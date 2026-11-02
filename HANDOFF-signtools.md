# Sign Tools — สรุปสถานะ (ส่งต่อแชตใหม่) · 2 พ.ย. 2569

## ภาพรวม
ร้าน **บอลสติ๊กเกอร์** (ballsticker.co.th) ทำแผง **Sign Tools** ขายลูกค้า มี 2 ตัว:
- **Illustrator** (CEP panel) — ตัวหลัก
- **CorelDRAW** (Docker ใน Corel, WebView2 + C#) — เริ่มทำ
เครื่องร้าน: Graphtec CE7000-130 (192.168.0.224) · CE7000-60 (192.168.0.222) · พอร์ตส่งตัด 9100 · Cutting Master 5 · CorelDRAW 2025 (v25)

## กฎการทำงานกับผู้ใช้ (สำคัญ)
- ตอบภาษาไทย สั้น ตรง · บอกตรงๆ ว่าอะไรยังไม่ได้ทดสอบในโปรแกรมจริง
- **"อัพบอล"** = ปล่อยเป็นเบต้า (เห็นเฉพาะเบอร์ทดสอบ 0935353555, 0900000000)
- **"อัพ"** = ปล่อยให้ลูกค้าทุกคน — แต่ผู้ใช้เคยพิมพ์ "อัพ" ผิดแทน "อัพบอล" หลายครั้ง → **ถามยืนยันก่อนเสมอ**
- ห้ามปล่อยรุ่นโดยไม่มีคำสั่ง · ห้ามพิมพ์รหัสผ่าน/คีย์แทนผู้ใช้ (ให้ผู้ใช้ล็อกอินแอดมินเอง) · ไม่แตะคีย์ลูกค้าถ้าไม่ได้สั่ง

## ที่อยู่โค้ด (repo `SBK-cmd/ball-sticker-web`, branch `signtools-corel` = ล่าสุดครบ)
| ส่วน | ที่อยู่ |
|---|---|
| แผง Illustrator (ซอร์ส) | `signtools-panel/SignTools/` (index.html, js/*, jsx/host.jsx, css) |
| สร้าง zip Illustrator | `cd signtools-panel && ./build.sh 1.13.28` → `SignTools-v1.13.28.zip` |
| เซิร์ฟเวอร์ (Cloudflare Worker + D1) | `signtools-worker/src/index.js` — push ที่ branch `signtools-worker` แล้ว deploy อัตโนมัติ |
| CorelDRAW | `signtools-corel/` (src/Loader = ตัวโหลด WPF, src/Host = C# สั่ง Corel, web/shim.js, build-app.sh, installer/) |
| ไฟล์ zip ที่ปล่อยแล้ว | `releases/` |

> หมายเหตุ: เดิมซอร์สแผงอยู่ที่ /tmp/m (หายเมื่อเปิดเครื่องใหม่) — ตอนนี้คัดลอกเข้า repo แล้วที่ `signtools-panel/`

### Build CorelDRAW
- **Host DLL** (C#, ไม่ต้องใช้ WPF): `apt-get install -y mono-devel` แล้ว
  `cd signtools-corel/src/Host && mcs -target:library -sdk:4.7.2 -langversion:7.2 -optimize -out:SignToolsHost.dll -r:Microsoft.CSharp.dll -r:System.Web.Extensions.dll -r:System.Core.dll -r:System.Drawing.dll *.cs`
- **หน้าแผง Corel**: `cd signtools-corel && ./build-app.sh ../signtools-panel/SignTools 1.1.2` (ใช้ซอร์สเดียวกับ Illustrator + shim)
- **Loader DLL** (WPF + WebView2) คอมไพล์ผ่าน GitHub Actions (`.github/workflows/corel.yml`, windows-latest → commit ผลลง branch `corel-out`) — **Actions หยุดรันตั้งแต่ 31 ต.ค.** ยังไม่รู้สาเหตุ · ตัวโหลดที่ใช้ได้อยู่ใน `releases/SignToolsCorel-v1.1.1.zip` (`SignTools/_addon/`) → ประกอบ zip ใหม่โดยใช้ `_addon` เดิม + app ใหม่ + Host DLL ใหม่
- โครง zip Corel: `SignTools/` = แอป (CSXS/manifest.xml บอกเวอร์ชัน, index.html, js, corel/, SignToolsHost.dll) + `SignTools/_addon/` (AppUI.xslt, UserUI.xslt, CorelDrw.addon, SignToolsCorel.dll, WebView2 dll, x64/x86 WebView2Loader.dll, install-corel.ps1) + `install-corel.bat`
- ติดตั้งลง `C:\Program Files\Corel\<suite>\Programs64\Addons\SignTools\` · แอปจริงรันจาก `%APPDATA%\SignTools\Corel\app` (อัปเดตในแผงได้) · log: `%APPDATA%\SignTools\Corel\signtools-corel.log`, `error.log`

## ปล่อยรุ่น
หน้าแอดมิน https://signtools.organic-parmesan.workers.dev/admin (ผู้ใช้ล็อกอินใน Chrome เครื่อง Windows = "Browser 2") → การ์ด "ปล่อยอัปเดต": เลือก **โปรแกรม** (Illustrator/CorelDRAW) · เวอร์ชัน · มีอะไรใหม่ · ไฟล์ zip · ติ๊ก **เบต้า** · อัปโหลด
- ref ของฟอร์มเปลี่ยนบ่อย → `find` ใหม่ก่อนกรอก
- ล็อกอินแอดมินอยู่ได้ 30 วันแล้ว
- เบต้าพร้อมแล้ว → การ์ด "ปล่อย X ให้ทุกคน" (ใช้ไฟล์เดิม)

## เวอร์ชันปัจจุบัน
| | ลูกค้าทั่วไป (stable) | เบต้า |
|---|---|---|
| Illustrator | **1.12.3** | **1.13.27** |
| CorelDRAW | — | **1.1.1** |

## ระบบหลังบ้าน (worker)
- คีย์แยกโปรแกรม: `keys.product` = `ai` / `cdr` (schema v6) · แอดมินเลือกโปรแกรมตอนเพิ่มสมาชิก/เพิ่มเครื่อง/สร้างคีย์ · ปล่อยรุ่นแยกโปรแกรม (Corel เก็บ version เป็น `cdr-X.Y.Z`, ไฟล์ `SignToolsCorel-vX.zip`)
- action `features` (ส่ง token) → บัญชีเบต้าได้ config คิวงาน (Firebase project `ball-sticker-d95c2`)
- beta_phones = `0935353555,0900000000`

## ฟีเจอร์ Illustrator ที่เพิ่มในเบต้า (1.13.x) — ยังไม่ปล่อยลูกค้า
- ส่งตัดตรงเข้า Graphtec (ไม่ผ่าน CM5) + อ่านมาร์ค CM5 (4 Points / Segment) · แรงกด/ความเร็วแยก Kiss/Die · ลำดับตัดงูเลื้อย · จำลองการตัด
- **ตัดแบบไม่อ่านมาร์ค** (หน้ากว้างวัสดุ, ตำแหน่ง X/Y, จำนวนชุด + ระยะห่าง แบบ Matrix Copy ของ CM5)
- เรียงสติ๊กเกอร์ + มาร์ค CM5 อัตโนมัติ · **Die Cut อย่างเดียว** · วาง artboard ให้อยู่ใน canvas (1.13.27)
- ส่งออก TIFF/JPG: แปลง Symbol เป็นภาพชั่วคราว (แก้ "Clipping path limit") + ส่งออกเฉพาะกรอบมาร์ค
- **คิวงานเชื่อมแอปร้าน** (app.ballsticker.co.th, Firestore `jobs` + `wholesale`, เฉพาะเบต้า): สถานะ รอทำ/ทำไฟล์แล้ว/ผลิตแล้ว/จัดส่ง · ผูกไฟล์ (`aiFile`) · เปิดไฟล์ · **✂ สั่งตัด** · หน้าต่างรายละเอียด · ใบราคาส่งแยกการ์ดต่อรายการ (สถานะเก็บใน `stq.i<n>`) · ซ่อนราคาส่งที่มีใบงานแล้ว (ลูกค้าเดียวกัน ±7 วัน) และรายการค่าส่ง

## CorelDRAW (เบต้า 1.1.1)
- ใช้ได้: ล็อกอิน (คีย์ cdr), อัปเดตในแผง, ส่งตัด (อ่านเส้นจากเลเยอร์/สีชื่อ Kiss/CutContour/Die), เรียงสติ๊กเกอร์ (หน้าใหม่ต่อแผ่น, Kiss/Die, มาร์ค CM5, Die Cut อย่างเดียว)
- ยังไม่มี: เครดิตร้าน, เครื่องมืออื่น (เงา, ตั้งชื่อไฟล์ ฯลฯ ซ่อนไว้)

## งานค้าง / รอผล
1. **Illustrator เด้งตอนสร้างแผ่น** (แผ่น 120×80 ซม. 104 ดวง, เส้นที่วาดเอง + ไดคัทสี่เหลี่ยม + CM5, ปิด Symbol ก็เด้ง) → ปล่อย 1.13.27 (วางแผ่นใน canvas) รอผล · ถ้ายังเด้ง ขอข้อความ "ครั้งก่อนเด้งที่ขั้น…" จากหน้าเรียงสติ๊กเกอร์ (breadcrumb `Folder.userData/SignTools/laststep.txt`) · ข้อสงสัยอื่น: รูปลิงก์จาก NAS `\\B-NAS\ballsticker\EXPORT`
2. **CorelDRAW เส้นตัดตามรูปไม่ทำงาน** (ได้สี่เหลี่ยมมุมมนแทน) → รอแคปข้อความ ⚠ จากหน้าเรียงสติ๊กเกอร์ (โค้ด: `StickerOps.ContourCuts` ส่งออก PNG ด้วย `ExportBitmap` แล้วหาขอบใน `Contour.cs`)
3. CorelDRAW: ยังไม่ได้ผลทดสอบส่งตัดจริง
4. GitHub Actions ไม่รัน (ต้องให้ผู้ใช้เปิดดูหน้า Actions) — จำเป็นเมื่อต้องแก้ Loader DLL
5. รายการที่ค้างจากเดิม: #1, #3, #6, #27, #29, #52, #57, #70, #98 · Weed line · Trapping · คีย์ KWLY/ACAT อาจต้องให้ผู้ใช้เก็บกวาด
6. ปล่อย 1.13.x ให้ลูกค้าทุกคน — เมื่อผู้ใช้สั่ง "อัพ" (ยืนยันก่อน)

## ทดสอบแบบไม่มีโปรแกรมจริง
- worker: shim sqlite + esbuild (`npx esbuild src/index.js --bundle --format=esm --platform=neutral --outfile=src/_t.mjs`) แล้วรันสคริปต์ทดสอบ
- แผง: Playwright เปิด index.html + จำลอง `__adobe_cep__` / Firestore ด้วย route
- shell ต่อ signtools.*.workers.dev / firestore ไม่ได้ (proxy) → ใช้ Chrome ของผู้ใช้ผ่าน tool
