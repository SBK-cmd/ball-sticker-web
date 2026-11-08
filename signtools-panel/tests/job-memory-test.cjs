'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const memoryPath = path.join(__dirname, '..', 'SignTools', 'js', 'job-memory.js');
const ST = require(memoryPath);
let passed = 0;

function ok(value, message) {
  assert.ok(value, message);
  passed += 1;
}
function eq(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  passed += 1;
}
function same(actual, expected, message) {
  assert.strictEqual(actual, expected, message);
  passed += 1;
}
function throws(fn, fragment, message) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error);
    if (fragment) assert.ok(err.message.indexOf(fragment) >= 0, `${message || 'error'}: ${err.message}`);
    return true;
  }, message);
  passed += 1;
}
function snap(extra) {
  const result = {
    mkWhy: 'ok',
    src: 'cut',
    text: 0,
    other: 0,
    n: 2,
    pts: 4,
    paths: [
      { c: 1, k: 'kiss', p: [0, 0, 0, 0, 10, 0, 10, 0, 10, 0, 10, 10] },
      { c: 0, k: 'die', p: [-1.25, 2.5, -1.25, 2.5, 7.5, 2.5, 7.5, 2.5, 7.5, 2.5, 8.5, 2.5] }
    ],
    marks: { style: 1, seg: false, stepMM: 250, n: 4, ox: 1.25, oy: 2.5, dx: 100, dy: 80, lenMM: 10 }
  };
  if (extra) Object.keys(extra).forEach((key) => { result[key] = extra[key]; });
  return result;
}
function cut(extra) {
  const result = {
    snap: snap(),
    view: { ab: [0, 100, 100, 0], marks: [[1, 2, 1], [3, 4, 0]] },
    viewNote: '',
    savedAt: 1700000000000,
    mtime: 1700000000123,
    thumb: 'data:image/png;base64,thumb',
    sentAt: 1700000000999,
    drv: { on: true, kS: '71', kF: '38', kA: '2', dS: 50, dF: 25, dA: 2 },
    settings: { lang: 'gpgl', step: '0.1', rotate: false, mirror: true, overcut: '2', useMk: true, cond: '2', first: 'kiss', nm: { rollW: '1000', x0: 0, y0: '0', gx: '5', gy: 6, copies: '2' } }
  };
  if (extra) Object.keys(extra).forEach((key) => { result[key] = extra[key]; });
  return result;
}

// CommonJS API and the browser global use the same object contract.
same(typeof ST.read, 'function', 'read exported');
same(typeof ST.setFile, 'function', 'setFile exported');
same(typeof ST.stringify, 'function', 'stringify exported');
same(typeof ST.normalizeFile, 'function', 'normalizeFile exported');
same(typeof ST.normalizeDrv, 'function', 'normalizeDrv exported');
same(typeof ST.normalizeSettings, 'function', 'normalizeSettings exported');
same(typeof ST.validateCut, 'function', 'validateCut exported');
const browserContext = { window: {}, console };
vm.runInNewContext(fs.readFileSync(memoryPath, 'utf8'), browserContext);
same(typeof browserContext.window.STJobMemory.read, 'function', 'window.STJobMemory exported');

// Empty/missing legacy values are valid and no path inference is used for files.
eq(ST.read({ no: 42 }), { v: 1, no: '42', files: [], printFiles: [] }, 'empty record');
eq(ST.read({ no: 'L1', aiFile: '/jobs/a.ai', aiFileName: 'a.ai' }).files, [
  { p: '/jobs/a.ai', n: 'a.ai', prints: [], cut: null }
], 'aiFile legacy fallback');
eq(ST.read({ no: 'L2', aiFiles: JSON.stringify([{ p: '/jobs/a.ai', n: 'A', prints: ['/print/a.tif'], legacy: { keep: true } }]) }).files, [
  { p: '/jobs/a.ai', n: 'A', prints: [{ p: '/print/a.tif', n: 'a.tif' }], cut: null, legacy: { keep: true } }
], 'aiFiles JSON string and per-file print');
eq(ST.read({ no: 'L3', aiFiles: [{ p: '/jobs/b.ai', n: 'B' }] }).files, [
  { p: '/jobs/b.ai', n: 'B', prints: [], cut: null }
], 'aiFiles array');

// Stored string/map records are accepted; current job no is authoritative.
const stored = {
  v: 1,
  no: 'stored-old',
  rootMeta: { keep: 'root' },
  files: [{ p: '/jobs/a.ai', n: 'stored-name', entryMeta: 'stored', cut: cut({ cutMeta: 'stored' }) }],
  printFiles: [{ p: '/print/doc.tif', n: 'doc.tif', printMeta: 1 }]
};
const merged = ST.read({
  no: 'latest-no',
  stProduction: JSON.stringify(stored),
  aiFiles: [{ p: '/jobs/a.ai', n: 'legacy-name', entryLegacy: true, prints: [{ p: '/print/per-file.tif', n: 'per-file.tif' }], cut: cut({ cutLegacy: true }) }, { p: '/jobs/b.ai', n: 'B' }],
  printFiles: JSON.stringify([{ p: '/print/doc.tif', n: 'new-doc-name' }, '/print/document-only.pdf'])
});
same(merged.no, 'latest-no', 'current no preserved');
same(merged.rootMeta.keep, 'root', 'unknown root metadata preserved');
same(merged.files.length, 2, 'exact path dedup');
same(merged.files[0].n, 'stored-name', 'stored production metadata wins for duplicate path');
ok(merged.files[0].entryMeta === 'stored' && merged.files[0].entryLegacy === true, 'unknown entry metadata from both sources preserved');
ok(merged.files[0].cut.cutMeta === 'stored' && merged.files[0].cut.cutLegacy === true, 'unknown cut metadata from both sources preserved');
same(merged.files[0].prints.length, 1, 'per-file print retained');
same(merged.printFiles.length, 2, 'document printFiles remain top-level');
same(merged.printFiles[0].p, '/print/doc.tif', 'document print exact path retained');
same(merged.files[0].cut.snap.paths[0].p[4], 10, 'document printFiles not guessed onto cut file');
same(ST.read({ no: 'PRINT-STRING', printFiles: '/print/single.tif' }).printFiles[0].p, '/print/single.tif', 'plain document print path string');

// Exact st_cutRead paths/marks survive stringify and JSON round-trip unchanged.
const exactRecord = ST.setFile(ST.read({ no: 'EXACT' }), { p: '/exact.ai', n: 'exact.ai', cut: cut() });
const roundTrip = ST.read({ no: 'EXACT', stProduction: ST.stringify(exactRecord) });
eq(roundTrip.files[0].cut.snap, exactRecord.files[0].cut.snap, 'paths and marks exact roundtrip');
eq(roundTrip.files[0].cut.view, exactRecord.files[0].cut.view, 'view exact roundtrip');
same(roundTrip.files[0].cut.snap.paths[1].p[0], -1.25, 'negative coordinate retained');

// Driver and settings values normalize without cross-file leakage.
const d1 = ST.normalizeDrv({ on: false, kS: '71', kF: '38', kA: '2', dS: '50', dF: '25', dA: '3', extra: 'keep' });
eq(d1, { on: false, kS: 71, kF: 38, kA: 2, dS: 50, dF: 25, dA: 3, extra: 'keep' }, 'driver numeric strings normalized and on=false allowed');
const s1 = ST.normalizeSettings({ lang: 'hpgl', step: '0.5', rotate: true, mirror: false, overcut: '3', useMk: false, cond: '8', first: 'piece', nm: { rollW: '100', x0: 0, y0: '2', gx: '3', gy: 4, copies: '500' } });
eq(s1, { lang: 'hpgl', step: 0.5, rotate: true, mirror: false, overcut: 3, useMk: false, cond: 8, first: 'piece', nm: { rollW: 100, x0: 0, y0: 2, gx: 3, gy: 4, copies: 500 } }, 'settings numeric strings normalized');
const isolated = ST.read({ no: 'DRV' });
const withTwo = ST.setFile(ST.setFile(isolated, { p: '/one.ai', cut: cut({ drv: { on: true, kS: 71, kF: 38, kA: 2, dS: 50, dF: 25, dA: 2 } }) }), { p: '/two.ai', cut: cut({ drv: { on: false, kS: 60, kF: 30, kA: 1, dS: 40, dF: 20, dA: 3 } }) });
same(withTwo.files[0].cut.drv.kS, 71, 'first file driver isolated');
same(withTwo.files[1].cut.drv.kS, 60, 'second file driver isolated');

// Immutable setFile merges by exact p and does not erase omitted data.
const before = ST.setFile(ST.read({ no: 'IMM' }), { p: '/same.ai', n: 'old', keep: { a: 1 }, cut: cut({ keepCut: true }), prints: [{ p: '/p1.tif' }] });
const beforeJson = JSON.stringify(before);
const after = ST.setFile(before, { p: '/same.ai', n: 'new', keep2: true, prints: [{ p: '/p2.tif' }] });
same(JSON.stringify(before), beforeJson, 'setFile is immutable');
same(after.files.length, 1, 'setFile merges exact p');
same(after.files[0].n, 'new', 'setFile updates supplied known property');
ok(after.files[0].keep.a === 1 && after.files[0].keep2 === true, 'setFile preserves unrelated entry metadata');
ok(after.files[0].cut.keepCut === true && after.files[0].prints.some((p) => p.p === '/p1.tif') && after.files[0].prints.some((p) => p.p === '/p2.tif'), 'setFile preserves omitted cut and merges prints');

// normalizeFile and validateCut return safe canonical copies.
const nf = ST.normalizeFile({ p: '/a.ai', prints: '"/a.tif"', custom: { x: 1 }, cut: cut({ customCut: 7 }) });
same(nf.n, 'a.ai', 'normalizeFile derives display name only');
same(nf.prints[0].p, '/a.tif', 'normalizeFile accepts a print path string');
same(nf.cut.customCut, 7, 'validateCut preserves unknown cut property');

// Corrupted production/cut/driver/settings data fails loudly in Thai.
throws(() => ST.read({ no: 'BAD', stProduction: '{oops' }), 'stProduction', 'bad stProduction JSON');
throws(() => ST.read({ no: 'BAD', stProduction: JSON.stringify({ v: 2, files: [] }) }), 'v=1', 'unsupported production version');
throws(() => ST.read({ no: 'BAD', stProduction: JSON.stringify({ v: 1, files: [{ p: '/bad.ai', cut: { snap: { paths: [{ c: 1, k: 'kiss', p: [0, 1, 2] }] } } }] }) }), '6 ค่า', 'malformed six-coordinate path');
throws(() => ST.validateCut({ snap: { paths: [{ c: 1, k: 'kiss', p: [0, NaN, 0, 0, 1, 1] }] } }), 'finite', 'nonfinite coordinate');
throws(() => ST.normalizeDrv({ on: 'false' }), 'boolean', 'driver on type');
throws(() => ST.normalizeDrv({ on: false, kS: '' }), 'ค่าว่าง', 'empty driver field');
throws(() => ST.normalizeDrv({ on: true, kF: '61' }), 'ไม่เกิน 60', 'driver force range');
throws(() => ST.validateCut({ snap: snap(), drv: null }), 'cut.drv', 'null driver is malformed when present');
throws(() => ST.validateCut({ snap: snap(), settings: null }), 'cut.settings', 'null settings are malformed when present');
throws(() => ST.normalizeSettings({ step: 0 }), 'มากกว่า 0', 'step lower bound');
throws(() => ST.normalizeSettings({ overcut: 101 }), 'ไม่เกิน 100', 'overcut upper bound');
throws(() => ST.normalizeSettings({ cond: 1.5 }), 'จำนวนเต็ม', 'condition integer');
throws(() => ST.normalizeSettings({ nm: { copies: 0 } }), 'ไม่น้อยกว่า 1', 'copies lower bound');
throws(() => ST.normalizeSettings({ nm: { rollW: 1000001 } }), 'ไม่เกิน 1000000', 'nm range');
throws(() => ST.normalizeSettings(new Date()), 'plain object', 'unsafe non-plain settings');

throws(() => ST.validateCut(cut({ snap: snap({ marks: { style: 1 } }) })), 'marks', 'incomplete mark geometry');
throws(() => ST.validateCut(cut({ view: { ab: [0], marks: [] } })), 'view', 'bad preview artboard');
throws(() => ST.validateCut(cut({ snap: snap({ n: 999 }) })), 'จำนวนเส้น', 'line count mismatch');
const unmarked = snap(); delete unmarked.marks;
const newScan = ST.setFile(before, { p: '/same.ai', cut: cut({ snap: unmarked, view: null, sentAt: null }) });
same(newScan.files[0].cut.snap.marks, undefined, 'new unmarked scan must not inherit previous marks');
same(newScan.files[0].cut.view, null, 'new scan clears previous mark view');
same(newScan.files[0].cut.sentAt, null, 'new scan is not previously sent');

// UTF-8 limit is enforced without Buffer and allows exact-size ordinary records.
const emoji = '🙂'.repeat(200000);
throws(() => ST.stringify(ST.setFile(ST.read({ no: 'BIG' }), { p: '/big.ai', meta: emoji })), '650000', 'UTF-8 size limit');
same(ST.utf8Bytes('ก'), 3, 'UTF-8 byte counter');
same(ST.utf8Bytes('🙂'), 4, 'UTF-8 surrogate-pair byte counter');

console.log(`job-memory tests: ${passed} assertions passed`);
