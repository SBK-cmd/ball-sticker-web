/* Ball Sticker — ตัวดึง "การใช้ Firebase จริง" (Cloudflare Worker)
 * แอปร้านเรียก GET /usage?days=14 → Worker ถาม Google Cloud Monitoring ว่า Firestore อ่าน/เขียน/ลบไปเท่าไหร่ รายวัน (เวลาไทย)
 * ตัวเลขรวมทั้งโปรเจกต์: แอปร้านทุกเครื่อง + แผง Sign Tools + หน้าติดตามของลูกค้า
 *
 * ค่าลับ (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ด):
 *   GCP_SA_KEY = เนื้อไฟล์ .json ของ Service Account ที่มีสิทธิ์ "Monitoring Viewer" อย่างเดียว (อ่านตัวเลขได้ แก้ข้อมูลร้านไม่ได้)
 * ไม่มีข้อมูลลูกค้า มีแต่ตัวเลขการใช้งาน · จำผลไว้ 10 นาที กันเรียกถี่
 */
const ALLOW = ['https://app.ballsticker.co.th', 'https://ballsticker.co.th', 'https://www.ballsticker.co.th', 'https://sbk-cmd.github.io'];
const METRICS = { reads: 'firestore.googleapis.com/document/read_count', writes: 'firestore.googleapis.com/document/write_count', deletes: 'firestore.googleapis.com/document/delete_count' };
const TZ_MS = 7 * 3600000;   // เวลาไทย
const CACHE_S = 600;
let tokenCache = { t: '', exp: 0 };

function cors(origin) {
  const o = ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0];
  return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(obj, status, origin, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin), extra || {}) });
}
const b64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function accessToken(sa) {
  if (tokenCache.t && Date.now() < tokenCache.exp - 60000) return tokenCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/monitoring.read', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('ขอสิทธิ์ Google ไม่ได้: ' + ((j && (j.error_description || j.error)) || res.status));
  tokenCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// ยอดรายชั่วโมง → รวมเป็นรายวันตามเวลาไทย
async function series(project, token, metric, startMs, endMs) {
  const days = {};
  let pageToken = '';
  do {
    const q = new URLSearchParams({
      filter: 'metric.type="' + metric + '"',
      'interval.startTime': new Date(startMs).toISOString(), 'interval.endTime': new Date(endMs).toISOString(),
      'aggregation.alignmentPeriod': '3600s', 'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM'
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetch('https://monitoring.googleapis.com/v3/projects/' + encodeURIComponent(project) + '/timeSeries?' + q, { headers: { Authorization: 'Bearer ' + token } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('ดึงตัวเลขไม่ได้ (' + res.status + '): ' + ((j.error && j.error.message) || ''));
    (j.timeSeries || []).forEach((ts) => (ts.points || []).forEach((p) => {
      const end = Date.parse(p.interval && p.interval.endTime), v = +(p.value && (p.value.int64Value || p.value.doubleValue)) || 0;
      if (!end) return;
      const d = new Date(end - 3600000 + TZ_MS).toISOString().slice(0, 10);
      days[d] = (days[d] || 0) + v;
    }));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return days;
}

async function usage(env, nDays) {
  let sa;
  try { sa = JSON.parse(env.GCP_SA_KEY || ''); } catch (e) { throw new Error('ยังไม่ได้ตั้ง Secret GCP_SA_KEY (เนื้อไฟล์ .json ของ Service Account)'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('GCP_SA_KEY ไม่ครบ (ต้องมี client_email, private_key, project_id)');
  const token = await accessToken(sa);
  const now = Date.now(), todayTH = new Date(now + TZ_MS).toISOString().slice(0, 10);
  const startMs = Date.parse(todayTH + 'T00:00:00Z') - TZ_MS - (nDays - 1) * 86400000;
  const out = {};
  for (const k of Object.keys(METRICS)) out[k] = await series(sa.project_id, token, METRICS[k], startMs, now);
  const days = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(now + TZ_MS - i * 86400000).toISOString().slice(0, 10);
    days.push({ d, reads: Math.round(out.reads[d] || 0), writes: Math.round(out.writes[d] || 0), deletes: Math.round(out.deletes[d] || 0) });
  }
  return { project: sa.project_id, days, updatedAt: now, note: 'วันนี้นับถึงชั่วโมงล่าสุด · Google ส่งตัวเลขช้า ~3-5 นาที' };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (url.pathname !== '/usage') return json({ ok: true, service: 'ball fb-usage' }, 200, origin);
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405, origin);
    if (origin && ALLOW.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);
    const nDays = Math.min(31, Math.max(1, parseInt(url.searchParams.get('days') || '14', 10) || 14));
    const cacheKey = new Request('https://fb-usage.cache/usage?d=' + nDays);
    const cache = caches.default;
    if (!url.searchParams.has('fresh')) {
      const hit = await cache.match(cacheKey);
      if (hit) { const body = await hit.text(); return new Response(body, { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT' }, cors(origin)) }); }
    }
    try {
      const data = await usage(env, nDays);
      const body = JSON.stringify(data);
      ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Cache-Control': 'max-age=' + CACHE_S } })));
      return new Response(body, { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' }, cors(origin)) });
    } catch (e) {
      return json({ error: e.message || String(e) }, 502, origin);
    }
  }
};
