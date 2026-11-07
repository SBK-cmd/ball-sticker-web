// Actual panel cut preset compiler and QR snapshot archive, with every TCP/Firestore call replaced locally.
const{chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const root='signtools-panel/SignTools',b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),page=await b.newPage({viewport:{width:600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());const html=fs.readFileSync(root+'/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<link rel="stylesheet" href="css/style.css">','<style>'+fs.readFileSync(root+'/css/style.css','utf8')+'</style>');await page.setContent(html);
 await page.evaluate(()=>{window.ST_core={hash:s=>s};window.__adobe_cep__={evalScript:(s,cb)=>cb(JSON.stringify({ok:true,msg:'test'}))};window.STPromptPay={};window.__testRequire=()=>({});window.tcp=0});
 for(const f of ['lib/qrcode.js','tools.js','cutjob.js'])await page.addScriptTag({content:fs.readFileSync(root+'/js/'+f,'utf8')});
 await page.evaluate(()=>{STCut.net=()=>({send:()=>{window.tcp++;return Promise.resolve(100)}})});
 await page.addScriptTag({content:fs.readFileSync(root+'/js/cut.js','utf8')});
 const values=await page.evaluate(()=>{
  const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change'))};set('cutIp','127.0.0.1');set('cutPort','9100');set('cutMName','เครื่องจำลอง');set('cutOver','0');
  const old=ST_cutApi.remoteMachines()[0].id;set('cutOver','1.5');const updated=ST_cutApi.remoteMachines()[0].id;
  const snap={src:'cut',n:1,pts:4,paths:[{c:1,k:'kiss',p:[0,0,0,0,0,0,30,0,30,0,30,0,30,20,30,20,30,20,0,20,0,20,0,20]}],marks:{style:1,seg:false,ox:-3,oy:-3,dx:26,dy:36,lenMM:15}};
  let stale=false;try{ST_cutApi.remotePrepare(old,snap,{key:'test'})}catch(e){stale=true}
  window.remoteSend=ST_cutApi.remotePrepare(updated,snap,{key:'test'});return{old,updated,stale,over:document.getElementById('cutOver').value};
 });
 assert.notEqual(values.old,values.updated,'overcut must change versioned preset');assert(values.stale);assert.equal(values.over,'1.5');await page.evaluate(()=>remoteSend());assert.equal(await page.evaluate(()=>tcp),1);// Queue acquires a single saved-sheet snapshot and verifies disk mtime on both sides.
 await page.evaluate(()=>{
  const memory={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>memory[k]||null,setItem:(k,v)=>memory[k]=String(v),removeItem:k=>delete memory[k]}});
  ST_core.hash=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return ('0'.repeat(64)+(h>>>0).toString(16)).slice(-64)};
  ST_core.features=()=>Promise.resolve({queue:{projectId:'test-project',apiKey:'invalid-test-placeholder'}});
  window.testMtime=1000;window.testSheet=1;window.testChangeMtime=false;
  window.cep_node={require:n=>({statSync:()=>({mtimeMs:testMtime})})};
  const snap={src:'cut',n:1,pts:4,paths:[{c:1,k:'kiss',p:[0,0,0,0,0,0,30,0,30,0,30,0,30,20,30,20,30,20,0,20,0,20,0,20]}],marks:{style:1,seg:false,ox:-3,oy:-3,dx:26,dy:36,lenMM:15}};
  __adobe_cep__.evalScript=(s,cb)=>{let r={ok:true};if(s.startsWith('st_cutSnapshot(')){r={read:{...snap,jobNote:JSON.stringify({kind:'st-job-qr',jobId:'job-test',sheet:testSheet,total:2})},mark:{why:'ok',ab:[-10,40,50,-10],marks:[[0,0,1],[40,0,1],[0,30,1],[40,30,1]]},thumb:{error:'mock thumbnail unavailable'},scan:{path:'/test/job.ai',ab:testSheet-1}};if(testChangeMtime)testMtime+=10}cb(JSON.stringify(r))};
  window.XMLHttpRequest=class{open(m,u){this.method=m;this.url=u}setRequestHeader(){}send(){let r={};if(this.url.includes('accounts:signUp'))r={idToken:'test-only',refreshToken:'test-only',expiresIn:3600};else if(this.url.includes('/documents/jobs?'))r={documents:[{name:'projects/test/databases/(default)/documents/jobs/job-test',fields:{no:{stringValue:'JB-TEST'},jName:{stringValue:'ทดสอบ'},status:{stringValue:'pending'},aiFile:{stringValue:'/test/job.ai'},aiFileName:{stringValue:'ทดสอบ.ai'}}}]};else if(this.url.includes('/documents/wholesale?'))r={documents:[]};this.status=200;this.responseText=JSON.stringify(r);setTimeout(()=>this.onload(),0)}};
 });
 await page.addScriptTag({content:fs.readFileSync(root+'/js/job-qr.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync(root+'/js/queue.js','utf8')});
 await page.waitForFunction(()=>window.ST_queueReady&&document.querySelector('#cqList [data-act=scan]'));
 await page.locator('.tab[data-tab=queue]').click();await page.locator('#cqList [data-act=scan]').first().click();await page.waitForFunction(()=>ST_queueRemote.catalog().length===1);
 const cat=await page.evaluate(()=>ST_queueRemote.catalog());assert.equal(cat[0].sheet,1);assert(cat[0].thumb.startsWith('data:image/'));
 await page.evaluate(()=>testSheet=2);await page.locator('#cqList [data-act=scan]').first().click();await page.waitForFunction(()=>ST_queueRemote.catalog().length===2);
 assert.deepEqual((await page.evaluate(()=>ST_queueRemote.catalog().map(q=>q.sheet))).sort(),[1,2]);
 await page.evaluate(()=>{testMtime=2000;testChangeMtime=true});await page.locator('#cqList [data-act=scan]').first().click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('ไฟล์ถูกแก้ระหว่างสแกน'));
 assert.equal(await page.evaluate(()=>ST_queueRemote.catalog().length),0);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('st_remote_sheets_v1')).length),2);
 await page.evaluate(()=>{testMtime=1000;testChangeMtime=false});assert.equal(await page.evaluate(()=>ST_queueRemote.catalog().length),2);
 await page.locator('#cqList .qjob').first().evaluate(el=>el.click());await page.locator('#cqModal [data-act=unlink]').first().click();await page.waitForFunction(()=>ST_queueRemote.catalog().length===0);
 assert.deepEqual(errors,[]);await b.close();console.log('PASS: actual cut preset rejects stale overcut config; real compile dispatches once to fake TCP only');})().catch(e=>{console.error(e);process.exit(1)});
