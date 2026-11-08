/* p11: เปลี่ยนอีโมจิในหน้าจอเป็นไอคอนเส้นชุดเดียว (แสดงผลอย่างเดียว ไม่แตะช่องกรอก/ข้อความที่ถูกคัดลอก) */
(function(){
  var P={
    '📦':'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    '🔔':'<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"/>',
    '✅':'<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    '📋':'<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
    '📷':'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    '💳':'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/>',
    '📞':'<path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    '💰':'<circle cx="12" cy="12" r="9"/><path d="M14.500 9.500c-.5-1-1.500-1.500-2.500-1.500-1.500 0-2.500.8-2.500 2s1 1.700 2.500 2 2.500.8 2.500 2-1 2-2.500 2c-1 0-2-.5-2.500-1.500M12 6.500v1.500M12 16v1.500"/>',
    '⚠️':'<path d="M12 4 2.500 20h19z"/><path d="M12 10v4.500M12 17.500v.01"/>',
    '⚠':'<path d="M12 4 2.500 20h19z"/><path d="M12 10v4.500M12 17.500v.01"/>',
    '🙏':'',
    '🏷️':'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.200"/>',
    '🏷':'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.200"/>'
  };
  var keys=Object.keys(P).sort(function(a,b){return b.length-a.length});
  var re=new RegExp('('+keys.map(function(k){return k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}).join('|')+')\uFE0F?','g');
  var SKIP={TEXTAREA:1,INPUT:1,SCRIPT:1,STYLE:1,TITLE:1,PRE:1,CODE:1};
  function svg(k){var p=P[k];return p?'<svg class="ic-e" viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>':''}
  function walk(root){
    if(!root||root.nodeType!==1&&root.nodeType!==11)return;
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n,list=[];
    while((n=w.nextNode())){re.lastIndex=0;if(re.test(n.nodeValue))list.push(n)}
    list.forEach(function(t){
      var el=t.parentNode;if(!el||SKIP[el.nodeName]||(el.closest&&el.closest('textarea,[data-keep-emoji],#trackMessage,.cutq-modal [contenteditable]')))return;
      if(el.nodeName==='OPTION'){t.nodeValue=t.nodeValue.replace(re,'').replace(/^\s+/,'');return}
      var html=t.nodeValue.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(re,function(m,k){return svg(k)});
      var sp=document.createElement('span');sp.className='ic-wrap';sp.innerHTML=html;t.parentNode.replaceChild(sp,t);
    });
  }
  var busy=false;
  function run(){if(busy)return;busy=true;try{walk(document.body)}finally{busy=false}}
  var tm;new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(run,60)}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  if(document.readyState!=='loading')run();else document.addEventListener('DOMContentLoaded',run);
})();
