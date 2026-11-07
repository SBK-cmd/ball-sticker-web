// Ball-only remote cut relay. Geometry, local paths and cutter addresses stay on the desktop.
const enc=new TextEncoder();
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const safe=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f]/.test(s);
const ref=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const requestId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(s);
export async function initRemoteCut(db){
 for(const sql of [
  `CREATE TABLE IF NOT EXISTS cut_hosts(id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, seen INTEGER NOT NULL, version TEXT NOT NULL, catalog TEXT NOT NULL, machines TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cut_pairs(secret TEXT PRIMARY KEY, host TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cut_mobiles(secret TEXT PRIMARY KEY, host TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cut_commands(id TEXT PRIMARY KEY, host TEXT NOT NULL, file TEXT NOT NULL, machine TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, message TEXT DEFAULT '')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cut_one_active_host ON cut_commands(host) WHERE state IN ('queued','claimed')`
 ])await db.prepare(sql).run();
}
function publication(catalog,machines){
 if(!Array.isArray(catalog)||catalog.length>100||!Array.isArray(machines)||machines.length>32)fail('รายการไฟล์หรือเครื่องมากเกินไป');
 const fs=new Set(),ms=new Set();
 const files=catalog.map(f=>{
  if(!f||!ref(f.id)||fs.has(f.id)||!safe(f.job,180)||!safe(f.no,80)||!safe(f.name,180)||!Number.isInteger(f.sheet)||!Number.isInteger(f.total)||f.sheet<1||f.total<f.sheet||f.total>10000)fail('ข้อมูลไฟล์ตัดไม่ถูกต้อง');
  fs.add(f.id);const thumb=f.thumb||'';
  if(typeof thumb!=='string'||thumb.length>60000||(thumb&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(thumb)))fail('รูปพรีวิวไม่ถูกต้อง');
  return{id:f.id,job:f.job,no:f.no,name:f.name,sheet:f.sheet,total:f.total,thumb};
 });
 const cutters=machines.map(m=>{if(!m||!ref(m.id)||ms.has(m.id)||!safe(m.name,80))fail('ข้อมูลเครื่องตัดไม่ถูกต้อง');ms.add(m.id);return{id:m.id,name:m.name};});
 if(enc.encode(JSON.stringify(files)).length>1500000)fail('รายการพรีวิวใหญ่เกินไป');return{files,cutters};
}
export function createRemoteCut(db,authorize,opt={}){
 const now=opt.now||(()=>Math.floor(Date.now()/1000));
 const first=(sql,...v)=>db.prepare(sql).bind(...v).first();
 const run=(sql,...v)=>db.prepare(sql).bind(...v).run();
 const online=h=>h&&h.enabled===1&&h.seen>=now()-30;
 const host=id=>first('SELECT * FROM cut_hosts WHERE id=?',id);
 const expire=id=>run("UPDATE cut_commands SET state='expired',message='คำสั่งหมดอายุ ยังไม่ได้ส่งตัด' WHERE host=? AND state='queued' AND expires<?",id,now());
 const commandView=c=>({ok:true,id:c.id,state:c.state,message:c.message||''});
 async function desktop(input,origin){
  const auth=await authorize(input.token);if(!auth||!ref(auth.id))fail('ไม่มีสิทธิ์รับคำสั่งตัด',401);
  const id=auth.id,t=now();await expire(id);
  if(input.action==='cut_sync'){
   const {files,cutters}=publication(input.catalog||[],input.machines||[]);
   const version=await hash(JSON.stringify({files,cutters}));
   await run('INSERT INTO cut_hosts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,seen=excluded.seen,version=excluded.version,catalog=excluded.catalog,machines=excluded.machines',id,input.enabled===true?1:0,t,version,JSON.stringify(files),JSON.stringify(cutters));
   await run("UPDATE cut_commands SET state='rejected',message='คอมปิดรับหรือรายการไฟล์เปลี่ยน กรุณาตรวจงานใหม่' WHERE host=? AND state='queued' AND (version<>? OR ?=0)",id,version,input.enabled===true?1:0);
   const active=await first("SELECT id,state FROM cut_commands WHERE host=? AND state IN ('queued','claimed')",id);
   return{ok:true,version,active:active||null};
  }
  const h=await host(id);
  if(input.action==='cut_pair'){
   if(!online(h))fail('เปิดรับคำสั่งบนคอมก่อน');
   const pair=random();await run('DELETE FROM cut_pairs WHERE expires<? OR (host=? AND used=0)',t,id);
   await run('INSERT INTO cut_pairs(secret,host,expires) VALUES(?,?,?)',await hash(pair),id,t+300);
   return{ok:true,pair,url:origin+'/cut#pair='+pair};
  }
  if(input.action==='cut_poll'){
   if(!online(h))return{ok:true,command:null};
   const c=await first("UPDATE cut_commands SET state='claimed' WHERE id=(SELECT id FROM cut_commands WHERE host=? AND state='queued' AND expires>=? AND version=? ORDER BY created LIMIT 1) AND state='queued' RETURNING *",id,t,h.version);
   return{ok:true,command:c?{id:c.id,file:c.file,machine:c.machine,version:c.version,expires:c.expires}:null};
  }
  if(input.action==='cut_ack'){
   if(!requestId(input.id)||!['sent','rejected','unknown'].includes(input.state))fail('ผลคำสั่งไม่ถูกต้อง');
   const c=await first('SELECT * FROM cut_commands WHERE id=? AND host=?',input.id,id);if(!c)fail('ไม่พบคำสั่ง',404);
   if(c.state===input.state)return commandView(c);if(c.state!=='claimed')fail('สถานะคำสั่งเปลี่ยนไปแล้ว');
   await run("UPDATE cut_commands SET state=?,message=? WHERE id=? AND host=? AND state='claimed'",input.state,String(input.message||'').slice(0,240),input.id,id);
   return{ok:true};
  }
  if(input.action==='cut_clear'){
   // This only clears the relay's stuck claim. It never purports to stop a plotter.
   await run("UPDATE cut_commands SET state='unknown',message='คอมยกเลิกคำสั่งค้าง ต้องตรวจเครื่องก่อนสั่งใหม่' WHERE host=? AND state IN ('queued','claimed')",id);return{ok:true};
  }
  fail('ไม่รู้จักคำสั่ง',400);
 }
 async function mobile(req){
  try{
   const url=new URL(req.url);
   if(req.method!=='POST'||req.headers.get('Origin')!==url.origin||!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))fail('คำขอต้องมาจากหน้าสั่งตัดนี้',403);
   if(Number(req.headers.get('Content-Length')||0)>2000000)fail('คำขอใหญ่เกินไป',413);
   const text=await req.text();if(text.length>2000000)fail('คำขอใหญ่เกินไป',413);
   let v;try{v=JSON.parse(text)}catch{fail('ข้อมูลไม่ถูกต้อง',400)}
   if(!v||typeof v!=='object')fail('ข้อมูลไม่ถูกต้อง',400);
   if(v.action==='pair'){
    if(!ref(v.pair))fail('ลิงก์จับคู่ไม่ถูกต้อง',401);
    const p=await first('UPDATE cut_pairs SET used=1 WHERE secret=? AND used=0 AND expires>=? RETURNING host',await hash(v.pair),now());
    if(!p||!online(await host(p.host)))fail('ลิงก์จับคู่หมดอายุ หรือคอมปิดรับแล้ว',401);
    const secret=random();await run('DELETE FROM cut_mobiles WHERE expires<?',now());
    await run('INSERT INTO cut_mobiles VALUES(?,?,?)',await hash(secret),p.host,now()+43200);
    return json({ok:true},200,{'Set-Cookie':'st_cut='+secret+'; Path=/cut; HttpOnly; Secure; SameSite=Strict; Max-Age=43200'});
   }
   const secret=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)st_cut=([a-f0-9]{64})(?:;|$)/)?.[1];
   const session=secret?await first('SELECT host FROM cut_mobiles WHERE secret=? AND expires>=?',await hash(secret),now()):null;
   if(!session)fail('จับคู่มือถือกับคอม SignTools ก่อน',401);
   const h=await host(session.host);if(!h)fail('ไม่พบคอมที่จับคู่',401);await expire(h.id);
   if(v.action==='logout'){await run('DELETE FROM cut_mobiles WHERE secret=?',await hash(secret));return json({ok:true},200,{'Set-Cookie':'st_cut=; Path=/cut; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
   if(v.action==='state'){
    const files=JSON.parse(h.catalog).filter(f=>safe(v.job,180)&&f.job===v.job);
    const active=await first("SELECT id,state,message FROM cut_commands WHERE host=? AND state IN ('queued','claimed')",h.id);
    return json({ok:true,online:online(h),version:h.version,files,machines:JSON.parse(h.machines),active:active||null});
   }
   if(v.action==='status'){
    const c=await first('SELECT * FROM cut_commands WHERE id=? AND host=?',String(v.id||''),h.id);if(!c)fail('ไม่พบคำสั่ง',404);return json(commandView(c));
   }
   if(v.action==='submit'){
    if(!requestId(v.id))fail('รหัสคำสั่งไม่ถูกต้อง');
    const old=await first('SELECT * FROM cut_commands WHERE id=?',v.id);
    if(old){if(old.host!==h.id||old.file!==v.file||old.machine!==v.machine||old.version!==v.version)fail('รหัสคำสั่งซ้ำกับงานอื่น');return json(commandView(old));}
    if(!online(h)||v.ready!==true||v.confirm!==true||v.version!==h.version)fail('คอมออฟไลน์หรือรายการเปลี่ยน กรุณาตรวจและยืนยันใหม่');
    const f=JSON.parse(h.catalog).find(f=>f.id===v.file&&f.job===v.job),m=JSON.parse(h.machines).find(m=>m.id===v.machine);
    if(!f||!m)fail('ไม่พบไฟล์หรือเครื่องที่เลือก กรุณารีเฟรช');
    try{await run("INSERT INTO cut_commands(id,host,file,machine,version,state,created,expires) VALUES(?,?,?,?,?,'queued',?,?)",v.id,h.id,f.id,m.id,h.version,now(),now()+30);}
    catch(e){const same=await first('SELECT * FROM cut_commands WHERE id=? AND host=?',v.id,h.id);if(same&&same.file===v.file&&same.machine===v.machine&&same.version===v.version)return json(commandView(same));fail('คอมกำลังมีคำสั่งค้าง กรุณารอผลก่อน');}
    return json({ok:true,id:v.id,state:'queued'});
   }
   fail('ไม่รู้จักคำสั่ง',400);
  }catch(e){return json({ok:false,error:e.status?e.message:'ระบบรับคำสั่งขัดข้อง'},e.status||500);}
 }
 return{desktop,mobile};
}
