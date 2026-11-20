import w,{sumBankIn,sumAds,slim,dayRange,bkkDay,toFs,fromFields} from './mcp-shop-worker.js';
import {generateKeyPairSync} from 'node:crypto';
import assert from 'node:assert/strict';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'});
const env={MCP_KEY:'k'.repeat(40),FIRESTORE_SA_JSON:JSON.stringify({client_email:'x@y.iam',private_key:pem,project_id:'p'})};
const calls=[];
globalThis.fetch=async(u,o={})=>{u=String(u);calls.push({u,o});
 if(u.includes('oauth2'))return new Response(JSON.stringify({access_token:'t',expires_in:3600}));
 if(u.includes(':runQuery')){const sq=JSON.parse(o.body).structuredQuery;const col=sq.from[0].collectionId;
   const F=(x)=>({document:{name:'projects/p/databases/(default)/documents/'+col+'/'+x.id,fields:Object.fromEntries(Object.entries(x).filter(([k])=>k!=='id').map(([k,v])=>[k,toFs(v)]))}});
   if(col==='bankIn')return new Response(JSON.stringify([{id:'a',amount:100.5,account:'กิติพงษ์'},{id:'b',amount:200,account:'วันทิม'},{id:'c',amount:-50,account:'กิติพงษ์'},{id:'d',amount:0.25,account:'กิติพงษ์'}].map(F)));
   if(col==='jobs')return new Response(JSON.stringify([{id:'j1',no:'JBS1',jName:'ร้านA',jPhone:'081-234-5678',photo:'data:image/png;base64,AAA',note:'x'.repeat(500)}].map(F)));
   return new Response('[]');}
 if(u.includes('/mcpDrafts/')){return new Response('{}')}
 if(u.includes('/ads')) return new Response(JSON.stringify([{date:'2026-11-19',spend:759.45,chats:15,impressions:12853,clicks:100},{date:'2026-11-18',spend:240.55,chats:5,impressions:100,clicks:10}]));
 return new Response('{}',{status:404});};
const req=(path,body,h={})=>new Request('https://x'+path,{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(body)});
const K='/mcp/'+env.MCP_KEY;
const rpc=async(m,params)=>(await (await w.fetch(req(K,{jsonrpc:'2.0',id:1,method:m,params}),env)).json());
// auth
assert.equal((await w.fetch(req('/mcp/wrong',{}),env)).status,401);
assert.equal((await w.fetch(req('/mcp',{jsonrpc:'2.0',id:1,method:'ping'},{Authorization:'Bearer '+env.MCP_KEY}),env)).status,200);
assert.equal((await w.fetch(req('/mcp/x',{}),{...env,MCP_KEY:'short'})).status,503);
assert.equal((await w.fetch(new Request('https://x'+K,{method:'GET'}),env)).status,405);
assert.equal((await w.fetch(req(K,{jsonrpc:'2.0',method:'notifications/initialized'}),env)).status,202);
// protocol
assert.equal((await rpc('initialize',{})).result.serverInfo.name,'ball-sticker-shop');
const tl=(await rpc('tools/list')).result.tools.map(t=>t.name);
assert.deepEqual(tl,['list_jobs','get_job','list_bills','bank_in_summary','ads_summary','create_draft','list_drafts']);
// ไม่มีเครื่องมือแก้/ลบ
assert.ok(!tl.some(n=>/delete|update|pay|transfer|publish/.test(n)));
// bank
const b=JSON.parse((await rpc('tools/call',{name:'bank_in_summary',arguments:{date:'2026-11-19'}})).result.content[0].text);
assert.equal(b.count,2);assert.equal(b.total,100.75);assert.deepEqual(b.byAccount,{'กิติพงษ์':100.75});
// jobs slim
const j=JSON.parse((await rpc('tools/call',{name:'list_jobs',arguments:{}})).result.content[0].text)[0];
assert.equal(j.jPhone,'xxx-xxx-5678');assert.ok(!('photo' in j));assert.ok(j.note.endsWith('(ตัดแล้ว)'));
// ads
const a=JSON.parse((await rpc('tools/call',{name:'ads_summary',arguments:{days:2}})).result.content[0].text);
assert.equal(a.spend,1000);assert.equal(a.chats,20);assert.equal(a.costPerChat,50);
// draft ok + validation
calls.length=0;
const d=JSON.parse((await rpc('tools/call',{name:'create_draft',arguments:{kind:'quote',title:'ใบเสนอราคา A',body:'สติ๊กเกอร์ 100 ดวง'}})).result.content[0].text);
assert.equal(d.status,'draft');
const wr=calls.find(c=>c.u.includes('/mcpDrafts/'));assert.ok(wr.u.includes('currentDocument.exists=false'));
const sent=JSON.parse(wr.o.body).fields;assert.equal(sent.status.stringValue,'draft');assert.equal(sent.source.stringValue,'mcp');
for(const bad of [{kind:'delete',title:'a',body:'b'},{kind:'note',title:'',body:'b'},{kind:'note',title:'a',body:'x'.repeat(4001)},{kind:'note',title:'a',body:'b',data:{x:'y'.repeat(9000)}}]){
  const r=(await rpc('tools/call',{name:'create_draft',arguments:bad})).result;assert.equal(r.isError,true);}
// unknown tool
assert.ok((await rpc('tools/call',{name:'drop_all'})).error);
// pure
assert.equal(sumAds([]).costPerChat,null);assert.equal(bkkDay(Date.parse('2026-11-19T17:30:00Z')),'2026-11-20');assert.deepEqual(dayRange('2026-11-19'),[Date.parse('2026-11-18T17:00:00Z'),Date.parse('2026-11-19T17:00:00Z')]);assert.equal(dayRange('xx'),null);
console.log('ALL PASS');
