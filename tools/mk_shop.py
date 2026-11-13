#!/usr/bin/env python3
"""สร้างโฟลเดอร์เว็บ shop.ballsticker.co.th (Cloudflare Pages โปรเจกต์ ball-sticker-shop)
ต้นฉบับ: shop.html (ของจริง) — แก้ใน upload-preview.html ก่อน แล้วตอนเจ้าของพิมพ์ "อัพ" ให้ cp upload-preview.html shop.html
ใช้: python3 tools/mk_shop.py [dist-shop]"""
import os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-shop'))
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
html = open(os.path.join(ROOT, 'shop.html'), encoding='utf8').read()
html = html.replace('<title>', '<link rel="canonical" href="https://shop.ballsticker.co.th/">\n<title>', 1)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf8').write(html)
for f in ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.ico']:
    if os.path.exists(os.path.join(ROOT, f)): shutil.copy2(os.path.join(ROOT, f), os.path.join(OUT, f))
open(os.path.join(OUT, 'robots.txt'), 'w').write('User-agent: *\nAllow: /\n')
open(os.path.join(OUT, '_redirects'), 'w').write('/upload /  301\n/order /  301\n')
print('shop ->', OUT, sorted(os.listdir(OUT)))
