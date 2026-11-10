/* Ball Sticker — books-sync (Cloudflare Worker)
 * คัดลอกข้อมูลบัญชีจาก Firestore → D1 "ball-books" (ตาราง docs) ให้ Claude อ่านด้วย SQL ตอนทำภาษี
 * อ่านอย่างเดียว: ไม่เขียน/ลบอะไรใน Firestore
 *
 * ตั้งค่าใน Cloudflare (ห้ามใส่ค่าลับในโค้ด):
 *   Secret  FIRESTORE_SA_JSON = เนื้อไฟล์ .json ของ Service Account role "Cloud Datastore Viewer" อย่างเดียว
 *   Secret  SYNC_KEY          = รหัสสุ่มยาวๆ สำหรับสั่งดึงทันที (GET /sync?month=2026-10 พร้อม header X-Sync-Key)
 *   D1 binding  DB            = ฐานข้อมูล ball-books
 *   Cron  "0 19 * * *"        = ทุกวันตี 2 เวลาไทย ดึงเดือนนี้ + เดือนก่อน
 *
 * ดึงเฉพาะช่วงเดือนที่ระบุ (query ตามวันที่) ไม่อ่านทั้งคอลเลกชัน · ตัดรูป/ฟิลด์ยาวเกิน 20 KB ออก
 */
const COLS = [
  { col: 'bills',     field: 'date',      kind: 'date' },
  { col: 'purchases', field: 'date',      kind: 'date' },
  { col: 'jobs',      field: 'date',      kind: 'date' },
  { col: 'bankIn',    field: 'createdAt', kind: 'ms' },
  { col: 'bankOut',   field: 'createdAt', kind: 'ms' },
];
const TZ_MS = 7 * 3600000;
const DROP = new Set(['photo', 'photos', 'slip', 'slipPhoto', 'thumb', 'image', 'images', 'files']);
let tok = { t: '', exp: 0 };

const b64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64s = (s) => b64url(new TextEncoder().encode(s));

async function token(sa) {
  if (tok.t && Date.now() < tok.exp - 60000) return tok.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64s(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64s(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('ขอสิทธิ์ Google ไม่ได้: ' + (j.error_description || j.error || r.status));
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.t;
}

// ค่า Firestore REST → JSON ปกติ
function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return obj((v.mapValue || {}).fields || {});
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(val);
  return null;
}
function obj(fields) {
  const o = {};
  for (const k of Object.keys(fields)) {
    if (DROP.has(k)) continue;
    const x = val(fields[k]);
    if (typeof x === 'string' && x.length > 20000) continue;   // รูป base64 ฯลฯ
    o[k] = x;
  }
  return o;
}

function monthRange(m) {   // 'YYYY-MM' → ช่วงวันที่ (string) และช่วงเวลา ms ตามเวลาไทย
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
  return { d0: m + '-01', d1: next + '-01', t0: Date.parse(m + '-01T00:00:00Z') - TZ_MS, t1: Date.parse(next + '-01T00:00:00Z') - TZ_MS };
}

async function runQuery(sa, t, c, r) {
  const lo = c.kind === 'date' ? { stringValue: r.d0 } : { integerValue: String(r.t0) };
  const hi = c.kind === 'date' ? { stringValue: r.d1 } : { integerValue: String(r.t1) };
  const body = { structuredQuery: { from: [{ collectionId: c.col }], where: { compositeFilter: { op: 'AND', filters: [
    { fieldFilter: { field: { fieldPath: c.field }, op: 'GREATER_THAN_OR_EQUAL', value: lo } },
    { fieldFilter: { field: { fieldPath: c.field }, op: 'LESS_THAN', value: hi } } ] } } } };
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) + '/databases/(default)/documents:runQuery';
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(j)) throw new Error(c.col + ': ' + ((j && j[0] && j[0].error && j[0].error.message) || (j && j.error && j.error.message) || res.status));
  return j.filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), data: obj(x.document.fields || {}) }));
}

async function syncMonth(env, m) {
  let sa;
  try { sa = JSON.parse(env.FIRESTORE_SA_JSON || ''); } catch (e) { throw new Error('ยังไม่ได้ตั้ง Secret FIRESTORE_SA_JSON'); }
  const t = await token(sa), r = monthRange(m), now = Date.now(), out = {};
  for (const c of COLS) {
    try {
      const rows = await runQuery(sa, t, c, r);
      const stmts = [env.DB.prepare('DELETE FROM docs WHERE col = ? AND month = ?').bind(c.col, m)];
      for (const x of rows) stmts.push(env.DB.prepare('INSERT OR REPLACE INTO docs (col, id, month, data, synced) VALUES (?, ?, ?, ?, ?)').bind(c.col, x.id, m, JSON.stringify(x.data), now));
      stmts.push(env.DB.prepare('INSERT INTO sync_log (at, month, col, n, ok, msg) VALUES (?, ?, ?, ?, 1, ?)').bind(now, m, c.col, rows.length, ''));
      await env.DB.batch(stmts);
      out[c.col] = rows.length;
    } catch (e) {
      await env.DB.prepare('INSERT INTO sync_log (at, month, col, n, ok, msg) VALUES (?, ?, ?, 0, 0, ?)').bind(now, m, c.col, String(e.message || e).slice(0, 500)).run();
      out[c.col] = 'error: ' + (e.message || e);
    }
  }
  return out;
}

const thMonth = (offset) => { const d = new Date(Date.now() + TZ_MS); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };

export default {
  async scheduled(ev, env, ctx) {
    ctx.waitUntil((async () => { await syncMonth(env, thMonth(-1)); await syncMonth(env, thMonth(0)); })());
  },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== '/sync') return new Response('ball books-sync', { status: 200 });
    if (!env.SYNC_KEY || req.headers.get('X-Sync-Key') !== env.SYNC_KEY) return new Response('forbidden', { status: 403 });
    const m = u.searchParams.get('month') || thMonth(-1);
    if (!/^\d{4}-\d{2}$/.test(m)) return new Response('month=YYYY-MM', { status: 400 });
    const r = await syncMonth(env, m);
    return new Response(JSON.stringify({ month: m, result: r }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  },
};
