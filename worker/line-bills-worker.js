/* Ball Sticker — LINE OA "บอลสติ๊กเกอร์ บิล" (@162oesrh) รับรูป/PDF บิลซื้อ + ปุ่ม "ตรวจบิล" (Cloudflare Worker: line-bills)
 * แยกจาก Worker line-oa (@bk25 แชตลูกค้า)
 *
 *  POST /webhook              ← LINE (ตรวจลายเซ็น LINE_BILLS_SECRET) · รูป/ไฟล์ → billInbox/{messageId} (status 'new')
 *                               → Google Vision อ่านข้อความ (≤ 8 วิ) → analyzeBill → ตอบการ์ดผลอ่าน billFlex (หลายรูป = carousel)
 *                               Vision ล้ม/ช้า → การ์ด "รับบิลแล้ว ✅" + ปุ่ม "ตรวจบิล" แบบเดิม
 *                               ปุ่มในการ์ด (postback act=save|hq|skip) ทำได้เฉพาะคนที่ส่งบิล
 *  GET  /bill?id&t            → ข้อมูลบิล + ocrText + edits + รายชื่อร้าน (vendors) ให้หน้า bill-check.html
 *  GET  /content?ch=bills&id&(t|key) → ไฟล์จาก LINE (LINE เก็บไฟล์ ~7 วัน)
 *  POST /bill/save {id,t,rec} → purchases/{rec.id} + billInbox done
 *  POST /bill/skip {id,t}     → billInbox done (skipped)
 *  ลิงก์ปุ่ม: https://app.ballsticker.co.th/bill-check?id=<messageId>&t=<32 ตัวแรกของ hex HMAC-SHA256(LINE_BILLS_LINK_KEY, messageId)>
 *
 * ค่าลับ (เจ้าของใส่เองใน Cloudflare · ห้ามส่งในแชต/ห้ามใส่ในโค้ด):
 *   LINE_BILLS_SECRET, LINE_BILLS_TOKEN, FIRESTORE_SA_JSON (Cloud Datastore User), LINE_BILLS_LINK_KEY (สุ่มเอง ≥ 32 ตัว)
 * ไม่บังคับ: APP_KEY (ค่าเริ่มต้น = LINE_OA_KEY ในแอป) · BILL_PAGE (ค่าเริ่มต้น https://app.ballsticker.co.th/bill-check)
 * Google Vision: เปิด Cloud Vision API ในโปรเจกต์เดียวกับ Service Account (ใช้ SA เดิม scope cloud-vision)
 *
 * โค้ดชุดนี้ import ตัวอ่านบิลจาก ./line-bills/bill-core.mjs (สร้างด้วย tools/mk_billcheck.py ห้ามแก้ตรง)
 * วางใน Cloudflare: ใช้ไฟล์รวม worker/line-bills/dist/line-bills.js (สร้างด้วย python3 tools/mk_line_bills.py)
 */
import { analyzeBill, billFlex, savedFlex } from './line-bills/bill-core.mjs';
const ALLOW = ['https://app.ballsticker.co.th', 'https://ball-sticker-app.pages.dev'];
const DEFAULT_APP_KEY = 'loa5408501ccebb8cc0e6155';
const DEFAULT_PAGE = 'https://app.ballsticker.co.th/bill-check';
const COL = 'billInbox';
const MAX_BODY = 32 * 1024;
const VISION_MS = 8000;
const CLOUDINARY = { cloud: 'm4n2ttwh', preset: 'nkbscpgs' };
const OCR_MAX_BYTES = 20000;
let tok = { t: '', exp: 0 };

// ---------- ทั่วไป ----------
function cors(origin) {
  return { 'Access-Control-Allow-Origin': ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'Content-Type, Content-Length', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
}
const json = (o, s, origin) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(origin)) });
const enc = (s) => new TextEncoder().encode(s);
const b64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc(s));
function sameStr(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function hmac(key, msg) { const k = await crypto.subtle.importKey('raw', enc(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(msg))); }
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const validId = (id) => /^\d{6,25}$/.test(String(id || ''));

async function lineSigOk(secret, body, sig) {
  if (!secret || !sig) return false;
  return sameStr(btoa(String.fromCharCode.apply(null, await hmac(secret, body))), sig);
}
async function linkTok(env, id) { return env.LINE_BILLS_LINK_KEY ? hex(await hmac(env.LINE_BILLS_LINK_KEY, String(id))).slice(0, 32) : ''; }
async function tokOk(env, id, t) { if (!env.LINE_BILLS_LINK_KEY || !validId(id) || !t) return false; return sameStr(await linkTok(env, id), t); }
async function billUrl(env, id) { return (env.BILL_PAGE || DEFAULT_PAGE) + '?id=' + id + '&t=' + await linkTok(env, id); }

// ---------- Firestore (REST + Service Account) ----------
async function gToken(sa) {
  if (tok.t && Date.now() < tok.exp - 60000) return tok.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-vision', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(head + '.' + claim));
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('google token: ' + (j.error_description || j.error || res.status));
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.t;
}
function saOf(env) {
  const sa = JSON.parse(env.FIRESTORE_SA_JSON || '{}');
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIRESTORE_SA_JSON ไม่ครบ');
  return sa;
}
const fsBase = (sa) => 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents';
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach((k) => { f[k] = toFs(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fromFields((v.mapValue || {}).fields || {});
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(fromFs);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function fromFields(f) { const o = {}; Object.keys(f || {}).forEach((k) => { o[k] = fromFs(f[k]); }); return o; }
async function fsFetch(env, path, opt) {
  const sa = saOf(env);
  return fetch(fsBase(sa) + path, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + await gToken(sa), 'Content-Type': 'application/json' } }));
}
async function fsGet(env, col, id) {
  const r = await fsFetch(env, '/' + col + '/' + encodeURIComponent(id), { method: 'GET' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore get ' + r.status);
  const j = await r.json(), o = fromFields(j.fields);
  Object.defineProperty(o, '_ut', { value: j.updateTime, enumerable: false });   // ใช้ล็อกกันกดบันทึกซ้อน
  return o;
}
// เขียน: mode 'create' = ต้องยังไม่มี · 'update' = ต้องมีแล้ว (แก้เฉพาะช่องที่ส่ง)
async function fsWrite(env, col, id, data, mode, updateTime) {
  const fields = {}; Object.keys(data).forEach((k) => { fields[k] = toFs(data[k]); });
  let q = mode === 'create' ? '?currentDocument.exists=false' : updateTime ? '?currentDocument.updateTime=' + encodeURIComponent(updateTime) : '?currentDocument.exists=true';
  if (mode === 'update') q += Object.keys(data).map((k) => '&updateMask.fieldPaths=' + encodeURIComponent(k)).join('');
  const r = await fsFetch(env, '/' + col + '/' + encodeURIComponent(id) + q, { method: 'PATCH', body: JSON.stringify({ fields }) });
  if (r.ok) return 'ok';
  const t = await r.text();
  if (/FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(t)) return mode === 'create' ? 'exists' : 'missing';
  throw new Error('firestore ' + r.status + ': ' + t.slice(0, 200));
}
async function fsQueryEq(env, col, field, value) {
  const r = await fsFetch(env, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFs(value) } }, limit: 50 } }) });
  if (!r.ok) throw new Error('firestore query ' + r.status);
  return (await r.json()).filter((x) => x.document).map((x) => Object.assign({ _id: x.document.name.split('/').pop() }, fromFields(x.document.fields)));
}
// รายชื่อร้าน (เฉพาะ name/tax/branch/cat/addr) · จำไว้ 10 นาที กันยอดอ่าน Firestore
async function vendors(env, ctx) {
  const ck = new Request('https://line-bills.cache/vendors'), cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) return hit.json();
  const out = []; let page = '';
  do {
    const q = '?pageSize=300' + ['name', 'tax', 'branch', 'cat', 'addr'].map((f) => '&mask.fieldPaths=' + f).join('') + (page ? '&pageToken=' + encodeURIComponent(page) : '');
    const r = await fsFetch(env, '/vendors' + q, { method: 'GET' });
    if (!r.ok) throw new Error('firestore vendors ' + r.status);
    const j = await r.json();
    (j.documents || []).forEach((d) => { const v = fromFields(d.fields); if (v.name) out.push({ name: String(v.name || ''), tax: String(v.tax || ''), branch: String(v.branch || ''), cat: String(v.cat || ''), addr: String(v.addr || '') }); });
    page = j.nextPageToken || '';
  } while (page && out.length < 3000);
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } })));
  return out;
}

// ---------- ล็อกบิล: เปลี่ยน status new → saving ได้คนเดียว (กดบันทึกพร้อมกัน 2 ที่ ไม่ได้ 2 รายการ) ----------
async function lockBill(env, id, b) {
  if (b.status !== 'new') return false;
  return (await fsWrite(env, COL, id, { status: 'saving' }, 'update', b._ut)) === 'ok';
}
async function saveRec(env, id, b, rec) {   // rec ผ่าน cleanRec แล้ว · ต้อง lockBill ก่อน
  Object.assign(rec, { savedAt: Date.now(), createdBy: 'LINE · ' + (b.fromName || ''), src: 'line', billId: id });
  let w;
  try { w = await fsWrite(env, 'purchases', rec.id, rec, 'create'); } catch (e) { await fsWrite(env, COL, id, { status: 'new' }, 'update').catch(() => {}); throw e; }
  if (w === 'exists') { await fsWrite(env, COL, id, { status: 'new' }, 'update').catch(() => {}); return 'exists'; }
  await fsWrite(env, COL, id, { status: 'done', doneAt: Date.now(), purchaseId: rec.id }, 'update');
  return 'ok';
}

// ---------- Google Vision ----------
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function cutBytes(t, max) { const b = enc(t); return b.length <= max ? t : new TextDecoder().decode(b.slice(0, max)).replace(/\uFFFD+$/, ''); }
async function withTimeout(fn, ms) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try { return await fn(ac.signal); } finally { clearTimeout(timer); }
}
// อ่านข้อความจากรูป/PDF (≤ 5 หน้า) · ล้มหรือเกินเวลา → null
async function visionText(env, type, buf, mime) {
  try {
    const sa = saOf(env), token = await gToken(sa);
    return await withTimeout(async (signal) => {
      const isPdf = type === 'file' && /pdf/i.test(mime || '');
      if (type === 'file' && !isPdf) return null;
      const url = 'https://vision.googleapis.com/v1/' + (isPdf ? 'files:annotate' : 'images:annotate');
      const req = isPdf
        ? { inputConfig: { content: b64(buf), mimeType: 'application/pdf' }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['th', 'en'] }, pages: [1, 2, 3, 4, 5] }
        : { image: { content: b64(buf) }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['th', 'en'] } };
      const r = await fetch(url, { method: 'POST', signal, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [req] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log('vision', r.status, JSON.stringify(j.error || {}).slice(0, 300)); return null; }
      const res = (j.responses || [])[0] || {};
      if (res.error) { console.log('vision item', JSON.stringify(res.error).slice(0, 300)); return null; }
      const text = isPdf ? (res.responses || []).map((x) => (x.fullTextAnnotation || {}).text || '').join('\n') : (res.fullTextAnnotation || {}).text || '';
      return text.trim() ? text : '';
    }, VISION_MS);
  } catch (e) { console.log('vision fail', e.name, e.message); return null; }
}
async function lineContent(env, id) {
  const r = await lineGet(env, 'https://api-data.line.me/v2/bot/message/' + id + '/content');
  if (!r.ok) return null;
  return { buf: await r.arrayBuffer(), mime: r.headers.get('Content-Type') || '' };
}
async function cloudinaryUpload(buf, mime, name) {
  try {
    return await withTimeout(async (signal) => {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime || 'image/jpeg' }), name);
      fd.append('upload_preset', CLOUDINARY.preset);
      const r = await fetch('https://api.cloudinary.com/v1_1/' + CLOUDINARY.cloud + '/image/upload', { method: 'POST', body: fd, signal });
      const j = await r.json().catch(() => ({}));
      return typeof j.secure_url === 'string' && j.secure_url.indexOf('https://res.cloudinary.com/' + CLOUDINARY.cloud + '/') === 0 ? j.secure_url : '';
    }, 8000);
  } catch (e) { return ''; }
}

// ---------- LINE ----------
const lineGet = (env, url) => fetch(url, { headers: { Authorization: 'Bearer ' + env.LINE_BILLS_TOKEN } });
async function displayName(env, userId) {
  try { const r = await lineGet(env, 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId)); if (r.ok) return ((await r.json()).displayName || '').slice(0, 80); } catch (e) {}
  return '';
}
async function reply(env, token, messages) {
  if (!token || !messages.length) return;
  const r = await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { Authorization: 'Bearer ' + env.LINE_BILLS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: token, messages: messages.slice(0, 5) }) }).catch((e) => ({ ok: false, text: async () => e.message }));
  if (!r.ok) console.log('reply failed', await r.text());
}
const textMsg = (text) => ({ type: 'text', text });
function bubble(title, sub, uri) {
  const b = { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: 'รับบิลแล้ว ✅', weight: 'bold', size: 'lg', color: '#1B2150' },
      { type: 'text', text: title, size: 'sm', color: '#555555', wrap: true, maxLines: 2 },
      { type: 'text', text: sub, size: 'xs', color: '#999999', wrap: true }] } };
  if (uri) b.footer = { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#E9B53E', height: 'sm', action: { type: 'uri', label: 'ตรวจบิล', uri } }] };
  return b;
}
// การ์ดสำหรับบิลแต่ละใบ: อ่านได้ → billFlex (ผลอ่าน) · อ่านไม่ได้ → การ์ด "รับบิลแล้ว" + ปุ่มตรวจบิล
async function cardOf(env, d, i, n, vendors) {
  const url = env.LINE_BILLS_LINK_KEY ? await billUrl(env, d.contentId) : '';
  if (d.ocrText && url) {
    const r = analyzeBill(d.ocrText, vendors, d.edits || {});
    return { bubble: billFlex(r, d.contentId, { edit: url }), amount: Number(r.fields.amount) || 0 };
  }
  const title = d.type === 'file' ? (d.fileName || 'ไฟล์บิล') : (n > 1 ? 'รูปที่ ' + (i + 1) + '/' + n : 'รูปบิล');
  return { bubble: bubble(title, url ? 'กด "ตรวจบิล" เพื่ออ่านและบันทึกเข้าภาษีซื้อ' : 'บันทึกเข้ากล่องบิลในแอปแล้ว', url), amount: 0 };
}
const fmtBaht = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function cardsFor(env, docs, vend) {
  const cards = [];
  for (let i = 0; i < docs.length; i++) cards.push(await cardOf(env, docs[i], i, docs.length, vend));
  const msgs = [];
  for (let i = 0; i < cards.length && msgs.length < 5; i += 12) {
    const part = cards.slice(i, i + 12), read = part.filter((c) => c.amount > 0);
    const alt = read.length ? 'อ่านบิลแล้ว ' + (read.length === 1 ? fmtBaht(read[0].amount) + ' บาท' : read.length + ' ใบ') : 'รับบิลแล้ว ✅ กดตรวจบิล';
    msgs.push({ type: 'flex', altText: alt, contents: part.length === 1 ? part[0].bubble : { type: 'carousel', contents: part.map((c) => c.bubble) } });
  }
  return msgs;
}

// รูป/ไฟล์ใหม่: บันทึก → Vision → เก็บ ocrText/parsed → ตอบ (หลายรูปพร้อมกัน ตอบครั้งเดียวที่รูปสุดท้าย)
async function onFile(env, ctx, ev, names) {
  const m = ev.message, uid = (ev.source || {}).userId || '';
  if (uid && names[uid] === undefined) names[uid] = await displayName(env, uid);
  const doc = { from: uid, fromName: names[uid] || '', type: m.type, contentId: m.id, fileName: m.fileName || (m.type === 'image' ? 'bill-' + m.id + '.jpg' : 'bill-' + m.id),
    size: m.fileSize || 0, createdAt: ev.timestamp || Date.now(), status: 'new' };
  const set = m.imageSet && m.imageSet.total > 1 ? m.imageSet : null;
  if (set) { doc.setId = set.id; doc.setIndex = set.index || 0; doc.setTotal = set.total; }
  let st = 'error';
  try { st = await fsWrite(env, COL, m.id, doc, 'create'); } catch (e) { console.log('billInbox write failed', m.id, e.message); }
  if (st === 'error') { await reply(env, ev.replyToken, [textMsg('บันทึกบิลไม่สำเร็จ ลองส่งใหม่อีกครั้งนะครับ')]); return; }
  if (st !== 'ok') return;                                        // LINE ส่งซ้ำ → ทำไปแล้ว

  let vend = [];
  try { vend = await vendors(env, ctx); } catch (e) { console.log('vendors', e.message); }
  const c = await lineContent(env, m.id);
  const text = c ? await visionText(env, m.type, c.buf, c.mime) : null;
  if (text) {
    doc.ocrText = cutBytes(text, OCR_MAX_BYTES);
    const f = analyzeBill(doc.ocrText, vend).fields, parsed = {};
    Object.keys(f).forEach((k) => { if (f[k] != null && typeof f[k] !== 'object') parsed[k] = String(f[k]).slice(0, 300); });
    await fsWrite(env, COL, m.id, { ocrText: doc.ocrText, parsed, ocrState: 'done' }, 'update').catch((e) => console.log('save ocr', e.message));
  } else {
    await fsWrite(env, COL, m.id, { ocrState: 'fail' }, 'update').catch(() => {});
  }

  if (set && set.index !== set.total) return;
  let docs = [doc];
  if (set) {                                                      // รวมทุกรูปในชุด (อาจมาคนละ webhook) · รอรูปอื่นอ่านเสร็จสั้นๆ
    for (let k = 0; k < 4; k++) {
      try { docs = (await fsQueryEq(env, COL, 'setId', set.id)).map((d) => Object.assign(d, { contentId: d.contentId || d._id })); } catch (e) { docs = [doc]; break; }
      if (docs.length >= set.total && docs.every((d) => d.ocrState)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!docs.some((d) => d.contentId === doc.contentId)) docs.push(doc);
    docs.sort((a, b) => (a.setIndex || 0) - (b.setIndex || 0));
  }
  await reply(env, ev.replyToken, await cardsFor(env, docs, vend));
}

// rec สำหรับ purchases จากผลอ่าน (รูปแบบเดียวกับหน้า bill-check)
function recFrom(r, b, photo) {
  const f = r.fields, n = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) && x > 0 ? x.toFixed(2) : ''; };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const claim = ['vat', 'expense', 'personal'].indexOf(f.claim) >= 0 ? f.claim : 'expense';
  return { id: 'p' + Date.now(), date, vendor: String(f.vendor || '').trim().slice(0, 200), invoiceNo: String(f.invoiceNo || '').trim().slice(0, 200),
    vendorTax: String(f.vendorTax || '').replace(/\D/g, '').length === 13 ? String(f.vendorTax).replace(/\D/g, '') : '',
    vendorAddr: String(f.vendorAddr || '').trim().slice(0, 200), vendorBranch: String(f.vendorBranch || '').trim().slice(0, 200),
    amount: n(f.amount), vat: n(f.vat), note: ('บิลจาก LINE ' + (b.fromName || '')).slice(0, 200), photo, account: 'กิติพงษ์', claim, cat: String(f.cat || '').slice(0, 200),
    evid: '', evNo: '', bankOutId: '', docSrc: String(f.docSrc || '').slice(0, 200),
    claimMonth: claim === 'vat' ? (/^\d{4}-\d{2}$/.test(f.claimMonth || '') ? f.claimMonth : date.slice(0, 7)) : '', chk: r.chk || {} };
}

// ปุ่มในการ์ด: act=save|hq|skip&id= · ทำได้เฉพาะคนที่ส่งบิล (คนอื่นกด = เงียบ)
async function onPostback(env, ctx, ev) {
  const q = new URLSearchParams((ev.postback || {}).data || ''), act = q.get('act'), id = q.get('id') || '', uid = (ev.source || {}).userId || '';
  if (['save', 'hq', 'skip'].indexOf(act) < 0 || !validId(id)) return;
  const b = await fsGet(env, COL, id);
  if (!b || !uid || b.from !== uid) return;
  const say = (t) => reply(env, ev.replyToken, [textMsg(t)]);
  if (b.status !== 'new') return say(b.skipped ? 'บิลนี้ทำเครื่องหมายว่าไม่ใช่บิลไปแล้ว' : 'บิลนี้บันทึกไปแล้ว');

  if (act === 'skip') {
    await fsWrite(env, COL, id, { status: 'done', doneAt: Date.now(), skipped: true }, 'update', b._ut);
    return say('เก็บไว้แล้ว ไม่บันทึกเป็นบิล');
  }
  if (!b.ocrText) return say('ยังอ่านบิลนี้ไม่ได้ กด "✏️ แก้ไข" เพื่อตรวจบิลในหน้าเว็บ');
  const vend = await vendors(env, ctx).catch(() => []);

  if (act === 'hq') {
    const edits = Object.assign({}, b.edits || {}, { vendorBranch: 'สำนักงานใหญ่' });
    await fsWrite(env, COL, id, { edits }, 'update');
    const r = analyzeBill(b.ocrText, vend, edits), url = await billUrl(env, id);
    return reply(env, ev.replyToken, [{ type: 'flex', altText: 'อ่านบิลแล้ว ' + (Number(r.fields.amount) ? fmtBaht(Number(r.fields.amount)) + ' บาท' : ''), contents: billFlex(r, id, { edit: url }) }]);
  }

  // save
  const r = analyzeBill(b.ocrText, vend, b.edits || {});
  if (!r.readable || !(Number(String(r.fields.amount || '').replace(/,/g, '')) > 0)) return say('ยังไม่พบยอดเงินในบิล กด "✏️ แก้ไข" เพื่อใส่เอง');
  if (!(await lockBill(env, id, b))) return say('บิลนี้บันทึกไปแล้ว');
  let photo = '';
  if (b.type === 'image') { const c = await lineContent(env, id); if (c) photo = await cloudinaryUpload(c.buf, c.mime, 'bill-' + id + '.jpg'); }
  const [rec, err] = cleanRec(recFrom(r, b, photo));
  if (!rec) { await fsWrite(env, COL, id, { status: 'new' }, 'update').catch(() => {}); return say('บันทึกไม่ได้: ' + err + ' · กด "✏️ แก้ไข" เพื่อแก้'); }
  const w = await saveRec(env, id, b, rec);
  if (w !== 'ok') return say('บันทึกไม่สำเร็จ ลองกดใหม่อีกครั้ง');
  return reply(env, ev.replyToken, [{ type: 'flex', altText: 'บันทึกแล้ว ' + fmtBaht(Number(rec.amount) || 0) + ' บาท', contents: savedFlex(rec) }]);
}

async function handleEvents(env, ctx, events) {
  const names = {};
  for (const ev of events) {
    try {
      if (ev.type === 'postback') { await onPostback(env, ctx, ev); continue; }
      if (ev.type !== 'message' || !ev.message) continue;
      const m = ev.message;
      if (m.type === 'image' || m.type === 'file') await onFile(env, ctx, ev, names);
      else if (m.type === 'text') await reply(env, ev.replyToken, [textMsg('ช่องนี้รับเฉพาะรูปหรือไฟล์ PDF ของบิลซื้อ ส่งเข้ามาได้เลย 🙏')]);
    } catch (e) { console.log('event error', ev.type, e.message); }
  }
}

// ---------- ตรวจข้อมูลบิลก่อนบันทึก ----------
const STR_FIELDS = ['vendor', 'invoiceNo', 'vendorAddr', 'vendorBranch', 'note', 'account', 'cat', 'evid', 'evNo', 'bankOutId', 'docSrc'];
const isMoney = (v) => v === '' || (typeof v === 'number' && isFinite(v) && v >= 0) || (typeof v === 'string' && /^\d{1,10}(\.\d{1,2})?$/.test(v));
function cleanRec(rec) {
  if (!rec || typeof rec !== 'object') return [null, 'ไม่มีข้อมูลบิล'];
  if (!/^p\d{10,16}$/.test(String(rec.id || ''))) return [null, 'id ไม่ถูกต้อง'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rec.date || ''))) return [null, 'วันที่ไม่ถูกต้อง'];
  if (['vat', 'expense', 'personal'].indexOf(rec.claim) < 0) return [null, 'ประเภทการเคลมไม่ถูกต้อง'];
  const cm = rec.claimMonth == null ? '' : String(rec.claimMonth);
  if (cm !== '' && !/^\d{4}-\d{2}$/.test(cm)) return [null, 'เดือนที่เคลมไม่ถูกต้อง'];
  const amount = rec.amount == null ? '' : rec.amount, vat = rec.vat == null ? '' : rec.vat;
  if (!isMoney(amount) || !isMoney(vat)) return [null, 'ยอดเงินไม่ถูกต้อง'];
  const tax = String(rec.vendorTax == null ? '' : rec.vendorTax);
  if (tax !== '' && !/^\d{13}$/.test(tax)) return [null, 'เลขผู้เสียภาษีต้อง 13 หลัก'];
  const photo = String(rec.photo == null ? '' : rec.photo);
  if (photo !== '' && (photo.length > 300 || photo.indexOf('https://res.cloudinary.com/m4n2ttwh/') !== 0)) return [null, 'ลิงก์รูปไม่ถูกต้อง'];
  const out = { id: rec.id, date: rec.date, claim: rec.claim, claimMonth: cm, amount: typeof amount === 'number' ? amount.toFixed(2) : amount,
    vat: typeof vat === 'number' ? vat.toFixed(2) : vat, vendorTax: tax, photo };
  for (const k of STR_FIELDS) {
    const v = rec[k] == null ? '' : rec[k];
    if (typeof v !== 'string' && typeof v !== 'number') return [null, k + ' ไม่ถูกต้อง'];
    if (String(v).length > 200) return [null, k + ' ยาวเกิน 200 ตัว'];
    out[k] = String(v);
  }
  const chk = {};
  if (rec.chk != null) {
    if (typeof rec.chk !== 'object' || Array.isArray(rec.chk)) return [null, 'chk ไม่ถูกต้อง'];
    const ks = Object.keys(rec.chk);
    if (ks.length > 30) return [null, 'chk มากเกินไป'];
    for (const k of ks) { if (!/^[A-Za-z]{1,30}$/.test(k) || typeof rec.chk[k] !== 'boolean') return [null, 'chk ต้องเป็นจริง/เท็จ']; chk[k] = rec.chk[k]; }
  }
  out.chk = chk;
  return [out, ''];
}
async function readBody(req) {
  const len = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (len > MAX_BODY) return null;
  const t = await req.text();
  if (t.length > MAX_BODY) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '', p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    if (p === '/webhook' && req.method === 'POST') {
      const body = await req.text();
      if (!(await lineSigOk(env.LINE_BILLS_SECRET, body, req.headers.get('X-Line-Signature') || ''))) return new Response('bad signature', { status: 401 });
      let j = {}; try { j = JSON.parse(body); } catch (e) {}
      ctx.waitUntil(handleEvents(env, ctx, j.events || []));
      return new Response('ok');
    }
    if (p === '/') return json({ ok: true, service: 'ball line-bills', ready: !!(env.LINE_BILLS_SECRET && env.LINE_BILLS_TOKEN && env.FIRESTORE_SA_JSON), link: !!env.LINE_BILLS_LINK_KEY }, 200, origin);
    if (origin && ALLOW.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);

    try {
      if (p === '/content' && req.method === 'GET') {
        if ((url.searchParams.get('ch') || 'bills') !== 'bills') return json({ error: 'ch ต้องเป็น bills' }, 400, origin);
        const id = url.searchParams.get('id') || '', t = url.searchParams.get('t');
        if (!validId(id)) return json({ error: 'id ไม่ถูกต้อง' }, 400, origin);
        const ok = t ? await tokOk(env, id, t) : url.searchParams.get('key') === (env.APP_KEY || DEFAULT_APP_KEY);
        if (!ok) return json({ error: t ? 'ลิงก์ไม่ถูกต้อง' : 'key ไม่ถูกต้อง' }, t ? 403 : 401, origin);
        const r = await lineGet(env, 'https://api-data.line.me/v2/bot/message/' + id + '/content');
        if (!r.ok) return json({ error: r.status === 404 ? 'ไม่พบไฟล์ (LINE เก็บไฟล์ไว้ประมาณ 7 วัน)' : 'ดึงไฟล์จาก LINE ไม่ได้ (' + r.status + ')' }, r.status === 404 ? 404 : 502, origin);
        return new Response(r.body, { headers: Object.assign({ 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' }, cors(origin)) });
      }

      if (p === '/bill' && req.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!(await tokOk(env, id, url.searchParams.get('t')))) return json({ error: 'ลิงก์ไม่ถูกต้อง' }, 403, origin);
        const b = await fsGet(env, COL, id);
        if (!b) return json({ error: 'ไม่พบบิล' }, 404, origin);
        const out = { ok: true, id, status: b.status === 'saving' ? 'new' : (b.status || 'new'), fromName: b.fromName || '', type: b.type || '', fileName: b.fileName || '', createdAt: b.createdAt || 0,
          ocrText: b.ocrText || '', edits: b.edits || {}, vendors: await vendors(env, ctx) };
        if (b.purchaseId) out.purchaseId = b.purchaseId;
        if (b.skipped) out.skipped = true;
        return json(out, 200, origin);
      }

      if ((p === '/bill/save' || p === '/bill/skip') && req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400, origin);
        const id = String(body.id || '');
        if (!(await tokOk(env, id, body.t))) return json({ error: 'ลิงก์ไม่ถูกต้อง' }, 403, origin);
        const b = await fsGet(env, COL, id);
        if (!b) return json({ error: 'ไม่พบบิล' }, 404, origin);

        if (p === '/bill/skip') {
          if (b.status !== 'new') return json({ ok: true, already: true }, 200, origin);
          if ((await fsWrite(env, COL, id, { status: 'done', doneAt: Date.now(), skipped: true }, 'update', b._ut)) !== 'ok') return json({ ok: true, already: true }, 200, origin);
          return json({ ok: true }, 200, origin);
        }

        if (b.status !== 'new') return json({ error: 'บิลนี้บันทึกไปแล้ว', purchaseId: b.purchaseId || '' }, 409, origin);
        const [rec, err] = cleanRec(body.rec);
        if (!rec) return json({ error: err }, 400, origin);
        if (!(await lockBill(env, id, b))) return json({ error: 'บิลนี้บันทึกไปแล้ว', purchaseId: '' }, 409, origin);
        const w = await saveRec(env, id, b, rec);
        if (w === 'exists') return json({ error: 'เลขรายการซ้ำ ลองกดบันทึกใหม่' }, 400, origin);
        return json({ ok: true, purchaseId: rec.id }, 200, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      console.log('error', p, e.message);
      return json({ error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }, 502, origin);
    }
  }
};
