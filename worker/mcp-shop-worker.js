/* Ball Sticker — MCP ของแอปหลังร้าน (Cloudflare Worker) · v1 อ่าน + สร้างร่าง
 * ให้ AI (Claude, Hermes ฯลฯ) ดูข้อมูลร้านแบบอ่านอย่างเดียว และ "สร้างร่าง" ไว้ให้เจ้าของกดยืนยันในแอป
 * ไม่มีเครื่องมือแก้/ลบ/โอนเงิน/ขึ้นเว็บจริง · ร่างทุกอันเขียนลงคอลเลกชัน mcpDrafts เท่านั้น
 *
 * เรียกที่:  https://<ชื่อ worker>.workers.dev/mcp/<MCP_KEY>      (วิธี JSON-RPC แบบ MCP Streamable HTTP, ไม่เก็บสถานะ)
 *            หรือ POST /mcp พร้อมหัว Authorization: Bearer <MCP_KEY>
 *
 * ค่าลับ/ตัวแปร (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ดหรือ repo):
 *   MCP_KEY          = รหัสสุ่มยาว ≥ 32 ตัว (เจ้าของตั้งเอง ผมไม่เห็น)
 *   FIRESTORE_SA_JSON= service account (สิทธิ์ Cloud Datastore User) — ตัวเดียวกับ Worker บิล LINE ใช้ได้
 *   ADS_URL          = (ไม่บังคับ) ค่าเริ่มต้น https://fb-ads.organic-parmesan.workers.dev/ads
 *   HIDDEN_ACCOUNTS  = (ไม่บังคับ) บัญชีที่ซ่อนจากผลเงินเข้า คั่นด้วยจุลภาค ค่าเริ่มต้น "วันทิม"
 *   SHOW_PHONE       = (ไม่บังคับ) ตั้งเป็น 1 ถึงจะเห็นเบอร์โทรเต็ม ค่าเริ่มต้นปิดเบอร์ (เหลือ 4 ตัวท้าย)
 */
const TZ_MS = 7 * 3600000, DAY_MS = 86400000;
const PROTO = '2025-03-26';
const MAX_OUT = 60000;

// ---------- ช่วยทั่วไป ----------
export const bkkDay = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
export const dayRange = (ymd) => { const s = Date.parse(ymd + 'T00:00:00+07:00'); return Number.isFinite(s) ? [s, s + DAY_MS] : null; };
const sameStr = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

// ตัดรูป/ข้อความยาว/ปิดเบอร์โทร ก่อนส่งให้ AI
const HEAVY = /photo|image|img|logo|sign|base64|thumb|pic|qr|slip/i, PHONE = /phone|tel|mobile|เบอร์/i;
export function slim(v, env, key) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    if (/^data:/i.test(v)) return undefined;
    if (PHONE.test(key || '') && !(env && env.SHOW_PHONE === '1')) { const d = v.replace(/\D/g, ''); return d.length > 4 ? 'xxx-xxx-' + d.slice(-4) : v; }
    return v.length > 400 ? v.slice(0, 400) + '…(ตัดแล้ว)' : v;
  }
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => slim(x, env, key)).filter((x) => x !== undefined);
  if (typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { if (HEAVY.test(k)) return; const x = slim(v[k], env, k); if (x !== undefined) o[k] = x; });
    return o;
  }
  return v;
}

// ---------- Firestore (REST + Service Account) แบบเดียวกับ Worker บิล LINE ----------
const enc = (s) => new TextEncoder().encode(s);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc(s));
let tok = { t: '', exp: 0 };
async function gToken(sa) {
  if (tok.t && Date.now() < tok.exp - 60000) return tok.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
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
  let sa = {}; try { sa = JSON.parse(env.FIRESTORE_SA_JSON || '{}'); } catch (e) {}
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIRESTORE_SA_JSON ไม่ครบ');
  return sa;
}
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach((k) => { f[k] = toFs(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
export function fromFs(v) {
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
export function fromFields(f) { const o = {}; Object.keys(f || {}).forEach((k) => { o[k] = fromFs(f[k]); }); return o; }
const fsBase = (sa) => 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents';
async function fsFetch(env, path, opt) {
  const sa = saOf(env);
  return fetch(fsBase(sa) + path, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + await gToken(sa), 'Content-Type': 'application/json' } }));
}
async function fsGet(env, col, id) {
  const r = await fsFetch(env, '/' + col + '/' + encodeURIComponent(id), { method: 'GET' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore get ' + r.status);
  return Object.assign({ id }, fromFields((await r.json()).fields));
}
async function fsQuery(env, sq) {
  const r = await fsFetch(env, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: sq }) });
  if (!r.ok) throw new Error('firestore query ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return (await r.json()).filter((x) => x.document).map((x) => Object.assign({ id: x.document.name.split('/').pop() }, fromFields(x.document.fields)));
}
async function fsCreate(env, col, id, data) {
  const fields = {}; Object.keys(data).forEach((k) => { fields[k] = toFs(data[k]); });
  const r = await fsFetch(env, '/' + col + '/' + encodeURIComponent(id) + '?currentDocument.exists=false', { method: 'PATCH', body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('firestore write ' + r.status + ': ' + (await r.text()).slice(0, 160));
}
const recent = (env, col, field, limit) => fsQuery(env, { from: [{ collectionId: col }], orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }], limit });

// ---------- เครื่องมือ ----------
const lim = (v, d, m) => Math.max(1, Math.min(m, Math.floor(num(v)) || d));
const hiddenOf = (env) => String(env.HIDDEN_ACCOUNTS === undefined ? 'วันทิม' : env.HIDDEN_ACCOUNTS).split(',').map((s) => s.trim()).filter(Boolean);

// รวมเงินเข้า (เฉพาะยอดบวก) ของวันหนึ่ง — คำนวณในโค้ด ไม่ให้ AI เดา
export function sumBankIn(rows, hidden) {
  const ok = rows.filter((x) => num(x.amount) > 0 && hidden.indexOf(x.account) < 0);
  const total = round2(ok.reduce((a, x) => a + num(x.amount), 0));
  const byAcc = {}; ok.forEach((x) => { const k = x.account || '-'; byAcc[k] = round2((byAcc[k] || 0) + num(x.amount)); });
  return { count: ok.length, total, byAccount: byAcc, rows: ok };
}
export function sumAds(rows) {
  const s = rows.reduce((a, r) => ({ spend: a.spend + num(r.spend), chats: a.chats + num(r.chats), impressions: a.impressions + num(r.impressions), clicks: a.clicks + num(r.clicks) }), { spend: 0, chats: 0, impressions: 0, clicks: 0 });
  return { days: rows.length, spend: round2(s.spend), chats: s.chats, impressions: s.impressions, clicks: s.clicks, costPerChat: s.chats ? round2(s.spend / s.chats) : null };
}

const TOOLS = [
  { name: 'list_jobs', description: 'ดูใบงานล่าสุด (เรียงจากใหม่ไปเก่า) ตัดรูปและปิดเบอร์โทรแล้ว', inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'จำนวน 1-30 (ค่าเริ่มต้น 10)' } } } },
  { name: 'get_job', description: 'ดูใบงานใบเดียว ด้วยเลขใบงาน (no) หรือรหัสเอกสาร (id)', inputSchema: { type: 'object', properties: { no: { type: 'string' }, id: { type: 'string' } } } },
  { name: 'list_bills', description: 'ดูบิลล่าสุด (เรียงจากใหม่ไปเก่า)', inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '1-30 (ค่าเริ่มต้น 10)' } } } },
  { name: 'bank_in_summary', description: 'สรุปเงินเข้าบัญชีของวันหนึ่ง (เวลาไทย) ยอดรวมคำนวณด้วยโค้ด · ไม่รวมบัญชีที่ซ่อน', inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (ไม่ใส่ = วันนี้)' } } } },
  { name: 'ads_summary', description: 'ค่าโฆษณา Meta และจำนวนแชตจากแอด ย้อนหลัง N วัน (สูงสุด 60) พร้อมต้นทุนต่อแชต', inputSchema: { type: 'object', properties: { days: { type: 'integer', description: '1-60 (ค่าเริ่มต้น 7)' } } } },
  { name: 'create_draft', description: 'สร้าง "ร่าง" ไว้ให้เจ้าของร้านกดยืนยันในแอป ไม่มีผลจริงจนกว่าเจ้าของจะยืนยัน (ชนิด: quote ใบเสนอราคา, job ใบงาน, reply ข้อความตอบลูกค้า, note บันทึก)', inputSchema: { type: 'object', required: ['kind', 'title', 'body'], properties: { kind: { type: 'string', enum: ['quote', 'job', 'reply', 'note'] }, title: { type: 'string', description: 'ไม่เกิน 120 ตัวอักษร' }, body: { type: 'string', description: 'เนื้อหาร่าง ไม่เกิน 4000 ตัวอักษร' }, data: { type: 'object', description: 'ข้อมูลประกอบ (ไม่บังคับ) ไม่เกิน 8 KB' } } } },
  { name: 'list_drafts', description: 'ดูร่างที่สร้างไว้ล่าสุด และสถานะ (draft/accepted/rejected)', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } },
];
const KINDS = ['quote', 'job', 'reply', 'note'];

async function callTool(env, name, a) {
  a = a || {};
  if (name === 'list_jobs') return (await recent(env, 'jobs', 'savedAt', lim(a.limit, 10, 30))).map((x) => slim(x, env));
  if (name === 'list_bills') return (await recent(env, 'bills', 'savedAt', lim(a.limit, 10, 30))).map((x) => slim(x, env));
  if (name === 'get_job') {
    let j = null;
    if (a.id) j = await fsGet(env, 'jobs', String(a.id));
    else if (a.no) { const r = await fsQuery(env, { from: [{ collectionId: 'jobs' }], where: { fieldFilter: { field: { fieldPath: 'no' }, op: 'EQUAL', value: { stringValue: String(a.no) } } }, limit: 1 }); j = r[0] || null; }
    else throw new Error('ต้องระบุ no หรือ id');
    return j ? slim(j, env) : { found: false };
  }
  if (name === 'bank_in_summary') {
    const d = a.date || bkkDay(Date.now()), rg = dayRange(d);
    if (!rg || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('วันที่ต้องเป็น YYYY-MM-DD');
    const rows = await fsQuery(env, { from: [{ collectionId: 'bankIn' }], where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(rg[0]) } } },
      { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { integerValue: String(rg[1]) } } }] } }, orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }], limit: 300 });
    const s = sumBankIn(rows, hiddenOf(env));
    return { date: d, count: s.count, total: s.total, byAccount: s.byAccount, note: rows.length >= 300 ? 'ถึงเพดาน 300 รายการ ยอดอาจไม่ครบ' : undefined, items: s.rows.slice(0, 40).map((x) => slim(x, env)) };
  }
  if (name === 'ads_summary') {
    const days = lim(a.days, 7, 60);
    const r = await fetch((env.ADS_URL || 'https://fb-ads.organic-parmesan.workers.dev/ads') + '?days=' + days, { headers: { Origin: 'https://app.ballsticker.co.th' } });
    if (!r.ok) throw new Error('ads ' + r.status);
    const j = await r.json(), rows = Array.isArray(j) ? j : (j.rows || j.days || []);
    return Object.assign(sumAds(rows), { rows });
  }
  if (name === 'create_draft') {
    const kind = String(a.kind || ''), title = String(a.title || '').trim(), body = String(a.body || '').trim();
    if (KINDS.indexOf(kind) < 0) throw new Error('kind ต้องเป็น ' + KINDS.join(' / '));
    if (!title || title.length > 120) throw new Error('title ต้องมี 1-120 ตัวอักษร');
    if (!body || body.length > 4000) throw new Error('body ต้องมี 1-4000 ตัวอักษร');
    const data = a.data && typeof a.data === 'object' ? a.data : {};
    if (JSON.stringify(data).length > 8192) throw new Error('data ใหญ่เกิน 8 KB');
    const now = Date.now(), id = 'd' + now + Math.floor(Math.random() * 1000);
    await fsCreate(env, 'mcpDrafts', id, { kind, title, body, data, status: 'draft', source: 'mcp', createdAt: now });
    return { ok: true, id, status: 'draft', note: 'สร้างร่างแล้ว ยังไม่มีผลจริง รอเจ้าของกดยืนยันในแอป' };
  }
  if (name === 'list_drafts') return (await recent(env, 'mcpDrafts', 'createdAt', lim(a.limit, 10, 30))).map((x) => slim(x, env));
  throw new Error('ไม่รู้จักเครื่องมือ ' + name);
}

// ---------- MCP (JSON-RPC) ----------
const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
export async function handleRpc(env, m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcErr(m && m.id !== undefined ? m.id : null, -32600, 'คำขอไม่ถูกต้อง');
  if (m.id === undefined) return null;                      // notification ไม่ต้องตอบ
  if (m.method === 'initialize') return rpcOk(m.id, { protocolVersion: PROTO, capabilities: { tools: {} }, serverInfo: { name: 'ball-sticker-shop', version: '1.0.0' }, instructions: 'ข้อมูลร้านบอลสติ๊กเกอร์ อ่านอย่างเดียว + สร้างร่างให้เจ้าของยืนยัน ห้ามเดาตัวเลข ใช้ตัวเลขจากเครื่องมือเท่านั้น' });
  if (m.method === 'ping') return rpcOk(m.id, {});
  if (m.method === 'tools/list') return rpcOk(m.id, { tools: TOOLS });
  if (m.method === 'tools/call') {
    const p = m.params || {};
    if (!TOOLS.some((t) => t.name === p.name)) return rpcErr(m.id, -32602, 'ไม่รู้จักเครื่องมือ');
    try {
      let text = JSON.stringify(await callTool(env, p.name, p.arguments), null, 1);
      if (text.length > MAX_OUT) text = text.slice(0, MAX_OUT) + '\n…(ตัดเพราะยาวเกิน)';
      return rpcOk(m.id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return rpcOk(m.id, { isError: true, content: [{ type: 'text', text: 'ผิดพลาด: ' + String((e && e.message) || e).slice(0, 300) }] });
    }
  }
  return rpcErr(m.id, -32601, 'ไม่รองรับ ' + m.method);
}

const J = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'mcp') return J({ error: 'not found' }, 404);
    const key = String(env.MCP_KEY || '');
    if (key.length < 32) return J({ error: 'ยังไม่ได้ตั้ง MCP_KEY (ต้องยาวอย่างน้อย 32 ตัว)' }, 503);
    const given = parts[1] || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!sameStr(given, key)) return J({ error: 'unauthorized' }, 401);
    if (req.method === 'GET' || req.method === 'DELETE') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    let body; try { body = await req.json(); } catch (e) { return J(rpcErr(null, -32700, 'อ่าน JSON ไม่ได้'), 400); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(env, m)))).filter(Boolean);
      return out.length ? J(out) : new Response(null, { status: 202 });
    }
    const out = await handleRpc(env, body);
    return out ? J(out) : new Response(null, { status: 202 });
  },
};
