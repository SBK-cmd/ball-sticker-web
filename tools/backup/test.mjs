import assert from 'node:assert/strict';
import {plain, collectUrls, photoName, encrypt, decrypt, packJson, unpackJson, toDelete, downloadPhotos} from './lib.mjs';
// เข้ารหัส/ถอดรหัส
const pw = 'รหัสทดสอบยาวพอสมควร123';
assert.deepEqual(unpackJson(packJson({a: 'ไทย', n: [1, 2]}, pw), pw), {a: 'ไทย', n: [1, 2]});
assert.throws(() => unpackJson(packJson({a: 1}, pw), 'ผิด-ผิด-ผิด-ผิด'));
const e = encrypt(Buffer.from('ข้อมูลยาวพอให้แก้ไบต์กลางไฟล์ได้'), pw); e[e.length - 3] ^= 1; assert.throws(() => decrypt(e, pw));
// plain
assert.deepEqual(plain({t: {toDate: () => new Date('2026-11-15T00:00:00Z'), seconds: 1}, g: {latitude: 1, longitude: 2}, z: [null, 3]}), {t: {__ts: '2026-11-15T00:00:00.000Z'}, g: {__geo: [1, 2]}, z: [null, 3]});
// เก็บลิงก์
const d = {photos: ['https://res.cloudinary.com/m4n2ttwh/image/upload/v1/a.jpg', 'data:image/png;base64,AAA', 'https://evil.example/x.jpg'], n: {p: 'https://res.cloudinary.com/m4n2ttwh/image/upload/v2/b_b.png'}, donePhotos: ['https://res.cloudinary.com/m4n2ttwh/image/upload/v1/a.jpg']};
const u = [...collectUrls(d)]; assert.equal(u.length, 2); assert.ok(!u.some(x => x.includes('evil')));
assert.notEqual(photoName(u[0]), photoName(u[1])); assert.match(photoName(u[0]), /^res\/[0-9a-f]{10}_a\.jpg$/);
// เก็บย้อนหลัง
const names = []; for (let i = 0; i < 45; i++) { const t = new Date(Date.UTC(2026, 9, 1 + i)); names.push('firestore-' + t.toISOString().slice(0, 10) + '.bsb'); }
const del = toDelete(names), keep = names.filter(n => !del.includes(n));
assert.ok(keep.includes('firestore-2026-11-14.bsb') && keep.includes('firestore-2026-11-08.bsb'));   // 7 วันล่าสุด (8–14 พ.ย.) อยู่
assert.equal(keep.length, 10);   // 7 วันล่าสุด + อาทิตย์ 3 วันที่ไม่ซ้อน (1 พ.ย., 25 ต.ค., 18 ต.ค.) เพราะ 8 พ.ย. อยู่ใน 7 วันแล้ว
assert.ok(keep.includes('firestore-2026-11-01.bsb') && keep.includes('firestore-2026-10-18.bsb') && !keep.includes('firestore-2026-10-11.bsb'));
assert.ok(del.includes('firestore-2026-10-02.bsb'));
// ดาวน์โหลด: ไม่ทับ, นับล้มเหลว
const saved = {}; const fetchFn = async url => url.includes('b_b') ? {ok: false, status: 404} : {ok: true, arrayBuffer: async () => new TextEncoder().encode('img').buffer};
const r1 = await downloadPhotos(new Set(u), {has: async n => n in saved, save: async (n, b) => { saved[n] = b; }, fetchFn});
assert.equal(r1.saved, 1); assert.equal(r1.failed.length, 1);
const r2 = await downloadPhotos(new Set(u), {has: async n => n in saved, save: async () => { throw new Error('ห้ามเขียนซ้ำ'); }, fetchFn});
assert.equal(r2.skipped, 1); assert.equal(r2.saved, 0);
console.log('ผ่านทุกข้อ');
