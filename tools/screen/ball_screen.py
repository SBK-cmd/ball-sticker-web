#!/usr/bin/env python3
"""วาดภาพสรุปร้านลงจอ Turing 3.5" (480x320) — รันบนคอมที่เสียบจอ
อ่านเอกสาร screenStats/today จาก Firestore (ตัวเลขล้วน ไม่มีข้อมูลลูกค้า) แล้วเขียนทับไฟล์ภาพพื้นหลัง
ที่โปรแกรม Turing ใช้อยู่ (ธีม "blank for image") โปรแกรมจะโหลดภาพใหม่เอง
ใช้:  python ball_screen.py            (วนทุก 30 วินาที)
      python ball_screen.py --once     (ทำครั้งเดียว)
      python ball_screen.py --demo     (ใช้ข้อมูลตัวอย่าง ไม่ต่อเน็ต)
ต้องมี: Python 3 + Pillow  (pip install pillow)
"""
import json, os, sys, time, urllib.request, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 480, 320
STALE_SEC = 15 * 60          # ข้อมูลเก่ากว่านี้ = ไม่แสดงเป็นตัวเลขปัจจุบัน
FONTS = ["C:/Windows/Fonts/LeelawUI.ttf", "C:/Windows/Fonts/tahoma.ttf",
         "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
         "/usr/share/fonts/truetype/tlwg/Loma.ttf", "/root/.fonts/Sarabun-Regular.ttf"]
FONTS_B = ["C:/Windows/Fonts/LeelaUIb.ttf", "C:/Windows/Fonts/tahomabd.ttf",
           "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf",
           "/usr/share/fonts/truetype/tlwg/Loma-Bold.ttf", "/root/.fonts/Sarabun-Bold.ttf"]

def load_config():
    p = os.path.join(HERE, "config.json")
    if not os.path.exists(p):
        sys.exit("ไม่พบ config.json — คัดลอก config.example.json เป็น config.json แล้วกรอกค่า")
    return json.load(open(p, encoding="utf-8"))

def fetch_stats(cfg):
    url = ("https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents/screenStats/today?key=%s"
           % (cfg["projectId"], cfg["apiKey"]))
    with urllib.request.urlopen(url, timeout=15) as r:
        doc = json.load(r)
    f = doc.get("fields", {})
    def n(k):
        v = f.get(k, {})
        return float(v.get("doubleValue", v.get("integerValue", 0)))
    return {"date": f.get("date", {}).get("stringValue", ""), "dueToday": int(n("dueToday")), "late": int(n("late")),
            "shipping": int(n("shipping")), "moneyToday": n("moneyToday"), "updatedAt": n("updatedAt") / 1000.0}

def money(v):
    return ("฿{:,.0f}" if abs(v - round(v)) < 0.005 else "฿{:,.2f}").format(v)

def font(paths, size):
    from PIL import ImageFont
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    sys.exit("ไม่พบฟอนต์ไทยในเครื่อง (ลองแก้รายชื่อฟอนต์ใน ball_screen.py)")

def render(stats, status_note, out):
    from PIL import Image, ImageDraw
    S = 2                                   # วาด 2 เท่าแล้วย่อ ให้ขอบเนียน
    im = Image.new("RGB", (W * S, H * S), (26, 15, 8))
    d = ImageDraw.Draw(im)
    fr, fb = (lambda s: font(FONTS, s * S)), (lambda s: font(FONTS_B, s * S))
    d.text((12 * S, 12 * S), "บอลสติ๊กเกอร์", font=fb(17), fill=(255, 154, 60))
    now = datetime.datetime.now().strftime("%H:%M")
    tw = d.textlength(now, font=fb(26))
    d.text((W * S - 12 * S - tw, 8 * S), now, font=fb(26), fill=(255, 255, 255))
    stale = stats is None
    cells = [("ต้องส่งวันนี้", "งาน", "dueToday", "o"), ("งานค้าง/เลยกำหนด", "งาน", "late", "r"),
             ("เงินเข้าวันนี้", "", "moneyToday", "n"), ("พัสดุกำลังส่ง", "ชิ้น", "shipping", "n")]
    cw, ch, gap, x0, y0 = 227, 117, 10, 12, 45
    for i, (label, unit, key, kind) in enumerate(cells):
        x = x0 + (i % 2) * (cw + gap); y = y0 + (i // 2) * (ch + gap)
        bg, bd, lc, vc = {"o": ((255, 138, 31), (255, 176, 102), (58, 29, 5), (26, 15, 8)),
                          "r": ((42, 26, 15), (74, 45, 23), (255, 197, 143), (255, 107, 90)),
                          "n": ((42, 26, 15), (74, 45, 23), (255, 197, 143), (255, 255, 255))}[kind]
        if stale:
            bg, bd, lc, vc = (34, 24, 18), (60, 45, 33), (130, 105, 85), (130, 105, 85)
        d.rounded_rectangle([x * S, y * S, (x + cw) * S, (y + ch) * S], radius=16 * S, fill=bg, outline=bd, width=2 * S)
        d.text(((x + 12) * S, (y + 9) * S), label, font=fr(14), fill=lc)
        if stale:
            val, unit = "--", ""
        else:
            val = money(stats[key]) if key == "moneyToday" else str(stats[key])
        fv = fb(46 if len(val) < 7 else 38)
        d.text(((x + 12) * S, (y + 46) * S), val, font=fv, fill=vc)
        if unit:
            vw = d.textlength(val, font=fv)
            d.text(((x + 12) * S + vw + 8 * S, (y + 74) * S), unit, font=fb(18), fill=vc)
    d.text((12 * S, 300 * S), status_note, font=fr(11), fill=(154, 122, 96))
    im = im.resize((W, H), Image.LANCZOS)
    tmp = out + ".tmp.png"
    im.save(tmp); os.replace(tmp, out)      # เขียนไฟล์ชั่วคราวก่อนแล้วสลับ กันโปรแกรมอ่านไฟล์ครึ่งๆ

def once(cfg, demo):
    if demo:
        stats = {"dueToday": 5, "late": 2, "shipping": 7, "moneyToday": 8450.0, "updatedAt": time.time()}
        note = "ตัวอย่าง · ข้อมูลสมมติ"
    else:
        try:
            stats = fetch_stats(cfg)
            age = time.time() - stats["updatedAt"]
            if age > STALE_SEC:
                stats, note = None, "ข้อมูลเก่า (แอปไม่ได้ส่งมา %d นาที)" % (age // 60)
            else:
                note = "อัปเดต " + datetime.datetime.fromtimestamp(stats["updatedAt"]).strftime("%H:%M")
        except Exception as e:
            stats, note = None, "ออฟไลน์/อ่านข้อมูลไม่ได้"
            print("fetch error:", e, file=sys.stderr)
    render(stats, note, cfg["outPath"])

if __name__ == "__main__":
    cfg = {"outPath": os.path.join(HERE, "preview.png")} if "--demo" in sys.argv else load_config()
    if "--demo" in sys.argv:
        once(cfg, True); print("wrote", cfg["outPath"]); sys.exit()
    while True:
        once(cfg, False)
        if "--once" in sys.argv: break
        time.sleep(int(cfg.get("intervalSec", 30)))
