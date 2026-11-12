#!/usr/bin/env python3
"""สร้าง bill-check.html (หน้าตรวจบิลที่เปิดจากปุ่มใน LINE บิล @162oesrh)
ต้นฉบับหน้า: src/bill-check.src.html · ตัวอ่านบิลดึงจาก src/app.html ช่วง @@BILLPARSE-START/END
เพื่อให้แอปกับหน้านี้อ่านบิลด้วยโค้ดชุดเดียวกันเสมอ — แก้ตัวอ่านบิลในแอปแล้วรันไฟล์นี้ซ้ำ
ใช้: python3 tools/mk_billcheck.py [ไฟล์ผลลัพธ์ ค่าเริ่มต้น bill-check.html]
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = open(os.path.join(ROOT, 'src/app.html'), encoding='utf8').read()
m = re.search(r'/\*@@BILLPARSE-START@@[^*]*\*/(.*?)/\*@@BILLPARSE-END@@\*/', app, re.S)
if not m:
    sys.exit('ไม่พบช่วง @@BILLPARSE ใน src/app.html')
block = m.group(1).strip()
src = open(os.path.join(ROOT, 'src/bill-check.src.html'), encoding='utf8').read()
if '/*@@BILLPARSE@@*/' not in src:
    sys.exit('ไม่พบ /*@@BILLPARSE@@*/ ใน src/bill-check.src.html')
out = src.replace('/*@@BILLPARSE@@*/', '// ---- ตัวอ่านบิล (คัดจาก src/app.html อัตโนมัติ ห้ามแก้ตรงนี้) ----\n  ' + block, 1)
dst = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else 'bill-check.html')
open(dst, 'w', encoding='utf8').write(out)
print('built', os.path.relpath(dst, ROOT), len(out))
