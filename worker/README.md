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
