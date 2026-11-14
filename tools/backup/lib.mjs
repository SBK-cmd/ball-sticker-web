// ฟังก์ชันหลักของระบบสำรอง (ไม่แตะเน็ตเอง — ฉีด fetch/fs เข้ามาเพื่อทดสอบได้)
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';

const MAGIC = Buffer.from('BSB1');

// แปลงค่าจาก Firestore เป็น JSON ล้วน (Timestamp/GeoPoint/Reference/Bytes)
export function plain(v) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v.toDate === 'function' && typeof v.seconds === 'number') return {__ts: v.toDate().toISOString()};
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 3) return {__geo: [v.latitude, v.longitude]};
  if (Buffer.isBuffer(v)) return {__bytes: v.toString('base64')};
  if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return {__ref: v.path};
  const o = {};
  for (const k of Object.keys(v)) o[k] = plain(v[k]);
  return o;
}

// ดึงลิงก์รูป https ทั้งหมดจากข้อมูลทุกชนิด (เฉพาะโฮสต์รูปที่เรารู้จัก)
const IMG_HOSTS = /^https:\/\/(res\.cloudinary\.com|firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//;
export function collectUrls(data, out = new Set()) {
  if (typeof data === 'string') { if (IMG_HOSTS.test(data)) out.add(data.split(/[\s"'<>]/)[0]); }
  else if (Array.isArray(data)) data.forEach(x => collectUrls(x, out));
  else if (data && typeof data === 'object') Object.values(data).forEach(x => collectUrls(x, out));
  return out;
}

// ชื่อไฟล์ปลายทางของรูป: คงชื่อเดิมของ Cloudinary + แฮชสั้นกันชนกัน
export function photoName(url) {
  const u = new URL(url);
  const base = path.posix.basename(u.pathname) || 'file';
  const clean = decodeURIComponent(base).replace(/[^\w.\-]+/g, '_').slice(-80);
  const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  const ext = path.posix.extname(clean) ? '' : '.bin';
  return u.hostname.split('.')[0].replace(/\W/g, '') + '/' + h + '_' + clean + ext;
}

export function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}
export function decrypt(file, pass) {
  if (!file.subarray(0, 4).equals(MAGIC)) throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้');
  const salt = file.subarray(4, 20), iv = file.subarray(20, 32), tag = file.subarray(32, 48), enc = file.subarray(48);
  const key = crypto.scryptSync(pass, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
export const packJson = (obj, pass) => encrypt(zlib.gzipSync(Buffer.from(JSON.stringify(obj))), pass);
export const unpackJson = (file, pass) => JSON.parse(zlib.gunzipSync(decrypt(file, pass)).toString());

// เก็บ 7 วันล่าสุด + วันอาทิตย์ย้อนหลัง 4 สัปดาห์ (ชื่อไฟล์ firestore-YYYY-MM-DD.bsb) — คืนรายชื่อที่ควรลบ
export function toDelete(names, keepDaily = 7, keepWeekly = 4) {
  const ds = names.map(n => ({n, d: (n.match(/(\d{4}-\d{2}-\d{2})/) || [])[1]})).filter(x => x.d).sort((a, b) => b.d.localeCompare(a.d));
  const keep = new Set(ds.slice(0, keepDaily).map(x => x.n));
  const sundays = ds.filter(x => new Date(x.d + 'T12:00:00Z').getUTCDay() === 0);
  sundays.slice(0, keepWeekly).forEach(x => keep.add(x.n));
  return ds.filter(x => !keep.has(x.n)).map(x => x.n);
}

// โหลดรูปที่ยังไม่มี (ไม่ลบ ไม่ทับ) — ถ้ารูปหายจากต้นทาง สำเนาเก่ายังอยู่
export async function downloadPhotos(urls, {has, save, fetchFn = fetch, concurrency = 4, log = () => {}}) {
  const list = [...urls]; const res = {saved: 0, skipped: 0, failed: []};
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const url = list[i++]; const name = photoName(url);
      try {
        if (await has(name)) { res.skipped++; continue; }
        const r = await fetchFn(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await save(name, Buffer.from(await r.arrayBuffer()));
        res.saved++;
      } catch (e) { res.failed.push({url, error: String(e.message || e)}); }
    }
  }
  await Promise.all(Array.from({length: concurrency}, worker));
  return res;
}
