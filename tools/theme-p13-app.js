/* PREVIEW เท่านั้น: จัดเมนู "เพิ่มเติม" ใหม่ (แผงล่างสไตล์การ์ดกลุ่ม + โหมดมืด/ออกจากระบบ) */
(function(){
  var P={
    track:'<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    cutq:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    qr:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    hist:'<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3z"/><path d="M10 8h4M10 12h4"/>',
    office:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'
  };
  function svg(k){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+P[k]+'</svg>'}
  var EMO=/^[✀-➿\u{1F300}-\u{1FAFF}☀-⛿\s]+/u;
  function build(){
    var sh=document.getElementById('taxSheet'); if(!sh||sh.dataset.p13)return; sh.dataset.p13='1';
    var t=document.createElement('div'); t.className='ts-title'; t.textContent='เมนูเพิ่มเติม'; sh.insertBefore(t,sh.firstChild);
    var map={wkBtn2:'qr',payHistBtn:'hist',sheetOffice:'office',sheetCutq:'cutq'};
    sh.querySelectorAll('.tax-sheet-sec').forEach(function(sec){
      var g=document.createElement('div'); g.className='ts-grid';
      Array.prototype.slice.call(sec.querySelectorAll('.tax-sheet-item')).forEach(function(b){
        var tn=b.childNodes; for(var i=0;i<tn.length;i++){ if(tn[i].nodeType===3){ tn[i].nodeValue=tn[i].nodeValue.replace(EMO,''); break; } }
        if(!b.querySelector('.tsi')){
          var k=map[b.id]||(b.dataset.tab==='track'?'track':''); 
          if(k){var w=document.createElement('span');w.className='tsi';w.innerHTML=svg(k);b.insertBefore(w,b.firstChild)}
        }
        g.appendChild(b);
      });
      sec.appendChild(g);
    });
    var secs=Array.prototype.slice.call(sh.querySelectorAll('.tax-sheet-sec')),body=document.createElement('div'),tabs=document.createElement('div');
    body.className='ts-body';tabs.className='ts-tabs';tabs.setAttribute('role','tablist');
    var names=['งานประจำวัน','ขาย','เงิน & ภาษี','ร้าน'],cur=0;
    try{cur=+localStorage.getItem('bs_ts_tab')||0}catch(e){}
    secs.forEach(function(sc,i){body.appendChild(sc);var t=document.createElement('button');t.type='button';t.setAttribute('role','tab');t.textContent=names[i]||('กลุ่ม '+(i+1));t.addEventListener('click',function(){cur=i;try{localStorage.setItem('bs_ts_tab',i)}catch(e){}paint()});tabs.appendChild(t)});
    function paint(){
      var tb=tabs.children,first=-1;
      secs.forEach(function(sc,i){var n=sc.querySelectorAll('.tax-sheet-item:not([hidden])').length;tb[i].hidden=!n;if(n&&first<0)first=i});
      if(secs[cur]&&tabs.children[cur].hidden)cur=first<0?0:first;
      secs.forEach(function(sc,i){sc.classList.toggle('on',i===cur);tb[i].classList.toggle('on',i===cur);tb[i].setAttribute('aria-selected',i===cur)});
    }
    sh.appendChild(body);sh.appendChild(tabs);paint();
    new MutationObserver(paint).observe(sh,{attributes:true,attributeFilter:['hidden'],subtree:true});
    var f=document.createElement('div'); f.className='ts-foot';
    f.innerHTML='<button type="button" class="ts-dark" id="tsDark">'+svg('moon')+'<span>โหมดมืด</span><i class="ts-sw"></i></button><button type="button" class="ts-out" id="tsOut">'+svg('out')+'<span>ออกจากระบบ</span></button>';
    sh.appendChild(f);
    function sync(){var a=document.documentElement.getAttribute('data-theme');var d=a==='dark'||(a!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);f.querySelector('.ts-dark').classList.toggle('on',d)}
    f.querySelector('#tsDark').addEventListener('click',function(){var b=document.getElementById('themeToggleBtn');if(b)b.click();sync()});
    f.querySelector('#tsOut').addEventListener('click',function(){var b=document.getElementById('menuLogout');if(b)b.click()});
    sync(); new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
  setTimeout(build,800);
})();
