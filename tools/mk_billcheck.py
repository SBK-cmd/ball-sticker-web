#!/usr/bin/env python3
"""สร้างไฟล์ตัวอ่านบิล LINE ทั้งสองฝั่งจากต้นฉบับเดียว:
  - bill-check.html                    หน้าตรวจบิล (จาก src/bill-check.src.html)
  - worker/line-bills/bill-core.mjs    โมดูลให้ Worker line-bills import (analyzeBill, billFlex, savedFlex)
ตัวอ่านบิลกลาง: src/bill-core.js · ฟังก์ชันอ่านข้อความบิลคัดจาก src/app.html ช่วง @@BILLPARSE-START/END
แก้ parser ในแอปหรือ bill-core.js แล้วรันไฟล์นี้ซ้ำ (Worker ต้องให้เจ้าของวางโค้ดใหม่ใน Cloudflare)
ใช้: python3 tools/mk_billcheck.py
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()
app = rd('src/app.html')
m = re.search(r'/\*@@BILLPARSE-START@@[^*]*\*/(.*?)/\*@@BILLPARSE-END@@\*/', app, re.S)
if not m: sys.exit('ไม่พบช่วง @@BILLPARSE ใน src/app.html')
core = rd('src/bill-core.js').replace('/*@@BILLPARSE@@*/', '// ---- คัดจาก src/app.html อัตโนมัติ ห้ามแก้ตรงนี้ ----\n  ' + m.group(1).strip(), 1)
page = rd('src/bill-check.src.html')
if '/*@@BILLCORE@@*/' not in page: sys.exit('ไม่พบ /*@@BILLCORE@@*/ ใน src/bill-check.src.html')
out = page.replace('/*@@BILLCORE@@*/', core.strip(), 1)
open(os.path.join(ROOT, 'bill-check.html'), 'w', encoding='utf8').write(out)
mod = ('// สร้างอัตโนมัติจาก src/bill-core.js + src/app.html (@@BILLPARSE) ด้วย tools/mk_billcheck.py — ห้ามแก้ไฟล์นี้ตรงๆ\n'
       'const $ = () => null;   // ตัวอ่านในแอปอ้างช่องในหน้า (sTax/sName) — บน Worker ไม่มี DOM\n' + core +
       '\nexport { analyzeBill, billFlex, savedFlex, parseReceiptText, defaultClaimMonth, claimWindow, thaiTaxIdValid, PURCH_CATS };\n')
os.makedirs(os.path.join(ROOT, 'worker/line-bills'), exist_ok=True)
open(os.path.join(ROOT, 'worker/line-bills/bill-core.mjs'), 'w', encoding='utf8').write(mod)
print('built bill-check.html', len(out), '+ worker/line-bills/bill-core.mjs', len(mod))
