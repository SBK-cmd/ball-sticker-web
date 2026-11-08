#!/usr/bin/env python3
"""สร้างไฟล์ขึ้นของจริง = build.py live + ธีมที่อนุมัติแล้ว (ตอนนี้ p10 Maximalism ซ้อนบน p4–p9a)
   ใช้แทน `python3 tools/build.py live` ทุกครั้งที่ปล่อย (build.py live เดี่ยวๆ จะได้แอปไม่มีธีม)
   python3 tools/mk_live.py   → เขียน index.html + ball-sticker.html แล้วสร้าง preview.html กลับคืน"""
import os, shutil, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
py = sys.executable
subprocess.check_call([py, R + '/tools/build.py', 'live'])
shutil.copy(R + '/index.html', R + '/preview.html')   # ใช้ไฟล์ live เป็นฐานของโซ่ธีม
subprocess.check_call([py, R + '/tools/mk_p11.py'], stdout=subprocess.DEVNULL)
for f in ('index.html', 'ball-sticker.html'):
    shutil.copy(R + '/preview11.html', R + '/' + f)
subprocess.check_call([py, R + '/tools/build.py', 'preview'])   # คืน preview.html ปกติ
print('live + theme p11 ->', 'index.html, ball-sticker.html')
