# Worker โพสต์เข้าเพจ (ยังไม่ได้ deploy)

ไฟล์นี้ไม่มีค่าลับ โทเคนและ APP_KEY ต้องตั้งใน Cloudflare เท่านั้น

## ขั้นตอน
1. สร้างบัญชี Cloudflare (แผนฟรี) แล้วติดตั้ง wrangler: `npm i -g wrangler`
2. ใน folder นี้ รัน `wrangler login`
3. ใส่ PAGE_ID ใน wrangler.toml
4. ตั้งค่าลับ:
   - `wrangler secret put PAGE_TOKEN` (โทเคนเพจระยะยาว จากแอป Meta ที่สร้างเอง)
   - `wrangler secret put APP_KEY` (รหัสที่คุณตั้งเอง ยาวๆ ใช้กันคนนอกเรียก)
5. `wrangler deploy` จะได้ URL เช่น https://ball-fb-post.<ชื่อ>.workers.dev
6. แจ้งผมว่า deploy แล้ว ผมจะต่อปุ่มในแอป (ยังไม่ทำจนกว่าคุณจะบอก)

## ทดสอบ
ยังไม่ได้ทดสอบกับ Facebook จริง ทดสอบครั้งแรกควรใช้เพจทดสอบหรือโพสต์แบบ unpublished ก่อน

## แชตเพจ (Messenger) — เพิ่มใน Worker ตัวเดียวกัน
Worker รับข้อความลูกค้าผ่าน webhook เก็บใน Workers KV ให้แอปหลังร้านอ่านและตอบ (เมนู "แชตเพจ" ในแอป)
ส่วนนี้ทดสอบด้วยข้อมูลจำลองเท่านั้น ยังไม่ได้ทดสอบกับ Facebook จริง

### สิ่งที่ต้องทำใน Cloudflare (เจ้าของทำเอง)
1. สร้าง KV namespace (Storage & Databases → KV → Create) ตั้งชื่ออะไรก็ได้ เช่น `ball-chat`
2. เปิด Worker → Settings → Bindings → Add → KV namespace → ตัวแปรชื่อ `CHAT_KV` เลือก namespace ที่สร้าง
3. Settings → Variables and Secrets เพิ่ม Secret 2 ตัว:
   - `VERIFY_TOKEN` ข้อความที่ตั้งเองสุ่มๆ (ใช้กรอกฝั่ง Meta ให้ตรงกัน)
   - `APP_SECRET` App Secret ของแอป Meta (Meta App → Settings → Basic → App secret)
4. วางโค้ดใหม่จาก `fb-post-worker.js` แล้ว Deploy (เส้นทางโพสต์เดิมยังทำงานเหมือนเดิม)

### สิ่งที่ต้องทำที่ Meta (developers.facebook.com)
1. แอป → เพิ่มผลิตภัณฑ์ Messenger → ตั้งค่า
2. Webhooks → Callback URL: `https://<worker>.workers.dev/webhook` · Verify token: ค่า `VERIFY_TOKEN` ที่ตั้งไว้ → Verify and Save
3. Subscribe ฟิลด์ `messages` (และ `message_echoes` ถ้ามีให้เลือก เพื่อให้เห็นข้อความที่ตอบจาก Business Suite)
4. Add Page → เลือกเพจ → Subscribe เพจกับแอป
5. โทเคนเพจ (`PAGE_TOKEN`) ต้องมีสิทธิ์ `pages_messaging` (ออกโทเคนใหม่ใน Graph API Explorer โดยติ๊กสิทธิ์นี้ แล้วอัปเดต Secret)

### จุดที่อาจติด (ยังไม่ยืนยัน)
- แอปในโหมดพัฒนาอาจรับ-ส่งแชตได้เฉพาะบัญชีที่มี role ในแอป (แอดมิน/นักพัฒนา/ผู้ทดสอบ) ถ้าแชตลูกค้าจริงไม่เข้า อาจต้องขอสิทธิ์ `pages_messaging` แบบ Advanced Access ผ่าน App Review (อาจต้องยืนยันธุรกิจด้วย)
- ตอบได้ภายใน 24 ชม. หลังลูกค้าส่งข้อความล่าสุด (Worker ตรวจให้ ถ้าเกินจะตอบ 409)
- KV อ่านค่าล่าสุดอาจช้าได้ถึงประมาณ 1 นาทีเมื่ออ่านจากคนละพื้นที่ แอปดึงใหม่ทุก 30 วินาที ไม่ใช่แจ้งเตือนทันที

## ตัวดึงการใช้ Firebase จริง (`fb-usage-worker.js`) — หน้าเงิน → การใช้ Firebase
ดึงยอดอ่าน/เขียน/ลบ Firestore รายวัน (เวลาไทย) จาก Google Cloud Monitoring รวมทั้งโปรเจกต์ (แอป + แผง + หน้าลูกค้า) · ไม่มีข้อมูลลูกค้า · จำผล 10 นาที
แอปเรียก `https://fb-usage.organic-parmesan.workers.dev/usage?days=14` (รับเฉพาะ Origin ของร้าน)

### Google Cloud (เจ้าของทำ)
1. console.cloud.google.com → เลือกโปรเจกต์ `ball-sticker-d95c2`
2. IAM & Admin → Service Accounts → Create service account ชื่อ `fb-usage-reader` → Role **Monitoring Viewer** อย่างเดียว → Done
3. คลิกบัญชีนั้น → Keys → Add key → Create new key → JSON (ได้ไฟล์ .json — ห้ามส่งในแชต/ห้ามใส่ในรีโป)
4. ถ้า Monitoring API ยังไม่เปิด: APIs & Services → Library → Cloud Monitoring API → Enable

### Cloudflare (เจ้าของทำ)
1. Workers & Pages → Create → Worker ชื่อ **fb-usage** → Deploy → Edit code → วางโค้ดจาก `fb-usage-worker.js` → Deploy
2. Settings → Variables and Secrets → Add → Type **Secret** ชื่อ `GCP_SA_KEY` → วางเนื้อไฟล์ .json ทั้งไฟล์ → Save
3. ทดสอบ: เปิด https://fb-usage.organic-parmesan.workers.dev/usage?days=3 ต้องได้ JSON มี `days`

ทดสอบแล้วแค่แบบจำลอง (คีย์ RSA จริง + จำลอง API ของ Google) ยังไม่ได้ทดสอบกับ Google จริง
