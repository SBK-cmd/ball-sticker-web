#!/usr/bin/env python3
"""Build the app from src/app.html.
   python3 tools/build.py preview  -> preview.html + js/p-lock.js + js/p-app.js
   python3 tools/build.py live     -> index.html, ball-sticker.html + js/lock.js + js/app.js
   The big inline scripts are moved to external files (deferred, cacheable, content-hashed)."""
import sys, re, hashlib, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
target = sys.argv[1] if len(sys.argv) > 1 else 'preview'
pre = 'p-' if target == 'preview' else ''
s = open(os.path.join(ROOT, 'src/app.html'), encoding='utf-8').read()
LOCK_MARK = '<script>\n(function () {\n  // ---- คลาวด์ (Firebase)'
def take(s, start):
    end = s.index('</script>', start) + len('</script>')
    return s[start:end], s[start + len('<script>'):end - len('</script>')]
# lock script
i = s.index(LOCK_MARK); block, lock_js = take(s, i)
# main app script = largest inline script
blocks = [(m.start(), m.group(1)) for m in re.finditer(r'<script>(.*?)</script>', s, re.S)]
ai, app_js = max(blocks, key=lambda b: len(b[1]))
app_block = '<script>' + app_js + '</script>'
def out(name, code):
    h = hashlib.sha1(code.encode()).hexdigest()[:10]
    open(os.path.join(ROOT, 'js', name), 'w', encoding='utf-8').write(code)
    return 'js/%s?v=%s' % (name, h)
lock_url = out(pre + 'lock.js', lock_js); app_url = out(pre + 'app.js', app_js)
# โหลดสคริปต์แบบฉลาด:
#  - เครื่องที่ล็อกอินแล้ว: Firebase + lock + app โหลดแบบ defer ทันที (เข้าแอปเร็วสุด)
#  - ยังไม่ล็อกอิน: วาดฟอร์มล็อกอินให้เสร็จก่อน แล้วค่อยโหลด Firebase + lock หลังหน้าโหลดเสร็จ (ไม่โหลดตัวแอปเลย)
#    พอล็อกอินสำเร็จหน้าจะรีโหลดเอง แล้วเข้าทางแรก
fb = re.findall(r'<script src="(https://www\.gstatic\.com/firebasejs/[^"]+)"></script>', s)
s = re.sub(r'<script src="https://www\.gstatic\.com/firebasejs/[^"]+"></script>\n?', '', s)
font_m = re.search(r'<link href="(https://fonts\.googleapis\.com/css2[^"]+)" rel="stylesheet"[^>]*>', s)
font_url = font_m.group(1); s = s.replace(font_m.group(0), '', 1)
import json
loader = ('<script>(function(){var ok=true;try{ok=!!localStorage.getItem("bs_session")}catch(e){}'
  'var core=%s,app=%s,font=%s;'
  'if(ok){var h="";core.concat([app]).forEach(function(u){h+=\'<script defer src="\'+u+\'"><\\/script>\'});document.write(h);'
  'var l=document.createElement("link");l.rel="stylesheet";l.href=font;document.head.appendChild(l);}'
  'else{var st=0,q=[];function go(cb){if(cb)q.push(cb);if(st===2){q.splice(0).forEach(function(f){f()});return}if(st)return;st=1;'
  'core.forEach(function(u,i){var e=document.createElement("script");e.src=u;e.async=false;if(i===core.length-1)e.onload=function(){st=2;setTimeout(function(){q.splice(0).forEach(function(f){f()})},0)};document.body.appendChild(e);});}'
  'window.bsLockSubmit=function(f){if(st===2)return false;go(function(){f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event("submit",{cancelable:true}))});return false};'
  '["pointerdown","keydown","focusin","touchstart"].forEach(function(t){addEventListener(t,function(){go()},{once:true,passive:true,capture:true})});'
  'addEventListener("load",function(){setTimeout(function(){go()},6000)});}'
  '})();</script>') % (json.dumps(fb + [lock_url]), json.dumps(app_url), json.dumps(font_url))
s = s.replace(app_block, loader, 1)
s = s.replace(block, '', 1)
files = ['preview.html'] if target == 'preview' else ['index.html', 'ball-sticker.html']
for f in files: open(os.path.join(ROOT, f), 'w', encoding='utf-8').write(s)
print('built', files, 'html', len(s), 'lock', len(lock_js), 'app', len(app_js))
