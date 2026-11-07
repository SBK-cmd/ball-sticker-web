// Cloudflare Worker ของร้าน: (1) โพสต์รูป+แคปชันเข้าเพจ Facebook  (2) รับ-ตอบแชต Messenger ของเพจ แล้วเก็บไว้ให้แอปหลังร้านดู
// ค่าลับ (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ด): PAGE_TOKEN, APP_KEY, VERIFY_TOKEN, APP_SECRET
// ค่าทั่วไป (wrangler.toml หรือ dashboard): PAGE_ID, GRAPH_VERSION
// ที่เก็บแชต: Workers KV ผูกชื่อ CHAT_KV (ต้องสร้าง namespace และผูกใน dashboard)
// ส่วนโพสต์ ทดสอบกับ Facebook จริงแล้ว · ส่วนแชต ทดสอบด้วยข้อมูลจำลองเท่านั้น ยังไม่ได้ทดสอบกับ Facebook จริง

const ALLOWED_ORIGINS = ['https://app.ballsticker.co.th', 'https://www.ballsticker.co.th', 'https://ballsticker.co.th'];
const ALLOWED_PHOTO_HOSTS = ['res.cloudinary.com', 'www.ballsticker.co.th'];
const MAX_PHOTOS = 10;
const WINDOW_MS = 24 * 3600 * 1000;   // Messenger: ตอบได้ภายใน 24 ชม. หลังลูกค้าส่งข้อความล่าสุด
const MAX_MSGS = 100, MAX_CONVS = 200;

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/* ---------------- โพสต์เข้าเพจ (เดิม) ---------------- */
async function handlePost(request, env, origin) {
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

/* ---------------- แชต Messenger: webhook รับข้อความ ---------------- */
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function verifyFbSignature(buf, header, secret) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header || ''); if (!m) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return safeEq(toHex(await crypto.subtle.sign('HMAC', key, buf)), m[1].toLowerCase());
}

async function fetchName(env, psid) {
  try {
    const v = env.GRAPH_VERSION || 'v26.0';
    const res = await fetch(`https://graph.facebook.com/${v}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(env.PAGE_TOKEN)}`);
    const d = await res.json().catch(() => ({}));
    return [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  } catch (e) { return ''; }
}

async function touchIndex(env, id, at) {
  const idx = (await env.CHAT_KV.get('idx', 'json')) || [];
  const next = [{id, at}].concat(idx.filter(x => x.id !== id)).slice(0, MAX_CONVS);
  await env.CHAT_KV.put('idx', JSON.stringify(next));
}

async function loadConv(env, id) {
  return (await env.CHAT_KV.get('c:' + id, 'json')) || {id, name: '', msgs: [], unread: 0, lastUserAt: 0, lastAt: 0, last: ''};
}
async function saveConv(env, conv) {
  await env.CHAT_KV.put('c:' + conv.id, JSON.stringify(conv));
  await touchIndex(env, conv.id, conv.lastAt || Date.now());
}

function addMessage(conv, msg) {
  if (conv.msgs.some(x => x.mid === msg.mid)) return false;   // กันซ้ำ (ข้อความที่ตอบจากแอปจะวนกลับมาเป็น echo)
  conv.msgs.push(msg);
  conv.msgs.sort((a, b) => a.t - b.t);
  conv.msgs = conv.msgs.slice(-MAX_MSGS);
  conv.lastAt = Math.max(conv.lastAt || 0, msg.t);
  const label = msg.text || (msg.att && msg.att.length ? '[' + (msg.att[0].type || 'ไฟล์') + ']' : '');
  const lastMsg = conv.msgs[conv.msgs.length - 1];
  if (lastMsg === msg) conv.last = (msg.from === 'page' ? 'ร้าน: ' : '') + label.slice(0, 80);
  return true;
}

async function storeEvent(env, ev) {
  const m = ev && ev.message; if (!m) return;   // อ่านแล้ว/ส่งถึงแล้ว/postback ยังไม่เก็บ
  const isEcho = !!m.is_echo;
  const psid = String(isEcho ? (ev.recipient && ev.recipient.id) : (ev.sender && ev.sender.id) || '');
  if (!/^\d+$/.test(psid) || psid === String(env.PAGE_ID || '')) return;
  const conv = await loadConv(env, psid);
  const t = Number(ev.timestamp) || Date.now();
  const att = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 6).map(a => ({type: String(a.type || ''), url: String((a.payload && a.payload.url) || '')}));
  const added = addMessage(conv, {mid: String(m.mid || ('t' + t)), from: isEcho ? 'page' : 'user', t, text: String(m.text || '').slice(0, 2000), att});
  if (!added) return;
  if (!isEcho) { conv.lastUserAt = Math.max(conv.lastUserAt || 0, t); conv.unread = (conv.unread || 0) + 1; }
  if (!conv.name && env.PAGE_TOKEN) conv.name = await fetchName(env, psid);
  await saveConv(env, conv);
}

async function handleWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {   // Meta ยืนยันลิงก์ webhook ตอนตั้งค่า
    if (url.searchParams.get('hub.mode') === 'subscribe' && env.VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN) {
      return new Response(url.searchParams.get('hub.challenge') || '', {status: 200});
    }
    return new Response('forbidden', {status: 403});
  }
  if (request.method !== 'POST') return new Response('method', {status: 405});
  if (!env.APP_SECRET || !env.CHAT_KV) return new Response('not configured', {status: 500});
  const buf = await request.arrayBuffer();
  if (!(await verifyFbSignature(buf, request.headers.get('x-hub-signature-256'), env.APP_SECRET))) return new Response('bad signature', {status: 403});
  let body; try { body = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return new Response('bad json', {status: 400}); }
  if (body.object === 'page') {
    for (const entry of (body.entry || [])) {
      for (const ev of (entry.messaging || [])) {
        try { await storeEvent(env, ev); } catch (e) { console.log('store error', String(e && e.message || e)); }
      }
    }
  }
  return new Response('EVENT_RECEIVED', {status: 200});   // ต้องตอบ 200 เร็ว ไม่งั้น Meta ยกเลิกการสมัครรับ
}

/* ---------------- แชต Messenger: API ให้แอปหลังร้าน ---------------- */
async function handleChatApi(request, env, origin, path) {
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ok: false, error: 'origin'}, 403, origin);
  if (!env.APP_KEY || request.headers.get('x-app-key') !== env.APP_KEY) return json({ok: false, error: 'unauthorized'}, 401, origin);
  if (!env.CHAT_KV) return json({ok: false, error: 'chat not configured (CHAT_KV)'}, 500, origin);
  const url = new URL(request.url);

  if (path === '/chat/inbox' && request.method === 'GET') {
    const idx = (await env.CHAT_KV.get('idx', 'json')) || [];
    const convs = await Promise.all(idx.slice(0, 60).map(x => env.CHAT_KV.get('c:' + x.id, 'json')));
    const now = Date.now();
    const items = convs.filter(Boolean).map(c => ({id: c.id, name: c.name || '', last: c.last || '', lastAt: c.lastAt || 0, unread: c.unread || 0, lastUserAt: c.lastUserAt || 0, canReply: !!c.lastUserAt && now - c.lastUserAt <= WINDOW_MS}));
    items.sort((a, b) => b.lastAt - a.lastAt);
    return json({ok: true, items, now}, 200, origin);
  }

  if (path === '/chat/conv' && request.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!/^\d+$/.test(id)) return json({ok: false, error: 'bad id'}, 400, origin);
    const c = await loadConv(env, id), now = Date.now();
    return json({ok: true, conv: {id: c.id, name: c.name || '', msgs: c.msgs, lastUserAt: c.lastUserAt || 0, canReply: !!c.lastUserAt && now - c.lastUserAt <= WINDOW_MS}, now}, 200, origin);
  }

  if (request.method !== 'POST') return json({ok: false, error: 'method'}, 405, origin);
  let body; try { body = await request.json(); } catch (e) { return json({ok: false, error: 'bad json'}, 400, origin); }
  const id = String(body.id || '');
  if (!/^\d+$/.test(id)) return json({ok: false, error: 'bad id'}, 400, origin);

  if (path === '/chat/read') {
    const c = await loadConv(env, id);
    if (c.unread) { c.unread = 0; await env.CHAT_KV.put('c:' + id, JSON.stringify(c)); }
    return json({ok: true}, 200, origin);
  }

  if (path === '/chat/reply') {
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) return json({ok: false, error: 'no text'}, 400, origin);
    if (!env.PAGE_TOKEN) return json({ok: false, error: 'server not configured'}, 500, origin);
    const c = await loadConv(env, id);
    if (!c.lastUserAt || Date.now() - c.lastUserAt > WINDOW_MS) return json({ok: false, error: 'window'}, 409, origin);   // เกิน 24 ชม. Meta ไม่ให้ส่ง
    try {
      const r = await graph(env, 'me/messages', {recipient: JSON.stringify({id}), message: JSON.stringify({text}), messaging_type: 'RESPONSE'});
      addMessage(c, {mid: String(r.message_id || ('a' + Date.now())), from: 'page', t: Date.now(), text, att: [], by: 'app'});
      await saveConv(env, c);
      return json({ok: true, mid: r.message_id || ''}, 200, origin);
    } catch (e) {
      return json({ok: false, error: String(e.message || e).slice(0, 300)}, 502, origin);
    }
  }
  return json({ok: false, error: 'not found'}, 404, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin)});
    const path = (new URL(request.url).pathname.replace(/\/+$/, '')) || '/';
    if (path === '/webhook') return handleWebhook(request, env);
    if (path.startsWith('/chat/')) return handleChatApi(request, env, origin, path);
    return handlePost(request, env, origin);   // เส้นทางเดิม: POST / → โพสต์เข้าเพจ
  }
};
