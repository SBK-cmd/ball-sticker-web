/* Ball Sticker — "เลขา" (Cloudflare Worker)
 * แอปร้าน (เจ้าของ) สั่งงาน → Worker สร้าง issue ป้าย lekha ใน GitHub → workflow .github/workflows/lekha.yml ปลุก Claude ทำงาน
 * แล้ว Claude ตอบกลับเป็นคอมเมนต์ใน issue → แอปอ่านผ่าน Worker นี้
 *
 * ค่าลับ (ตั้งใน Cloudflare เท่านั้น ห้ามใส่ในโค้ด):
 *   GH_TOKEN   = Fine-grained token ของบัญชีเจ้าของ repo · เลือกเฉพาะ repo ball-sticker-web · สิทธิ์ Issues: Read and write อย่างเดียว
 *   LEKHA_PIN  = รหัสสำหรับสั่งงาน (อย่างน้อย 6 ตัว) เจ้าของใส่ในแอปครั้งเดียว
 * ตัวแปรไม่ลับ (ไม่บังคับ): REPO = "SBK-cmd/ball-sticker-web"
 *
 * API (ทุกคำขอต้องมี header X-Lekha-Pin):
 *   GET  /tasks            → งานล่าสุด 15 รายการ [{n,title,state,status,createdAt,updatedAt,reply}]
 *   GET  /tasks/:n         → งานเดียวพร้อมข้อความทั้งหมด {n,title,state,status,messages:[{who:'owner'|'lekha',text,at}]}
 *   POST /tasks            {text}  → สั่งงานใหม่ → {n}
 *   POST /tasks/:n/reply   {text}  → ตอบ/สั่งต่อในงานเดิม (เช่น "อัพ")
 *   POST /tasks/:n/close           → ปิดงาน
 * status: queued (รอเริ่ม) · working (กำลังทำ) · done (ตอบแล้ว รอคุณ) · fail (ไม่สำเร็จ) · closed
 */
const ALLOW = ['https://app.ballsticker.co.th', 'https://ball-sticker-app.pages.dev'];
const LABEL = 'lekha';
const MAX_TEXT = 4000;
const FAIL_LIMIT = 5, FAIL_WINDOW_S = 900;   // ใส่รหัสผิด 5 ครั้ง ล็อก 15 นาที (ต่อ IP)

function cors(origin) {
  return { 'Access-Control-Allow-Origin': ALLOW.indexOf(origin) >= 0 ? origin : ALLOW[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lekha-Pin', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(origin)) });
}
function sameStr(a, b) {               // เทียบแบบเวลาคงที่
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function failCount(ip, add) {
  const key = new Request('https://lekha.lock/' + encodeURIComponent(ip)), cache = caches.default;
  const hit = await cache.match(key);
  let n = hit ? (parseInt(await hit.text(), 10) || 0) : 0;
  if (add) { n++; await cache.put(key, new Response(String(n), { headers: { 'Cache-Control': 'max-age=' + FAIL_WINDOW_S } })); }
  return n;
}

async function gh(env, path, opt) {
  opt = opt || {};
  const res = await fetch('https://api.github.com/repos/' + (env.REPO || 'SBK-cmd/ball-sticker-web') + path, {
    method: opt.method || 'GET',
    headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ball-lekha', 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok && !(opt.ok || []).includes(res.status)) throw new Error('GitHub ' + res.status + ': ' + (j.message || ''));
  return j;
}

const MARK = /<!-- lekha:(working|done|fail) -->\s*/;
function statusOf(issue, comments) {
  if (issue.state === 'closed') return 'closed';
  let st = 'queued';
  for (const c of comments) {
    const m = (c.body || '').match(MARK);
    if (m) st = m[1];
    else if (c.author_association === 'OWNER' || c.user.login === issue.user.login) st = 'queued';   // เจ้าของตอบต่อ = รอรอบใหม่
  }
  return st;
}
function messages(issue, comments) {
  const out = [{ who: 'owner', text: stripFooter(issue.body || ''), at: issue.created_at }];
  for (const c of comments) {
    const m = (c.body || '').match(MARK);
    if (m && m[1] === 'working') continue;
    out.push({ who: m ? 'lekha' : 'owner', text: (c.body || '').replace(MARK, ''), at: c.created_at });
  }
  return out;
}
const FOOTER = '\n\n---\n_สั่งจากแอปร้าน (เลขา)_';
const stripFooter = (s) => s.endsWith(FOOTER) ? s.slice(0, -FOOTER.length) : s;
const cleanText = (t) => String(t || '').replace(/\r/g, '').trim().slice(0, MAX_TEXT);

async function getComments(env, n) { return gh(env, '/issues/' + n + '/comments?per_page=100'); }

async function listTasks(env) {
  const issues = (await gh(env, '/issues?labels=' + LABEL + '&state=all&sort=created&direction=desc&per_page=15')).filter((i) => !i.pull_request);
  return Promise.all(issues.map(async (i) => {
    const cs = i.comments ? await getComments(env, i.number) : [];
    const ms = messages(i, cs), last = ms.filter((m) => m.who === 'lekha').pop();
    return { n: i.number, title: i.title.replace(/^เลขา:\s*/, ''), state: i.state, status: statusOf(i, cs), createdAt: i.created_at, updatedAt: i.updated_at, reply: last ? last.text.slice(0, 300) : '' };
  }));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (url.pathname === '/') return json({ ok: true, service: 'ball lekha' }, 200, origin);
    if (origin && ALLOW.indexOf(origin) < 0) return json({ error: 'origin not allowed' }, 403, origin);
    if (!env.GH_TOKEN || !env.LEKHA_PIN || String(env.LEKHA_PIN).length < 6) return json({ error: 'ยังตั้งค่า Worker ไม่ครบ (GH_TOKEN / LEKHA_PIN)' }, 500, origin);

    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (await failCount(ip, false) >= FAIL_LIMIT) return json({ error: 'ใส่รหัสผิดหลายครั้ง รอ 15 นาที' }, 429, origin);
    if (!sameStr(req.headers.get('X-Lekha-Pin'), env.LEKHA_PIN)) { await failCount(ip, true); return json({ error: 'รหัสเลขาไม่ถูกต้อง' }, 401, origin); }

    try {
      const p = url.pathname.replace(/\/+$/, '');
      let m;
      if (p === '/tasks' && req.method === 'GET') return json({ tasks: await listTasks(env) }, 200, origin);
      if (p === '/tasks' && req.method === 'POST') {
        const text = cleanText((await req.json().catch(() => ({}))).text);
        if (text.length < 2) return json({ error: 'พิมพ์งานที่จะสั่งก่อน' }, 400, origin);
        await gh(env, '/labels', { method: 'POST', body: { name: LABEL, color: 'E9B53E', description: 'งานจากเลขา (สั่งจากแอป)' }, ok: [422] });
        const firstLine = text.split('\n')[0];
        const title = 'เลขา: ' + (firstLine.length > 70 ? firstLine.slice(0, 70) + '…' : firstLine);
        const i = await gh(env, '/issues', { method: 'POST', body: { title, body: text + FOOTER, labels: [LABEL] } });
        return json({ n: i.number }, 200, origin);
      }
      if ((m = p.match(/^\/tasks\/(\d+)$/)) && req.method === 'GET') {
        const i = await gh(env, '/issues/' + m[1]);
        if (!(i.labels || []).some((l) => l.name === LABEL)) return json({ error: 'ไม่พบงาน' }, 404, origin);
        const cs = await getComments(env, m[1]);
        return json({ n: i.number, title: i.title.replace(/^เลขา:\s*/, ''), state: i.state, status: statusOf(i, cs), messages: messages(i, cs) }, 200, origin);
      }
      if ((m = p.match(/^\/tasks\/(\d+)\/(reply|close)$/)) && req.method === 'POST') {
        const i = await gh(env, '/issues/' + m[1]);
        if (!(i.labels || []).some((l) => l.name === LABEL)) return json({ error: 'ไม่พบงาน' }, 404, origin);
        if (m[2] === 'close') { await gh(env, '/issues/' + m[1], { method: 'PATCH', body: { state: 'closed' } }); return json({ ok: true }, 200, origin); }
        const text = cleanText((await req.json().catch(() => ({}))).text);
        if (text.length < 1) return json({ error: 'พิมพ์ข้อความก่อน' }, 400, origin);
        if (i.state === 'closed') await gh(env, '/issues/' + m[1], { method: 'PATCH', body: { state: 'open' } });
        await gh(env, '/issues/' + m[1] + '/comments', { method: 'POST', body: { body: text } });
        return json({ ok: true }, 200, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: e.message || String(e) }, 502, origin);
    }
  }
};
