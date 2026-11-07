#!/usr/bin/env python3
"""ใส่ตัวนับ GA4 หน้าร้าน (idempotent): python3 tools/ga_patch.py preview|live
 preview → *-preview.html · live → *.html (รวม privacy/terms) ; ตัวนับจริงอยู่ที่ js/ga.js"""
import os, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mode = sys.argv[1] if len(sys.argv) > 1 else 'preview'
suf = '-preview' if mode == 'preview' else ''
pages = ['site', 'products', 'work', 'order', 'about', 'contact-us', 'designer', 'contact'] + ([] if mode == 'preview' else ['privacy', 'terms'])
TAG = '<script src="js/ga.js" defer></script>'
for pg in pages:
    f = os.path.join(R, pg + suf + '.html')
    if not os.path.exists(f): print('skip', f); continue
    s = open(f, encoding='utf8').read()
    if TAG in s: print('ok  ', pg + suf); continue
    i = s.rfind('</body>')
    if i < 0: print('no body', f); continue
    open(f, 'w', encoding='utf8').write(s[:i] + TAG + '\n' + s[i:]); print('add ', pg + suf)
