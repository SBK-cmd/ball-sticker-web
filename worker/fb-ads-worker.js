/* Ball Sticker — ตัวดึงค่าโฆษณา Meta รายวัน (Cloudflare Worker)
 * แอปเรียก GET /ads?days=14 → Worker ถาม Meta Marketing API → คืน [{date, spend, chats, impressions, clicks}]
 * ROAS คำนวณฝั่งแอปจากยอดขายจริงของร้าน (ไม่เอาตัวเลขซื้อของ Meta เพราะลูกค้าปิดการขายทางแชต)
 *
 * ค่าลับ/ตัวแปร (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ด):
 *   ADS_TOKEN   = โทเคนที่มีสิทธิ์ ads_read อย่างเดียว (ควรเป็นของ System User ที่ไม่หมดอายุ)
 *   AD_ACCOUNT  = เลขบัญชีโฆษณา (ตัวเลขล้วน ไม่ต้องใส่ act_)
 *   GRAPH_VER   = (ไม่บังคับ) เช่น v21.0
 * ไม่มีข้อมูลลูกค้า มีแต่ตัวเลขรวมรายวัน · จำผล 10 นาที
 */
const ALLOW = ['https://app.ballsticker.co.th', 'https://ballsticker.co.th', 'https://www.ballsticker.co.th', 'https://sbk-cmd.github.io'];
const TZ_MS = 7 * 3600000, CACHE_S = 600;
const CHAT_TYPES = ['onsite_conversion.total_messaging_connection']; // = คอลัมน์ "ผู้ติดต่อผ่านการส่งข้อความ" ใน Ads Manager (ตรวจเทียบ 17-18 พ.ย. 69 ตรงทั้ง 2 วัน)

function cors(origin) {
  const o = ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0];
  return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(obj, status, origin, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin), extra || {}) });
}
const ymd = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);

// แปลงแถวของ Meta เป็นรายวัน (ใช้ชนิดแรกที่พบจาก CHAT_TYPES เพื่อไม่นับซ้ำ)
export function parseRows(data) {
  return (data || []).map((r) => {
    const acts = r.actions || [];
    let chats = 0;
    for (const t of CHAT_TYPES) { const a = acts.find((x) => x.action_type === t); if (a) { chats = +a.value || 0; break; } }
    return { date: r.date_start, spend: Math.round((+r.spend || 0) * 100) / 100, chats, impressions: +r.impressions || 0, clicks: +r.clicks || 0 };
  });
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    if (url.pathname !== '/ads') return json({ error: 'ไม่พบเส้นทาง' }, 404, origin);
    if (origin && ALLOW.indexOf(origin) < 0) return json({ error: 'ไม่อนุญาต' }, 403, origin);
    if (!env.ADS_TOKEN || !env.AD_ACCOUNT) return json({ error: 'ยังไม่ได้ตั้งค่า ADS_TOKEN / AD_ACCOUNT' }, 503, origin);
    const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 14));
    const cache = caches.default, key = new Request(url.origin + '/ads?days=' + days);
    const hit = await cache.match(key);
    if (hit) { const b = await hit.text(); return new Response(b, { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)) }); }
    const until = ymd(Date.now()), since = ymd(Date.now() - (days - 1) * 86400000);
    const q = new URLSearchParams({
      fields: 'spend,impressions,clicks,actions', time_increment: '1', limit: '100',
      time_range: JSON.stringify({ since, until }), access_token: env.ADS_TOKEN
    });
    let res, j;
    try {
      res = await fetch('https://graph.facebook.com/' + (env.GRAPH_VER || 'v21.0') + '/act_' + String(env.AD_ACCOUNT).replace(/\D/g, '') + '/insights?' + q);
      j = await res.json();
    } catch (e) { return json({ error: 'ติดต่อ Meta ไม่ได้' }, 502, origin); }
    if (!res.ok) return json({ error: 'Meta ตอบผิดพลาด: ' + ((j.error && j.error.message) || res.status) }, 502, origin);
    const out = JSON.stringify({ since, until, days: parseRows(j.data), note: 'chats = แชตที่เริ่มจากโฆษณา (นับตามที่ Meta รายงาน)' });
    ctx.waitUntil(cache.put(key, new Response(out, { headers: { 'Cache-Control': 'max-age=' + CACHE_S } })));
    return new Response(out, { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)) });
  }
};
