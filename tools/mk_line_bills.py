#!/usr/bin/env python3
"""รวม Worker line-bills เป็นไฟล์เดียวสำหรับวางในหน้าแก้โค้ดของ Cloudflare
   worker/line-bills-worker.js (import ./line-bills/bill-core.mjs) → worker/line-bills/dist/line-bills.js
   รันหลังแก้ Worker หรือหลัง tools/mk_billcheck.py สร้าง bill-core.mjs ใหม่"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()
core = rd('worker/line-bills/bill-core.mjs')
core, n = re.subn(r'^export \{[^}]*\};\s*$', '', core, flags=re.M)
assert n == 1, 'ไม่พบบรรทัด export ใน bill-core.mjs'
work = rd('worker/line-bills-worker.js')
work, n = re.subn(r"^import \{[^}]*\} from '\./line-bills/bill-core\.mjs';\s*$", '', work, flags=re.M)
assert n == 1, 'ไม่พบบรรทัด import ใน line-bills-worker.js'
out = ('// ไฟล์รวมสำหรับวางใน Cloudflare (Worker line-bills) — สร้างด้วย python3 tools/mk_line_bills.py ห้ามแก้ตรง\n'
       '// ===== ตัวอ่านบิล (worker/line-bills/bill-core.mjs) =====\n' + core.strip() + '\n\n'
       '// ===== Worker (worker/line-bills-worker.js) =====\n' + work.strip() + '\n')
os.makedirs(os.path.join(ROOT, 'worker/line-bills/dist'), exist_ok=True)
open(os.path.join(ROOT, 'worker/line-bills/dist/line-bills.js'), 'w', encoding='utf8').write(out)
print('built worker/line-bills/dist/line-bills.js', len(out.encode('utf8')), 'bytes')
