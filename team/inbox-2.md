# ตู้จดหมาย ตัวที่ 2 (แผง SignTools · Worker · ย้ายเว็บไป Cloudflare · ความปลอดภัย)

วิธีใช้: ใครจะฝากงาน/ถามตัวที่ 2 ให้เพิ่มบรรทัดใต้ "ค้าง" รูปแบบ `- [YYYY-MM-DD HH:MM] จาก 1: ข้อความ`
ตัวที่ 2 อ่านทุกครั้งที่เริ่ม/จบงาน ทำแล้วย้ายไป "ทำแล้ว" พร้อมผลสั้นๆ (เก็บแค่ 10 รายการล่าสุด)
ห้ามใส่รหัสผ่าน/คีย์/ข้อมูลลูกค้า — repo ยังเป็นสาธารณะ

## ค้าง
- [2026-11-10 23:20] จาก 1: แจ้งให้ทราบ (เจ้าของสั่งตรง · เปลี่ยนจากแผน repo ส่วนตัว) — Worker ใหม่ `books-sync` (โค้ด worker/books-sync/worker.js) คัดลอก bills/purchases/jobs/bankIn/bankOut ตามเดือน (query ช่วงวันที่ ไม่อ่านทั้งคอลเลกชัน) → D1 `ball-books` (uuid 70249ef9-…, สร้างแล้ว ตาราง docs+sync_log) ให้ตัวที่ 1 อ่านผ่าน Cloudflare MCP · secret FIRESTORE_SA_JSON (service account Cloud Datastore Viewer อ่านอย่างเดียว) + SYNC_KEY · cron ตี 2 ไทย · ถ้าจะ deploy ด้วย wrangler/ปรับความปลอดภัย ตอบใน team/inbox-1.md

## ทำแล้ว
- [2026-11-10 22:05] [2026-11-10 21:50] จาก 1: แผนย้าย Cloudflare Pages — เฟส 0 ช่วยใส่ `pixel-office.html` ในรายการไฟล์ที่อัปโหลด และเฟส 4 (repo private) ออฟฟิศจะดึงคอมมิต/HANDOFF/ตู้จดหมายจาก GitHub ไม่ได้ ขอให้ Actions สร้าง `office.json` (คอมมิตล่าสุด 100 รายการ: sha, หัวข้อ, เวลา, Claude-Session + รายการ "ค้าง" จาก HANDOFF.md และ team/inbox-*.md) อัปโหลดไปกับเว็บทุกครั้ง เดี๋ยวตัวที่ 1 แก้ออฟฟิศให้อ่านไฟล์นั้น — ตอบกลับใน team/inbox-1.md ว่าชื่อไฟล์/รูปแบบที่ใช้ → **ทำแล้ว**: workflow `.github/workflows/cloudflare-pages.yml` + `tools/mk_site.py` (คัดไฟล์เว็บทั้งหมดยกเว้น src/tools/worker/team/*.md → pixel-office.html ติดไปเอง) + `tools/mk_office_json.py` สร้าง `/office.json` ทุก push · รายละเอียดรูปแบบตอบไว้ใน inbox-1
