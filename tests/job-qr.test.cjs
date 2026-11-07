const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const file='signtools-panel/SignTools/js/job-qr.js';
let Q;if(fs.existsSync(file)) Q=require('../'+file);
const qr=require('../signtools-panel/SignTools/js/lib/qrcode.js');
const job={id:'job /ก&?',no:'JB261107-TEST',jName:'ลูกค้าทดสอบ'};
test('job QR identifies exact job without personal data',()=>{
 assert.ok(Q,'job QR helper missing');const q=Q.create(job,qr);
 const u=new URL(q.url);assert.equal(u.origin,'https://signtools.organic-parmesan.workers.dev');assert.equal(u.pathname,'/cut');assert.equal(u.searchParams.get('job'),job.id);
 assert.equal(q.url.includes(job.jName),false);assert.equal(q.quiet,4);assert(q.rows.length>=21);assert(q.rows.every(r=>r.length===q.rows.length&&/^[01]+$/.test(r)));assert(q.sizeMM/(q.rows.length+8)>=.4);
});
test('reject local or wholesale cards and missing/invalid job references',()=>{
 assert.ok(Q);[null,{}, {id:'x',no:''},{...job,_col:'local'},{...job,ws:true},{...job,_doc:'x'},{...job,_col:'wholesale'},{...job,id:'x'.repeat(400)}].forEach(j=>assert.throws(()=>Q.create(j,qr)));
});
test('mixed-size footer stays below every piece and within full and trimmed sheets',()=>{
 assert.ok(Q);const q=Q.create(job,qr);
 for(const scale of [72/25.4,72/25.4/10])for(const bleed of [0,10]){
  const pieces=[{x:19*scale,y:19*scale,w:50*scale,h:30*scale},{x:75*scale,y:19*scale,w:20*scale,h:80*scale,r:1}];
  const margin=19,W=560*scale,H=1010*scale;
  const h=Q.trimHeight(q,pieces,H,margin,scale,bleed);
  for(const sh of [H,h]){
   const f=Q.footer(q,pieces,W,sh,margin,scale,bleed,1,3);
   assert(f.y>=99*scale+bleed*scale+7*scale);assert(f.y+f.size+9*scale<=sh);
   assert(f.x>=margin*scale);assert(f.x+f.size<=W-margin*scale);assert.equal(f.caption,job.no+'\rแผ่น 2/3');
  }
  assert(Q.reserveMM(q,bleed)>q.sizeMM);
 }
});
test('rejects a narrow sheet or missing reserved height before Illustrator mutation',()=>{
 assert.ok(Q);const q=Q.create(job,qr);assert.throws(()=>Q.footer(q,[{y:10,h:20}],30,100,5,1,0,0,1));assert.throws(()=>Q.footer(q,[{y:10,h:80}],200,100,5,1,0,0,1));
});
test('Illustrator QR renderer exists and rejects malformed geometry before creating artwork',()=>{
 const host=fs.readFileSync('signtools-panel/SignTools/jsx/host.jsx','utf8').replace(/^#.*$/mg,'');
 const ctx={};vm.createContext(ctx);vm.runInContext(host,ctx);
 assert.equal(typeof ctx.st_jobQR,'function');
 let created=0;const layer={groupItems:{add(){created++;return {};}}};
 assert.throws(()=>ctx.st_jobQR({},layer,{rows:['1'],size:28,quiet:4,x:0,y:0},0,0));assert.equal(created,0);
});
test('Illustrator renders white quiet zone and black fill-only modules with sheet metadata at both canvas scales',()=>{
 const host=fs.readFileSync('signtools-panel/SignTools/jsx/host.jsx','utf8').replace(/^#.*$/mg,'');
 const q=Q.create(job,qr),unit=72/25.4;
 for(const sf of [1,10]){
  const ctx={};vm.createContext(ctx);vm.runInContext(host,ctx);ctx.ST_SF=sf;ctx.st_color=(d,rgb,cmyk)=>({rgb,cmyk});ctx.st_thaiFont=()=>null;
  const paths=[],attributes={},cap={textRange:{characterAttributes:attributes},width:20/sf,height:5*unit/sf};
  const shape={rectangle(top,left,w,h){const p={top,left,w,h};paths.push(p);return p;}};
  const g={pathItems:shape,compoundPathItems:{add(){return {pathItems:shape};}},textFrames:{add(){return cap;}},remove(){this.removed=true;}};
  const layer={groupItems:{add(){return g;}}};
  const footer=Q.footer(q,[{x:0,y:0,w:20*unit/sf,h:30*unit/sf}],210*unit/sf,297*unit/sf,19,unit/sf,0,0,2);
  const drawn=ctx.st_jobQR({},layer,footer,100,-50);
  assert.equal(drawn,g);assert(paths.length>30);assert(paths.every(p=>p.filled===true&&p.stroked===false));
  const bg=paths[0],module=footer.size/(q.rows.length+8);
  assert.equal(bg.left,100+footer.x);assert.equal(bg.top,-50-footer.y);
  for(const p of paths.slice(1)){assert(p.left>=bg.left+4*module-1e-8);assert(p.top<=bg.top-4*module+1e-8);assert(p.left+p.w<=bg.left+bg.w-4*module+1e-8);}
  assert.equal(cap.contents,footer.caption);assert.equal(JSON.parse(g.note).jobId,job.id);assert.equal(JSON.parse(g.note).sheet,1);
 }
});
test('render failure removes partially created QR group',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('signtools-panel/SignTools/jsx/host.jsx','utf8'),ctx);
 ctx.st_color=()=>({});ctx.st_thaiFont=()=>null;
 const shape={rectangle(){return {}}},g={pathItems:shape,compoundPathItems:{add(){return {pathItems:shape}}},textFrames:{add(){return {width:10000,height:10,textRange:{characterAttributes:{}}}}},remove(){this.removed=true;}};
 const q=Q.create(job,qr),f=Q.footer(q,[{y:0,h:20}],210,297,19,1,0,0,1);
 assert.throws(()=>ctx.st_jobQR({},{groupItems:{add(){return g}}},f,0,0));assert.equal(g.removed,true);
});
test('QR failure rolls back sticker artwork and cut paths already placed on existing layers',()=>{
 const ctx={SpotColor:function(){},ElementPlacement:{PLACEATEND:1}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('signtools-panel/SignTools/jsx/host.jsx','utf8'),ctx);
 const clones=[],ab=[],layers={},fake=()=>({visibleBounds:[0,20,20,0],geometricBounds:[0,20,20,0],position:[0,20],name:'art',typename:'GroupItem',duplicate(){const c=fake();clones.push(c);return c;},remove(){this.removed=true;},move(){},translate(){},rotate(){}});
 const src=fake(),makeLayer=()=>({pageItems:[],groupItems:{add(){return fake();}},remove(){}});
 const boards=[{artboardRect:[0,200,200,0]}];boards.add=r=>{const a={artboardRect:r,remove(){this.removed=true;}};ab.push(a);return a;};
 const doc={layers:{add:makeLayer,getByName(){throw Error('no preview');}},artboards:boards,selection:null};
 Object.assign(ctx,{st_doc:()=>doc,st_selection:()=>[src],st_designs:()=>[{art:src,cuts:[]}],st_cutSwatch:()=>({}),st_bc:()=>{},st_bcClear:()=>{},st_findType:()=>[],st_findCuts:()=>[],st_shapeCut:()=>fake(),st_hasRaster:()=>false,st_hasLayer:()=>true,st_layer:(d,n)=>layers[n]||(layers[n]=makeLayer()),st_freeSpot:()=>[1000,1000],st_jobQR:()=>{throw Error('caption too wide');}});
 const result=JSON.parse(ctx.st_stkPlace({count:1,cutType:'rect',symbol:false,sheetW:200,sheetH:200,sheets:[[{d:0,x:10,y:10,r:0}]],jobQR:[{x:10,y:50,size:28}]}));
 assert.match(result.error,/caption too wide/);
 assert(clones.length>=3);assert(clones.slice(1).every(c=>c.removed),'all final artwork copies must be removed after QR error (prototype is removed with staging)');assert(ab.every(a=>a.removed));
});
test('full-sheet scan rejects unsaved or switched Illustrator document',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('signtools-panel/SignTools/jsx/host.jsx','utf8'),ctx);
 const doc={saved:false,fullName:{fsName:'/expected.ai'},selection:[],artboards:{getActiveArtboardIndex:()=>0}};
 ctx.st_doc=()=>doc;ctx.st_cutRead=()=>'{"n":1,"paths":[]}';
 assert.match(JSON.parse(ctx.st_cutReadSheet('/expected.ai')).error,/บันทึก/);
 doc.saved=true;assert.match(JSON.parse(ctx.st_cutReadSheet('/other.ai')).error,/ไฟล์/);
});
