/* Ball Sticker — LINE OA "บอลสติ๊กเกอร์ บิล" (@162oesrh) รับรูป/PDF บิลซื้อ + ปุ่ม "ตรวจบิล" (Cloudflare Worker: line-bills)
 * แยกจาก Worker line-oa (@bk25 แชตลูกค้า)
 *
 *  POST /webhook              ← LINE (ตรวจลายเซ็น LINE_BILLS_SECRET) · รูป/ไฟล์ → billInbox/{messageId} (status 'new')
 *                               ตอบการ์ด "รับบิลแล้ว ✅" + ปุ่ม "ตรวจบิล" (หลายรูปพร้อมกัน = carousel 1 การ์ดต่อรูป)
 *  GET  /bill?id&t            → ข้อมูลบิล + รายชื่อร้าน (vendors) ให้หน้า bill-check.html
 *  GET  /content?ch=bills&id&(t|key) → ไฟล์จาก LINE (LINE เก็บไฟล์ ~7 วัน)
 *  POST /bill/save {id,t,rec} → purchases/{rec.id} + billInbox done
 *  POST /bill/skip {id,t}     → billInbox done (skipped)
 *  ลิงก์ปุ่ม: https://app.ballsticker.co.th/bill-check?id=<messageId>&t=<32 ตัวแรกของ hex HMAC-SHA256(LINE_BILLS_LINK_KEY, messageId)>
 *
 * ค่าลับ (เจ้าของใส่เองใน Cloudflare · ห้ามส่งในแชต/ห้ามใส่ในโค้ด):
 *   LINE_BILLS_SECRET, LINE_BILLS_TOKEN, FIRESTORE_SA_JSON (Cloud Datastore User), LINE_BILLS_LINK_KEY (สุ่มเอง ≥ 32 ตัว)
 * ไม่บังคับ: APP_KEY (ค่าเริ่มต้น = LINE_OA_KEY ในแอป) · BILL_PAGE (ค่าเริ่มต้น https://app.ballsticker.co.th/bill-check)
 */
const ALLOW = ['https://app.ballsticker.co.th', 'https://ball-sticker-app.pages.dev'];
const DEFAULT_APP_KEY = 'loa5408501ccebb8cc0e6155';
const DEFAULT_PAGE = 'https://app.ballsticker.co.th/bill-check';
const COL = 'billInbox';
const MAX_BODY = 32 * 1024;
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
  return fromFields((await r.json()).fields);
}
// เขียน: mode 'create' = ต้องยังไม่มี · 'update' = ต้องมีแล้ว (แก้เฉพาะช่องที่ส่ง)
async function fsWrite(env, col, id, data, mode) {
  const fields = {}; Object.keys(data).forEach((k) => { fields[k] = toFs(data[k]); });
  let q = mode === 'create' ? '?currentDocument.exists=false' : '?currentDocument.exists=true';
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
async function cardsFor(env, docs) {
  const bubbles = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const title = d.type === 'file' ? (d.fileName || 'ไฟล์บิล') : (docs.length > 1 ? 'รูปที่ ' + (i + 1) + '/' + docs.length : 'รูปบิล');
    bubbles.push(bubble(title, env.LINE_BILLS_LINK_KEY ? 'กด "ตรวจบิล" เพื่ออ่านและบันทึกเข้าภาษีซื้อ' : 'บันทึกเข้ากล่องบิลในแอปแล้ว', env.LINE_BILLS_LINK_KEY ? await billUrl(env, d.contentId) : ''));
  }
  const msgs = [];
  for (let i = 0; i < bubbles.length && msgs.length < 5; i += 12) {
    const part = bubbles.slice(i, i + 12);
    msgs.push({ type: 'flex', altText: 'รับบิลแล้ว ✅' + (bubbles.length > 1 ? ' (' + bubbles.length + ' รูป)' : '') + ' กดตรวจบิล',
      contents: part.length === 1 ? part[0] : { type: 'carousel', contents: part } });
  }
  return msgs;
}

async function handleEvents(env, events) {
  const names = {};
  for (const ev of events) {
    if (ev.type !== 'message' || !ev.message) continue;
    const m = ev.message, uid = (ev.source || {}).userId || '';
    if (m.type !== 'image' && m.type !== 'file') {
      if (m.type === 'text') await reply(env, ev.replyToken, [textMsg('ช่องนี้รับเฉพาะรูปหรือไฟล์ PDF ของบิลซื้อ ส่งเข้ามาได้เลย 🙏')]);
      continue;
    }
    if (uid && names[uid] === undefined) names[uid] = await displayName(env, uid);
    const doc = { from: uid, fromName: names[uid] || '', type: m.type, contentId: m.id, fileName: m.fileName || (m.type === 'image' ? 'bill-' + m.id + '.jpg' : 'bill-' + m.id),
      size: m.fileSize || 0, createdAt: ev.timestamp || Date.now(), status: 'new' };
    const set = m.imageSet && m.imageSet.total > 1 ? m.imageSet : null;
    if (set) { doc.setId = set.id; doc.setIndex = set.index || 0; doc.setTotal = set.total; }
    let st = 'error';
    try { st = await fsWrite(env, COL, m.id, doc, 'create'); } catch (e) { console.log('billInbox write failed', m.id, e.message); }
    if (st === 'error') { await reply(env, ev.replyToken, [textMsg('บันทึกบิลไม่สำเร็จ ลองส่งใหม่อีกครั้งนะครับ')]); continue; }
    if (st !== 'ok') continue;                                    // LINE ส่งซ้ำ → ตอบไปแล้ว
    if (set && set.index !== set.total) continue;                 // หลายรูปพร้อมกัน → ตอบเมื่อรูปสุดท้ายมาถึง
    let docs = [doc];
    if (set) {                                                    // รวมทุกรูปในชุด (อาจมาคนละ webhook)
      for (let k = 0; k < 3; k++) {
        try { docs = (await fsQueryEq(env, COL, 'setId', set.id)).map((d) => Object.assign(d, { contentId: d.contentId || d._id })); } catch (e) { docs = [doc]; break; }
        if (docs.length >= set.total) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      docs.sort((a, b) => (a.setIndex || 0) - (b.setIndex || 0));
    }
    await reply(env, ev.replyToken, await cardsFor(env, docs));
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
      ctx.waitUntil(handleEvents(env, j.events || []));
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
        const out = { ok: true, id, status: b.status || 'new', fromName: b.fromName || '', type: b.type || '', fileName: b.fileName || '', createdAt: b.createdAt || 0, vendors: await vendors(env, ctx) };
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
          await fsWrite(env, COL, id, { status: 'done', doneAt: Date.now(), skipped: true }, 'update');
          return json({ ok: true }, 200, origin);
        }

        if (b.status !== 'new') return json({ error: 'บิลนี้บันทึกไปแล้ว', purchaseId: b.purchaseId || '' }, 409, origin);
        const [rec, err] = cleanRec(body.rec);
        if (!rec) return json({ error: err }, 400, origin);
        Object.assign(rec, { savedAt: Date.now(), createdBy: 'LINE · ' + (b.fromName || ''), src: 'line', billId: id });
        const w = await fsWrite(env, 'purchases', rec.id, rec, 'create');
        if (w === 'exists') return json({ error: 'เลขรายการซ้ำ ลองกดบันทึกใหม่' }, 400, origin);
        await fsWrite(env, COL, id, { status: 'done', doneAt: Date.now(), purchaseId: rec.id }, 'update');
        return json({ ok: true, purchaseId: rec.id }, 200, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      console.log('error', p, e.message);
      return json({ error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }, 502, origin);
    }
  }
};
