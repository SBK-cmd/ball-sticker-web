#!/usr/bin/env node
// สำรองข้อมูลบอลสติ๊กเกอร์: Firestore (ทุกคอลเลกชัน, เข้ารหัส) + รูปทั้งหมดที่อ้างถึง
// ใช้: BACKUP_DIR=/data/backup BACKUP_PASSPHRASE=... GOOGLE_APPLICATION_CREDENTIALS=sa.json node run.mjs
import {Firestore} from '@google-cloud/firestore';
import fs from 'node:fs/promises';
import path from 'node:path';
import {plain, collectUrls, packJson, toDelete, downloadPhotos} from './lib.mjs';

const dir = process.env.BACKUP_DIR, pass = process.env.BACKUP_PASSPHRASE;
if (!dir || !pass || pass.length < 12) { console.error('ต้องตั้ง BACKUP_DIR และ BACKUP_PASSPHRASE (ยาว ≥ 12 ตัว)'); process.exit(2); }
const projectId = process.env.FIREBASE_PROJECT || 'ball-sticker-d95c2';
const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);   // วันที่เวลาไทย

const db = new Firestore({projectId});
const data = {}; let docs = 0;
for (const col of await db.listCollections()) {
  const snap = await col.get();
  data[col.id] = Object.fromEntries(snap.docs.map(d => [d.id, plain(d.data())]));
  docs += snap.size;
  console.log('คอลเลกชัน', col.id, snap.size, 'เอกสาร');
}
if (!docs) { console.error('อ่านได้ 0 เอกสาร — ไม่เขียนไฟล์สำรอง (กันทับของดีด้วยของว่าง)'); process.exit(3); }

await fs.mkdir(path.join(dir, 'firestore'), {recursive: true});
const out = path.join(dir, 'firestore', 'firestore-' + day + '.bsb');
await fs.writeFile(out + '.tmp', packJson({savedAt: new Date().toISOString(), docs, data}, pass));
await fs.rename(out + '.tmp', out);
console.log('เขียน', out);
for (const n of toDelete(await fs.readdir(path.join(dir, 'firestore')))) await fs.unlink(path.join(dir, 'firestore', n));

const urls = collectUrls(data);
const photoDir = path.join(dir, 'photos');
const r = await downloadPhotos(urls, {
  has: async n => fs.access(path.join(photoDir, n)).then(() => true, () => false),
  save: async (n, buf) => { const p = path.join(photoDir, n); await fs.mkdir(path.dirname(p), {recursive: true}); await fs.writeFile(p + '.tmp', buf); await fs.rename(p + '.tmp', p); }
});
console.log(`รูป: ลิงก์ ${urls.size} · โหลดใหม่ ${r.saved} · มีอยู่แล้ว ${r.skipped} · ล้มเหลว ${r.failed.length}`);
await fs.writeFile(path.join(dir, 'last-run.json'), JSON.stringify({at: new Date().toISOString(), docs, photos: urls.size, newPhotos: r.saved, failed: r.failed.slice(0, 50)}, null, 1));
process.exit(r.failed.length > urls.size * 0.2 ? 1 : 0);   // เกือบ 1 ใน 5 โหลดไม่ได้ = ถือว่าผิดปกติ
