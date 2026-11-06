// Cloudflare Worker: รับแคปชัน + ลิงก์รูปจากแอปหลังร้าน แล้วโพสต์เข้าเพจ Facebook ผ่าน Graph API
// ค่าลับ (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ด): PAGE_TOKEN, APP_KEY
// ค่าทั่วไป (ตั้งใน wrangler.toml หรือ dashboard): PAGE_ID, GRAPH_VERSION
// ยังไม่ได้ทดสอบกับ Facebook จริง

const ALLOWED_ORIGINS = ['https://app.ballsticker.co.th', 'https://www.ballsticker.co.th', 'https://ballsticker.co.th'];
const ALLOWED_PHOTO_HOSTS = ['res.cloudinary.com', 'www.ballsticker.co.th'];
const MAX_PHOTOS = 10;

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-app-key',
    'Vary': 'Origin'
  };
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), {status, headers: {'content-type': 'application/json; charset=utf-8', ...cors(origin)}});

function cleanPhotos(list) {
  const out = [];
  for (const u of (Array.isArray(list) ? list : [])) {
    if (typeof u !== 'string') continue;
    let url; try { url = new URL(u); } catch (e) { continue; }
    if (url.protocol !== 'https:' || !ALLOWED_PHOTO_HOSTS.includes(url.hostname)) continue;
    if (!out.includes(url.href)) out.push(url.href);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

async function graph(env, path, params) {
  const v = env.GRAPH_VERSION || 'v26.0';
  const body = new URLSearchParams({...params, access_token: env.PAGE_TOKEN});
  const res = await fetch(`https://graph.facebook.com/${v}/${path}`, {method: 'POST', body});
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error((data.error && data.error.message) || ('Graph HTTP ' + res.status));
  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin)});
    if (request.method !== 'POST') return json({ok: false, error: 'method'}, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ok: false, error: 'origin'}, 403, origin);
    if (!env.APP_KEY || request.headers.get('x-app-key') !== env.APP_KEY) return json({ok: false, error: 'unauthorized'}, 401, origin);

    let body; try { body = await request.json(); } catch (e) { return json({ok: false, error: 'bad json'}, 400, origin); }
    const text = String(body.text || '').trim().slice(0, 5000);
    const photos = cleanPhotos(body.photos);
    if (!text) return json({ok: false, error: 'no text'}, 400, origin);
    if (!photos.length) return json({ok: false, error: 'no photos'}, 400, origin);
    if (!env.PAGE_ID || !env.PAGE_TOKEN) return json({ok: false, error: 'server not configured'}, 500, origin);

    try {
      // 1) อัปรูปแบบยังไม่เผยแพร่ทีละรูป → ได้ media_fbid
      const mediaIds = [];
      for (const url of photos) {
        const r = await graph(env, `${env.PAGE_ID}/photos`, {url, published: 'false'});
        mediaIds.push(r.id);
      }
      // 2) สร้างโพสต์เดียวที่แนบรูปทั้งหมด
      const attached = {};
      mediaIds.forEach((id, i) => { attached[`attached_media[${i}]`] = JSON.stringify({media_fbid: id}); });
      const post = await graph(env, `${env.PAGE_ID}/feed`, {message: text, ...attached});
      return json({ok: true, id: post.id, photos: mediaIds.length}, 200, origin);
    } catch (e) {
      return json({ok: false, error: String(e.message || e).slice(0, 300)}, 502, origin);
    }
  }
};
