#!/usr/bin/env python3
"""สร้าง office.json ให้ออฟฟิศ AI อ่าน (แทนการดึงจาก GitHub เมื่อ repo เป็น private)
รูปแบบ (v1):
{ "v": 1, "generatedAt": "<ISO UTC>",
  "commits": [ {"sha": "abc1234", "subject": "หัวข้อคอมมิต", "at": "<ISO พร้อมโซนเวลา>", "session": "session_… หรือ ''"} ]  (ล่าสุด 100 รายการ ใหม่→เก่า)
  "handoffPending": ["บรรทัดใต้หัวข้อ 'ค้างอยู่' ใน HANDOFF.md (ตัด '- ' หน้าออก)", …],
  "inbox": { "1": ["บรรทัดใต้ '## ค้าง' ใน team/inbox-1.md", …], "2": [ … ] } }
ใช้: python3 tools/mk_office_json.py [ไฟล์ปลายทาง]  (ค่าเริ่มต้น dist/office.json)"""
import datetime, json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'office.json')

def commits(n=100):
    raw = subprocess.run(['git', '-C', ROOT, 'log', '-n', str(n), '--format=%h%x1f%s%x1f%aI%x1f%b%x1e'], capture_output=True, text=True).stdout
    out = []
    for rec in raw.split('\x1e'):
        rec = rec.strip('\n')
        if not rec: continue
        sha, subj, at, body = (rec.split('\x1f') + ['', '', '', ''])[:4]
        m = re.search(r'claude\.ai/code/(session_[A-Za-z0-9]+)', body)
        out.append({'sha': sha, 'subject': subj, 'at': at, 'session': m.group(1) if m else ''})
    return out

def section(path, head_re):
    try: lines = open(os.path.join(ROOT, path), encoding='utf-8').read().splitlines()
    except OSError: return []
    items, on = [], False
    for ln in lines:
        if ln.startswith('#'):
            on = bool(re.match(head_re, ln)); continue
        if on and ln.lstrip().startswith('- '): items.append(ln.lstrip()[2:].strip())
    return items

data = {'v': 1, 'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'commits': commits(),
        'handoffPending': section('HANDOFF.md', r'^##\s*ค้าง'),
        'inbox': {k: section('team/inbox-%s.md' % k, r'^##\s*ค้าง') for k in ('1', '2')}}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('office.json ->', OUT, len(data['commits']), 'commits ·', len(data['handoffPending']), 'handoff ·', {k: len(v) for k, v in data['inbox'].items()}, 'inbox')
