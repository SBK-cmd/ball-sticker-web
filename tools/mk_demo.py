#!/usr/bin/env python3
"""สร้าง iphone-demo.html: แอป (preview7.html ล่าสุด) ในกรอบ iPhone ไฟล์เดียว ไม่ต้องใช้อินเทอร์เน็ต
   ใช้ส่งไปแสดงในแถบข้างแชต (โหมดเดโม: ข้อมูลตัวอย่าง ปุ่มสลับเจ้าของ/พนักงาน)
   python3 tools/mk_demo.py [ที่เก็บไฟล์ผลลัพธ์.html]    (ต้องรัน tools/mk_p8.py ก่อนให้ preview7.html เป็นรุ่นล่าสุด)"""
import re, base64, io, os, sys
from PIL import Image
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(R, 'iphone-demo.html')
h = open(R + '/' + os.environ.get('BS_PREVIEW','preview8.html'), encoding='utf8').read()
lock = open(R + '/js/p-lock.js', encoding='utf8').read(); app = open(R + '/js/p-app.js', encoding='utf8').read()
m = re.search(r'<script>\(function\(\)\{var ok=true;try\{ok=!!localStorage.getItem\("bs_session"\).*?\}\)\(\);</script>', h, re.S)
assert m, 'ไม่พบตัวโหลดสคริปต์ใน preview8.html'
qr = open(R + '/js/html5-qrcode.min.js', encoding='utf8').read()
h = h.replace(m.group(0), '<script>' + qr.replace('</script', '<\\/script') + '</script><script>' + lock.replace('</script', '<\\/script') + '</script><script>' + app.replace('</script', '<\\/script') + '</script>', 1)
h = re.sub(r'<script src="https://www\.gstatic\.com[^"]*"></script>\n?', '', h)
h = re.sub(r'<link[^>]+(fonts\.googleapis|fonts\.gstatic)[^>]*>\n?', '', h)
h = re.sub(r'<link rel="manifest"[^>]*>\n?', '', h)
def uri(path, mime, size=None):
    if size:
        im = Image.open(path).convert('RGBA'); im.thumbnail(size); b = io.BytesIO(); im.save(b, 'WEBP', quality=85); return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
h = h.replace('logo-160-transparent.png', uri(R + '/logo-160-transparent.png', 'image/png', (200, 200)))
h = h.replace('logo-160.webp', uri(R + '/logo-160.webp', 'image/webp'))
tpl = open(R + '/tools/iphone-frame.tpl.html', encoding='utf8').read()
open(out, 'w', encoding='utf8').write(tpl.replace('__APPSRC__', h.replace('</script', '<\\/script')))
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
