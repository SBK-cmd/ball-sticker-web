/* At-most-once remote dispatch; all physical sending remains in the existing local cut API. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();else{root.STRemoteCut=factory();boot(root);}
 function boot(w){
  var tries=0;
  function wait(){if(w.ST_COREL)return;var c=w.ST_core;if(c&&c.features&&w.ST_queueReady&&!document.body.classList.contains('locked')){c.features().then(function(f){if(f&&f.remoteCut&&w.ST_queueRemote&&w.ST_cutApi)start(c);});return;}if(++tries<900)setTimeout(wait,2000);}
  function start(c){
   var pane=document.getElementById('tab-queue');if(!pane)return;
   var card=document.createElement('div');card.className='card';card.id='stRemoteCutCard';
   card.innerHTML='<label class="chk"><input type="checkbox" id="stRemoteOn"><b>เปิดรับคำสั่งตัดจากมือถือ · บอลเบต้า</b></label><p class="hint">เปิดรับครั้งละ 1 ชั่วโมง คอมและ SignTools ต้องเปิดอยู่ · สแกนแผ่นที่มี QR แล้วผูกไฟล์ก่อน · ใช้ได้กับมาร์คที่รองรับเท่านั้น</p><button class="btn ghost sm" id="stRemotePair" disabled>จับคู่มือถือ</button> <button class="btn ghost sm" id="stRemoteClear">ล้างคำสั่งค้างในระบบ</button><canvas id="stRemotePairQR" width="240" height="240" hidden></canvas><p id="stRemoteStatus" class="hint" role="status">ปิดรับอยู่</p>';
   pane.insertBefore(card,pane.firstChild);
   var $=function(id){return document.getElementById(id);},until=0,running=false,lastVersion='',timer=null,ackPending=null,published=false;
   var overlay=document.createElement('div');overlay.id='stRemoteLock';overlay.style.cssText='display:none;position:fixed;inset:0;background:rgba(20,20,24,.93);z-index:999999;padding:35px 20px;color:white;text-align:center';overlay.innerHTML='<h2>กำลังจัดการคำสั่งตัดจากมือถือ</h2><p>รอผลการส่งข้อมูลสักครู่</p><button class="btn ghost" id="stRemoteStop">ปิดรับคำสั่งใหม่</button><p>ปุ่มนี้ไม่หยุดการส่งที่เริ่มแล้ว หากต้องหยุดเครื่องให้ใช้ปุ่มบนเครื่องตัด</p>';document.body.appendChild(overlay);
   function enabled(){return $('stRemoteOn').checked&&Date.now()<until;}
   function status(s){$('stRemoteStatus').textContent=s;}
   function lock(b){w.ST_remoteBusy=b;overlay.style.display=b?'block':'none';}
   var ex=w.STRemoteCut.executor({now:function(){return Math.floor(Date.now()/1000);},guard:enabled,remember:c.remoteRemember,
    prepare:function(cmd){
     if(cmd.version!==lastVersion)throw new Error('รายการไฟล์เปลี่ยน กรุณารีเฟรชมือถือ');
     return w.ST_queueRemote.prepare(cmd.file,cmd.machine);
    },ack:function(result){return c.remoteCut('cut_ack',result).catch(function(e){ackPending=result;throw e;});}
   });
   function tick(){
    if(running)return;running=true;
    if($('stRemoteOn').checked&&!enabled())$('stRemoteOn').checked=false;
    var on=enabled(),catalog=[],machines=[];
    if(!on&&!published&&!ackPending){running=false;$('stRemotePair').disabled=true;return;}
    try {if(on){catalog=w.ST_queueRemote.catalog();machines=w.ST_cutApi.remoteMachines();}}catch(e){status(e.message);running=false;return;}
    $('stRemotePair').disabled=!on;
    if(on)published=true;
    c.remoteCut('cut_sync',{enabled:on,catalog:catalog,machines:machines}).then(function(s){
     if(!on)published=false;
     lastVersion=s.version;
     status(on?'เปิดรับ · '+catalog.length+' แผ่นพร้อม · '+machines.length+' เครื่อง'+(s.active?' · มีคำสั่ง '+s.active.state:''):'ปิดรับอยู่');
     if(ackPending)return c.remoteCut('cut_ack',ackPending).then(function(){ackPending=null;});
     if(on)return c.remoteCut('cut_poll').then(function(r){
      if(!r.command)return;
      lock(true);return ex.run(r.command).then(function(result){status(result.state==='sent'?'ส่งข้อมูลเข้าเครื่องแล้ว (ยังไม่ทราบว่าตัดเสร็จ)':result.state==='unknown'?'ไม่ทราบผล ตรวจเครื่องก่อนสั่งใหม่':'ไม่ส่งตัด: '+result.message);lock(false);});
     });
    }).catch(function(e){status('เชื่อมมือถือไม่ได้: '+e.message);lock(false);}).then(function(){running=false;});
   }
   $('stRemoteOn').onchange=function(){until=this.checked?Date.now()+3600000:0;$('stRemotePairQR').hidden=true;tick();};
   $('stRemoteStop').onclick=function(){$('stRemoteOn').checked=false;until=0;};
   $('stRemotePair').onclick=function(){if(!enabled())return;this.disabled=true;c.remoteCut('cut_pair').then(function(r){
    var q=w.qrcode(0,'M');q.addData(r.url,'Byte');q.make();var cv=$('stRemotePairQR'),g=cv.getContext('2d'),n=q.getModuleCount(),size=cv.width/(n+8);g.fillStyle='#fff';g.fillRect(0,0,cv.width,cv.height);g.fillStyle='#000';for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(q.isDark(y,x))g.fillRect((x+4)*size,(y+4)*size,size+.1,size+.1);cv.hidden=false;status('สแกน QR นี้ด้วยมือถือเพื่อจับคู่ ใช้ได้ครั้งเดียวภายใน 5 นาที');
   }).catch(function(e){status(e.message);}).then(function(){$('stRemotePair').disabled=!enabled();});};
   $('stRemoteClear').onclick=function(){if(!confirm('ตรวจเครื่องแล้วใช่ไหม? ล้างคำสั่งค้างในระบบเท่านั้น ไม่หยุดเครื่องและไม่ส่งซ้ำ'))return;c.remoteCut('cut_clear').then(function(){ackPending=null;tick();},function(e){status(e.message);});};
   timer=setInterval(tick,3000);
  }
  wait();
 }
})(typeof window==='undefined'?this:window,function(){
 'use strict';
 function executor(opt){
  var busy=false;
  function run(cmd){
   if(busy)return Promise.resolve({id:cmd.id,state:'rejected',message:'คอมกำลังรับคำสั่งอื่น'});
   busy=true;var started=false,result;
   return Promise.resolve().then(function(){
    if(!opt.guard()||opt.now()>cmd.expires)throw new Error('คำสั่งหมดอายุหรือคอมปิดรับแล้ว');
    if(!opt.remember(cmd.id)){result={id:cmd.id,state:'unknown',message:'เคยรับคำสั่งนี้แล้ว ไม่ส่งซ้ำ กรุณาตรวจเครื่อง'};return null;}
    return opt.prepare(cmd);
   }).then(function(send){
    if(result)return;
    if(typeof send!=='function'||!opt.guard()||opt.now()>cmd.expires)throw new Error('คำสั่งหรือไฟล์ไม่พร้อมก่อนส่ง');
    started=true;return send();
   }).then(function(){if(!result)result={id:cmd.id,state:'sent',message:'ส่งข้อมูลเข้าเครื่องแล้ว ยังไม่ทราบว่าตัดเสร็จหรือไม่'};},function(e){result={id:cmd.id,state:started?'unknown':'rejected',message:String(e.message||e).slice(0,240)};})
    .then(function(){return Promise.resolve().then(function(){return opt.ack(result);}).then(function(){return result;},function(){result.ackPending=true;return result;});})
    .then(function(r){busy=false;return r;},function(e){busy=false;throw e;});
  }
  return{run:run};
 }
 return{executor:executor};
});
