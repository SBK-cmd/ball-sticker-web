#!/usr/bin/env python3
"""คัดไฟล์หน้าเว็บไป dist/ สำหรับ Cloudflare Pages (ไม่เอาต้นฉบับ/เครื่องมือ/บันทึกทีม/Worker)
ใช้: python3 tools/mk_site.py [dist]  · ไฟล์ใหม่ที่หน้าเว็บใช้ (เช่น pixel-office.html) ติดไปเองอัตโนมัติ"""
import os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist'))
SKIP_DIRS = {'.git', '.github', '.claude', 'src', 'tools', 'worker', 'team', 'tests', 'node_modules', 'dist'}
SKIP_FILES = {'CNAME', '.gitignore'}
SKIP_EXT = {'.md', '.py', '.sh', '.toml', '.cjs', '.mjs'}
if os.path.exists(OUT): shutil.rmtree(OUT)
n = size = 0
for d, dirs, files in os.walk(ROOT):
    rel = os.path.relpath(d, ROOT)
    top = rel.split(os.sep)[0]
    if top in SKIP_DIRS or os.path.abspath(d).startswith(OUT):
        dirs[:] = []; continue
    dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
    for f in files:
        if f in SKIP_FILES or os.path.splitext(f)[1].lower() in SKIP_EXT: continue
        src = os.path.join(d, f); dst = os.path.join(OUT, rel, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst)
        n += 1; size += os.path.getsize(src)
# Cloudflare Pages: ถ้าไม่มี 404.html จะส่งหน้าแอปกลับให้ทุกลิงก์ที่ไม่มี (สถานะ 200) → ใส่หน้า 404 จริง
p404 = os.path.join(OUT, '404.html')
if not os.path.exists(p404):
    with open(p404, 'w', encoding='utf-8') as fh:
        fh.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                 '<meta name="robots" content="noindex"><title>ไม่พบหน้านี้ · Ball Sticker</title>'
                 '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1fa;color:#1b2150;font-family:system-ui,sans-serif;text-align:center}'
                 'a{display:inline-block;margin-top:16px;padding:12px 24px;border-radius:12px;background:#e9b53e;color:#1b2150;text-decoration:none;font-weight:700}</style></head>'
                 '<body><div><h1>ไม่พบหน้านี้</h1><p>ลิงก์อาจผิดหรือถูกย้ายแล้ว</p><a href="/">กลับหน้าแรก</a></div></body></html>')
    n += 1
print('site ->', OUT, n, 'files', round(size / 1048576, 1), 'MB')
