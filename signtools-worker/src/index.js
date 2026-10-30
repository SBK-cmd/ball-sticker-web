// Sign Tools — license + update server on Cloudflare Workers (D1)
// Same protocol as the PHP version, so the Illustrator panel is unchanged.
import { unzipSync } from 'fflate';
import qrcode from 'qrcode-generator';

const TOKEN_DAYS = 3;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, kind TEXT, key TEXT, phone TEXT, plan TEXT, amount REAL,
      status TEXT, slip BLOB, slip_type TEXT, trans_ref TEXT, verify TEXT, reason TEXT, created_at INTEGER, decided_at INTEGER)`),
  ]);
  // v2: สมาชิก — เบอร์ / แพ็กเกจ / วันหมดอายุ (NULL = ตลอดชีพ)
  if ((await getSetting(db, 'schema_v')) !== '2') {
    for (const q of ['ALTER TABLE keys ADD COLUMN phone TEXT', 'ALTER TABLE keys ADD COLUMN plan TEXT', 'ALTER TABLE keys ADD COLUMN expires_at INTEGER']) {
      try { await db.prepare(q).run(); } catch (e) { /* มีอยู่แล้ว */ }
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS orders_ref ON orders(trans_ref)').run();
    await setSetting(db, 'schema_v', '2');
  }
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

async function makeToken(db, key, machine, expiresAt) {
  let exp = now() + TOKEN_DAYS * 86400;
  if (expiresAt && expiresAt < exp) exp = expiresAt;            // คีย์รายเดือน/ปี: โทเคนไม่เกินวันหมดอายุ
  const p = enc.encode(JSON.stringify({ k: key, m: machine, iat: now(), exp }));
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
function normPhone(p) { let d = String(p || '').replace(/\D/g, ''); if (d.indexOf('66') === 0 && d.length === 11) d = '0' + d.slice(2); return /^0\d{9}$/.test(d) ? d : ''; }
const dtD = (t) => t ? new Date(t * 1000).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const EXPIRED_MSG = (req) => 'คีย์หมดอายุแล้ว — ต่ออายุได้ที่ ' + new URL(req.url).host + '/member แล้วเปิดแผงใหม่';
const PLANS = { month: { label: 'รายเดือน', days: 30 }, year: { label: 'รายปี', days: 365 }, life: { label: 'ตลอดชีพ', days: 0 } };
const planLabel = (p) => (PLANS[p] || PLANS.life).label;
// ต่ออายุ/เปลี่ยนแพ็กเกจ: นับต่อจากวันหมดเดิม (ถ้ายังไม่หมด)
function extendTo(row, plan) {
  if (plan === 'life') return { plan: 'life', expires_at: null };
  const base = Math.max(now(), (row && row.expires_at) || 0);
  return { plan, expires_at: base + PLANS[plan].days * 86400 };
}
async function prices(db) {
  const out = {};
  for (const k of Object.keys(PLANS)) { const v = parseFloat(await getSetting(db, 'price_' + k)); if (v > 0) out[k] = Math.round(v * 100) / 100; }
  return out;
}

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
    if (r.expires_at && r.expires_at < now()) { await log(key, 'activate', 'expired'); return fail('expired', EXPIRED_MSG(req)); }
    if (r.machine && r.machine !== machine) {
      await log(key, 'activate', 'in_use');
      return fail('in_use', `คีย์นี้ใช้กับเครื่องอื่นอยู่ (${r.machine_name}) — ยกเลิกที่เครื่องเดิมก่อน หรือติดต่อผู้ขาย`);
    }
    await db.prepare('UPDATE keys SET machine=?, machine_name=?, activated_at=COALESCE(activated_at,?), last_seen=? WHERE key=?')
      .bind(machine, mname, now(), now(), key).run();
    await log(key, 'activate', 'ok');
    return json({ ok: true, token: await makeToken(db, key, machine, r.expires_at) });
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
    if (r.expires_at && r.expires_at < now()) { await log(t.k, 'refresh', 'expired'); return fail('expired', EXPIRED_MSG(req)); }
    await db.prepare('UPDATE keys SET last_seen=? WHERE key=?').bind(now(), t.k).run();
    return json({ ok: true, token: await makeToken(db, t.k, t.m, r.expires_at) });
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
      const n = Math.max(1, Math.min(200, parseInt(f('n'), 10) || 1)), plan = PLANS[f('plan')] ? f('plan') : 'life';
      const ex = extendTo(null, plan), phone = normPhone(f('phone')) || null;
      const st = db.prepare('INSERT INTO keys (key, note, created_at, plan, expires_at, phone) VALUES (?,?,?,?,?,?)');
      for (let i = 0; i < n; i++) created.push(newKey());
      await db.batch(created.map((k) => st.bind(k, f('note'), now(), ex.plan, ex.expires_at, n === 1 ? phone : null)));
      msg = `สร้างคีย์ ${planLabel(plan)} ${n} อันแล้ว`;
    } else if (d === 'extend') {
      const plan = PLANS[f('plan')] ? f('plan') : 'month', row = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
      if (row) { const ex = extendTo(row, plan); await db.prepare('UPDATE keys SET plan=?, expires_at=? WHERE key=?').bind(ex.plan, ex.expires_at, key).run(); msg = `${key}: ${plan === 'life' ? 'เปลี่ยนเป็นตลอดชีพ' : 'ต่ออายุ' + planLabel(plan) + ' ถึง ' + dtD(ex.expires_at)} แล้ว`; }
    } else if (d === 'phone') { await db.prepare('UPDATE keys SET phone=? WHERE key=?').bind(normPhone(f('phone')) || null, key).run(); msg = 'บันทึกเบอร์แล้ว'; }
    else if (d === 'settings') {
      for (const k of ['price_month', 'price_year', 'price_life', 'pp_id', 'pp_name', 'contact']) await setSetting(db, k, f(k).trim());
      msg = 'บันทึกการตั้งค่าร้านแล้ว';
    } else if (d === 'approve' || d === 'reject') {
      const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(f('o')).first();
      if (o && o.status === 'pending') {
        if (d === 'approve') { const k = await fulfill(db, o); msg = `อนุมัติแล้ว · คีย์ ${k}`; }
        else { await db.prepare("UPDATE orders SET status='rejected', reason=?, decided_at=? WHERE id=?").bind(f('reason') || 'ร้านตรวจแล้วไม่ผ่าน', now(), o.id).run(); msg = 'ปฏิเสธรายการแล้ว'; }
      }
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
  const pend = (await db.prepare("SELECT id, kind, key, phone, plan, amount, reason, created_at FROM orders WHERE status='pending' ORDER BY created_at DESC LIMIT 50").all()).results;
  const recent = (await db.prepare("SELECT id, kind, key, phone, plan, amount, status, reason, created_at FROM orders WHERE status IN ('paid','rejected') ORDER BY created_at DESC LIMIT 15").all()).results;
  const S = {}; for (const k of ['price_month', 'price_year', 'price_life', 'pp_id', 'pp_name', 'contact']) S[k] = (await getSetting(db, k)) || '';
  const dt = (t) => t ? new Date(t * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const btn = (k, d, label, cls, conf) => `<form method="post"><input type="hidden" name="key" value="${h(k)}"><button name="do" value="${d}" class="${cls} sm"${conf ? ` onclick="return confirm('${conf}')"` : ''}>${label}</button></form>`;

  return page('Sign Tools — แอดมิน', `
<header><h1>Sign Tools <small>แอดมิน</small></h1><form method="post"><button name="do" value="logout" class="ghost">ออกจากระบบ</button></form></header>
${msg ? `<p class="ok">${h(msg)}</p>` : ''}${err ? `<p class="err">${h(err)}</p>` : ''}
${created.length ? `<div class="card"><h3>คีย์ใหม่ (ก็อปส่งให้ลูกค้า)</h3><textarea rows="${Math.min(10, created.length)}" readonly onclick="this.select()">${h(created.join('\n'))}</textarea></div>` : ''}
<div class="grid2">
  <form method="post" class="card"><h3>สร้างคีย์</h3><input type="hidden" name="do" value="create">
    <label>จำนวน<input name="n" type="number" value="1" min="1" max="200"></label>
    <label>แพ็กเกจ<select name="plan"><option value="life">ตลอดชีพ</option><option value="year">รายปี (365 วัน)</option><option value="month">รายเดือน (30 วัน)</option></select></label>
    <label>เบอร์ลูกค้า (ใช้ล็อกอินหน้าสมาชิก · ไม่ใส่ก็ได้ ลูกค้าล็อกอินครั้งแรกจะผูกเอง)<input name="phone" inputmode="tel"></label>
    <label>โน้ต (ชื่อลูกค้า / เลขออเดอร์)<input name="note"></label><button>สร้าง</button></form>
  <form method="post" enctype="multipart/form-data" class="card"><h3>ปล่อยอัปเดต</h3>
    <p class="mut">เวอร์ชันล่าสุด: <b>${latest ? h(latest.version) + '</b> (' + dt(latest.created_at) + ')' : 'ยังไม่มี</b>'}</p>
    <input type="hidden" name="do" value="release"><label>เวอร์ชัน<input name="version" placeholder="1.2.0" required></label>
    <label>มีอะไรใหม่<textarea name="notes" rows="2"></textarea></label>
    <label>ไฟล์ SignTools-vX.zip<input name="zip" type="file" accept=".zip" required></label><button>อัปโหลด + ปล่อย</button></form>
</div>
${pend.length ? `<div class="card hl"><h3>รอตรวจสลิป <small>${pend.length} รายการ</small></h3><div class="tw"><table><tr><th>เวลา</th><th>รายการ</th><th>เบอร์</th><th>ยอด</th><th>เหตุผลที่ไม่ผ่านอัตโนมัติ</th><th>สลิป</th><th></th></tr>
  ${pend.map((o) => `<tr><td>${dt(o.created_at)}</td><td>${o.kind === 'new' ? 'ซื้อใหม่' : 'ต่ออายุ ' + h(o.key)} · ${planLabel(o.plan)}</td><td>${h(o.phone)}</td><td>${o.amount}</td><td class="wrap">${h(o.reason || '-')}</td>
    <td><a href="/admin/slip?o=${h(o.id)}" target="_blank">ดูสลิป</a></td>
    <td class="act"><form method="post"><input type="hidden" name="o" value="${h(o.id)}"><button name="do" value="approve" class="sm">อนุมัติ</button></form>
    <form method="post"><input type="hidden" name="o" value="${h(o.id)}"><button name="do" value="reject" class="danger sm" onclick="return confirm('ปฏิเสธรายการนี้?')">ปฏิเสธ</button></form></td></tr>`).join('')}
  </table></div></div>` : ''}
<form method="post" class="card"><h3>ตั้งค่าร้าน (หน้าสมาชิก /member)</h3><input type="hidden" name="do" value="settings">
  <div class="grid3"><label>ราคารายเดือน (บาท · ว่าง = ไม่ขาย)<input name="price_month" inputmode="decimal" value="${h(S.price_month)}"></label>
  <label>ราคารายปี<input name="price_year" inputmode="decimal" value="${h(S.price_year)}"></label>
  <label>ราคาตลอดชีพ<input name="price_life" inputmode="decimal" value="${h(S.price_life)}"></label></div>
  <div class="grid3"><label>พร้อมเพย์รับเงิน (เบอร์ / เลขบัตร)<input name="pp_id" value="${h(S.pp_id)}"></label>
  <label>ชื่อบัญชี (แสดงให้ลูกค้าเห็น)<input name="pp_name" value="${h(S.pp_name)}"></label>
  <label>ช่องทางติดต่อ<input name="contact" value="${h(S.contact)}" placeholder="LINE @ballsticker / 08x-xxx-xxxx"></label></div>
  <p class="mut small">ตรวจสลิปอัตโนมัติ: ${env.EASYSLIP_KEY ? '<b style="color:#9ff0ae">เปิดอยู่ (EasySlip)</b>' : '<b>ปิด</b> — ทุกสลิปรอคุณอนุมัติ · เปิดได้โดยใส่ Secret ชื่อ <code>EASYSLIP_KEY</code> ใน Cloudflare › Workers › signtools › Settings › Variables'}</p>
  <button>บันทึก</button></form>
<div class="card">
  <div class="bar"><h3>คีย์ทั้งหมด <small>${stats.n || 0} อัน · ใช้งาน ${stats.used || 0} · ระงับ ${stats.rev || 0}</small></h3>
    <form><input name="q" value="${h(q)}" placeholder="ค้นหาคีย์ / โน้ต / ชื่อเครื่อง"></form></div>
  <div class="tw"><table><tr><th>คีย์</th><th>โน้ต</th><th>เบอร์</th><th>แพ็กเกจ</th><th>เครื่อง</th><th>เปิดใช้</th><th>ล่าสุด</th><th>สถานะ</th><th></th></tr>
  ${rows.map((r) => `<tr class="${r.status === 'revoked' ? 'rev' : ''}"><td class="mono">${h(r.key)}</td>
    <td><form method="post" class="inl"><input type="hidden" name="key" value="${h(r.key)}"><input name="note" value="${h(r.note)}"><button name="do" value="note" class="ghost sm">บันทึก</button></form></td>
    <td><form method="post" class="inl"><input type="hidden" name="key" value="${h(r.key)}"><input name="phone" value="${h(r.phone || '')}" style="min-width:105px" inputmode="tel"><button name="do" value="phone" class="ghost sm">บันทึก</button></form></td>
    <td>${planLabel(r.plan)}${r.expires_at ? `<br><span class="${r.expires_at < now() ? 'exp' : 'mut'}">${r.expires_at < now() ? 'หมดแล้ว ' : 'ถึง '}${dtD(r.expires_at)}</span>` : ''}
      <form method="post" class="inl" style="margin-top:3px"><input type="hidden" name="key" value="${h(r.key)}"><select name="plan" class="sm"><option value="month">+30 วัน</option><option value="year">+1 ปี</option><option value="life">ตลอดชีพ</option></select><button name="do" value="extend" class="ghost sm">ต่อ</button></form></td>
    <td>${r.machine ? h(r.machine_name) : '<span class="mut">ยังไม่ผูก</span>'}${r.moves ? ` <span class="mut">(ย้าย ${r.moves})</span>` : ''}</td>
    <td>${dt(r.activated_at)}</td><td>${dt(r.last_seen)}</td>
    <td>${r.status === 'active' ? '<span class="tag on">ใช้ได้</span>' : '<span class="tag off">ระงับ</span>'}</td>
    <td class="act">${r.machine ? btn(r.key, 'reset', 'ปลดเครื่อง', 'ghost', 'ปลดเครื่องของคีย์นี้?') : ''}${r.status === 'active' ? btn(r.key, 'revoke', 'ระงับ', 'danger', 'ระงับคีย์นี้?') : btn(r.key, 'restore', 'เปิดใช้', 'ghost')}</td></tr>`).join('')
    || '<tr><td colspan="9" class="mut">ยังไม่มีคีย์</td></tr>'}
  </table></div>
</div>
${recent.length ? `<div class="card"><h3>รายการชำระเงินล่าสุด</h3><div class="tw"><table><tr><th>เวลา</th><th>รายการ</th><th>เบอร์</th><th>ยอด</th><th>สถานะ</th><th>คีย์</th></tr>
  ${recent.map((o) => `<tr><td>${dt(o.created_at)}</td><td>${o.kind === 'new' ? 'ซื้อใหม่' : 'ต่ออายุ'} · ${planLabel(o.plan)}</td><td>${h(o.phone)}</td><td>${o.amount}</td>
    <td>${o.status === 'paid' ? '<span class="tag on">ชำระแล้ว</span>' : '<span class="tag off">ปฏิเสธ</span>'}</td><td class="mono">${h(o.key || '')}</td></tr>`).join('')}</table></div></div>` : ''}
<p class="mut small">หน้าสมาชิกสำหรับลูกค้า: <a href="/member" style="color:#9ff0ae">/member</a> · หน้าดาวน์โหลด: <a href="/download" style="color:#9ff0ae">/download</a></p>
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
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}@media(max-width:720px){.grid3{grid-template-columns:1fr}}
select{background:var(--in);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit}select.sm{padding:3px 4px;font-size:12px}
.hl{border:1px solid #c9a227}.exp{color:#ff8d95}td.wrap{white-space:normal;max-width:260px}
.tag{padding:2px 8px;border-radius:10px;font-size:12px}.tag.on{background:#1d3a24;color:#9ff0ae}.tag.off{background:#3d1d21;color:#ffb3b8}
</style></head><body>${body}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' } });
}

// หน้าดาวน์โหลดสำหรับลูกค้า (สาธารณะ) — เวอร์ชันล่าสุดเสมอ
async function downloadPage(env, url) {
  const r = await env.DB.prepare('SELECT version, size, notes, created_at FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
  const ver = r ? h(r.version) : '-', size = r ? (r.size / 1024).toFixed(0) + ' KB' : '';
  const date = r ? new Date(r.created_at * (r.created_at < 1e12 ? 1000 : 1)).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ดาวน์โหลด Sign Tools · บอลสติ๊กเกอร์</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#10233f;--card:#16304f;--line:#2a4a72;--tx:#eef3fa;--mut:#a9bbd3;--acc:#ffd23f;--ink:#10233f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 "IBM Plex Sans Thai",system-ui,sans-serif;padding:28px max(16px,env(safe-area-inset-left)) 48px}
.w{max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
.brand{display:flex;align-items:center;gap:12px}.logo{width:44px;height:44px;border-radius:11px;background:var(--acc);color:var(--ink);display:grid;place-items:center;font-weight:700;font-size:26px}
h1{margin:0;font-size:24px;line-height:1.2}.sub{color:var(--mut);font-size:13.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px}
.dl{display:flex;align-items:center;justify-content:center;gap:10px;background:var(--acc);color:var(--ink);text-decoration:none;font-weight:700;font-size:18px;border-radius:12px;padding:15px}
.dl:focus-visible{outline:3px solid #fff;outline-offset:2px}
.meta{color:var(--mut);font-size:13px;text-align:center}
h2{margin:0;font-size:15px}ol{margin:0;padding-left:20px}li{margin:3px 0}code{background:#0c1c33;border-radius:5px;padding:1px 6px;font-size:13px;white-space:nowrap}
.note{color:var(--mut);font-size:13px}
</style></head><body><div class="w">
<div class="brand"><div class="logo">B</div><div><h1>Sign Tools</h1><div class="sub">เครื่องมือร้านป้าย/สติ๊กเกอร์ สำหรับ Adobe Illustrator · บอลสติ๊กเกอร์</div></div></div>
<div class="card"><a class="dl" href="/download/latest.zip">⬇ ดาวน์โหลด Sign Tools v${ver}</a>
<div class="meta">${size}${date ? ' · อัปเดต ' + h(date) : ''} · Windows และ Mac · Illustrator 2018 ขึ้นไป</div>
${r && r.notes ? '<div class="note">ใหม่: ' + h(r.notes) + '</div>' : ''}</div>
<div class="card"><h2>วิธีติดตั้ง</h2><ol>
<li>ปิด Illustrator ก่อน</li>
<li>แตกไฟล์ zip (Windows: คลิกขวา › Extract All)</li>
<li><b>Windows:</b> ดับเบิลคลิก <code>install-windows.bat</code><br><b>Mac:</b> ดับเบิลคลิก <code>install-mac.command</code> (ถ้าเปิดไม่ได้: คลิกขวา › Open › Open)</li>
<li>เปิด Illustrator › Window › Extensions › <b>Sign Tools</b></li>
<li>ใส่คีย์ที่ได้รับจากร้าน (ST-XXXX-XXXX-XXXX-XXXX) · 1 คีย์ ใช้ได้ 1 เครื่อง</li></ol>
<div class="note">ติดตั้งแล้ว อัปเดตครั้งต่อไปกด "เช็คอัปเดต" ในแผงได้เลย ไม่ต้องโหลดใหม่</div></div>
<div class="card"><h2>ยังไม่มีคีย์ / ติดปัญหา</h2><div class="note">ติดต่อร้านบอลสติ๊กเกอร์ · <a href="https://ballsticker.co.th" style="color:var(--acc)">ballsticker.co.th</a></div></div>
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// =====================================================================
//  ระบบสมาชิก: ล็อกอินด้วยเบอร์ + คีย์ · ซื้อ/ต่ออายุด้วยพร้อมเพย์ + สลิป
// =====================================================================
function ppPayload(id, amount) {          // Thai QR (PromptPay) — เหมือน promptpay-qr
  const f = (i, v) => i + String(v.length).padStart(2, '0') + v;
  let d = String(id || '').replace(/\D/g, ''), type, val;
  if (d.length === 10 && d[0] === '0') { type = '01'; val = ('0000000000000' + '66' + d.slice(1)).slice(-13); }
  else if (d.length === 13) { type = '02'; val = d; } else if (d.length === 15) { type = '03'; val = d; } else return null;
  let p = f('00', '01') + f('01', amount > 0 ? '12' : '11') + f('29', f('00', 'A000000677010111') + f(type, val)) + f('58', 'TH') + f('53', '764') + (amount > 0 ? f('54', amount.toFixed(2)) : '') + '6304';
  let c = 0xFFFF;
  for (let i = 0; i < p.length; i++) { c ^= p.charCodeAt(i) << 8; for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; }
  return p + c.toString(16).toUpperCase().padStart(4, '0');
}
function qrSvg(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: 'QR พร้อมเพย์' }); }
const rid = () => hex(crypto.getRandomValues(new Uint8Array(16)));

// ส่งมอบ: ซื้อใหม่ = สร้างคีย์ · ต่ออายุ = ขยายวันหมดอายุ
async function fulfill(db, o) {
  let key = o.key;
  if (o.kind === 'new') {
    key = newKey(); const ex = extendTo(null, o.plan);
    await db.prepare('INSERT INTO keys (key, note, created_at, plan, expires_at, phone) VALUES (?,?,?,?,?,?)').bind(key, 'ซื้อออนไลน์', now(), ex.plan, ex.expires_at, o.phone).run();
  } else {
    const row = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
    const ex = extendTo(row, o.plan);
    await db.prepare('UPDATE keys SET plan=?, expires_at=? WHERE key=?').bind(ex.plan, ex.expires_at, key).run();
  }
  await db.prepare("UPDATE orders SET status='paid', key=?, decided_at=? WHERE id=?").bind(key, now(), o.id).run();
  return key;
}

// ตรวจสลิปกับ EasySlip → { ok, retry, reason, ref }
async function checkSlip(env, db, buf, type, amount) {
  if (!env.EASYSLIP_KEY) return { ok: false, reason: 'ยังไม่ได้เปิดตรวจสลิปอัตโนมัติ — รอร้านตรวจ' };
  let j;
  try {
    const r = await fetch('https://api.easyslip.com/v2/verify/bank', { method: 'POST',
      headers: { Authorization: 'Bearer ' + env.EASYSLIP_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: 'data:' + type + ';base64,' + b64(buf), matchAccount: true, matchAmount: amount, checkDuplicate: true }) });
    j = await r.json();
  } catch (e) { return { ok: false, reason: 'ติดต่อระบบตรวจสลิปไม่ได้ — รอร้านตรวจ' }; }
  if (!j || !j.success) {
    const code = (j && j.error && j.error.code) || 'ERROR';
    if (code === 'SLIP_NOT_FOUND' || code === 'VALIDATION_ERROR' || code === 'IMAGE_SIZE_TOO_LARGE') return { ok: false, retry: true, reason: 'อ่านสลิปไม่ได้ — ส่งรูปสลิปที่ชัด (มี QR มุมสลิป) อีกครั้ง', raw: code };
    if (code === 'SLIP_PENDING') return { ok: false, retry: true, reason: 'ธนาคารยังไม่ยืนยันรายการ — รอ 1-2 นาทีแล้วส่งใหม่', raw: code };
    return { ok: false, reason: 'ระบบตรวจสลิปขัดข้อง (' + code + ') — รอร้านตรวจ', raw: code };
  }
  const d = j.data || {}, raw = d.rawSlip || {}, ref = raw.transRef || null, why = [];
  const inSlip = Number(d.amountInSlip != null ? d.amountInSlip : (raw.amount && raw.amount.amount));
  if (d.isDuplicate) why.push('สลิปนี้เคยใช้แล้ว');
  if (ref && await db.prepare("SELECT id FROM orders WHERE trans_ref=? AND status='paid'").bind(ref).first()) why.push('สลิปนี้ใช้ต่ออายุไปแล้ว');
  if (!d.matchedAccount) why.push('บัญชีผู้รับไม่ใช่ของร้าน');
  if (d.isAmountMatched === false || !(inSlip >= amount - 0.001)) why.push('ยอดในสลิป ' + (isNaN(inSlip) ? '?' : inSlip) + ' ไม่ตรงกับ ' + amount);
  const t = Date.parse(raw.date || ''); if (t && Date.now() - t > 3 * 86400000) why.push('สลิปเก่าเกิน 3 วัน');
  return { ok: !why.length, reason: why.join(' · '), ref, raw: JSON.stringify({ ref, inSlip, acct: !!d.matchedAccount, dup: !!d.isDuplicate, date: raw.date }).slice(0, 500) };
}

// ----- session ลูกค้า -----
async function memSession(db, key) {
  const p = b64u(enc.encode(JSON.stringify({ k: key, exp: now() + 7 * 86400 })));
  return p + '.' + b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('m:' + p))));
}
async function memKey(db, req) {
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)st_mem=([^;]+)/);
  if (!m) return null;
  const [p, sig] = m[1].split('.');
  if (!p || !sig) return null;
  const want = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('m:' + p))));
  if (!timingSafeEq(want, sig)) return null;
  try { const o = JSON.parse(dec.decode(unb64u(p))); return o.exp > now() ? o.k : null; } catch { return null; }
}
const memCookie = (v, maxAge) => `st_mem=${v}; Path=/member; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function mPage(title, body, extraHead = '') {
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${h(title)} · Sign Tools</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">${extraHead}
<style>
:root{--bg:#10233f;--card:#16304f;--line:#2a4a72;--tx:#eef3fa;--mut:#a9bbd3;--acc:#ffd23f;--ink:#10233f;--ok:#7be39a;--bad:#ff9aa2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 "IBM Plex Sans Thai",system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-left)) 48px}
.w{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.logo{width:40px;height:40px;border-radius:10px;background:var(--acc);color:var(--ink);display:grid;place-items:center;font-weight:700;font-size:23px}
h1{margin:0;font-size:21px;line-height:1.2}h2{margin:0;font-size:16px}.sub{color:var(--mut);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--mut)}
input{background:#0c1c33;color:var(--tx);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:inherit;font-size:16px;width:100%}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
button,.btn{display:inline-flex;align-items:center;justify-content:center;background:var(--acc);color:var(--ink);border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
.ghost{background:transparent;color:var(--tx);border:1px solid var(--line)}.sm{padding:7px 12px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1}.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px}.kv b{font-weight:600}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em}.mut{color:var(--mut)}.small{font-size:12.5px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.msg{border-radius:10px;padding:10px 12px;background:#0c1c33;border:1px solid var(--line)}.msg.bad{border-color:#7a3940}.msg.ok{border-color:#2f6b45}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.plan{border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;background:#0c1c33}
.plan b{font-size:16px}.plan .p{font-size:22px;font-weight:700;color:var(--acc)}
.qr{background:#fff;border-radius:12px;padding:14px;align-self:center;display:flex;flex-direction:column;align-items:center;gap:6px;color:#10233f}
.qr svg{width:230px;height:230px;display:block}
.foot{color:var(--mut);font-size:12.5px;text-align:center}
</style></head><body><div class="w"><a class="brand" href="/member"><div class="logo">B</div><div><h1>Sign Tools · สมาชิก</h1><div class="sub">บอลสติ๊กเกอร์ · เครื่องมือ Illustrator สำหรับร้านป้าย</div></div></a>
${body}<div class="foot"><a href="/download" style="color:var(--mut)">ดาวน์โหลดโปรแกรม</a></div></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' } });
}

async function member(req, env) {
  const db = env.DB, url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/member';
  let form = null;
  if (req.method === 'POST') {
    const origin = req.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('bad origin', { status: 400 });
    form = await req.formData();
  }
  const f = (k) => (form?.get(k) ?? '').toString();
  const P = await prices(db), contact = (await getSetting(db, 'contact')) || 'ร้านบอลสติ๊กเกอร์';
  const planCards = (kind, key) => Object.keys(PLANS).filter((p) => P[p]).map((p) => `<form method="post" action="/member/order" class="plan">
      <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="plan" value="${p}">${key ? `<input type="hidden" name="key" value="${h(key)}">` : ''}
      <b>${planLabel(p)}</b><span class="p">฿${P[p].toLocaleString('th-TH')}</span><span class="mut small">${p === 'life' ? 'จ่ายครั้งเดียว ใช้ได้ตลอด' : p === 'year' ? '365 วัน' : '30 วัน'}</span>
      ${kind === 'new' ? '' : ''}<button class="sm">${kind === 'new' ? 'ซื้อ' : 'ต่ออายุ'}</button></form>`).join('') || '<p class="mut">ยังไม่เปิดขายออนไลน์ — ติดต่อ ' + h(contact) + '</p>';

  // ----- สร้างรายการชำระเงิน -----
  if (path === '/member/order' && form) {
    const plan = PLANS[f('plan')] && P[f('plan')] ? f('plan') : null, kind = f('kind') === 'renew' ? 'renew' : 'new';
    if (!plan) return redirect('/member');
    let key = null, phone = normPhone(f('phone'));
    if (kind === 'renew') { key = await memKey(db, req); if (!key) return redirect('/member'); phone = (await db.prepare('SELECT phone FROM keys WHERE key=?').bind(key).first())?.phone || ''; }
    else if (!phone) return mPage('ซื้อคีย์', `<div class="card"><p class="msg bad">ใส่เบอร์มือถือ 10 หลักให้ถูกต้อง</p><a class="btn ghost" href="/member/buy">ย้อนกลับ</a></div>`);
    const id = rid();
    await db.prepare("INSERT INTO orders (id, kind, key, phone, plan, amount, status, created_at) VALUES (?,?,?,?,?,?,'new',?)").bind(id, kind, key, phone, plan, P[plan], now()).run();
    return redirect('/member/pay?o=' + id);
  }

  // ----- หน้าชำระเงิน + อัปโหลดสลิป -----
  if (path === '/member/pay') {
    const id = (url.searchParams.get('o') || f('o')).replace(/[^0-9a-f]/g, '');
    let o = id ? await db.prepare('SELECT id, kind, key, phone, plan, amount, status, reason FROM orders WHERE id=?').bind(id).first() : null;
    if (!o) return mPage('ไม่พบรายการ', `<div class="card"><p>ไม่พบรายการชำระเงินนี้</p><a class="btn" href="/member">กลับหน้าสมาชิก</a></div>`);
    let note = '';
    if (form && (o.status === 'new' || o.status === 'retry')) {
      const file = form.get('slip');
      if (!file || typeof file === 'string' || !file.size) note = '<p class="msg bad">ยังไม่ได้เลือกรูปสลิป</p>';
      else if (file.size > 1500000) note = '<p class="msg bad">รูปใหญ่เกิน 1.5 MB — แคปหน้าจอสลิปแล้วส่งใหม่</p>';
      else if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type || '')) note = '<p class="msg bad">ต้องเป็นรูปภาพ (JPG / PNG)</p>';
      else {
        const buf = new Uint8Array(await file.arrayBuffer()), v = await checkSlip(env, db, buf, file.type, o.amount);
        if (v.ok) {
          await db.prepare('UPDATE orders SET slip=?, slip_type=?, trans_ref=?, verify=? WHERE id=?').bind(buf, file.type, v.ref, v.raw || '', o.id).run();
          await fulfill(db, o);
        } else if (v.retry) {
          await db.prepare("UPDATE orders SET status='retry', reason=? WHERE id=?").bind(v.reason, o.id).run();
          note = '<p class="msg bad">' + h(v.reason) + '</p>';
        } else {
          await db.prepare("UPDATE orders SET status='pending', slip=?, slip_type=?, trans_ref=?, verify=?, reason=? WHERE id=?").bind(buf, file.type, v.ref || null, v.raw || '', v.reason, o.id).run();
        }
        o = await db.prepare('SELECT id, kind, key, phone, plan, amount, status, reason FROM orders WHERE id=?').bind(id).first();
      }
    }
    const head = `<div class="kv"><span class="mut">รายการ</span><b>${o.kind === 'new' ? 'ซื้อคีย์ใหม่' : 'ต่ออายุคีย์ ' + h(o.key)}</b>
      <span class="mut">แพ็กเกจ</span><b>${planLabel(o.plan)}</b><span class="mut">ยอดชำระ</span><b>฿${Number(o.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b>
      <span class="mut">เบอร์</span><b>${h(o.phone || '-')}</b></div>`;
    if (o.status === 'paid') {
      const k = await db.prepare('SELECT key, plan, expires_at FROM keys WHERE key=?').bind(o.key).first();
      const sess = await memSession(db, o.key);
      return new Response((await mPage('ชำระเงินสำเร็จ', `<div class="card"><h2 class="ok">✓ ชำระเงินสำเร็จ</h2>${head}
        <div class="msg ok">${o.kind === 'new' ? 'คีย์ของคุณ' : 'ต่ออายุแล้ว'}<div class="mono" style="font-size:19px;margin-top:4px">${h(o.key)}</div>
        <div class="small mut">${k && k.expires_at ? 'ใช้ได้ถึง ' + dtD(k.expires_at) : 'ใช้ได้ตลอดชีพ'}</div></div>
        ${o.kind === 'new' ? '<p class="small">เก็บคีย์นี้ไว้ ใช้ใส่ในโปรแกรม และใช้คู่กับเบอร์ ' + h(o.phone) + ' เพื่อเข้าหน้าสมาชิก</p><a class="btn" href="/download">ดาวน์โหลดโปรแกรม</a>' : '<p class="small">เปิดแผง Sign Tools ใหม่ ระบบจะใช้ได้ทันที</p>'}
        <a class="btn ghost" href="/member">ไปหน้าสมาชิก</a></div>`)).body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': memCookie(sess, 7 * 86400) } });
    }
    if (o.status === 'pending') return mPage('รอตรวจสอบ', `<div class="card"><h2>⏳ ได้รับสลิปแล้ว · รอร้านตรวจสอบ</h2>${head}
      <p class="msg">${h(o.reason || '')}</p><p class="small mut">ร้านจะตรวจและยืนยันให้เร็วที่สุด · เปิดหน้านี้อีกครั้งเพื่อดูสถานะ (บันทึกลิงก์ไว้ได้)</p>
      <p class="small">สอบถาม: ${h(contact)}</p><a class="btn ghost" href="/member/pay?o=${o.id}">รีเฟรชสถานะ</a></div>`);
    if (o.status === 'rejected') return mPage('ไม่ผ่าน', `<div class="card"><h2 class="bad">รายการนี้ไม่ผ่าน</h2>${head}<p class="msg bad">${h(o.reason || '')}</p><p>ติดต่อ ${h(contact)}</p><a class="btn" href="/member">กลับหน้าสมาชิก</a></div>`);
    const ppid = await getSetting(db, 'pp_id'), ppname = (await getSetting(db, 'pp_name')) || '', payload = ppPayload(ppid, Number(o.amount));
    return mPage('ชำระเงิน', `<div class="card"><h2>ชำระเงินด้วยพร้อมเพย์</h2>${head}
      ${payload ? `<div class="qr">${qrSvg(payload)}<b>฿${Number(o.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b><span class="small">${h(ppname)}</span></div>
      <p class="small mut">สแกนด้วยแอปธนาคาร ยอดเงินจะขึ้นให้อัตโนมัติ · บนมือถือ: กดค้างที่ QR แล้วบันทึกรูป แล้วเปิดในแอปธนาคาร</p>` : '<p class="msg bad">ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ — ติดต่อ ' + h(contact) + '</p>'}
      ${o.status === 'retry' && !note ? '<p class="msg bad">' + h(o.reason || '') + '</p>' : ''}${note}
      <form method="post" enctype="multipart/form-data" class="card" style="padding:14px"><input type="hidden" name="o" value="${o.id}">
        <label>โอนแล้ว แนบรูปสลิป<input type="file" name="slip" accept="image/*" required></label><button>ส่งสลิป</button>
        <span class="small mut">ระบบตรวจสลิปอัตโนมัติ ผ่านแล้วได้คีย์/ต่ออายุทันที</span></form></div>
`);
  }

  // ----- ซื้อคีย์ใหม่ -----
  if (path === '/member/buy') {
    return mPage('ซื้อคีย์', `<div class="card"><h2>ซื้อคีย์ Sign Tools</h2>
      <label>เบอร์มือถือ (ใช้คู่กับคีย์เพื่อเข้าหน้าสมาชิก)<input id="ph" inputmode="tel" placeholder="08x-xxx-xxxx" autocomplete="tel"></label>
      <div class="plans">${planCards('new')}</div>
      <p class="small mut">1 คีย์ ใช้ได้ 1 เครื่อง · ย้ายเครื่องได้เองจากหน้าสมาชิก</p></div>
      <script>document.querySelectorAll('form.plan').forEach(function(fm){fm.addEventListener('submit',function(){var i=document.createElement('input');i.type='hidden';i.name='phone';i.value=document.getElementById('ph').value;fm.appendChild(i);});});</script>`);
  }

  // ----- ล็อกอิน / หน้าสมาชิก -----
  if (form && f('do') === 'logout') return redirect('/member', { 'Set-Cookie': memCookie('', 0) });
  let key = await memKey(db, req), err = '';
  if (form && f('do') === 'login') {
    const k = normKey(f('key')), phone = normPhone(f('phone')), r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(k).first();
    if (!phone) err = 'ใส่เบอร์มือถือ 10 หลัก';
    else if (!r || (r.phone && r.phone !== phone)) { await sleep(800); err = 'เบอร์หรือคีย์ไม่ถูกต้อง'; }
    else {
      if (!r.phone) await db.prepare('UPDATE keys SET phone=? WHERE key=?').bind(phone, k).run();     // ล็อกอินครั้งแรก = ผูกเบอร์
      return redirect('/member', { 'Set-Cookie': memCookie(await memSession(db, k), 7 * 86400) });
    }
  }
  if (!key) {
    return mPage('เข้าสู่ระบบ', `<form method="post" class="card"><h2>เข้าสู่ระบบสมาชิก</h2>${err ? `<p class="msg bad">${h(err)}</p>` : ''}
      <input type="hidden" name="do" value="login">
      <label>เบอร์มือถือ<input name="phone" inputmode="tel" placeholder="08x-xxx-xxxx" autocomplete="tel" required></label>
      <label>คีย์ (ST-XXXX-XXXX-XXXX-XXXX)<input name="key" class="mono" autocapitalize="characters" spellcheck="false" required></label>
      <button>เข้าสู่ระบบ</button></form>
      <div class="card"><h2>ยังไม่มีคีย์?</h2><a class="btn" href="/member/buy">ซื้อคีย์</a></div>`);
  }
  const r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
  if (!r) return redirect('/member', { 'Set-Cookie': memCookie('', 0) });
  let msg = '';
  if (form && f('do') === 'move') { await db.prepare('UPDATE keys SET machine=NULL, machine_name=NULL, moves=moves+1 WHERE key=?').bind(key).run(); msg = 'ปลดเครื่องแล้ว — เปิด Sign Tools ที่เครื่องใหม่แล้วใส่คีย์ได้เลย'; r.machine = null; }
  const expired = r.expires_at && r.expires_at < now(), days = r.expires_at ? Math.ceil((r.expires_at - now()) / 86400) : null;
  const status = r.status !== 'active' ? '<b class="bad">ถูกระงับ</b>' : expired ? '<b class="bad">หมดอายุแล้ว</b>' : '<b class="ok">ใช้งานได้</b>';
  const pendO = await db.prepare("SELECT id FROM orders WHERE key=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(key).first();
  return mPage('สมาชิก', `${msg ? `<p class="msg ok">${h(msg)}</p>` : ''}
    <div class="card"><h2>คีย์ของคุณ</h2><div class="kv">
      <span class="mut">คีย์</span><b class="mono">${h(r.key)}</b><span class="mut">เบอร์</span><b>${h(r.phone || '-')}</b>
      <span class="mut">แพ็กเกจ</span><b>${planLabel(r.plan)}</b>
      <span class="mut">ใช้ได้ถึง</span><b>${r.expires_at ? dtD(r.expires_at) + (expired ? '' : ` <span class="mut small">(อีก ${days} วัน)</span>`) : 'ตลอดชีพ'}</b>
      <span class="mut">สถานะ</span>${status}
      <span class="mut">เครื่องที่ใช้</span><b>${r.machine ? h(r.machine_name) : '<span class="mut">ยังไม่ได้ผูกเครื่อง</span>'}</b></div>
      ${pendO ? `<p class="msg">มีสลิปรอร้านตรวจ · <a href="/member/pay?o=${pendO.id}" style="color:var(--acc)">ดูสถานะ</a></p>` : ''}
      <div class="row">${r.machine ? `<form method="post" onsubmit="return confirm('ปลดคีย์จากเครื่องเดิม เพื่อใช้กับเครื่องใหม่?')"><button name="do" value="move" class="ghost" style="width:100%">ย้ายไปเครื่องใหม่</button></form>` : ''}
      <a class="btn ghost" href="/download">ดาวน์โหลดโปรแกรม</a></div></div>
    ${r.plan === 'life' || !r.plan ? '' : `<div class="card"><h2>${expired ? 'ต่ออายุเพื่อใช้งานต่อ' : 'ต่ออายุ / อัปเกรด'}</h2><div class="plans">${planCards('renew', r.key)}</div>
      <p class="small mut">ต่ออายุแล้วนับต่อจากวันหมดเดิม ไม่เสียวันที่เหลือ</p></div>`}
    <form method="post"><button name="do" value="logout" class="ghost sm">ออกจากระบบ</button></form>`);
}

// สลิปสำหรับแอดมินดู
async function adminSlip(req, env) {
  if (!(await validSession(env.DB, req))) return new Response('login required', { status: 401 });
  const o = await env.DB.prepare('SELECT slip, slip_type FROM orders WHERE id=?').bind(new URL(req.url).searchParams.get('o') || '').first();
  if (!o || !o.slip) return new Response('no slip', { status: 404 });
  return new Response(new Uint8Array(o.slip), { headers: { 'Content-Type': o.slip_type || 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      await init(env.DB);
      if (url.pathname === '/api') {
        if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
        return await api(req, env);
      }
      const rm = url.pathname.match(/^\/releases\/(SignTools-v\d+\.\d+\.\d+\.zip)$/);
      if (rm) {
        const r = await env.DB.prepare('SELECT zip FROM releases WHERE name=?').bind(rm[1]).first();
        if (!r) return new Response('not found', { status: 404 });
        return new Response(new Uint8Array(r.zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${rm[1]}"`, 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.pathname === '/admin') return await admin(req, env);
      if (url.pathname === '/admin/slip') return await adminSlip(req, env);
      if (url.pathname === '/member' || url.pathname.startsWith('/member/')) return await member(req, env);
      if (url.pathname === '/download' || url.pathname === '/download/') return await downloadPage(env, url);
      if (url.pathname === '/download/latest.zip') {
        const r = await env.DB.prepare('SELECT name, zip FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
        if (!r) return new Response('not found', { status: 404 });
        return new Response(new Uint8Array(r.zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${r.name}"`, 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/') return redirect('/download');
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.error(e);
      return url.pathname === '/api' ? json({ ok: false, code: 'server', error: 'เซิร์ฟเวอร์ผิดพลาด' }) : new Response('server error', { status: 500 });
    }
  },
};
