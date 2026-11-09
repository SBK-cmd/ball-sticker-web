/* Worker ตัวกลางเรียก iShip "Trace routes" (POST https://app.iship.cloud/api/traces)
   - Bearer Token (secret ISHIP_TOKEN) ไม่บังคับ: curl ตัวอย่างของ iShip เรียกได้โดยไม่ใส่โทเคน ถ้าตั้งไว้จะส่งไปด้วย
   - รับ GET ?no=เลขพัสดุ&key=กุญแจแอป  → ส่งต่อเป็น POST {"track_no": ...}
   - ส่ง "ผลดิบจาก iShip" กลับไปตรงๆ: data.trace_routes[] = {status, status_text, status_desc, current_location, timestamp}
   ตั้งค่าลับ:  wrangler secret put APP_KEY  (และ ISHIP_TOKEN ถ้าต้องการ) */

const ALLOW_ORIGINS = ['https://www.ballsticker.co.th', 'https://ballsticker.co.th', 'https://app.ballsticker.co.th'];
const TRACK_RE = /^[A-Za-z0-9-]{6,40}$/;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGINS.includes(o) ? o : ALLOW_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (req, obj, status = 200) =>
  new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...cors(req)}});

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(req)});
    if (req.method !== 'GET') return json(req, {error: 'method_not_allowed'}, 405);
    const u = new URL(req.url);
    if (!env.APP_KEY) return json(req, {error: 'not_configured'}, 500);
    if (u.searchParams.get('key') !== env.APP_KEY) return json(req, {error: 'forbidden'}, 403);
    const no = (u.searchParams.get('no') || '').trim();
    if (!TRACK_RE.test(no)) return json(req, {error: 'bad_track_no'}, 400);
    try {
      const r = await fetch('https://app.iship.cloud/api/traces', {
        method: 'POST',
        headers: Object.assign({'Accept': 'application/json', 'Content-Type': 'application/json'}, env.ISHIP_TOKEN ? {'Authorization': 'Bearer ' + env.ISHIP_TOKEN} : {}),
        body: JSON.stringify({track_no: no}),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch (e) { data = {raw: text.slice(0, 2000)}; }
      return json(req, {ok: r.ok, status: r.status, data}, r.ok ? 200 : 502);
    } catch (e) {
      return json(req, {error: 'upstream_failed'}, 502);
    }
  },
};
