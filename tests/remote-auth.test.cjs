const{test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');const{DatabaseSync}=require('node:sqlite');
test('real Worker endpoints require active unexpired Ball AI beta license bound to this desktop',async()=>{
 const{default:worker}=await import('file://'+path.resolve('signtools-worker/src/index.js'));
 const sql=new DatabaseSync(':memory:'),db={prepare(s){const bound=(v=[])=>({first:async()=>sql.prepare(s).get(...v)||null,all:async()=>({results:sql.prepare(s).all(...v)}),run:async()=>{const r=sql.prepare(s).run(...v);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}});return{...bound(),bind:(...v)=>bound(v)}},batch:async a=>{const results=[];for(const x of a)results.push(await x.run());return results;}};
 await worker.fetch(new Request('https://test.example/cut'),{DB:db});
 const kp=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const settings=(k,v)=>sql.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)').run(k,v);
 settings('sign_private',Buffer.from(await crypto.subtle.exportKey('pkcs8',kp.privateKey)).toString('base64'));settings('sign_public',Buffer.from(await crypto.subtle.exportKey('raw',kp.publicKey)).toString('base64'));settings('beta_phones','0935353555');
 const now=Math.floor(Date.now()/1000);
 sql.prepare("INSERT INTO users(id,phone,status,tools_off) VALUES(1,'0935353555','active','')").run();
 sql.prepare("INSERT INTO keys(key,status,machine,user_id,product,expires_at) VALUES('test-key','active','test-machine',1,'ai',?)").run(now+86400);
 async function token(p={}){const data=Buffer.from(JSON.stringify({k:'test-key',m:'test-machine',exp:now+3600,iat:now,...p}));return data.toString('base64url')+'.'+Buffer.from(await crypto.subtle.sign('Ed25519',kp.privateKey,data)).toString('base64url')}
 const api=async tok=>{const r=await worker.fetch(new Request('https://test.example/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cut_sync',token:tok,enabled:true,catalog:[],machines:[]})}),{DB:db});return{status:r.status,body:await r.json()}};
 const good=await token();assert.equal((await api(good)).status,200);
 assert.equal((await api(await token({exp:now-1}))).status,401);assert.equal((await api(await token({m:'other-machine'}))).status,401);
 const variants=[['keys',"product='cdr'","product='ai'"],['keys',"status='revoked'","status='active'"],['keys','expires_at=1','expires_at='+(now+86400)],['users',"status='revoked'","status='active'"],['users',"phone='0900000000'","phone='0935353555'"],['users',"tools_off='cut'","tools_off=''"],['users',"tools_off='queue'","tools_off=''"],['settings',"v='' WHERE k='beta_phones'","v='0935353555' WHERE k='beta_phones'"]];
 for(const[t,change,undo]of variants){sql.exec('UPDATE '+t+' SET '+change);assert.equal((await api(good)).status,401,change);sql.exec('UPDATE '+t+' SET '+undo);}
 const denied=await api('not-a-token');assert.equal(denied.status,401);
});
