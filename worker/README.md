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

## เลขา (lekha-worker.js) — สั่งงาน Claude จากแอป
1. GitHub repo → Settings → Secrets and variables → Actions → เพิ่ม `ANTHROPIC_API_KEY` (ใช้กับ `.github/workflows/lekha.yml`)
2. GitHub → Settings (บัญชี) → Developer settings → Fine-grained tokens → Generate: เลือกเฉพาะ repo `ball-sticker-web` · Repository permissions → **Issues: Read and write** อย่างเดียว
3. Cloudflare → Workers & Pages → Create → Worker ชื่อ `lekha` → วางโค้ด `lekha-worker.js` → Deploy
4. Worker `lekha` → Settings → Variables and Secrets → เพิ่ม Secret `GH_TOKEN` (token ข้อ 2) และ `LEKHA_PIN` (รหัส ≥ 6 ตัว)
- ทำงานเฉพาะ issue ที่ป้าย `lekha` และคนส่งเป็นเจ้าของ repo · ใส่รหัสผิด 5 ครั้งล็อก 15 นาที · ช่วงที่ repo ยังเป็นสาธารณะ ข้อความใน issue คนนอกเห็นได้ ห้ามพิมพ์ข้อมูลลูกค้า/รหัส

## line-bills (line-bills-worker.js) — LINE OA "บอลสติ๊กเกอร์ บิล" (@162oesrh) รับบิลซื้อ
- Webhook URL: `https://line-bills.organic-parmesan.workers.dev/webhook` · ไฟล์: `GET /content?ch=bills&key=<LINE_OA_KEY>&id=<contentId>` (CORS แอปร้าน)
- Secrets: `LINE_BILLS_SECRET`, `LINE_BILLS_TOKEN`, `FIRESTORE_SA_JSON` (Service Account บทบาท Cloud Datastore User), `LINE_BILLS_LINK_KEY` (สุ่มเอง ≥ 32 ตัว ใช้เซ็นลิงก์ปุ่ม "ตรวจบิล")
- **วางโค้ดใน Cloudflare ใช้ไฟล์รวม `worker/line-bills/dist/line-bills.js`** (สร้างด้วย `python3 tools/mk_line_bills.py` — รวม bill-core.mjs + Worker) · การ์ดผลอ่านบิลใช้ Google Vision (เปิด Cloud Vision API ในโปรเจกต์ ใช้ SA เดิม ไม่ต้องเพิ่มบทบาท)
- ปุ่ม "ตรวจบิล": `GET /bill?id&t` · `POST /bill/save {id,t,rec}` · `POST /bill/skip {id,t}` · หน้า bill-check.html (ตัวที่ 1)
- Firestore rules ส่วน billInbox: `worker/line-bills/firestore-rules-billInbox.txt` (วางใน `match /databases/{database}/documents { … }`)
- LINE เก็บไฟล์ไว้ ~7 วัน → ต้องตรวจ/บันทึกภายใน 7 วัน (รูปที่บันทึกแล้วไปอยู่ Cloudinary)

## ตัวดึงค่าโฆษณา Meta (`fb-ads-worker.js`) — แดชบอร์ด ROAS / ค่าแอด / แชตจากแอด
GET `/ads?days=14` → `{days:[{date,spend,chats,impressions,clicks}]}` · ROAS แอปคำนวณเองจากยอดขายจริง
ทดสอบแล้วแค่แบบจำลอง (parse + CORS) ยังไม่ได้ทดสอบกับ Meta จริง

### Meta (เจ้าของทำ)
1. business.facebook.com → Business settings → Users → **System users** → Add (บทบาท Admin หรือ Employee) 
2. Add assets → Ad accounts → เลือกบัญชีโฆษณา → สิทธิ์ **View performance**
3. Generate token → เลือกแอป Meta ที่มีอยู่ → ติ๊กสิทธิ์ **ads_read** อย่างเดียว → เลือกไม่หมดอายุ ถ้ามีตัวเลือก → คัดลอกโทเคน (ห้ามส่งในแชต)
4. เลขบัญชีโฆษณา: Ads Manager มุมซ้ายบน (ตัวเลขล้วน)
### Cloudflare (เจ้าของทำ)
Workers & Pages → Create → Worker ชื่อ **fb-ads** → วางโค้ด → Secret `ADS_TOKEN`, `AD_ACCOUNT` → ทดสอบ `/ads?days=3` ต้องได้ JSON

## mcp-shop — MCP ของแอปหลังร้าน (ให้ AI ดูข้อมูลร้าน + สร้างร่าง)
ไฟล์ `mcp-shop-worker.js` · ทดสอบ: `node worker/mcp-shop-worker.test.mjs` (ใช้ข้อมูลจำลอง ไม่แตะของจริง)

**ทำอะไรได้:** `list_jobs`, `get_job`, `list_bills`, `bank_in_summary` (ยอดรวมคำนวณด้วยโค้ด ไม่รวมบัญชีวันทิม), `ads_summary`, `create_draft`, `list_drafts`
**ทำไม่ได้โดยตั้งใจ:** แก้/ลบข้อมูล, โอนเงิน, ขึ้นเว็บจริง · ร่างทุกอันเขียนลงคอลเลกชัน `mcpDrafts` เท่านั้น แล้วเจ้าของกด "ยอมรับ/ทิ้ง" ในแอป (การ์ด "ร่างจาก AI")
**ความเป็นส่วนตัว:** ตัดรูป/ข้อความยาวออก ปิดเบอร์โทรเหลือ 4 ตัวท้าย (เปิดเต็มด้วย `SHOW_PHONE=1`)

ติดตั้ง (เจ้าของทำเอง ค่าลับห้ามส่งในแชต):
1. Cloudflare → Workers & Pages → สร้าง Worker ชื่อ `ball-mcp-shop` → วางโค้ดจาก `mcp-shop-worker.js` → Deploy
2. Settings → Variables and Secrets → เพิ่ม **Secret** `MCP_KEY` (สุ่มยาว ≥ 32 ตัว) และ `FIRESTORE_SA_JSON` (service account สิทธิ์ Cloud Datastore User ตัวเดียวกับ Worker บิล LINE)
3. Firebase Console → Firestore → Rules → เพิ่มกฎจาก `firestore-rules-mcpDrafts.txt` (ไม่เพิ่ม = การ์ดร่างในแอปยอมรับ/ทิ้งไม่ได้)
4. ต่อกับ Claude: Customize → Connectors → Add custom connector → ใส่ URL `https://ball-mcp-shop.<บัญชี>.workers.dev/mcp/<MCP_KEY>`
   (รหัสอยู่ใน URL เหมือนรหัสผ่าน อย่าแชร์ ถ้าหลุดให้เปลี่ยน `MCP_KEY` แล้วต่อใหม่)
