/* Ball Sticker — ตัวส่งแจ้งเตือนเข้า Kob Chat (Cloudflare Worker)
 * แอปร้านเรียก POST /notify เมื่อ (1) ระบบตัดบิลจากเงินเข้าให้แล้ว (2) เงินเข้าที่ไม่แน่ใจ ต้องให้เจ้าของกดยืนยัน
 * Worker ถือ token ของบอตไว้ แล้วส่งการ์ดหาเจ้าของใน Kob Chat (บอตส่วนตัว ส่งหาได้เฉพาะเจ้าของบอต)
 *
 * ค่าลับ/ตัวแปร (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ดหรือแชต):
 *   KOBCHAT_BOT_TOKEN  (Secret, ขึ้นต้น kobbot_)  จากหน้า "บอทของฉัน" ใน Kob Chat
 *   KOB_USER_ID        (ไม่บังคับ) userId ของเจ้าของ ถ้าไม่ตั้ง Worker จะใช้คนแรกจาก GET /chats
 *   KOB_KV             (ไม่บังคับ) KV binding ไว้จำ eventId กันส่งซ้ำข้ามเครื่อง (ไม่ผูกก็ได้ จะกันซ้ำในหน่วยความจำ)
 * แอปทำงานได้ตามปกติถ้า Worker ล่ม (แจ้งเตือนในแอปยังมี) · ไม่มีข้อมูลลูกค้านอกจากชื่อร้านและยอดที่แอปส่งมา
 */
const API = 'https://kobchat.com/api/bot/v1';
const ALLOW = ['https://app.ballsticker.co.th', 'https://ballsticker.co.th', 'https://www.ballsticker.co.th', 'https://sbk-cmd.github.io'];
const seen = new Map();   // eventId → เวลา (กันซ้ำในหน่วยความจำ)
let ownerCache = '';
const baht = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' ฿';

function cors(origin) {
  const o = ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0];
  return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)) });
}
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);

function card(p) {
  const ok = p.type === 'matched';
  const color = ok ? '#15803d' : '#b45309';
  const head = ok ? '✅ ตัดบิลให้แล้ว' : '⚠️ เงินเข้า ต้องยืนยัน';
  const rows = (p.lines || []).slice(0, 8).map((t) => ({ type: 'text', text: t, size: 'sm', wrap: true, color: '#333333' }));
  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px', contents: [
      { type: 'text', text: head, color: '#ffffff', weight: 'bold', size: 'lg' },
      { type: 'text', text: p.title || 'บอลสติ๊กเกอร์', color: '#ffffff', size: 'xs' } ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: baht(p.amount), weight: 'bold', size: 'xl', color: color }, ...rows ] }
  };
  if (p.link) bubble.footer = { type: 'box', layout: 'vertical', contents: [
    { type: 'button', style: 'primary', color: color, action: { type: 'uri', label: ok ? 'เปิดดูในแอป' : 'เปิดแอปเพื่อยืนยัน', uri: p.link } } ] };
  return { type: 'card', altText: clip(head + ' ' + baht(p.amount) + ' ' + (p.title || ''), 300), contents: bubble };
}

async function kob(env, path, init) {
  return fetch(API + path, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + env.KOBCHAT_BOT_TOKEN, 'Content-Type': 'application/json' }, (init && init.headers) || {}) }));
}
async function ownerId(env) {
  if (env.KOB_USER_ID) return env.KOB_USER_ID;
  if (ownerCache) return ownerCache;
  const r = await kob(env, '/chats');
  const j = await r.json().catch(() => ({}));
  const u = j && j.users && j.users[0];
  if (!r.ok || !u) throw Object.assign(new Error('หาเจ้าของบอตไม่เจอ (ต้องเพิ่มบอตเป็นเพื่อนก่อน)'), { status: r.status || 404 });
  ownerCache = u.id || u.userId; return ownerCache;
}
async function already(env, id) {
  if (!id) return false;
  const now = Date.now(); seen.forEach((t, k) => { if (now - t > 86400000) seen.delete(k); });
  if (seen.has(id)) return true;
  if (env.KOB_KV) { if (await env.KOB_KV.get('ev:' + id)) { seen.set(id, now); return true; } await env.KOB_KV.put('ev:' + id, '1', { expirationTtl: 86400 }); }
  seen.set(id, now); return false;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.KOBCHAT_BOT_TOKEN) return json({ ok: false, error: 'ยังไม่ได้ตั้ง KOBCHAT_BOT_TOKEN' }, 500, origin);
    if (url.pathname === '/health' && req.method === 'GET') {   // เช็คว่า token ใช้ได้ (ไม่คืนค่า token)
      const r = await kob(env, '/me'); const j = await r.json().catch(() => ({}));
      return json({ ok: r.ok, bot: r.ok ? (j.name || '') : undefined, status: r.status }, r.ok ? 200 : 502, origin);
    }
    if (url.pathname !== '/notify' || req.method !== 'POST') return json({ ok: false, error: 'not found' }, 404, origin);
    if (ALLOW.indexOf(origin) < 0) return json({ ok: false, error: 'origin not allowed' }, 403, origin);
    let b; try { b = await req.json(); } catch (e) { return json({ ok: false, error: 'bad json' }, 400, origin); }
    if (!b || (b.type !== 'matched' && b.type !== 'confirm')) return json({ ok: false, error: 'bad type' }, 400, origin);
    const p = { type: b.type, title: clip(b.title, 80), amount: Number(b.amount) || 0, link: /^https:\/\/(app\.)?ballsticker\.co\.th(\/|$)/.test(String(b.link || '')) ? String(b.link) : '',
      lines: Array.isArray(b.lines) ? b.lines.slice(0, 8).map((x) => clip(x, 160)) : [] };
    const eventId = clip(b.eventId, 80);
    try {
      if (await already(env, eventId)) return json({ ok: true, duplicate: true }, 200, origin);
      const to = await ownerId(env);
      const r = await kob(env, '/messages', { method: 'POST', body: JSON.stringify({ userId: to, messages: [card(p)] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        seen.delete(eventId);   // ส่งไม่สำเร็จ ให้ลองใหม่ได้
        const retry = r.status === 429 ? Number(r.headers.get('Retry-After')) || 60 : undefined;
        return json({ ok: false, status: r.status, error: j.error || 'ส่งไม่สำเร็จ', details: j.details, retryAfter: retry }, r.status === 429 ? 429 : 502, origin);
      }
      return json({ ok: true }, 200, origin);
    } catch (e) { seen.delete(eventId); return json({ ok: false, error: String(e.message || e) }, e.status === 404 ? 404 : 502, origin); }
  }
};
