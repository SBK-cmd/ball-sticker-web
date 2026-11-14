# สำรองข้อมูลบอลสติ๊กเกอร์ (Firestore + รูป)

ทำอะไร: ทุกคืนดึงข้อมูล Firestore **ทุกคอลเลกชัน** → บีบ + เข้ารหัส AES-256-GCM เป็นไฟล์ `firestore-YYYY-MM-DD.bsb`
แล้วโหลดรูปทุกลิงก์ที่อยู่ในข้อมูล (Cloudinary / Firebase Storage) เก็บเป็นไฟล์ธรรมดาใน `photos/` — **ไม่ลบ ไม่ทับ** ถ้ารูปหายจากต้นทางสำเนายังอยู่
เก็บไฟล์ Firestore ย้อนหลัง 7 วัน + วันอาทิตย์ 4 สัปดาห์ · ถ้าอ่านได้ 0 เอกสารจะไม่เขียนทับ (exit 3)

## ติดตั้งบน NAS (ทำครั้งเดียว)
1. สร้าง service account **อ่านอย่างเดียว** ในโปรเจกต์ `ball-sticker-d95c2` บทบาท *Cloud Datastore Viewer* ดาวน์โหลดคีย์ JSON เป็น `sa.json` (ห้ามขึ้น repo ห้ามส่งในแชต)
2. สร้างโฟลเดอร์ `/volume1/ball-backup/` วาง `sa.json` + โฟลเดอร์สคริปต์นี้ (`lib.mjs run.mjs restore-read.mjs package.json`) ไว้ใน `app/`
3. ตั้งรหัสผ่านเข้ารหัสยาว ≥ 12 ตัว **จดเก็บไว้นอกเครื่อง NAS** (ลืม = ถอดรหัสไม่ได้)
4. ตั้งงานตามเวลา (เช่น 02:30 ทุกคืน) รันคำสั่ง:
```
docker run --rm -v /volume1/ball-backup:/data -w /data/app \
  -e BACKUP_DIR=/data/out -e BACKUP_PASSPHRASE='รหัสของคุณ' \
  -e GOOGLE_APPLICATION_CREDENTIALS=/data/sa.json \
  node:22-slim sh -c "npm install --silent --no-audit && node run.mjs"
```
ผลอยู่ที่ `/volume1/ball-backup/out/` · ดูสถานะล่าสุดที่ `out/last-run.json`

## ถอดรหัสดู / กู้ข้อมูล
`BACKUP_PASSPHRASE='รหัส' node restore-read.mjs out/firestore/firestore-2026-11-15.bsb > ข้อมูล.json`
(การเขียนกลับ Firestore ยังไม่ได้ทำ — ทำเมื่อจำเป็นจริง พร้อมตรวจกับเจ้าของก่อน)

## สำเนานอกร้าน (ขั้นต่อไป ยังไม่ได้ตั้ง)
ซิงก์โฟลเดอร์ `out/` ขึ้น Cloudflare R2 ด้วย rclone (`rclone sync out r2:ball-backup`) — ไฟล์ Firestore เข้ารหัสอยู่แล้ว รูปเป็นรูปที่อยู่บน Cloudinary สาธารณะอยู่แล้ว
ต้องมีคีย์ R2 (สร้างที่แดชบอร์ด Cloudflare) — รอเจ้าของ

## ทดสอบ
`node test.mjs` (เข้ารหัส/ถอดรหัส, แก้ไบต์แล้วต้องพัง, เก็บย้อนหลัง, โหลดรูปไม่ทับ) · ส่วนต่อ Firestore จริง (`run.mjs`) ยังไม่ได้ทดสอบกับข้อมูลจริง
