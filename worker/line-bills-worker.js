/* Ball Sticker — LINE OA "บอลสติ๊กเกอร์ บิล" (@162oesrh) รับรูป/PDF บิลซื้อ (Cloudflare Worker: line-bills)
 * แยกจาก Worker line-oa (@bk25 แชตลูกค้า) เพื่อไม่ให้รูปบิลปนกับรูปลูกค้า และไม่แตะระบบแชตเดิม
 *
 *  POST /webhook            ← ใส่ใน LINE Developers (Messaging API → Webhook URL) · ตรวจลายเซ็นด้วย LINE_BILLS_SECRET
 *       รูป/ไฟล์ → Firestore billInbox/{messageId} = {from, fromName, type:'image'|'file', contentId, fileName, size, createdAt, status:'new'}
 *       แล้วตอบกลับ "รับบิลแล้ว" (ตอบกลับฟรี ไม่กินโควตาข้อความ · ส่งหลายรูปพร้อมกันตอบครั้งเดียว)
 *  GET  /content?ch=bills&key=…&id=<contentId>  → ไฟล์จาก LINE (รูป/PDF) · CORS ให้แอปร้าน · key = LINE_OA_KEY เดียวกับในแอป
 *
 * ค่าลับ (เจ้าของใส่เองใน Cloudflare → Worker line-bills → Settings → Variables and Secrets · ห้ามส่งในแชต/ห้ามใส่ในโค้ด):
 *   LINE_BILLS_SECRET   Channel secret ของ @162oesrh
 *   LINE_BILLS_TOKEN    Channel access token (long-lived) ของ @162oesrh
 *   FIRESTORE_SA_JSON   เนื้อไฟล์ .json ของ Service Account บทบาท "Cloud Datastore User" (เขียน Firestore ได้)
 * ไม่บังคับ: APP_KEY (ค่าเริ่มต้น = LINE_OA_KEY ที่แอปใช้อยู่แล้ว)
 */
const ALLOW = ['https://app.ballsticker.co.th', 'https://ball-sticker-app.pages.dev'];
const DEFAULT_APP_KEY = 'loa5408501ccebb8cc0e6155';   // เท่ากับ LINE_OA_KEY ในแอป (ค่าสาธารณะอยู่แล้ว) · ไฟล์ต้องรู้ messageId ด้วย
const COL = 'billInbox';
const REPLY_TEXT = 'รับบิลแล้ว ✅';
let tok = { t: '', exp: 0 };

function cors(origin) {
  return { 'Access-Control-Allow-Origin': ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0], 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'Content-Type, Content-Length, X-File-Name', 'Vary': 'Origin' };
}
const json = (o, s, origin) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(origin)) });
const b64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function lineSigOk(secret, body, sig) {
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = btoa(String.fromCharCode.apply(null, new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  if (mac.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < mac.length; i++) d |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

async function gToken(sa) {
  if (tok.t && Date.now() < tok.exp - 60000) return tok.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('google token: ' + (j.error_description || j.error || res.status));
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.t;
}

function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: String(v) };
}
// สร้างเอกสารใหม่เท่านั้น (LINE ส่ง webhook ซ้ำได้ → มีแล้วไม่ทับ status ที่แอปแก้ไปแล้ว)
async function fsCreate(env, id, data) {
  const sa = JSON.parse(env.FIRESTORE_SA_JSON || '{}');
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIRESTORE_SA_JSON ไม่ครบ');
  const fields = {}; Object.keys(data).forEach((k) => { fields[k] = fsVal(data[k]); });
  const url = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents/' + COL + '/' + encodeURIComponent(id) + '?currentDocument.exists=false';
  const res = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer ' + await gToken(sa), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (res.ok) return 'created';
  const t = await res.text();
  if (/FAILED_PRECONDITION|ALREADY_EXISTS/.test(t)) return 'exists';
  throw new Error('firestore ' + res.status + ': ' + t.slice(0, 200));
}

async function lineGet(env, url) { return fetch(url, { headers: { Authorization: 'Bearer ' + env.LINE_BILLS_TOKEN } }); }
async function displayName(env, userId) {
  try { const r = await lineGet(env, 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId)); if (r.ok) return ((await r.json()).displayName || '').slice(0, 80); } catch (e) {}
  return '';
}
async function reply(env, token, text) {
  if (!token) return;
  await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { Authorization: 'Bearer ' + env.LINE_BILLS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: token, messages: [{ type: 'text', text }] }) }).catch(() => {});
}

async function handleEvents(env, events) {
  const names = {};
  for (const ev of events) {
    if (ev.type !== 'message' || !ev.message) continue;
    const m = ev.message, src = ev.source || {}, uid = src.userId || '';
    if (m.type !== 'image' && m.type !== 'file') {
      if (m.type === 'text' && ev.replyToken) await reply(env, ev.replyToken, 'ช่องนี้รับเฉพาะรูปหรือไฟล์ PDF ของบิลซื้อ ส่งเข้ามาได้เลย 🙏');
      continue;
    }
    if (uid && names[uid] === undefined) names[uid] = await displayName(env, uid);
    const doc = { from: uid, fromName: names[uid] || '', type: m.type, contentId: m.id, fileName: m.fileName || (m.type === 'image' ? 'bill-' + m.id + '.jpg' : 'bill-' + m.id),
      size: m.fileSize || 0, createdAt: ev.timestamp || Date.now(), status: 'new' };
    if (m.imageSet) { doc.setId = m.imageSet.id; doc.setIndex = m.imageSet.index || 0; doc.setTotal = m.imageSet.total || 0; }
    let st = 'error';
    try { st = await fsCreate(env, m.id, doc); } catch (e) { console.log('billInbox write failed', m.id, e.message); }
    // หลายรูปพร้อมกัน (imageSet) → ตอบเฉพาะรูปสุดท้าย · บันทึกไม่ได้ → บอกให้ส่งใหม่
    const last = !m.imageSet || !m.imageSet.total || m.imageSet.index === m.imageSet.total;
    if (st === 'error') await reply(env, ev.replyToken, 'บันทึกบิลไม่สำเร็จ ลองส่งใหม่อีกครั้งนะครับ');
    else if (last && st === 'created') await reply(env, ev.replyToken, REPLY_TEXT + (m.imageSet && m.imageSet.total > 1 ? ' (' + m.imageSet.total + ' รูป)' : ''));
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    if (url.pathname === '/webhook' && req.method === 'POST') {
      const body = await req.text();
      if (!(await lineSigOk(env.LINE_BILLS_SECRET, body, req.headers.get('X-Line-Signature') || ''))) return new Response('bad signature', { status: 401 });
      let j = {}; try { j = JSON.parse(body); } catch (e) {}
      ctx.waitUntil(handleEvents(env, j.events || []));   // ตอบ LINE ทันที (ต้องภายใน ~1 วิ) แล้วค่อยบันทึก
      return new Response('ok');
    }

    if (url.pathname === '/content' && req.method === 'GET') {
      if (origin && ALLOW.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);
      if ((url.searchParams.get('ch') || 'bills') !== 'bills') return json({ error: 'ch ต้องเป็น bills' }, 400, origin);
      if (url.searchParams.get('key') !== (env.APP_KEY || DEFAULT_APP_KEY)) return json({ error: 'key ไม่ถูกต้อง' }, 401, origin);
      const id = url.searchParams.get('id') || '';
      if (!/^\d{6,25}$/.test(id)) return json({ error: 'id ไม่ถูกต้อง' }, 400, origin);
      const r = await lineGet(env, 'https://api-data.line.me/v2/bot/message/' + id + '/content');
      if (!r.ok) return json({ error: r.status === 404 ? 'ไม่พบไฟล์ (LINE ลบไฟล์เก่าแล้ว หรือ id ผิด)' : 'ดึงไฟล์จาก LINE ไม่ได้ (' + r.status + ')' }, r.status === 404 ? 404 : 502, origin);
      return new Response(r.body, { headers: Object.assign({ 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' }, cors(origin)) });
    }

    if (url.pathname === '/') return json({ ok: true, service: 'ball line-bills', ready: !!(env.LINE_BILLS_SECRET && env.LINE_BILLS_TOKEN && env.FIRESTORE_SA_JSON) }, 200, origin);
    return json({ error: 'not found' }, 404, origin);
  }
};
