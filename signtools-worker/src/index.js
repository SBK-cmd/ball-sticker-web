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
  const sv = () => getSetting(db, 'schema_v').then((v) => parseInt(v || '1', 10));
  if ((await sv()) < 2) {
    for (const q of ['ALTER TABLE keys ADD COLUMN phone TEXT', 'ALTER TABLE keys ADD COLUMN plan TEXT', 'ALTER TABLE keys ADD COLUMN expires_at INTEGER']) {
      try { await db.prepare(q).run(); } catch (e) { /* มีอยู่แล้ว */ }
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS orders_ref ON orders(trans_ref)').run();
    await setSetting(db, 'schema_v', '2');
  }
  // v3: บัญชีเบอร์ + รหัสผ่าน (คีย์ยังอยู่เบื้องหลัง)
  if ((await sv()) < 3) {
    for (const q of ['ALTER TABLE keys ADD COLUMN pw_salt TEXT', 'ALTER TABLE keys ADD COLUMN pw_hash TEXT', 'ALTER TABLE orders ADD COLUMN pw_salt TEXT', 'ALTER TABLE orders ADD COLUMN pw_hash TEXT']) {
      try { await db.prepare(q).run(); } catch (e) { /* มีอยู่แล้ว */ }
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS keys_phone ON keys(phone)').run();
    await setSetting(db, 'schema_v', '3');
  }
  // v4: ผู้ใช้ 1 คน มีได้หลายคีย์/หลายเครื่อง
  if ((await sv()) < 4) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, name TEXT DEFAULT '', shop TEXT DEFAULT '',
      line TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', note TEXT DEFAULT '', pw_salt TEXT, pw_hash TEXT, pw_enc TEXT,
      status TEXT DEFAULT 'active', created_at INTEGER)`).run();
    for (const q of ['ALTER TABLE keys ADD COLUMN user_id INTEGER', 'ALTER TABLE orders ADD COLUMN user_id INTEGER']) { try { await db.prepare(q).run(); } catch (e) { /* มีแล้ว */ } }
    // ย้ายข้อมูลเดิม: คีย์ที่มีเบอร์ → ผู้ใช้ตามเบอร์ (รหัสผ่านเดิมย้ายไปด้วย)
    const old = (await db.prepare('SELECT * FROM keys WHERE phone IS NOT NULL AND user_id IS NULL ORDER BY (pw_hash IS NULL), created_at').all()).results;
    for (const k of old) {
      let u = await db.prepare('SELECT id, pw_hash FROM users WHERE phone=?').bind(k.phone).first();
      if (!u) {
        await db.prepare('INSERT INTO users (phone, name, pw_salt, pw_hash, created_at) VALUES (?,?,?,?,?)').bind(k.phone, k.note || '', k.pw_salt || null, k.pw_hash || null, k.created_at || now()).run();
        u = await db.prepare('SELECT id, pw_hash FROM users WHERE phone=?').bind(k.phone).first();
      } else if (!u.pw_hash && k.pw_hash) await db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').bind(k.pw_salt, k.pw_hash, u.id).run();
      await db.prepare('UPDATE keys SET user_id=? WHERE key=?').bind(u.id, k.key).run();
    }
    await db.prepare('CREATE INDEX IF NOT EXISTS keys_user ON keys(user_id)').run();
    await setSetting(db, 'schema_v', '4');
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
    let key = normKey(inp.key);
    const machine = String(inp.machine || ''), mname = String(inp.name || '').slice(0, 80);
    if (!/^[0-9a-f]{64}$/.test(machine)) return fail('bad_request', 'ข้อมูลเครื่องไม่ถูกต้อง');
    if (inp.phone !== undefined) {                       // เข้าด้วยเบอร์ + รหัสผ่าน → เลือกคีย์ของบัญชีที่ว่าง
      const phone = normPhone(inp.phone);
      if (!phone) return fail('bad_login', 'ใส่เบอร์มือถือ 10 หลัก');
      if (await tooMany(db, 'tel:' + phone)) return fail('locked', 'ใส่รหัสผิดหลายครั้ง — รอ 15 นาทีแล้วลองใหม่');
      const u = await userByPhone(db, phone);
      if (!u || !(await checkPw(u, inp.password))) { await log('tel:' + phone, 'activate', 'bad_pw'); return fail('bad_login', 'เบอร์หรือรหัสผ่านไม่ถูกต้อง'); }
      if (u.status !== 'active') return fail('revoked', 'บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้ขาย');
      const ks = (await db.prepare('SELECT * FROM keys WHERE user_id=? ORDER BY created_at').bind(u.id).all()).results;
      const live = ks.filter((k) => k.status === 'active' && !(k.expires_at && k.expires_at < now()));
      const pick = live.find((k) => k.machine === machine) || live.find((k) => !k.machine);
      if (!pick) {
        if (!ks.length) return fail('no_key', 'บัญชีนี้ยังไม่มีคีย์ — ติดต่อผู้ขาย หรือซื้อที่ ' + new URL(req.url).host + '/member');
        if (!live.length) return fail('expired', EXPIRED_MSG(req));
        return fail('in_use', `บัญชีนี้ใช้ครบ ${live.length} เครื่องแล้ว — ย้ายเครื่องได้ที่ ${new URL(req.url).host}/member หรือซื้อคีย์เพิ่ม`);
      }
      key = pick.key;
    }
    const r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
    if (!r) { await log(key, 'activate', 'not_found'); return fail('not_found', 'ไม่พบคีย์นี้ — ตรวจตัวสะกดอีกครั้ง'); }
    if (r.status !== 'active' || !(await userActive(db, r))) { await log(key, 'activate', 'revoked'); return fail('revoked', 'คีย์นี้ถูกระงับแล้ว — ติดต่อผู้ขาย'); }
    if (r.expires_at && r.expires_at < now()) { await log(key, 'activate', 'expired'); return fail('expired', EXPIRED_MSG(req)); }
    if (r.machine && r.machine !== machine) {
      await log(key, 'activate', 'in_use');
      return fail('in_use', `คีย์นี้ใช้กับเครื่องอื่นอยู่ (${r.machine_name}) — ยกเลิกที่เครื่องเดิมก่อน หรือติดต่อผู้ขาย`);
    }
    await db.prepare('UPDATE keys SET machine=?, machine_name=?, activated_at=COALESCE(activated_at,?), last_seen=? WHERE key=?')
      .bind(machine, mname, now(), now(), key).run();
    await log(key, 'activate', 'ok');
    const owner = r.user_id ? await db.prepare('SELECT phone FROM users WHERE id=?').bind(r.user_id).first() : null;
    return json({ ok: true, token: await makeToken(db, key, machine, r.expires_at), phone: (owner && owner.phone) || null });
  }
  if (action === 'member_link') {                         // ปุ่ม "หน้าสมาชิก" ในโปรแกรม → ลิงก์เข้าระบบอัตโนมัติ (ใช้ได้ 5 นาที)
    const t = await readToken(db, inp.token), base = new URL(req.url).origin + '/member';
    if (!t) { await log('', 'member_link', 'bad_token'); return json({ ok: true, url: base, why: 'bad_token' }); }
    const r = await db.prepare('SELECT user_id, machine FROM keys WHERE key=?').bind(t.k).first();
    const why = !r ? 'no_key' : !r.user_id ? 'no_user' : r.machine !== t.m ? 'machine' : '';
    await log(t.k, 'member_link', why || 'ok');
    if (why) return json({ ok: true, url: base, why });
    const p = b64u(enc.encode(JSON.stringify({ u: r.user_id, exp: now() + 300 })));
    const sig = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('ml:' + p))));
    return json({ ok: true, url: base + '/auto?t=' + p + '.' + sig });
  }
  if (action === 'refresh' || action === 'deactivate') {
    const t = await readToken(db, inp.token);
    if (!t) return fail('bad_token', 'ไลเซนส์ไม่ถูกต้อง');
    const r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(t.k).first();
    if (!r || r.status !== 'active' || (action === 'refresh' && !(await userActive(db, r)))) { await log(t.k, action, 'revoked'); return fail('revoked', 'คีย์นี้ถูกระงับแล้ว — ติดต่อผู้ขาย'); }
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
  const uid = parseInt(url.searchParams.get('u') || f('u') || '0', 10) || 0;
  if (form) {
    const d = f('do'), key = normKey(f('key'));
    let go = uid ? '/admin?u=' + uid : '/admin';
    const keyRow = key ? await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first() : null;
    if (d === 'create') {                                   // คีย์ลอย (แบบเดิม ไม่มีเจ้าของ)
      const n = Math.max(1, Math.min(200, parseInt(f('n'), 10) || 1)), plan = PLANS[f('plan')] ? f('plan') : 'life', ex = extendTo(null, plan);
      const st = db.prepare('INSERT INTO keys (key, note, created_at, plan, expires_at) VALUES (?,?,?,?,?)');
      for (let i = 0; i < n; i++) created.push(newKey());
      await db.batch(created.map((k) => st.bind(k, f('note'), now(), ex.plan, ex.expires_at)));
      msg = `สร้างคีย์ ${planLabel(plan)} ${n} อันแล้ว`;
    } else if (d === 'member') {                            // เพิ่มสมาชิก + คีย์แรก
      const phone = normPhone(f('phone')), plan = PLANS[f('plan')] ? f('plan') : 'life';
      if (!phone) err = 'ใส่เบอร์มือถือ 10 หลัก';
      else if (!pwOk(f('pw'))) err = 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว';
      else if (await userByPhone(db, phone)) err = `เบอร์ ${phone} มีบัญชีอยู่แล้ว`;
      else {
        const u = await createUser(db, { phone, name: f('name'), shop: f('shop'), pw: f('pw') });
        const n = Math.max(1, Math.min(20, parseInt(f('n'), 10) || 1));
        for (let i = 0; i < n; i++) await addKey(db, u.id, plan);
        msg = `เพิ่มสมาชิก ${f('name') || phone} · ${n} เครื่อง (${planLabel(plan)}) แล้ว`; go = '/admin?u=' + u.id;
      }
    } else if (d === 'user_save' && uid) {
      const phone = normPhone(f('phone')), other = phone ? await db.prepare('SELECT id FROM users WHERE phone=? AND id!=?').bind(phone, uid).first() : null;
      if (!phone) err = 'เบอร์ไม่ถูกต้อง';
      else if (other) err = `เบอร์ ${phone} เป็นของสมาชิกคนอื่นอยู่แล้ว`;
      else { await db.prepare('UPDATE users SET phone=?, name=?, shop=?, line=?, email=?, address=?, note=? WHERE id=?').bind(phone, f('name'), f('shop'), f('line'), f('email'), f('address'), f('note'), uid).run(); msg = 'บันทึกข้อมูลสมาชิกแล้ว'; }
    } else if (d === 'user_pw' && uid) {
      if (!pwOk(f('pw'))) err = 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว'; else { await setUserPw(db, uid, f('pw')); msg = 'ตั้งรหัสผ่านใหม่แล้ว'; }
    } else if (d === 'user_status' && uid) {
      const u = await db.prepare('SELECT status FROM users WHERE id=?').bind(uid).first(), ns = u && u.status === 'active' ? 'disabled' : 'active';
      await db.prepare('UPDATE users SET status=? WHERE id=?').bind(ns, uid).run(); msg = ns === 'active' ? 'เปิดใช้งานบัญชีแล้ว' : 'ปิดบัญชีแล้ว — ทุกเครื่องของสมาชิกนี้จะใช้ไม่ได้ภายใน 3 วัน';
    } else if (d === 'user_delete' && uid) {
      await db.batch([db.prepare('DELETE FROM keys WHERE user_id=?').bind(uid), db.prepare('DELETE FROM users WHERE id=?').bind(uid)]);
      msg = 'ลบสมาชิกและคีย์ทั้งหมดของสมาชิกนี้แล้ว'; go = '/admin';
    } else if (d === 'key_add' && uid) {
      const plan = PLANS[f('plan')] ? f('plan') : 'life', n = Math.max(1, Math.min(20, parseInt(f('n'), 10) || 1));
      for (let i = 0; i < n; i++) await addKey(db, uid, plan, f('note'));
      msg = `เพิ่ม ${n} เครื่อง (${planLabel(plan)}) แล้ว`;
    } else if (keyRow && d === 'extend') {
      const plan = PLANS[f('plan')] ? f('plan') : 'month', ex = extendTo(keyRow, plan);
      await db.prepare('UPDATE keys SET plan=?, expires_at=? WHERE key=?').bind(ex.plan, ex.expires_at, key).run();
      msg = plan === 'life' ? 'เปลี่ยนเป็นตลอดชีพแล้ว' : `ต่ออายุถึง ${dtD(ex.expires_at)} แล้ว`;
    } else if (keyRow && d === 'until') {
      const t = Date.parse(f('date') + 'T23:59:59+07:00');
      if (!t) err = 'เลือกวันที่ก่อน';
      else { await db.prepare("UPDATE keys SET plan=CASE WHEN plan='life' OR plan IS NULL THEN 'month' ELSE plan END, expires_at=? WHERE key=?").bind(Math.floor(t / 1000), key).run(); msg = `ตั้งวันหมดอายุเป็น ${dtD(Math.floor(t / 1000))} แล้ว`; }
    } else if (keyRow && d === 'toggle') {
      const ns = keyRow.status === 'active' ? 'revoked' : 'active';
      await db.prepare('UPDATE keys SET status=? WHERE key=?').bind(ns, key).run(); msg = ns === 'active' ? `เปิดใช้ ${key} แล้ว` : `ปิด ${key} แล้ว`;
    } else if (keyRow && d === 'key_delete') { await db.prepare('DELETE FROM keys WHERE key=?').bind(key).run(); msg = `ลบ ${key} แล้ว`; }
    else if (keyRow && d === 'reset') { await db.prepare('UPDATE keys SET machine=NULL, machine_name=NULL, moves=moves+1 WHERE key=?').bind(key).run(); msg = 'ปลดเครื่องแล้ว — ใช้กับเครื่องใหม่ได้เลย'; }
    else if (keyRow && d === 'note') { await db.prepare('UPDATE keys SET note=? WHERE key=?').bind(f('note'), key).run(); msg = 'บันทึกโน้ตแล้ว'; }
    else if (keyRow && d === 'assign') {
      const phone = normPhone(f('phone'));
      if (!phone) err = 'ใส่เบอร์สมาชิก';
      else { let u = await userByPhone(db, phone); if (!u) u = await createUser(db, { phone, name: keyRow.note || '' });
        await db.prepare('UPDATE keys SET user_id=? WHERE key=?').bind(u.id, key).run(); msg = `ย้ายคีย์ไปที่สมาชิก ${u.name || phone} แล้ว`; go = '/admin?u=' + u.id; }
    } else if (d === 'settings') {
      for (const k of ['price_month', 'price_year', 'price_life', 'pp_id', 'pp_name', 'contact']) await setSetting(db, k, f(k).trim());
      msg = 'บันทึกการตั้งค่าร้านแล้ว';
    } else if (d === 'approve' || d === 'reject') {
      const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(f('o')).first();
      if (o && o.status === 'pending') {
        if (d === 'approve') { await fulfill(db, o); msg = 'อนุมัติแล้ว'; }
        else { await db.prepare("UPDATE orders SET status='rejected', reason=?, decided_at=? WHERE id=?").bind(f('reason') || 'ร้านตรวจแล้วไม่ผ่าน', now(), o.id).run(); msg = 'ปฏิเสธรายการแล้ว'; }
      }
    } else if (d === 'release') {
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
          const manifest = JSON.stringify({ version: ver, url: `${url.origin}/releases/${name}`, sha256: sha, size: buf.length, notes: f('notes'), date: new Date().toISOString().slice(0, 10) });
          const sig = b64(await sign(db, enc.encode(manifest)));
          await db.prepare('INSERT OR REPLACE INTO releases VALUES (?,?,?,?,?,?,?,?,?)').bind(ver, name, buf, sha, buf.length, f('notes'), manifest, sig, now()).run();
          msg = `ปล่อยเวอร์ชัน ${ver} แล้ว — ลูกค้าจะเห็นปุ่มอัปเดตเมื่อเปิดแผงครั้งถัดไป`;
        }
      }
    }
    if (!created.length && !err) return redirect(go + (msg ? (go.includes('?') ? '&' : '?') + 'm=' + encodeURIComponent(msg) : ''));
  }
  if (!msg) msg = url.searchParams.get('m') || '';
  const dt = (t) => t ? new Date(t * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const hid = (n, v) => `<input type="hidden" name="${n}" value="${h(v)}">`;
  const uIn = uid ? hid('u', uid) : '';
  const btn = (k, d, label, cls, conf) => `<form method="post">${uIn}${hid('key', k)}<button name="do" value="${d}" class="${cls} sm"${conf ? ` onclick="return confirm('${conf}')"` : ''}>${label}</button></form>`;
  const ymd = (t) => t ? new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10) : '';
  const expTag = (r) => r.plan === 'life' || !r.plan || !r.expires_at ? '<span class="tag on">ตลอดชีพ</span>'
    : r.expires_at < now() ? `<span class="tag off">หมด ${dtD(r.expires_at)}</span>` : `<span class="tag ${r.expires_at - now() < 7 * 86400 ? 'warn' : 'on'}">ถึง ${dtD(r.expires_at)} · อีก ${Math.ceil((r.expires_at - now()) / 86400)} วัน</span>`;
  const keyRows = (rows, owned) => rows.map((r) => `<tr class="${r.status !== 'active' ? 'rev' : ''}"><td class="mono">${h(r.key)}<br>
      <form method="post" class="inl">${uIn}${hid('key', r.key)}<input name="note" value="${h(r.note)}" placeholder="โน้ต"><button name="do" value="note" class="ghost sm">บันทึก</button></form></td>
    <td>${r.machine ? h(r.machine_name) + `<br><span class="mut small">ล่าสุด ${dt(r.last_seen)}</span>` : '<span class="mut">ยังไม่ผูกเครื่อง</span>'}${r.moves ? ` <span class="mut small">(ย้าย ${r.moves})</span>` : ''}</td>
    <td>${planLabel(r.plan)}<br>${expTag(r)}</td>
    <td><form method="post" class="inl">${uIn}${hid('key', r.key)}<select name="plan" class="sm"><option value="month">+30 วัน</option><option value="year">+1 ปี</option><option value="life">ตลอดชีพ</option></select><button name="do" value="extend" class="sm">เพิ่มเวลา</button></form>
      <form method="post" class="inl" style="margin-top:4px">${uIn}${hid('key', r.key)}<input type="date" name="date" value="${ymd(r.expires_at)}" class="sm"><button name="do" value="until" class="ghost sm">ตั้งวันหมด</button></form></td>
    <td>${r.status === 'active' ? '<span class="tag on">เปิด</span>' : '<span class="tag off">ปิด</span>'}</td>
    <td class="act">${btn(r.key, 'toggle', r.status === 'active' ? 'ปิด' : 'เปิด', r.status === 'active' ? 'ghost' : '', '')}${r.machine ? btn(r.key, 'reset', 'ปลดเครื่อง', 'ghost', 'ปลดเครื่องของคีย์นี้?') : ''}${btn(r.key, 'key_delete', 'ลบ', 'danger', 'ลบคีย์นี้ถาวร?')}
      ${owned ? '' : `<form method="post" class="inl">${hid('key', r.key)}<input name="phone" placeholder="เบอร์สมาชิก" style="min-width:100px" inputmode="tel"><button name="do" value="assign" class="ghost sm">ย้ายให้สมาชิก</button></form>`}</td></tr>`).join('');
  const keyHead = '<tr><th>คีย์ / โน้ต</th><th>เครื่อง</th><th>แพ็กเกจ / หมดอายุ</th><th>เพิ่มเวลาใช้งาน</th><th>สถานะ</th><th></th></tr>';
  const head = `<header><h1><a href="/admin" style="color:inherit;text-decoration:none">Sign Tools <small>แอดมิน</small></a></h1><form method="post"><button name="do" value="logout" class="ghost">ออกจากระบบ</button></form></header>
${msg ? `<p class="ok">${h(msg)}</p>` : ''}${err ? `<p class="err">${h(err)}</p>` : ''}`;

  // ----- หน้ารายละเอียดสมาชิก -----
  if (uid) {
    const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!u) return redirect('/admin?m=' + encodeURIComponent('ไม่พบสมาชิก'));
    const ks = (await db.prepare('SELECT * FROM keys WHERE user_id=? ORDER BY created_at').bind(uid).all()).results;
    const os = (await db.prepare("SELECT kind, plan, amount, status, created_at FROM orders WHERE user_id=? AND status IN ('paid','pending','rejected') ORDER BY created_at DESC LIMIT 20").bind(uid).all()).results;
    const pw = u.pw_enc ? await decPw(db, u.pw_enc) : null;
    return page((u.name || u.phone) + ' · สมาชิก', `${head}
<p><a href="/admin" class="mut">‹ สมาชิกทั้งหมด</a></p>
<div class="card"><div class="bar"><h2>${h(u.name || '(ไม่มีชื่อ)')} <small>${h(u.phone)}${u.shop ? ' · ' + h(u.shop) : ''}</small></h2>
  <div class="act">${u.status === 'active' ? '<span class="tag on">บัญชีเปิดอยู่</span>' : '<span class="tag off">บัญชีปิดอยู่</span>'}
  <form method="post">${uIn}<button name="do" value="user_status" class="ghost sm">${u.status === 'active' ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button></form>
  <form method="post">${uIn}<button name="do" value="user_delete" class="danger sm" onclick="return confirm('ลบสมาชิกนี้และคีย์ทั้งหมดถาวร?')">ลบสมาชิก</button></form></div></div>
  <p class="mut small">สมัครเมื่อ ${dt(u.created_at)} · ${ks.length} เครื่อง</p></div>
<div class="grid2">
<form method="post" class="card"><h3>ข้อมูลสมาชิก</h3>${uIn}
  <div class="grid2 in"><label>ชื่อ<input name="name" value="${h(u.name)}"></label><label>เบอร์ (ใช้ล็อกอิน)<input name="phone" value="${h(u.phone)}" inputmode="tel"></label>
  <label>ชื่อร้าน<input name="shop" value="${h(u.shop)}"></label><label>LINE ID<input name="line" value="${h(u.line)}"></label>
  <label>อีเมล<input name="email" value="${h(u.email)}"></label><label>โน้ต (เห็นเฉพาะแอดมิน)<input name="note" value="${h(u.note)}"></label></div>
  <label>ที่อยู่<textarea name="address" rows="2">${h(u.address)}</textarea></label><button name="do" value="user_save">บันทึกข้อมูล</button></form>
<form method="post" class="card"><h3>รหัสผ่าน</h3>${uIn}
  ${pw ? `<details><summary class="mut">แสดงรหัสผ่าน</summary><p class="pw mono">${h(pw)}</p></details>` : `<p class="mut small">${u.pw_hash ? 'รหัสนี้ตั้งก่อนระบบแสดงรหัส — ตั้งใหม่เพื่อให้ดูได้' : 'ยังไม่มีรหัสผ่าน'}</p>`}
  <label>ตั้งรหัสใหม่ (6 ตัวขึ้นไป)<input name="pw" autocomplete="off"></label><button name="do" value="user_pw" class="ghost">ตั้งรหัสผ่าน</button></form>
</div>
<div class="card"><div class="bar"><h3>คีย์ / เครื่อง <small>${ks.length} อัน · 1 คีย์ = 1 เครื่อง</small></h3>
  <form method="post" class="inl">${uIn}<input name="n" type="number" value="1" min="1" max="20" style="width:64px;min-width:0"><select name="plan"><option value="life">ตลอดชีพ</option><option value="year">รายปี</option><option value="month">รายเดือน</option></select><button name="do" value="key_add" class="sm" style="white-space:nowrap">+ เพิ่มเครื่อง</button></form></div>
  <div class="tw"><table>${keyHead}${keyRows(ks, true) || '<tr><td colspan="6" class="mut">ยังไม่มีคีย์ — กด "+ เพิ่มเครื่อง"</td></tr>'}</table></div></div>
${os.length ? `<div class="card"><h3>ประวัติการชำระเงิน</h3><div class="tw"><table><tr><th>เวลา</th><th>รายการ</th><th>ยอด</th><th>สถานะ</th></tr>${os.map((o) => `<tr><td>${dt(o.created_at)}</td><td>${o.kind === 'renew' ? 'ต่ออายุ' : o.kind === 'add' ? 'เพิ่มเครื่อง' : 'สมัคร'} · ${planLabel(o.plan)}</td><td>${o.amount}</td><td>${o.status === 'paid' ? '<span class="tag on">ชำระแล้ว</span>' : o.status === 'pending' ? '<span class="tag warn">รอตรวจ</span>' : '<span class="tag off">ปฏิเสธ</span>'}</td></tr>`).join('')}</table></div></div>` : ''}`);
  }

  // ----- หน้าหลัก -----
  const q = (url.searchParams.get('q') || '').trim(), like = `%${q}%`;
  const users = (await db.prepare(`SELECT u.*, COUNT(k.key) nk, SUM(k.machine IS NOT NULL) nm,
      MIN(CASE WHEN k.plan!='life' AND k.expires_at IS NOT NULL THEN k.expires_at END) nexp, SUM(k.plan='life' OR k.plan IS NULL OR k.expires_at IS NULL) nlife
    FROM users u LEFT JOIN keys k ON k.user_id=u.id ${q ? 'WHERE u.name LIKE ?1 OR u.phone LIKE ?1 OR u.shop LIKE ?1 OR k.key LIKE ?1' : ''}
    GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`).bind(...(q ? [like] : [])).all()).results;
  const loose = (await db.prepare(`SELECT * FROM keys WHERE user_id IS NULL ${q ? 'AND (key LIKE ?1 OR note LIKE ?1 OR machine_name LIKE ?1)' : ''} ORDER BY created_at DESC LIMIT 300`).bind(...(q ? [like] : [])).all()).results;
  const latest = await db.prepare('SELECT version, created_at FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
  const pub = (await keys(db)).pub;
  const pend = (await db.prepare("SELECT o.id, o.kind, o.key, o.phone, o.plan, o.amount, o.reason, o.created_at, u.name FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.status='pending' ORDER BY o.created_at DESC LIMIT 50").all()).results;
  const recent = (await db.prepare("SELECT o.kind, o.phone, o.plan, o.amount, o.status, o.created_at, o.user_id, u.name FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.status IN ('paid','rejected') ORDER BY o.created_at DESC LIMIT 15").all()).results;
  const S = {}; for (const k of ['price_month', 'price_year', 'price_life', 'pp_id', 'pp_name', 'contact']) S[k] = (await getSetting(db, k)) || '';
  const kindTxt = (k) => k === 'renew' ? 'ต่ออายุ' : k === 'add' ? 'เพิ่มเครื่อง' : 'สมัครใหม่';
  const uExp = (u) => !u.nk ? '<span class="mut">ไม่มีคีย์</span>' : u.nexp ? (u.nexp < now() ? `<span class="tag off">หมด ${dtD(u.nexp)}</span>` : `<span class="tag ${u.nexp - now() < 7 * 86400 ? 'warn' : 'on'}">ใกล้สุด ${dtD(u.nexp)}</span>`) : '<span class="tag on">ตลอดชีพ</span>';

  return page('Sign Tools — แอดมิน', `${head}
${created.length ? `<div class="card"><h3>คีย์ใหม่ (ก็อปส่งให้ลูกค้า)</h3><textarea rows="${Math.min(10, created.length)}" readonly onclick="this.select()">${h(created.join('\n'))}</textarea></div>` : ''}
${pend.length ? `<div class="card hl"><h3>รอตรวจสลิป <small>${pend.length} รายการ</small></h3><div class="tw"><table><tr><th>เวลา</th><th>สมาชิก</th><th>รายการ</th><th>ยอด</th><th>เหตุผลที่ไม่ผ่านอัตโนมัติ</th><th>สลิป</th><th></th></tr>
  ${pend.map((o) => `<tr><td>${dt(o.created_at)}</td><td>${h(o.name || '')} ${h(o.phone || '')}</td><td>${kindTxt(o.kind)} · ${planLabel(o.plan)}</td><td>${o.amount}</td><td class="wrap">${h(o.reason || '-')}</td>
    <td><a href="/admin/slip?o=${h(o.id)}" target="_blank">ดูสลิป</a></td>
    <td class="act"><form method="post">${hid('o', o.id)}<button name="do" value="approve" class="sm">อนุมัติ</button></form>
    <form method="post">${hid('o', o.id)}<button name="do" value="reject" class="danger sm" onclick="return confirm('ปฏิเสธรายการนี้?')">ปฏิเสธ</button></form></td></tr>`).join('')}</table></div></div>` : ''}
<form method="post" class="card hlg"><h3>เพิ่มสมาชิก <small>ลูกค้าเข้าโปรแกรมด้วยเบอร์ + รหัสผ่าน</small></h3><input type="hidden" name="do" value="member">
  <div class="grid3"><label>ชื่อลูกค้า<input name="name"></label><label>เบอร์มือถือ<input name="phone" inputmode="tel" required></label><label>รหัสผ่าน (6 ตัวขึ้นไป)<input name="pw" required autocomplete="off"></label></div>
  <div class="grid3"><label>ชื่อร้าน<input name="shop"></label><label>แพ็กเกจ<select name="plan"><option value="life">ตลอดชีพ</option><option value="year">รายปี (365 วัน)</option><option value="month">รายเดือน (30 วัน)</option></select></label>
  <label>จำนวนเครื่อง<input name="n" type="number" value="1" min="1" max="20"></label></div><button>เพิ่มสมาชิก</button></form>
<div class="card">
  <div class="bar"><h3>สมาชิก <small>${users.length} คน</small></h3><form class="srch"><input name="q" value="${h(q)}" placeholder="ค้นหาชื่อ / เบอร์ / ร้าน / คีย์"></form></div>
  <div class="tw"><table><tr><th>ชื่อ</th><th>เบอร์</th><th>ร้าน</th><th>เครื่อง</th><th>หมดอายุ</th><th>บัญชี</th></tr>
  ${users.map((u) => `<tr class="click ${u.status !== 'active' ? 'rev' : ''}" onclick="location='/admin?u=${u.id}'"><td><a href="/admin?u=${u.id}"><b>${h(u.name || '(ไม่มีชื่อ)')}</b></a></td><td>${h(u.phone)}</td><td>${h(u.shop)}</td>
    <td>${u.nm || 0} / ${u.nk || 0}</td><td>${uExp(u)}</td><td>${u.status === 'active' ? '<span class="tag on">เปิด</span>' : '<span class="tag off">ปิด</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="mut">ยังไม่มีสมาชิก</td></tr>'}</table></div>
  <p class="mut small">เครื่อง = ใช้อยู่ / ทั้งหมด · คลิกที่ชื่อเพื่อดูรายละเอียด แก้ข้อมูล รหัสผ่าน และจัดการคีย์</p></div>
${loose.length ? `<details class="card"><summary><b>คีย์ที่ยังไม่มีเจ้าของ</b> <small class="mut">${loose.length} อัน · ใส่เบอร์แล้วกด "ย้ายให้สมาชิก"</small></summary>
  <div class="tw"><table>${keyHead}${keyRows(loose, false)}</table></div></details>` : ''}
<form method="post" class="card"><h3>ตั้งค่าร้าน (หน้าสมาชิก /member)</h3><input type="hidden" name="do" value="settings">
  <div class="grid3"><label>ราคารายเดือน (บาท · ว่าง = ไม่ขาย)<input name="price_month" inputmode="decimal" value="${h(S.price_month)}"></label>
  <label>ราคารายปี<input name="price_year" inputmode="decimal" value="${h(S.price_year)}"></label><label>ราคาตลอดชีพ<input name="price_life" inputmode="decimal" value="${h(S.price_life)}"></label></div>
  <div class="grid3"><label>พร้อมเพย์รับเงิน (เบอร์ / เลขบัตร)<input name="pp_id" value="${h(S.pp_id)}"></label><label>ชื่อบัญชี (แสดงให้ลูกค้าเห็น)<input name="pp_name" value="${h(S.pp_name)}"></label>
  <label>ช่องทางติดต่อ<input name="contact" value="${h(S.contact)}" placeholder="LINE @ballsticker / 08x-xxx-xxxx"></label></div>
  <p class="mut small">ตรวจสลิปอัตโนมัติ: ${env.EASYSLIP_KEY ? '<b style="color:#9ff0ae">เปิดอยู่ (EasySlip)</b>' : '<b>ปิด</b> — ทุกสลิปรอคุณอนุมัติ · เปิดได้โดยใส่ Secret ชื่อ <code>EASYSLIP_KEY</code> ใน Cloudflare › Workers › signtools › Settings › Variables'}</p><button>บันทึก</button></form>
<div class="grid2">
  <form method="post" enctype="multipart/form-data" class="card"><h3>ปล่อยอัปเดต</h3>
    <p class="mut">เวอร์ชันล่าสุด: <b>${latest ? h(latest.version) + '</b> (' + dt(latest.created_at) + ')' : 'ยังไม่มี</b>'}</p>
    <input type="hidden" name="do" value="release"><label>เวอร์ชัน<input name="version" placeholder="1.2.0" required></label>
    <label>มีอะไรใหม่<textarea name="notes" rows="2"></textarea></label>
    <label>ไฟล์ SignTools-vX.zip<input name="zip" type="file" accept=".zip" required></label><button>อัปโหลด + ปล่อย</button></form>
  <form method="post" class="card"><h3>สร้างคีย์ลอย <small>(แบบเดิม ไม่ผูกสมาชิก)</small></h3><input type="hidden" name="do" value="create">
    <label>จำนวน<input name="n" type="number" value="1" min="1" max="200"></label>
    <label>แพ็กเกจ<select name="plan"><option value="life">ตลอดชีพ</option><option value="year">รายปี</option><option value="month">รายเดือน</option></select></label>
    <label>โน้ต<input name="note"></label><button>สร้าง</button></form>
</div>
${recent.length ? `<div class="card"><h3>รายการชำระเงินล่าสุด</h3><div class="tw"><table><tr><th>เวลา</th><th>สมาชิก</th><th>รายการ</th><th>ยอด</th><th>สถานะ</th></tr>
  ${recent.map((o) => `<tr><td>${dt(o.created_at)}</td><td>${o.user_id ? `<a href="/admin?u=${o.user_id}">${h(o.name || o.phone)}</a>` : h(o.phone)}</td><td>${kindTxt(o.kind)} · ${planLabel(o.plan)}</td><td>${o.amount}</td>
    <td>${o.status === 'paid' ? '<span class="tag on">ชำระแล้ว</span>' : '<span class="tag off">ปฏิเสธ</span>'}</td></tr>`).join('')}</table></div></div>` : ''}
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
label{display:flex;flex-direction:column;gap:4px;color:var(--mut);font-size:12.5px}[hidden]{display:none!important}
input,textarea{background:var(--in);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;width:100%}
button{background:var(--acc);color:#0d1f10;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer}
.ghost{background:var(--in);color:var(--tx);border:1px solid var(--line)}.danger{background:#5a2026;color:#ffb3b8}.sm{padding:4px 9px;font-size:12px;font-weight:600}
h2,h3{margin:0}.mut{color:var(--mut)}.small{font-size:12px}.ok{background:#1d3a24;color:#9ff0ae;padding:10px;border-radius:8px}.err{background:#3d1d21;color:#ffb3b8;padding:10px;border-radius:8px}
.bar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.bar form.srch{width:260px}code{word-break:break-all}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-weight:500}
.mono{font-family:Consolas,Menlo,monospace}tr.rev td{opacity:.5}.inl{display:flex;gap:4px}.inl input{padding:4px 6px;min-width:140px}.act{display:flex;gap:4px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}@media(max-width:720px){.grid3{grid-template-columns:1fr}}
select{background:var(--in);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit}select.sm{padding:3px 4px;font-size:12px}
.hl{border:1px solid #c9a227}.hlg{border:1px solid #2f6b45}.tag.warn{background:#4a3b12;color:#ffd979}tr.click{cursor:pointer}tr.click:hover td{background:#2a2a30}a{color:#cfe8ff}.grid2.in{gap:10px}.grid2.in label{margin:0}.pw{font-size:18px;background:var(--in);padding:8px 12px;border-radius:8px;margin:6px 0 0;user-select:all}details summary{cursor:pointer}.exp{color:#ff8d95}td.wrap{white-space:normal;max-width:260px}
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

// ----- รหัสผ่านสมาชิก -----
async function hashPw(pw) { const salt = b64(crypto.getRandomValues(new Uint8Array(16))); return { salt, hash: await pbkdf2('m:' + pw, salt) }; }
async function checkPw(row, pw) { if (!row || !row.pw_hash || !row.pw_salt) return false; return timingSafeEq(row.pw_hash, await pbkdf2('m:' + String(pw || ''), row.pw_salt)); }
const pwOk = (pw) => String(pw || '').length >= 6;
async function tooMany(db, who) {     // กันเดารหัส: ผิดเกิน 8 ครั้งใน 15 นาที
  const r = await db.prepare("SELECT COUNT(*) n FROM log WHERE key=? AND result='bad_pw' AND t>?").bind(who, now() - 900).first();
  return (r && r.n) >= 8;
}
async function userByPhone(db, phone) { return phone ? db.prepare('SELECT * FROM users WHERE phone=?').bind(phone).first() : null; }
async function userActive(db, keyRow) { if (!keyRow.user_id) return true; const u = await db.prepare('SELECT status FROM users WHERE id=?').bind(keyRow.user_id).first(); return !u || u.status === 'active'; }
// รหัสผ่าน: เก็บแบบ hash (ไว้ตรวจ) + เข้ารหัส AES (ให้แอดมินเปิดดูได้)
async function encKey(db) {
  let k = await getSetting(db, 'pw_enc_key');
  if (!k) { k = b64(crypto.getRandomValues(new Uint8Array(32))); await setSetting(db, 'pw_enc_key', k); }
  return crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encPw(db, pw) { const iv = crypto.getRandomValues(new Uint8Array(12)); return b64(iv) + '.' + b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encKey(db), enc.encode(pw)))); }
async function decPw(db, s) { try { const [i, c] = String(s || '').split('.'); return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(i) }, await encKey(db), unb64(c))); } catch { return null; } }
async function setUserPw(db, id, pw) { const x = await hashPw(pw); await db.prepare('UPDATE users SET pw_salt=?, pw_hash=?, pw_enc=? WHERE id=?').bind(x.salt, x.hash, await encPw(db, pw), id).run(); }
async function createUser(db, o) {
  await db.prepare('INSERT INTO users (phone, name, shop, line, email, note, created_at) VALUES (?,?,?,?,?,?,?)').bind(o.phone, o.name || '', o.shop || '', o.line || '', o.email || '', o.note || '', now()).run();
  const u = await db.prepare('SELECT * FROM users WHERE phone=?').bind(o.phone).first();
  if (o.pw) await setUserPw(db, u.id, o.pw);
  return u;
}
async function addKey(db, userId, plan, note) {
  const k = newKey(), ex = extendTo(null, plan);
  await db.prepare('INSERT INTO keys (key, note, created_at, plan, expires_at, user_id) VALUES (?,?,?,?,?,?)').bind(k, note || '', now(), ex.plan, ex.expires_at, userId).run();
  return k;
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

// ส่งมอบ: new = สร้างบัญชี + คีย์ · add = คีย์ใหม่ให้บัญชี · renew = ขยายวันหมดอายุ
async function fulfill(db, o) {
  let key = o.key, userId = o.user_id;
  if (o.kind === 'new') {
    let u = await userByPhone(db, o.phone);
    if (!u) {
      await db.prepare('INSERT INTO users (phone, pw_salt, pw_hash, pw_enc, created_at) VALUES (?,?,?,?,?)').bind(o.phone, o.pw_salt, o.pw_hash, o.verify && o.verify.indexOf('pwenc:') === 0 ? o.verify.slice(6) : null, now()).run();
      u = await userByPhone(db, o.phone);
    }
    userId = u.id; key = await addKey(db, userId, o.plan, 'ซื้อออนไลน์');
  } else if (o.kind === 'add') key = await addKey(db, userId, o.plan, 'ซื้อเพิ่มออนไลน์');
  else {
    const row = await db.prepare('SELECT * FROM keys WHERE key=?').bind(key).first();
    const ex = extendTo(row, o.plan);
    await db.prepare('UPDATE keys SET plan=?, expires_at=? WHERE key=?').bind(ex.plan, ex.expires_at, key).run();
  }
  await db.prepare("UPDATE orders SET status='paid', key=?, user_id=?, decided_at=?, verify=NULL WHERE id=?").bind(key, userId, now(), o.id).run();
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
const mlog = (db, req, who, res) => db.prepare('INSERT INTO log VALUES (?,?,?,?,?)').bind(now(), req.headers.get('CF-Connecting-IP') || '', who, 'member_auto', res + ' ' + String(req.headers.get('User-Agent') || '').slice(0, 120)).run();
async function memSession(db, userId) {
  const p = b64u(enc.encode(JSON.stringify({ u: userId, exp: now() + 7 * 86400 })));
  return p + '.' + b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('m:' + p))));
}
async function memUser(db, req) {
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)st_mem=([^;]+)/);
  if (!m) return null;
  const [p, sig] = m[1].split('.');
  if (!p || !sig) return null;
  const want = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('m:' + p))));
  if (!timingSafeEq(want, sig)) return null;
  try { const o = JSON.parse(dec.decode(unb64u(p))); return o.exp > now() && o.u ? o.u : null; } catch { return null; }
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
[hidden]{display:none!important}
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
  const uid = await memUser(db, req);
  const planCards = (kind, key, btnTxt) => Object.keys(PLANS).filter((p) => P[p]).map((p) => `<form method="post" action="/member/order" class="plan">
      <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="plan" value="${p}">${key ? `<input type="hidden" name="key" value="${h(key)}">` : ''}
      <b>${planLabel(p)}</b><span class="p">฿${P[p].toLocaleString('th-TH')}</span><span class="mut small">${p === 'life' ? 'จ่ายครั้งเดียว ใช้ได้ตลอด' : p === 'year' ? '365 วัน' : '30 วัน'}</span>
      <button class="sm">${btnTxt}</button></form>`).join('') || '<p class="mut">ยังไม่เปิดขายออนไลน์ — ติดต่อ ' + h(contact) + '</p>';

  // ----- เข้าระบบอัตโนมัติจากโปรแกรม -----
  if (path === '/member/auto') {
    const [p, sig] = String(url.searchParams.get('t') || '').split('.');
    if (p && sig) {
      const want = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(db), enc.encode('ml:' + p))));
      if (timingSafeEq(want, sig)) {
        try { const o = JSON.parse(dec.decode(unb64u(p))); if (o.exp > now() && o.u) { await mlog(db, req, 'u' + o.u, 'ok'); return redirect('/member', { 'Set-Cookie': memCookie(await memSession(db, o.u), 7 * 86400) }); } await mlog(db, req, 'u' + o.u, 'expired'); } catch (e) {}
      } else await mlog(db, req, '', 'bad_sig');
    } else await mlog(db, req, '', 'no_t');
    return redirect('/member');
  }

  // ----- สร้างรายการชำระเงิน: new = สมัคร · add = เพิ่มเครื่อง · renew = ต่ออายุคีย์ -----
  if (path === '/member/order' && form) {
    const plan = PLANS[f('plan')] && P[f('plan')] ? f('plan') : null, kind = ['new', 'add', 'renew'].includes(f('kind')) ? f('kind') : 'new';
    if (!plan) return redirect('/member');
    let key = null, phone = normPhone(f('phone')), userId = null, pw = { salt: null, hash: null }, pwEnc = null;
    if (kind === 'renew' || kind === 'add') {
      if (!uid) return redirect('/member');
      const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(uid).first(); if (!u) return redirect('/member');
      userId = u.id; phone = u.phone;
      if (kind === 'renew') { const k = await db.prepare('SELECT key FROM keys WHERE key=? AND user_id=?').bind(normKey(f('key')), uid).first(); if (!k) return redirect('/member'); key = k.key; }
    } else {
      const back = (t) => mPage('สมัครสมาชิก', `<div class="card"><p class="msg bad">${t}</p><a class="btn ghost" href="/member/buy">ย้อนกลับ</a></div>`);
      if (!phone) return back('ใส่เบอร์มือถือ 10 หลักให้ถูกต้อง');
      if (!pwOk(f('pw'))) return back('ตั้งรหัสผ่านอย่างน้อย 6 ตัว');
      if (await userByPhone(db, phone)) return back('เบอร์นี้เป็นสมาชิกอยู่แล้ว — <a href="/member" style="color:var(--acc)">เข้าสู่ระบบ</a> แล้วซื้อ/ต่ออายุได้เลย');
      pw = await hashPw(f('pw')); pwEnc = await encPw(db, f('pw'));
    }
    const id = rid();
    await db.prepare("INSERT INTO orders (id, kind, key, phone, plan, amount, status, created_at, pw_salt, pw_hash, user_id, verify) VALUES (?,?,?,?,?,?,'new',?,?,?,?,?)")
      .bind(id, kind, key, phone, plan, P[plan], now(), pw.salt, pw.hash, userId, pwEnc ? 'pwenc:' + pwEnc : null).run();
    return redirect('/member/pay?o=' + id);
  }

  // ----- หน้าชำระเงิน + อัปโหลดสลิป -----
  if (path === '/member/pay') {
    const id = (url.searchParams.get('o') || f('o')).replace(/[^0-9a-f]/g, '');
    const load = () => db.prepare('SELECT id, kind, key, phone, plan, amount, status, reason, user_id FROM orders WHERE id=?').bind(id).first();
    let o = id ? await load() : null;
    if (!o) return mPage('ไม่พบรายการ', `<div class="card"><p>ไม่พบรายการชำระเงินนี้</p><a class="btn" href="/member">กลับหน้าสมาชิก</a></div>`);
    let note = '';
    if (form && (o.status === 'new' || o.status === 'retry')) {
      const file = form.get('slip');
      if (!file || typeof file === 'string' || !file.size) note = '<p class="msg bad">ยังไม่ได้เลือกรูปสลิป</p>';
      else if (file.size > 1500000) note = '<p class="msg bad">รูปใหญ่เกิน 1.5 MB — แคปหน้าจอสลิปแล้วส่งใหม่</p>';
      else if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type || '')) note = '<p class="msg bad">ต้องเป็นรูปภาพ (JPG / PNG)</p>';
      else {
        const buf = new Uint8Array(await file.arrayBuffer()), v = await checkSlip(env, db, buf, file.type, o.amount);
        if (v.ok) { await db.prepare('UPDATE orders SET slip=?, slip_type=?, trans_ref=? WHERE id=?').bind(buf, file.type, v.ref, o.id).run(); await fulfill(db, await db.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first()); }
        else if (v.retry) { await db.prepare("UPDATE orders SET status='retry', reason=? WHERE id=?").bind(v.reason, o.id).run(); note = '<p class="msg bad">' + h(v.reason) + '</p>'; }
        else await db.prepare("UPDATE orders SET status='pending', slip=?, slip_type=?, trans_ref=?, reason=? WHERE id=?").bind(buf, file.type, v.ref || null, v.reason, o.id).run();
        o = await load();
      }
    }
    const kindTxt = o.kind === 'new' ? 'สมัครสมาชิกใหม่' : o.kind === 'add' ? 'เพิ่มเครื่อง (คีย์ใหม่)' : 'ต่ออายุเครื่อง';
    const head = `<div class="kv"><span class="mut">รายการ</span><b>${kindTxt}</b>
      <span class="mut">แพ็กเกจ</span><b>${planLabel(o.plan)}</b><span class="mut">ยอดชำระ</span><b>฿${Number(o.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b>
      <span class="mut">เบอร์</span><b>${h(o.phone || '-')}</b></div>`;
    if (o.status === 'paid') {
      const k = o.key ? await db.prepare('SELECT key, plan, expires_at FROM keys WHERE key=?').bind(o.key).first() : null;
      const extra = o.user_id ? { 'Set-Cookie': memCookie(await memSession(db, o.user_id), 7 * 86400) } : {};
      const r = await mPage('ชำระเงินสำเร็จ', `<div class="card"><h2 class="ok">✓ ชำระเงินสำเร็จ</h2>${head}
        <div class="msg ok">${o.kind === 'new' ? 'สมัครสมาชิกแล้ว · เบอร์ <b>' + h(o.phone) + '</b>' : o.kind === 'add' ? 'เพิ่มเครื่องแล้ว' : 'ต่ออายุแล้ว'}
        <div class="small mut">${k && k.expires_at ? 'ใช้ได้ถึง ' + dtD(k.expires_at) : 'ใช้ได้ตลอดชีพ'}</div></div>
        ${o.kind === 'new' ? '<p class="small">เปิดโปรแกรม Sign Tools แล้วเข้าสู่ระบบด้วย <b>เบอร์ + รหัสผ่าน</b> ที่ตั้งไว้</p><a class="btn" href="/download">ดาวน์โหลดโปรแกรม</a>' : '<p class="small">เปิดแผง Sign Tools ใหม่ ระบบจะใช้ได้ทันที</p>'}
        <a class="btn ghost" href="/member">ไปหน้าสมาชิก</a></div>`);
      return new Response(r.body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
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
        <span class="small mut">ระบบตรวจสลิปอัตโนมัติ ผ่านแล้วใช้งานได้ทันที</span></form></div>`);
  }

  // ----- สมัครสมาชิก -----
  if (path === '/member/buy') {
    if (uid) return redirect('/member');
    return mPage('สมัครสมาชิก', `<div class="card"><h2>สมัครสมาชิก Sign Tools</h2>
      <label>เบอร์มือถือ<input id="ph" inputmode="tel" placeholder="08x-xxx-xxxx" autocomplete="tel"></label>
      <label>ตั้งรหัสผ่าน (6 ตัวขึ้นไป · ใช้เข้าโปรแกรมและหน้าสมาชิก)<input id="pw" type="password" autocomplete="new-password"></label>
      <div class="plans">${planCards('new', null, 'สมัคร')}</div>
      <p class="small mut">1 แพ็กเกจ = 1 เครื่อง · ซื้อเพิ่มเครื่องได้ภายหลัง · ย้ายเครื่องได้เองจากหน้าสมาชิก</p></div>
      <script>document.querySelectorAll('form.plan').forEach(function(fm){fm.addEventListener('submit',function(){[['phone','ph'],['pw','pw']].forEach(function(x){var i=document.createElement('input');i.type='hidden';i.name=x[0];i.value=document.getElementById(x[1]).value;fm.appendChild(i);});});});</script>`);
  }

  // ----- ล็อกอิน -----
  if (form && f('do') === 'logout') return redirect('/member', { 'Set-Cookie': memCookie('', 0) });
  let err = '';
  if (form && f('do') === 'login') {
    const phone = normPhone(f('phone')), ip = req.headers.get('CF-Connecting-IP') || '';
    const bad = async (t) => { await db.prepare('INSERT INTO log VALUES (?,?,?,?,?)').bind(now(), ip, 'tel:' + phone, 'member', 'bad_pw').run(); await sleep(800); return t; };
    if (!phone) err = 'ใส่เบอร์มือถือ 10 หลัก';
    else if (await tooMany(db, 'tel:' + phone)) err = 'ใส่รหัสผิดหลายครั้ง — รอ 15 นาทีแล้วลองใหม่';
    else if (f('key')) {                                   // ลูกค้าเดิมที่มีแต่คีย์ → สร้างบัญชีจากเบอร์
      const k = normKey(f('key')), r = await db.prepare('SELECT * FROM keys WHERE key=?').bind(k).first();
      let u = r && r.user_id ? await db.prepare('SELECT * FROM users WHERE id=?').bind(r.user_id).first() : null;
      if (!r || (u && u.phone !== phone)) err = await bad('เบอร์หรือคีย์ไม่ถูกต้อง');
      else if (!u && await userByPhone(db, phone)) err = 'เบอร์นี้มีบัญชีอยู่แล้ว — เข้าด้วยรหัสผ่าน หรือให้ร้านย้ายคีย์เข้าบัญชีให้';
      else {
        if (!u) { u = await createUser(db, { phone, name: r.note || '' }); await db.prepare('UPDATE keys SET user_id=? WHERE key=?').bind(u.id, k).run(); }
        return redirect('/member', { 'Set-Cookie': memCookie(await memSession(db, u.id), 7 * 86400) });
      }
    } else {
      const u = await userByPhone(db, phone);
      if (!u || !(await checkPw(u, f('pw')))) err = await bad('เบอร์หรือรหัสผ่านไม่ถูกต้อง');
      else if (u.status !== 'active') err = 'บัญชีนี้ถูกปิดใช้งาน — ติดต่อ ' + contact;
      else return redirect('/member', { 'Set-Cookie': memCookie(await memSession(db, u.id), 7 * 86400) });
    }
  }
  if (!uid) {
    return mPage('เข้าสู่ระบบ', `<form method="post" class="card"><h2>เข้าสู่ระบบสมาชิก</h2>${err ? `<p class="msg bad">${h(err)}</p>` : ''}
      <input type="hidden" name="do" value="login">
      <label>เบอร์มือถือ<input name="phone" inputmode="tel" placeholder="08x-xxx-xxxx" autocomplete="tel" required></label>
      <label id="pwBox">รหัสผ่าน<input name="pw" type="password" autocomplete="current-password"></label>
      <label id="keyBox" hidden>คีย์ (ST-XXXX-XXXX-XXXX-XXXX)<input name="key" class="mono" autocapitalize="characters" spellcheck="false"></label>
      <button>เข้าสู่ระบบ</button>
      <a href="#" id="useKey" class="small mut">ลูกค้าเดิมที่มีคีย์ ST-… ? เข้าด้วยคีย์</a>
      <span class="small mut">ลืมรหัสผ่าน: ติดต่อ ${h(contact)}</span></form>
      <div class="card"><h2>ยังไม่เป็นสมาชิก?</h2><a class="btn" href="/member/buy">สมัครสมาชิก</a></div>
      <script>document.getElementById('useKey').onclick=function(e){e.preventDefault();document.getElementById('keyBox').hidden=false;document.getElementById('pwBox').hidden=true;this.hidden=true;};</script>`);
  }

  // ----- หน้าสมาชิก -----
  const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
  if (!u) return redirect('/member', { 'Set-Cookie': memCookie('', 0) });
  let msg = '';
  if (form) {
    const d = f('do'), k = normKey(f('key'));
    if (d === 'profile') {
      await db.prepare('UPDATE users SET name=?, shop=?, line=?, email=?, address=? WHERE id=?').bind(f('name').slice(0, 100), f('shop').slice(0, 100), f('line').slice(0, 60), f('email').slice(0, 120), f('address').slice(0, 400), uid).run();
      msg = 'บันทึกข้อมูลแล้ว'; Object.assign(u, { name: f('name'), shop: f('shop'), line: f('line'), email: f('email'), address: f('address') });
    } else if (d === 'pw') {
      if (u.pw_hash && !(await checkPw(u, f('old')))) msg = '!รหัสผ่านเดิมไม่ถูกต้อง';
      else if (!pwOk(f('pw'))) msg = '!รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัว';
      else { await setUserPw(db, uid, f('pw')); u.pw_hash = 'x'; msg = 'เปลี่ยนรหัสผ่านแล้ว — ใช้รหัสใหม่เข้าโปรแกรมครั้งถัดไป'; }
    } else if (d === 'move' && k) {
      await db.prepare('UPDATE keys SET machine=NULL, machine_name=NULL, moves=moves+1 WHERE key=? AND user_id=?').bind(k, uid).run();
      msg = 'ปลดเครื่องแล้ว — เปิด Sign Tools ที่เครื่องใหม่แล้วเข้าสู่ระบบได้เลย';
    }
  }
  const ks = (await db.prepare('SELECT * FROM keys WHERE user_id=? ORDER BY created_at').bind(uid).all()).results;
  const pendO = await db.prepare("SELECT id FROM orders WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(uid).first();
  const msgHtml = msg ? (msg[0] === '!' ? `<p class="msg bad">${h(msg.slice(1))}</p>` : `<p class="msg ok">${h(msg)}</p>`) : '';
  const keyCard = (r, i) => {
    const expired = r.expires_at && r.expires_at < now(), life = r.plan === 'life' || !r.plan || !r.expires_at;
    const st = r.status !== 'active' ? '<b class="bad">ปิดอยู่</b>' : expired ? '<b class="bad">หมดอายุแล้ว</b>' : '<b class="ok">ใช้งานได้</b>';
    return `<div class="plan" style="gap:8px"><div class="row" style="align-items:center"><b>เครื่องที่ ${i + 1}</b><span style="text-align:right">${st}</span></div>
      <div class="kv small"><span class="mut">เครื่อง</span><span>${r.machine ? h(r.machine_name) : '<span class="mut">ว่าง · เข้าสู่ระบบในโปรแกรมได้เลย</span>'}</span>
      <span class="mut">แพ็กเกจ</span><span>${planLabel(r.plan)}</span>
      <span class="mut">ใช้ได้ถึง</span><span>${life ? 'ตลอดชีพ' : dtD(r.expires_at) + (expired ? '' : ` <span class="mut">(อีก ${Math.ceil((r.expires_at - now()) / 86400)} วัน)</span>`)}</span></div>
      ${r.machine ? `<form method="post" onsubmit="return confirm('ปลดเครื่องนี้ เพื่อใช้กับเครื่องใหม่?')"><input type="hidden" name="key" value="${h(r.key)}"><button name="do" value="move" class="ghost sm" style="width:100%">ย้ายไปเครื่องใหม่</button></form>` : ''}
      ${life ? '' : `<details><summary class="small" style="cursor:pointer">ต่ออายุเครื่องนี้</summary><div class="plans" style="margin-top:8px">${planCards('renew', r.key, 'ต่ออายุ')}</div></details>`}</div>`;
  };
  return mPage('สมาชิก', `${msgHtml}
    <div class="card"><h2>สวัสดี ${h(u.name || u.phone)}</h2><p class="small mut">${h(u.phone)}${u.shop ? ' · ' + h(u.shop) : ''}</p>
      ${pendO ? `<p class="msg">มีสลิปรอร้านตรวจ · <a href="/member/pay?o=${pendO.id}" style="color:var(--acc)">ดูสถานะ</a></p>` : ''}
      <h2 style="margin-top:4px">เครื่องของฉัน <span class="mut small">${ks.length} เครื่อง</span></h2>
      <div class="plans" style="grid-template-columns:1fr">${ks.map(keyCard).join('') || '<p class="mut">ยังไม่มีเครื่อง</p>'}</div>
      <details><summary style="cursor:pointer"><b>+ เพิ่มเครื่อง</b> <span class="mut small">ใช้ Sign Tools อีกเครื่องด้วยบัญชีเดียวกัน</span></summary><div class="plans" style="margin-top:10px">${planCards('add', null, 'ซื้อเพิ่ม')}</div></details>
      <a class="btn ghost" href="/download">ดาวน์โหลดโปรแกรม</a></div>
    <details class="card"><summary style="cursor:pointer"><b>ข้อมูลของฉัน</b></summary>
      <form method="post" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <label>ชื่อ<input name="name" value="${h(u.name)}"></label><label>ชื่อร้าน<input name="shop" value="${h(u.shop)}"></label>
      <label>LINE ID<input name="line" value="${h(u.line)}"></label><label>อีเมล<input name="email" type="email" value="${h(u.email)}"></label>
      <label>ที่อยู่ (สำหรับออกใบเสร็จ)<textarea name="address" rows="2" style="background:#0c1c33;color:var(--tx);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit">${h(u.address)}</textarea></label>
      <button name="do" value="profile">บันทึกข้อมูล</button></form></details>
    <details class="card"><summary style="cursor:pointer"><b>${u.pw_hash ? 'เปลี่ยนรหัสผ่าน' : 'ตั้งรหัสผ่าน (เข้าโปรแกรมด้วยเบอร์ + รหัสผ่าน)'}</b></summary>
      <form method="post" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">${u.pw_hash ? '<label>รหัสผ่านเดิม<input name="old" type="password" autocomplete="current-password" required></label>' : ''}
      <label>รหัสผ่านใหม่ (6 ตัวขึ้นไป)<input name="pw" type="password" autocomplete="new-password" required></label><button name="do" value="pw">บันทึกรหัสผ่าน</button></form></details>
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
      if (url.pathname === '/admin/log') {
        if (!(await validSession(env.DB, req))) return new Response('login required', { status: 401 });
        const rs = await env.DB.prepare("SELECT t, action, result, substr(key,1,8) k FROM log WHERE action IN ('member_link','member_auto') ORDER BY t DESC LIMIT 30").all();
        return new Response(JSON.stringify(rs.results), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }
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
