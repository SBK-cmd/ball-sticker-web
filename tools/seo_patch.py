#!/usr/bin/env python3
"""ปรับ SEO หน้าร้าน (idempotent): python3 tools/seo_patch.py preview|live
 - meta description / og:description แยกรายหน้า
 - JSON-LD LocalBusiness (หน้าแรก + ติดต่อเรา): ช่องที่อยู่, contactPoint 2 เบอร์, areaServed, sameAs Facebook
 - FAQPage JSON-LD จากส่วนคำถามที่พบบ่อยในหน้าแรก (ดึงข้อความจริงจาก HTML)
 - alt รูป fb01/fb05 ที่ว่าง (ใช้คำบรรยายเดิมของร้านจากแกลเลอรีหน้าแรก)
 - H1 หน้าแรก: เติม "พิษณุโลก" (ไทยเท่านั้น)"""
import re, sys, json, html, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mode = sys.argv[1] if len(sys.argv) > 1 else 'preview'
suf = '-preview' if mode == 'preview' else ''
DESC = {
 'products': 'สินค้าสติ๊กเกอร์สั่งทำ PVC ไดคัท โฮโลแกรม สะท้อนแสง พิมพ์ UV วานิช ฉลากสินค้า สติ๊กเกอร์ใสและแบบแผ่น ลองออกแบบออนไลน์ ส่งทั่วประเทศ จากบอลสติ๊กเกอร์ พิษณุโลก',
 'work': 'ผลงานสติ๊กเกอร์จริงจากหน้าร้านบอลสติ๊กเกอร์ พิษณุโลก ไดคัทโลโก้ วงกลมลายไทย โฮโลแกรม ตัวอักษร และลายการ์ตูน ดูตัวอย่างก่อนสั่งทำ',
 'order': 'วิธีสั่งทำสติ๊กเกอร์ 4 ขั้นตอน: ออกแบบหรือส่งไฟล์ทางแชท ตรวจแบบก่อนพิมพ์ ชำระเงิน QR พร้อมเพย์ ผลิตและส่งพร้อมเลขพัสดุ ไม่มีไฟล์งานร้านช่วยจัดแบบให้',
 'about': 'บอลสติ๊กเกอร์ ร้านสติ๊กเกอร์ไดคัท พิษณุโลก รับผลิตตามรูปทรงโลโก้และภาพของคุณ ตรวจไฟล์และส่งแบบให้ยืนยันก่อนพิมพ์ ฉลากสินค้า โฮโลแกรม สะท้อนแสง งาน UV',
 'contact-us': 'ติดต่อบอลสติ๊กเกอร์ พิษณุโลก ทาง LINE @bk25 Facebook โทร 093-535-3555 และ 096-669-7495 ร้านอยู่ ต.บางระกำ จ.พิษณุโลก เปิดจันทร์–เสาร์ 09:00–17:00',
}
ALT = {'work/fb01.webp': 'KEN Clutch — ไดคัทโลโก้', 'work/fb05.webp': 'ส.เหน่ง สัมผัส 8 — ไดคัทลายการ์ตูน'}
LDRE = re.compile(r'(<script type="application/ld\+json">)(.*?)(</script>)', re.S)
def rw(path, fn):
    s = open(path, encoding='utf8').read(); n = fn(s)
    if n != s: open(path, 'w', encoding='utf8').write(n); return True
    return False
def fix_ld(s):
    def one(m):
        j = json.loads(m.group(2))
        if j.get('@type') != 'LocalBusiness': return m.group(0)
        j['address'].update({'streetAddress': '8 หมู่ 19 ต.บางระกำ', 'addressLocality': 'อ.บางระกำ'})
        j['contactPoint'] = [{'@type': 'ContactPoint', 'telephone': t, 'contactType': 'customer service', 'availableLanguage': 'th'} for t in ('+66935353555', '+66966697495')]
        j['areaServed'] = {'@type': 'Country', 'name': 'Thailand'}
        fb = 'https://www.facebook.com/108503502205863'
        if fb not in j.get('sameAs', []): j.setdefault('sameAs', []).append(fb)
        return m.group(1) + json.dumps(j, ensure_ascii=False) + m.group(3)
    return LDRE.sub(one, s)
def add_faq(s):
    if 'FAQPage' in s: return s
    i = s.find('id="faq"'); 
    if i < 0: return s
    blk = s[i:s.index('</section>', i)]
    qa = re.findall(r'<summary>(.*?)</summary><p>(.*?)</p>', blk, re.S)
    strip = lambda t: html.unescape(re.sub(r'<[^>]+>', '', t)).strip()
    j = {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': strip(q), 'acceptedAnswer': {'@type': 'Answer', 'text': strip(a)}} for q, a in qa]}
    return s.replace('</head>', '<script type="application/ld+json">' + json.dumps(j, ensure_ascii=False) + '</script>\n</head>', 1)
def desc(p):
    d = DESC[p]
    def fn(s):
        s = re.sub(r'(<meta name="description" content=")[^"]*(")', lambda m: m.group(1) + d + m.group(2), s, 1)
        s = re.sub(r'(<meta property="og:description" content=")[^"]*(")', lambda m: m.group(1) + d + m.group(2), s, 1)
        return s
    return fn
def alts(s):
    for src, a in ALT.items(): s = s.replace('<img src="%s" alt=""' % src, '<img src="%s" alt="%s"' % (src, a))
    return s
def h1(s):
    s = s.replace('<span data-i="h1a">สติ๊กเกอร์ไดคัท</span>', '<span data-i="h1a">สติ๊กเกอร์ไดคัท พิษณุโลก</span>')
    return re.sub(r'("h1a": \[")สติ๊กเกอร์ไดคัท(")', r'\1สติ๊กเกอร์ไดคัท พิษณุโลก\2', s)
ch = []
for p in ['site', 'products', 'work', 'order', 'about', 'contact-us']:
    f = os.path.join(R, p + suf + '.html')
    fns = [alts]
    if p in DESC: fns.append(desc(p))
    if p in ('site', 'contact-us'): fns.append(fix_ld)
    if p == 'site': fns += [add_faq, h1]
    for fn in fns:
        if rw(f, fn): ch.append(p + ':' + fn.__name__)
print(mode, 'changed:', ch)
