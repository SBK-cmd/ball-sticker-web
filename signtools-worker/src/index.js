// Sign Tools — license + update server on Cloudflare Workers (D1)
// Same protocol as the PHP version, so the Illustrator panel is unchanged.
import { unzipSync } from 'fflate';

const TOKEN_DAYS = 14;
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------- helpers ----------
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
function timingSafeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// ---------- schema ----------
let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS keys (key TEXT PRIMARY KEY, note TEXT DEFAULT '', status TEXT DEFAULT 'active',
      machine TEXT, machine_name TEXT, activated_at INTEGER, last_seen INTEGER, moves INTEGER DEFAULT 0, created_at INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS releases (version TEXT PRIMARY KEY, name TEXT, zip BLOB, sha256 TEXT, size INTEGER,
      notes TEXT, manifest TEXT, sig TEXT, created_at INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS log (t INTEGER, ip TEXT, key TEXT, action TEXT, result TEXT)`),
  ]);
  ready = true;
}
const getSetting = async (db, k) => (await db.prepare('SELECT v FROM settings WHERE k=?').bind(k).first())?.v ?? null;
const setSetting = (db, k, v) => db.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, v).run();

// ---------- Ed25519 signing (keypair made on first use, stored in D1) ----------
let signKeys = null;
async function keys(db) {
  if (signKeys) return signKeys;
  let priv = await getSetting(db, 'sign_private'), pub = await getSetting(db, 'sign_public');
  if (!priv) {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    priv = b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)));
    pub = b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    await setSetting(db, 'sign_private', priv); await setSetting(db, 'sign_public', pub);
  }
  signKeys = {
    pub,
    sk: await crypto.subtle.importKey('pkcs8', unb64(priv), { name: 'Ed25519' }, false, ['sign']),
    pk: await crypto.subtle.importKey('raw', unb64(pub), { name: 'Ed25519' }, false, ['verify']),
  };
  return signKeys;
}
const sign = async (db, bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', (await keys(db)).sk, bytes));
const verify = async (db, bytes, sig) => sig.length === 64 && crypto.subtle.verify('Ed25519', (await keys(db)).pk, sig, bytes);

async function makeToken(db, key, machine) {
  const p = enc.encode(JSON.stringify({ k: key, m: machine, iat: now(), exp: now() + TOKEN_DAYS * 86400 }));
  return b64u(p) + '.' + b64u(await sign(db, p));
}
async function readToken(db, tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 2) return null;
  try { const p = unb64u(parts[0]); if (!(await verify(db, p, unb64u(parts[1])))) return null; return JSON.parse(dec.decode(p)); }
  catch { return null; }
}
function newKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(16));
  const g = [0, 1, 2, 3].map((i) => [...r.slice(i * 4, i * 4 + 4)].map((b) => abc[b & 31]).join(''));
  return 'ST-' + g.join('-');
}
const normKey = (k) => String(k || '').replace(/\s+/g, '').toUpperCase();

// ---------- API (used by the panel) ----------
async function api(req, env) {
  const db = env.DB, ip = req.headers.get('CF-Connecting-IP') || '';
  const log = (key, action, result) => db.prepare('INSERT INTO log VALUES (?,?,?,?,?)').bind(now(), ip, key, action, result).run();
  const fail = async (code, error) => { await sleep(400); return json({ ok: false, code, error }); };
  let inp = {};
  if (req.method === 'POST') { try { inp = await req.json(); } catch { inp = {}; } }
  else inp = Object.fromEntries(new URL(req.url).searchParams);
  const action = inp.action || '';

  if (action === 'latest') {
    const r = await db.prepare('SELECT manifest, sig FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
    return json({ ok: true, release: r ? { manifest: r.manifest, sig: r.sig } : null });
  }
  if (action === 'activate') {
    const key = normKey(inp.key), machine = String(inp.machine || ''), mname = String(inp.name || '').slice(0, 80);
    if (!/^[0-9a-f]{64}$/.test(machine)) return fail('bad_request', 'ข้อมูลเครื่องไม่ถูกต้อง');
    const r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
    if (!r) { await log(key, 'activate', 'not_found'); return fail('not_found', 'ไม่พบคีย์นี้ — ตรวจตัวสะกดอีกครั้ง'); }
    if (r.status !== 'active') { await log(key, 'activate', 'revoked'); return fail('revoked', 'คีย์นี้ถูกระงับแล้ว — ติดต่อผู้ขาย'); }
    if (r.machine && r.machine !== machine) {
      await log(key, 'activate', 'in_use');
      return fail('in_use', `คีย์นี้ใช้กับเครื่องอื่นอยู่ (${r.machine_name}) — ยกเลิกที่เครื่องเดิมก่อน หรือติดต่อผู้ขาย`);
    }
    await db.prepare('UPDATE keys SET machine=?, machine_name=?, activated_at=COALESCE(activated_at,?), last_seen=? WHERE key=?')
      .bind(machine, mname, now(), now(), key).run();
    await log(key, 'activate', 'ok');
    return json({ ok: true, token: await makeToken(db, key, machine) });
  }
  if (action === 'refresh' || action === 'deactivate') {
    const t = await readToken(db, inp.token);
    if (!t) return fail('bad_token', 'ไลเซนส์ไม่ถูกต้อง');
    const r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(t.k).first();
    if (!r || r.status !== 'active') { await log(t.k, action, 'revoked'); return fail('revoked', 'คีย์นี้ถูกระงับแล้ว — ติดต่อผู้ขาย'); }
    if (r.machine !== t.m) { await log(t.k, action, 'moved'); return fail('moved', 'คีย์นี้ถูกย้ายไปใช้เครื่องอื่นแล้ว'); }
    if (action === 'deactivate') {
      await db.prepare('UPDATE keys SET machine=NULL, machine_name=NULL, moves=moves+1 WHERE key=?').bind(t.k).run();
      await log(t.k, 'deactivate', 'ok');
      return json({ ok: true });
    }
    await db.prepare('UPDATE keys SET last_seen=? WHERE key=?').bind(now(), t.k).run();
    return json({ ok: true, token: await makeToken(db, t.k, t.m) });
  }
  return fail('bad_request', 'unknown action');
}

// ---------- admin auth ----------
async function pbkdf2(pw, saltB64) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 20000 }, k, 256)));
}
async function hmacKey(db) {
  let s = await getSetting(db, 'session_secret');
  if (!s) { s = b64(crypto.getRandomValues(new Uint8Array(32))); await setSetting(db, 'session_secret', s); }
  return crypto.subtle.importKey('raw', unb64(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function makeSession(db) {
  const p = b64u(enc.encode(JSON.stringify({ exp: now() + 12 * 3600 })));
  return p + '.' + b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode(p))));
}
async function validSession(db, req) {
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)st_admin=([^;]+)/);
  if (!m) return false;
  const [p, sig] = m[1].split('.');
  if (!p || !sig) return false;
  const want = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode(p))));
  if (!timingSafeEq(want, sig)) return false;
  try { return JSON.parse(dec.decode(unb64u(p))).exp > now(); } catch { return false; }
}
const cookie = (v, maxAge) => `st_admin=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const redirect = (to, extra = {}) => new Response(null, { status: 303, headers: { Location: to, ...extra } });

// ---------- admin pages ----------
async function admin(req, env) {
  const db = env.DB, url = new URL(req.url);
  const hasAdmin = !!(await getSetting(db, 'admin_hash'));
  let form = null;
  if (req.method === 'POST') {
    // CSRF: form must come from this same site
    const origin = req.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('bad origin', { status: 400 });
    form = await req.formData();
  }
  const f = (k) => (form?.get(k) ?? '').toString();

  if (!hasAdmin) {
    let err = '';
    if (form) {
      const code = f('code').trim();
      if (!env.SETUP_HASH || !timingSafeEq(await sha256(code), env.SETUP_HASH)) err = 'SETUP_CODE ไม่ถูกต้อง';
      else if (f('pw').length < 10) err = 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัว';
      else if (f('pw') !== f('pw2')) err = 'รหัสผ่านสองช่องไม่ตรงกัน';
      else {
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        await setSetting(db, 'admin_salt', salt); await setSetting(db, 'admin_hash', await pbkdf2(f('pw'), salt));
        await keys(db);
        return redirect('/admin', { 'Set-Cookie': cookie(await makeSession(db), 43200) });
      }
    }
    return page('ตั้งค่าครั้งแรก', `<form method="post" class="card narrow"><h2>ตั้งรหัสผ่านแอดมิน</h2>${err ? `<p class="err">${h(err)}</p>` : ''}
      <label>SETUP_CODE<input name="code" required autocomplete="off"></label>
      <label>รหัสผ่านใหม่ (10 ตัวขึ้นไป)<input name="pw" type="password" required></label>
      <label>ยืนยันรหัสผ่าน<input name="pw2" type="password" required></label><button>บันทึก</button></form>`);
  }

  if (form && f('do') === 'logout') return redirect('/admin', { 'Set-Cookie': cookie('', 0) });
  if (!(await validSession(db, req))) {
    let err = '';
    if (form && f('do') === 'login') {
      const want = await getSetting(db, 'admin_hash'), got = await pbkdf2(f('pw'), await getSetting(db, 'admin_salt'));
      if (timingSafeEq(want, got)) return redirect('/admin', { 'Set-Cookie': cookie(await makeSession(db), 43200) });
      await sleep(1000); err = 'รหัสผ่านไม่ถูกต้อง';
    }
    return page('เข้าสู่ระบบ', `<form method="post" class="card narrow"><h2>Sign Tools — แอดมิน</h2>${err ? `<p class="err">${h(err)}</p>` : ''}
      <input type="hidden" name="do" value="login"><label>รหัสผ่าน<input name="pw" type="password" required autofocus></label><button>เข้าสู่ระบบ</button></form>`);
  }

  // ----- logged in -----
  let msg = '', err = '', created = [];
  if (form) {
    const d = f('do'), key = normKey(f('key'));
    if (d === 'create') {
      const n = Math.max(1, Math.min(200, parseInt(f('n'), 10) || 1));
      const st = db.prepare('INSERT INTO keys (key, note, created_at) VALUES (?,?,?)');
      for (let i = 0; i < n; i++) created.push(newKey());
      await db.batch(created.map((k) => st.bind(k, f('note'), now())));
      msg = `สร้างคีย์ ${n} อันแล้ว`;
    } else if (d === 'revoke') { await db.prepare("UPDATE keys SET status='revoked' WHERE key=?").bind(key).run(); msg = `ระงับ ${key} แล้ว`; }
    else if (d === 'restore') { await db.prepare("UPDATE keys SET status='active' WHERE key=?").bind(key).run(); msg = `เปิดใช้ ${key} อีกครั้งแล้ว`; }
    else if (d === 'reset') { await db.prepare('UPDATE keys SET machine=NULL, machine_name=NULL, moves=moves+1 WHERE key=?').bind(key).run(); msg = `ปลดเครื่องของ ${key} แล้ว — ลูกค้าใส่คีย์ที่เครื่องใหม่ได้เลย`; }
    else if (d === 'note') { await db.prepare('UPDATE keys SET note=? WHERE key=?').bind(f('note'), key).run(); msg = 'บันทึกโน้ตแล้ว'; }
    else if (d === 'release') {
      const ver = f('version').trim(), file = form.get('zip');
      if (!/^\d+\.\d+\.\d+$/.test(ver)) err = 'เวอร์ชันต้องเป็นรูปแบบ 1.2.3';
      else if (!file || typeof file === 'string' || !file.size) err = 'ยังไม่ได้เลือกไฟล์ zip';
      else if (file.size > 1900000) err = 'ไฟล์ใหญ่เกิน 1.9 MB';
      else {
        const buf = new Uint8Array(await file.arrayBuffer());
        let man = null;
        try { const z = unzipSync(buf, { filter: (e) => e.name === 'SignTools/CSXS/manifest.xml' }); man = z['SignTools/CSXS/manifest.xml'] ? dec.decode(z['SignTools/CSXS/manifest.xml']) : null; }
        catch { err = 'ไฟล์ไม่ใช่ zip'; }
        if (!err && !man) err = 'ใน zip ไม่มี SignTools/CSXS/manifest.xml';
        else if (!err && !man.includes(`ExtensionBundleVersion="${ver}"`)) err = `เวอร์ชันใน manifest ไม่ตรงกับ ${ver}`;
        else if (!err) {
          const name = `SignTools-v${ver}.zip`, sha = await sha256(buf);
          const manifest = JSON.stringify({ version: ver, url: `${url.origin}/releases/${name}`, sha256: sha, size: buf.length,
            notes: f('notes'), date: new Date().toISOString().slice(0, 10) });
          const sig = b64(await sign(db, enc.encode(manifest)));
          await db.prepare('INSERT OR REPLACE INTO releases VALUES (?,?,?,?,?,?,?,?,?)').bind(ver, name, buf, sha, buf.length, f('notes'), manifest, sig, now()).run();
          msg = `ปล่อยเวอร์ชัน ${ver} แล้ว — ลูกค้าจะเห็นปุ่มอัปเดตเมื่อเปิดแผงครั้งถัดไป`;
        }
      }
    }
    if (!created.length && !err) return redirect('/admin' + (url.search || '') + (msg ? (url.search ? '&' : '?') + 'm=' + encodeURIComponent(msg) : ''));
  }
  if (!msg) msg = url.searchParams.get('m') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const rows = (q
    ? await db.prepare('SELECT * FROM keys WHERE key LIKE ?1 OR note LIKE ?1 OR machine_name LIKE ?1 ORDER BY created_at DESC LIMIT 500').bind(`%${q}%`).all()
    : await db.prepare('SELECT * FROM keys ORDER BY created_at DESC LIMIT 500').all()).results;
  const stats = await db.prepare("SELECT COUNT(*) n, SUM(machine IS NOT NULL) used, SUM(status='revoked') rev FROM keys").first();
  const latest = await db.prepare('SELECT version, created_at FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
  const pub = (await keys(db)).pub;
  const dt = (t) => t ? new Date(t * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const btn = (k, d, label, cls, conf) => `<form method="post"><input type="hidden" name="key" value="${h(k)}"><button name="do" value="${d}" class="${cls} sm"${conf ? ` onclick="return confirm('${conf}')"` : ''}>${label}</button></form>`;

  return page('Sign Tools — แอดมิน', `
<header><h1>Sign Tools <small>แอดมิน</small></h1><form method="post"><button name="do" value="logout" class="ghost">ออกจากระบบ</button></form></header>
${msg ? `<p class="ok">${h(msg)}</p>` : ''}${err ? `<p class="err">${h(err)}</p>` : ''}
${created.length ? `<div class="card"><h3>คีย์ใหม่ (ก็อปส่งให้ลูกค้า)</h3><textarea rows="${Math.min(10, created.length)}" readonly onclick="this.select()">${h(created.join('\n'))}</textarea></div>` : ''}
<div class="grid2">
  <form method="post" class="card"><h3>สร้างคีย์</h3><input type="hidden" name="do" value="create">
    <label>จำนวน<input name="n" type="number" value="1" min="1" max="200"></label>
    <label>โน้ต (ชื่อลูกค้า / เบอร์ / เลขออเดอร์)<input name="note"></label><button>สร้าง</button></form>
  <form method="post" enctype="multipart/form-data" class="card"><h3>ปล่อยอัปเดต</h3>
    <p class="mut">เวอร์ชันล่าสุด: <b>${latest ? h(latest.version) + '</b> (' + dt(latest.created_at) + ')' : 'ยังไม่มี</b>'}</p>
    <input type="hidden" name="do" value="release"><label>เวอร์ชัน<input name="version" placeholder="1.2.0" required></label>
    <label>มีอะไรใหม่<textarea name="notes" rows="2"></textarea></label>
    <label>ไฟล์ SignTools-vX.zip<input name="zip" type="file" accept=".zip" required></label><button>อัปโหลด + ปล่อย</button></form>
</div>
<div class="card">
  <div class="bar"><h3>คีย์ทั้งหมด <small>${stats.n || 0} อัน · ใช้งาน ${stats.used || 0} · ระงับ ${stats.rev || 0}</small></h3>
    <form><input name="q" value="${h(q)}" placeholder="ค้นหาคีย์ / โน้ต / ชื่อเครื่อง"></form></div>
  <div class="tw"><table><tr><th>คีย์</th><th>โน้ต</th><th>เครื่อง</th><th>เปิดใช้</th><th>ล่าสุด</th><th>สถานะ</th><th></th></tr>
  ${rows.map((r) => `<tr class="${r.status === 'revoked' ? 'rev' : ''}"><td class="mono">${h(r.key)}</td>
    <td><form method="post" class="inl"><input type="hidden" name="key" value="${h(r.key)}"><input name="note" value="${h(r.note)}"><button name="do" value="note" class="ghost sm">บันทึก</button></form></td>
    <td>${r.machine ? h(r.machine_name) : '<span class="mut">ยังไม่ผูก</span>'}${r.moves ? ` <span class="mut">(ย้าย ${r.moves})</span>` : ''}</td>
    <td>${dt(r.activated_at)}</td><td>${dt(r.last_seen)}</td>
    <td>${r.status === 'active' ? '<span class="tag on">ใช้ได้</span>' : '<span class="tag off">ระงับ</span>'}</td>
    <td class="act">${r.machine ? btn(r.key, 'reset', 'ปลดเครื่อง', 'ghost', 'ปลดเครื่องของคีย์นี้?') : ''}${r.status === 'active' ? btn(r.key, 'revoke', 'ระงับ', 'danger', 'ระงับคีย์นี้?') : btn(r.key, 'restore', 'เปิดใช้', 'ghost')}</td></tr>`).join('')
    || '<tr><td colspan="7" class="mut">ยังไม่มีคีย์</td></tr>'}
  </table></div>
</div>
<p class="mut small">กุญแจสาธารณะ (ใส่ในแผง Sign Tools): <code id="pk">${h(pub)}</code></p>`);
}

function page(title, body) {
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${h(title)}</title><style>
:root{--bg:#17171a;--card:#232327;--line:#34343a;--tx:#ececec;--mut:#9a9aa2;--acc:#56d36b;--in:#1a1a1d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 -apple-system,"Segoe UI","Leelawadee UI",Tahoma,sans-serif;padding:16px;max-width:1150px;margin:auto}
header{display:flex;justify-content:space-between;align-items:center}h1{font-size:20px}h1 small,h3 small{color:var(--mut);font-weight:400;font-size:13px}
.card{background:var(--card);border-radius:12px;padding:16px;margin:12px 0;display:flex;flex-direction:column;gap:10px}.narrow{max-width:380px;margin:60px auto}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid2 .card{margin:0}@media(max-width:720px){.grid2{grid-template-columns:1fr}}
label{display:flex;flex-direction:column;gap:4px;color:var(--mut);font-size:12.5px}
input,textarea{background:var(--in);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;width:100%}
button{background:var(--acc);color:#0d1f10;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer}
.ghost{background:var(--in);color:var(--tx);border:1px solid var(--line)}.danger{background:#5a2026;color:#ffb3b8}.sm{padding:4px 9px;font-size:12px;font-weight:600}
h2,h3{margin:0}.mut{color:var(--mut)}.small{font-size:12px}.ok{background:#1d3a24;color:#9ff0ae;padding:10px;border-radius:8px}.err{background:#3d1d21;color:#ffb3b8;padding:10px;border-radius:8px}
.bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.bar form{width:260px}code{word-break:break-all}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-weight:500}
.mono{font-family:Consolas,Menlo,monospace}tr.rev td{opacity:.5}.inl{display:flex;gap:4px}.inl input{padding:4px 6px;min-width:140px}.act{display:flex;gap:4px}
.tag{padding:2px 8px;border-radius:10px;font-size:12px}.tag.on{background:#1d3a24;color:#9ff0ae}.tag.off{background:#3d1d21;color:#ffb3b8}
</style></head><body>${body}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      await init(env.DB);
      if (url.pathname === '/api') {
        if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
        return await api(req, env);
      }
      const rm = url.pathname.match(/^\/releases\/(SignTools-v\d+\.\d+\.\d+\.zip)$/);
      if (rm) {
        const r = await env.DB.prepare('SELECT zip FROM releases WHERE name=?').bind(rm[1]).first();
        if (!r) return new Response('not found', { status: 404 });
        return new Response(new Uint8Array(r.zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${rm[1]}"` } });
      }
      if (url.pathname === '/admin') return await admin(req, env);
      if (url.pathname === '/') return redirect('/admin');
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.error(e);
      return url.pathname === '/api' ? json({ ok: false, code: 'server', error: 'เซิร์ฟเวอร์ผิดพลาด' }) : new Response('server error', { status: 500 });
    }
  },
};
