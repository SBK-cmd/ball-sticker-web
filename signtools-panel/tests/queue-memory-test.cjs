#!/usr/bin/env node
'use strict';
// Actual queue.js/cut.js/cutjob.js/job-memory.js; mock DOM, Firestore, CEP and LAN.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const clone = v => JSON.parse(JSON.stringify(v));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function fv(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, fv(val)]));
  throw Error('unexpected Firestore value');
}
function encode(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).map(([k, val]) => [k, encode(val)])) } };
}
function makeSnap(offset = 0) {
  const points = [[offset, 10], [offset + 20, 10], [offset + 20, 30], [offset, 30]];
  const p = points.flatMap(([x, y]) => [x, y, x, y, x, y]);
  return { src: 'cut', text: 0, other: 0, n: 2, pts: 8,
    paths: [{ c: 1, k: 'kiss', p }, { c: 1, k: 'die', p: p.map((n, i) => n + (i % 2 ? 1 : 0)) }],
    marks: { style: 1, ox: 0, oy: 0, dx: 100, dy: 100, lenMM: 10, seg: false } };
}
function baseDb() {
  return { jobs: {
    jobA: { id: 'jobA', no: 'JB-001', date: '2026-11-08', jName: 'TEST ONLY A', items: [{ name: 'test design', qty: 4 }],
      status: 'pending', savedAt: 1000, aiFiles: JSON.stringify([{ p: '/test/a.ai', n: 'a.ai' }, { p: '/test/b.ai', n: 'b.ai' }]),
      note: 'app note must survive', unrelated: { keep: true } }
  }, wholesale: {} };
}
async function simulator(database) {
  const html = fs.readFileSync(path.join(root, 'SignTools/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(html, { url: 'https://offline-signtools.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [], patches = [], sends = [], errors = [];
  let failPatch = false;
  let noMarks = false;
  w.addEventListener('error', e => errors.push(e.error || e.message));
  const context = new Proxy({}, { get: (o, key) => key in o ? o[key] : () => {}, set: (o, key, value) => (o[key] = value, true) });
  w.HTMLCanvasElement.prototype.getContext = () => context;
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
  const times = { '/test/a.ai': 1000, '/test/b.ai': 1000 };
  let active = '/test/a.ai';
  w.cep_node = { Buffer, require: mod => {
    if (mod === 'fs') return { statSync: p => { if (!(p in times)) throw Error('test file absent'); return { mtimeMs: times[p] }; } };
    throw Error('forbidden module in mock: ' + mod);
  } };
  w.__adobe_cep__ = { evalScript(source, cb) {
    const pos = source.indexOf('('), fn = source.slice(0, pos), arg = source.slice(pos + 1, -1);
    const value = arg ? JSON.parse(arg) : undefined;
    calls.push({ fn, arg: value });
    let result;
    if (fn === 'st_openFile') { active = value; result = { ok: true, msg: 'mock open' }; }
    else if (fn === 'st_cutRead') { result = makeSnap(active === '/test/b.ai' ? 40 : 0); if (noMarks) delete result.marks; }
    else if (fn === 'st_markCheck') result = noMarks ? { why: 'nolayer' } : { why: 'ok', style: 1, ab: [0, 100, 100, 0], marks: [[0, 0, 1], [100, 0, 1], [0, 100, 1], [100, 100, 1]] };
    else if (fn === 'st_thumb') result = { error: 'no thumbnail in mock' };
    else if (fn === 'st_pickFile') result = { path: '/test/print.tif', name: 'print.tif' };
    else if (fn === 'st_docInfo') result = { path: active };
    else throw Error('unexpected CEP call: ' + fn);
    cb(JSON.stringify(result));
  } };
  w.ST_core = { features: () => Promise.resolve({ queue: { apiKey: 'offline-only', projectId: 'offline-only' } }), report() {} };
  w.XMLHttpRequest = class {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { setTimeout(() => {
      try {
        const u = new URL(this.url);
        let data;
        if (u.hostname === 'identitytoolkit.googleapis.com') data = { idToken: 'mock', refreshToken: 'mock', expiresIn: '3600' };
        else if (u.hostname === 'securetoken.googleapis.com') data = { id_token: 'mock', refresh_token: 'mock', expires_in: '3600' };
        else if (u.hostname === 'firestore.googleapis.com') {
          const match = u.pathname.match(/\/documents\/(jobs|wholesale)(?:\/([^/]+))?$/);
          assert(match, 'unexpected Firestore route: ' + u.pathname);
          const [, col, rawId] = match;
          if (this.method === 'GET') {
            const mask = u.searchParams.getAll('mask.fieldPaths');
            if (col === 'jobs') { assert(mask.includes('stProduction')); assert(mask.includes('printFiles')); }
            data = { documents: Object.entries(database[col]).map(([id, doc]) => ({
              name: 'projects/offline/databases/(default)/documents/' + col + '/' + id,
              fields: Object.fromEntries(Object.entries(doc).filter(([k]) => mask.includes(k)).map(([k, v]) => [k, encode(v)]))
            })) };
          } else if (this.method === 'PATCH') {
            if (failPatch) { this.status = 503; this.responseText = JSON.stringify({ error: { message: 'mock cloud offline' } }); this.onload(); return; }
            const id = decodeURIComponent(rawId), record = database[col][id];
            assert(record, 'must not create unexpected job');
            const decoded = fv({ mapValue: { fields: JSON.parse(body).fields } });
            const mask = u.searchParams.getAll('updateMask.fieldPaths');
            for (const entry of mask) {
              const parts = entry.split('.'); let source = decoded, target = record;
              for (const part of parts.slice(0, -1)) { source = source[part]; target[part] ||= {}; target = target[part]; }
              const last = parts.at(-1); target[last] = clone(source[last]);
            }
            patches.push({ col, id, mask, fields: decoded }); data = { fields: encode(record).mapValue.fields };
          } else throw Error('unexpected method: ' + this.method);
        } else throw Error('NETWORK FORBIDDEN: ' + this.url);
        this.status = 200; this.responseText = JSON.stringify(data); this.onload();
      } catch (error) { errors.push(error); this.status = 500; this.responseText = JSON.stringify({ error: { message: error.message } }); this.onload(); }
    }, 0); }
  };
  for (const file of ['cutjob.js', 'cut.js', 'job-memory.js', 'queue.js']) {
    w.eval(fs.readFileSync(path.join(root, 'SignTools/js', file), 'utf8'));
    if (file === 'cutjob.js') w.STCut.net = () => ({ tryPort: () => Promise.resolve(false), send: (ip, port, data) => { sends.push({ ip, port, data }); return Promise.resolve(data.length); } });
  }
  await delay(70);
  function set(id, value) {
    const el = w.document.getElementById(id); assert(el, id);
    if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  function row(id = 'jobA') { const el = w.document.querySelector('#cqList .qjob[data-id="' + id + '"]'); assert(el, 'missing job ' + id); return el; }
  async function click(action, index = 0, id = 'jobA') {
    const el = row(id).querySelector('[data-act="' + action + '"][data-i="' + index + '"]') || row(id).querySelector('[data-act="' + action + '"]');
    assert(el, 'missing action ' + action); el.click(); await delay(70);
  }
  async function preview(index = 0) { await click('cutprev', index); assert(w.document.querySelector('#cqPrev.show')); }
  return { w, calls, patches, sends, errors, set, row, click, preview, times,
    offline(value) { failPatch = value; }, close() { w.close(); },
    markless(value) { noMarks = value; },
    async scan(index = 0, force = 31) { set('cutDrv', true); set('dKisF', force); await click('scan', index); },
    async refresh() { w.document.getElementById('cqRe').click(); await delay(70); },
    assertNoErrors() { assert.deepEqual(errors, []); }
  };
}

let persisted;
test('scan saves exact Kiss/Die coordinates, marks and per-file options into the job', async () => {
  const db = baseDb(), sim = await simulator(db);
  try {
    await sim.scan(0, 31);
    const record = JSON.parse(db.jobs.jobA.stProduction), saved = record.files[0].cut;
    assert.deepEqual(saved.snap, makeSnap());
    assert.equal(saved.drv.kF, 31); assert.equal(saved.drv.on, true);
    assert.equal(saved.settings.useMk, true); assert.equal(saved.settings.lang, 'gpgl');
    assert.deepEqual(saved.view.marks, [[0, 0, 1], [100, 0, 1], [0, 100, 1], [100, 100, 1]]);
    assert.equal(record.no, 'JB-001'); assert.equal(record.files[1].cut, null);
    assert.equal(db.jobs.jobA.note, 'app note must survive'); assert.deepEqual(db.jobs.jobA.unrelated, { keep: true });
    assert.equal(sim.sends.length, 0);
    await sim.scan(1, 42);
    const both = JSON.parse(db.jobs.jobA.stProduction);
    assert.equal(both.files[0].cut.drv.kF, 31); assert.equal(both.files[1].cut.drv.kF, 42);
    assert.deepEqual(both.files[1].cut.snap, makeSnap(40));
    persisted = clone(db); sim.assertNoErrors();
  } finally { sim.close(); }
});
test('fresh panel loads complete data from app job without relinking or scanning', async () => {
  const db = clone(persisted);
  // Same semantics as app cloudSave(..., {merge:true}) editing the job fields.
  Object.assign(db.jobs.jobA, { no: 'JB-EDITED', note: 'edited in app', savedAt: 2000 });
  const sim = await simulator(db);
  try {
    assert.equal(sim.w.localStorage.getItem('st_cutq'), null);
    await sim.preview(0);
    assert.equal(sim.w.document.querySelector('#cqPrev input[data-dv="kF"]').value, '31');
    assert.equal(sim.w.ST_cutApi.getDrv().kF, '31');
    assert.equal(sim.calls.filter(c => c.fn === 'st_cutRead' || c.fn === 'st_openFile').length, 0);
    assert(sim.w.document.querySelector('#cqPrev').textContent.includes('JB-EDITED'));
    await sim.preview(1);
    assert.equal(sim.w.document.querySelector('#cqPrev input[data-dv="kF"]').value, '42');
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('sending restores saved driver values and persists sent-not-finished state', async () => {
  const db = clone(persisted), sim = await simulator(db);
  try {
    sim.set('cutIp', '192.0.2.123'); sim.set('cutPort', '9100'); sim.set('dKisF', '59');
    await sim.click('cutnow', 0); await sim.click('cutnow', 0);
    assert.equal(sim.sends.length, 1);
    assert(sim.sends[0].data.includes('*2,31,2\x03'), 'saved kiss force must be in actual GP-GL');
    assert(!sim.sends[0].data.includes('*2,59,2\x03'), 'previous job/global force must not leak');
    assert(JSON.parse(db.jobs.jobA.stProduction).files[0].cut.sentAt > 0);
    assert.equal(db.jobs.jobA.status, 'pending');
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('force edits affect only the selected file and invalid integers never overwrite', async () => {
  const db = clone(persisted), sim = await simulator(db);
  try {
    await sim.preview(0);
    const input = sim.w.document.querySelector('#cqPrev input[data-dv="kF"]');
    for (const invalid of ['61', '7.5', '-1', '']) {
      input.value = invalid; input.dispatchEvent(new sim.w.Event('change', { bubbles: true })); await delay(40);
      assert.equal(JSON.parse(db.jobs.jobA.stProduction).files[0].cut.drv.kF, 31);
    }
    input.value = '33'; input.dispatchEvent(new sim.w.Event('change', { bubbles: true })); await delay(80);
    const stored = JSON.parse(db.jobs.jobA.stProduction);
    assert.equal(stored.files[0].cut.drv.kF, 33); assert.equal(stored.files[1].cut.drv.kF, 42);
    assert.equal(sim.sends.length, 0); sim.assertNoErrors();
  } finally { sim.close(); }
});
test('print file references are saved once and survive a fresh app-job load', async () => {
  const db = clone(persisted), sim = await simulator(db);
  try {
    sim.row().click(); await delay(30);
    sim.w.document.querySelector('#cqModal [data-act="printlink"]').click(); await delay(70);
    assert.deepEqual(JSON.parse(db.jobs.jobA.stProduction).printFiles, [{ p: '/test/print.tif', n: 'print.tif' }]);
    assert.equal(JSON.parse(db.jobs.jobA.stProduction).files[0].prints.length, 0, 'must not guess a print/cut pairing');
    sim.assertNoErrors();
  } finally { sim.close(); }
  const fresh = await simulator(db);
  try { fresh.row().click(); await delay(30); assert(fresh.w.document.querySelector('#cqModal').textContent.includes('print.tif')); fresh.assertNoErrors(); }
  finally { fresh.close(); }
});
test('cloud failure keeps local unsynced snapshot, blocks sending and supports retry', async () => {
  const db = baseDb(), sim = await simulator(db);
  try {
    sim.offline(true); await sim.scan(0, 31);
    assert.equal(db.jobs.jobA.stProduction, undefined);
    assert.equal(JSON.parse(sim.w.localStorage.getItem('st_cutq'))['jobA|/test/a.ai'].unsynced, true);
    sim.set('cutIp', '192.0.2.123'); sim.set('cutPort', '9100');
    await sim.click('cutnow', 0); await sim.click('cutnow', 0); assert.equal(sim.sends.length, 0);
    sim.offline(false); await sim.click('cutsave', 0);
    assert.equal(JSON.parse(db.jobs.jobA.stProduction).files[0].cut.drv.kF, 31);
    assert.equal(JSON.parse(sim.w.localStorage.getItem('st_cutq'))['jobA|/test/a.ai'].unsynced, false);
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('wholesale item metadata is scoped to stq.i0 and sibling fields survive', async () => {
  const db = baseDb(); db.jobs = {};
  db.wholesale.wsA = { ref: 'W-001', date: '2026-11-08', buyerName: 'TEST WHOLESALE', savedAt: Date.now(),
    items: [{ name: 'wholesale sample', qty: 1 }], stq: { i0: { status: 'pending', aiFile: '/test/a.ai', aiFileName: 'a.ai', other: 'keep' }, i1: { status: 'shipped', other: 'sibling' } } };
  const sim = await simulator(db);
  try {
    sim.set('cutDrv', true); sim.set('dKisF', 29); await sim.click('scan', 0, 'wsA#0');
    assert.equal(JSON.parse(db.wholesale.wsA.stq.i0.stProduction).files[0].cut.drv.kF, 29);
    assert.equal(db.wholesale.wsA.stq.i0.other, 'keep'); assert.deepEqual(db.wholesale.wsA.stq.i1, { status: 'shipped', other: 'sibling' });
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('changed file mtime blocks sending until rescanned', async () => {
  const db = clone(persisted), sim = await simulator(db);
  try {
    sim.set('cutIp', '192.0.2.123'); sim.set('cutPort', '9100'); sim.times['/test/a.ai'] = 100000;
    await sim.click('cutnow', 0); await sim.click('cutnow', 0); assert.equal(sim.sends.length, 0);
    assert(sim.w.document.getElementById('toast').textContent.includes('สแกนใหม่')); sim.assertNoErrors();
  } finally { sim.close(); }
});
test('rescan without marks clears old mark geometry and sent status', async () => {
  const db = clone(persisted), record = JSON.parse(db.jobs.jobA.stProduction);
  record.files[0].cut.sentAt = 1234; db.jobs.jobA.stProduction = JSON.stringify(record);
  const sim = await simulator(db);
  try {
    sim.markless(true); await sim.scan(0, 31);
    const stored = JSON.parse(db.jobs.jobA.stProduction).files[0].cut;
    assert.equal(stored.snap.marks, undefined); assert.equal(stored.view, null); assert.equal(stored.sentAt, null);
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('incomplete saved driver cannot inherit the previous job force', async () => {
  const db = clone(persisted), record = JSON.parse(db.jobs.jobA.stProduction);
  delete record.files[0].cut.drv.kF; db.jobs.jobA.stProduction = JSON.stringify(record);
  const sim = await simulator(db);
  try {
    sim.set('cutIp', '192.0.2.123'); sim.set('cutPort', '9100'); sim.set('dKisF', 59);
    await sim.click('cutnow', 0); await sim.click('cutnow', 0);
    assert.equal(sim.sends.length, 0); assert(sim.w.document.getElementById('toast').textContent.includes('ไม่ครบ'));
    sim.assertNoErrors();
  } finally { sim.close(); }
});
test('corrupt production payload is surfaced and never sent', async () => {
  const db = baseDb(); db.jobs.jobA.stProduction = '{broken';
  const sim = await simulator(db);
  try {
    assert.equal(sim.row().querySelector('[data-act="cutnow"]'), null);
    sim.row().click(); await delay(30);
    assert(sim.w.document.querySelector('#cqModal').textContent.includes('ผิดปกติ'));
    assert.equal(sim.sends.length, 0); sim.assertNoErrors();
  } finally { sim.close(); }
});

(async () => {
  let count = 0;
  for (const { name, fn } of tests) {
    await fn(); count++; console.log('PASS ' + name);
  }
  console.log(`PASS ${count} queue integration tests; actual JS, mocked DOM/Firestore/CEP/LAN only`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
