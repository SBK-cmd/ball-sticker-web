(function(){
  var $=function(i){return document.getElementById(i)};
  function init(){
    var panel=$('panel-calc');if(!panel||panel.dataset.p6)return;panel.dataset.p6='1';
    var fs=panel.querySelectorAll('.calc-grid>.card>fieldset');
    var chev='<svg class="acc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    fs.forEach(function(f,i){
      var lg=f.querySelector('legend');if(!lg)return;
      var t=lg.textContent.replace(/\s*\(ไม่บังคับ\)\s*$/,'');
      lg.innerHTML='<span class="acc-title"></span><span class="acc-sum"></span>'+chev;lg.querySelector('.acc-title').textContent=t;
      var body=document.createElement('div');body.className='acc-body';
      while(lg.nextSibling)body.appendChild(lg.nextSibling);f.appendChild(body);
      if(i===0)f.classList.add('open');
      lg.addEventListener('click',function(){f.classList.toggle('open')});
    });
    function unit(){var b=document.querySelector('#sunit button.on');return b?b.textContent.trim():'ซม.'}
    function sums(){
      var s=fs[0]&&fs[0].querySelector('.acc-sum');if(s)s.textContent=$('sw').value+' × '+$('sh').value+' '+unit();
      s=fs[1]&&fs[1].querySelector('.acc-sum');if(s){var o=$('paper');s.textContent=o.options[o.selectedIndex].text.replace(/ เซนติเมตร/,'')}
      s=fs[2]&&fs[2].querySelector('.acc-sum');if(s)s.textContent='ช่องไฟ '+$('gap').value+' · ขอบ '+$('margin').value+' ซม.';
      s=fs[3]&&fs[3].querySelector('.acc-sum');if(s)s.textContent=$('fillOn').checked?$('fw').value+' × '+$('fh').value+' ซม.':'ปิดอยู่';
    }
    panel.addEventListener('input',sums);panel.addEventListener('change',sums);panel.addEventListener('click',function(){setTimeout(sums,0)});
    sums();
    // ตัวอย่างการเรียง พับได้
    var vc=$('viz')&&$('viz').closest('.card');var vh=vc&&vc.querySelector('.viz-head');
    if(vc){vc.id='viz-card';vc.classList.add('collapsed');vh.addEventListener('click',function(){vc.classList.toggle('collapsed')})}
    // แถบผลลัพธ์ติดบน
    var bar=document.createElement('div');bar.className='calc-bar no-print';
    bar.innerHTML='<div class="cb-t"><div class="cb-n"><span id="cbN">0</span><small>ชิ้น</small></div><div class="cb-s" id="cbS"></div></div><button type="button" id="cbPrice">คิดราคา</button><button type="button" class="go" id="cbGo">สั่งงาน</button>';
    document.body.appendChild(bar);
    function upd(){$('cbN').textContent=$('count').textContent;$('cbS').textContent=($('cols').textContent||'0')+' ต่อแถว × '+($('rows').textContent||'0')+' แถว'}
    new MutationObserver(upd).observe($('count'),{childList:true,characterData:true,subtree:true});upd();
    var res=panel.querySelector('.result');
    function vis(show){bar.classList.toggle('show',show&&panel.classList.contains('active'))}
    if('IntersectionObserver'in window&&res){
      var io=new IntersectionObserver(function(e){var r=e[0];vis(!r.isIntersecting&&r.boundingClientRect.top<0)},{threshold:0});io.observe(res);
    }
    new MutationObserver(function(){if(!panel.classList.contains('active'))bar.classList.remove('show')}).observe(panel,{attributes:true,attributeFilter:['class']});
    $('cbPrice').addEventListener('click',function(){var p=$('priceCard');if(p)p.scrollIntoView({behavior:'smooth',block:'start'})});
    $('cbGo').addEventListener('click',function(){var b=document.querySelector('.btab[data-tab="confirm"]');if(b)b.click();window.scrollTo(0,0)});
  }
  if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
})();
