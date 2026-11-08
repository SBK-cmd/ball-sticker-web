'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const STPathMap = require(path.join(__dirname, '..', 'SignTools', 'js', 'path-map.js'));

const map = (windows, mac) => ({ windows, mac });
const expectBad = (fn, pattern = /พาธไม่ถูกต้อง/) => {
  assert.throws(fn, pattern);
};

 test('exports the requested API and browser UMD global', () => {
  assert.deepEqual(Object.keys(STPathMap).sort(), [
    'candidates', 'equivalent', 'normalize', 'rootOf', 'validateMaps'
  ]);
  const source = fs.readFileSync(path.join(__dirname, '..', 'SignTools', 'js', 'path-map.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(typeof window.STPathMap.normalize, 'function');
  const combined = { window: {}, module: { exports: {} } };
  vm.runInNewContext(source, combined);
  assert.equal(combined.window.STPathMap, combined.module.exports);
});

test('normalizes drive and UNC paths with mixed separators and redundant separators', () => {
  assert.deepEqual(STPathMap.normalize('c:/Work//Art\\File.ai'), {
    path: 'c:\\Work\\Art\\File.ai', kind: 'windows', root: 'c:\\'
  });
  assert.deepEqual(STPathMap.normalize('\\\\Server/Share\\Folder//File.ai'), {
    path: '\\\\Server\\Share\\Folder\\File.ai',
    kind: 'windows', root: '\\\\Server\\Share'
  });
  assert.deepEqual(STPathMap.normalize('C:/'), {
    path: 'C:\\', kind: 'windows', root: 'C:\\'
  });
});

test('keeps POSIX backslashes as filename characters and identifies only explicit Volumes mounts', () => {
  assert.deepEqual(STPathMap.normalize('/Users/A\\B//งาน.ai'), {
    path: '/Users/A\\B/งาน.ai', kind: 'posix', root: null
  });
  assert.equal(STPathMap.rootOf('/Volumes/Share-1/folder/file'), '/Volumes/Share-1');
  assert.equal(STPathMap.rootOf('/Volumes/Share-1-other/folder'), '/Volumes/Share-1-other');
  assert.equal(STPathMap.rootOf('/Volumes'), null);
  assert.equal(STPathMap.rootOf('/Users/Share-1/folder'), null);
});

test('matches Unicode roots by NFC while retaining original filename spelling', () => {
  const nfdRoot = '/Users/e\u0301/Project';
  const nfdFile = `${nfdRoot}/cafe\u0301.ai`;
  const result = STPathMap.candidates(nfdFile, [map('S:/Project', '/Users/é/Project')], 'win32');
  assert.equal(result.original.path, nfdFile);
  assert.equal(result.mapped[0].path, 'S:\\Project\\cafe\u0301.ai');
  assert.equal(result.mapped[0].from, '/Users/é/Project');
});

test('decodes file URLs by segment and supports drive, UNC, and localhost forms', () => {
  assert.equal(STPathMap.normalize('file:///C:/งาน%20ใหม่/a.ai').path, 'C:\\งาน ใหม่\\a.ai');
  assert.equal(STPathMap.normalize('file://Server/Share/%E0%B8%87%E0%B8%B2%E0%B8%99.ai').path, '\\\\Server\\Share\\งาน.ai');
  assert.equal(STPathMap.normalize('file://localhost/Users/me/a%20b.ai').path, '/Users/me/a b.ai');
  expectBad(() => STPathMap.normalize('file:///tmp/a%2Fb'));
  expectBad(() => STPathMap.normalize('file:///tmp/a%5Cb'));
  expectBad(() => STPathMap.normalize('file:///tmp/a%00b'));
  expectBad(() => STPathMap.normalize('file:///tmp/%ZZ'));
});

test('preserves ordinary percent signs in non-URL POSIX filenames', () => {
  assert.equal(STPathMap.normalize('/Users/me/100%/งาน.ai').path, '/Users/me/100%/งาน.ai');
});

test('rejects traversal, relative, unsupported URL, device, and control paths', () => {
  [
    '../a', './a', 'a/b', 'C:relative', '/Users/../secret', 'C:/Users/../secret',
    '\\\\?\\C:\\secret', '\\\\.\\C:\\secret', 'http://example/a',
    '/Users/a\u0000b', '/Users/a\n b'
  ].forEach((value) => expectBad(() => STPathMap.normalize(value)));
});

test('rejects Windows invalid tail characters but permits them in POSIX paths', () => {
  expectBad(() => STPathMap.normalize('C:/bad:name/file.ai'));
  expectBad(() => STPathMap.normalize('\\\\server\\share\\bad|name'));
  assert.equal(STPathMap.normalize('/tmp/bad:name|file').path, '/tmp/bad:name|file');
  const result = STPathMap.candidates('/Users/me/Project/bad:name.ai', [map('C:/Project', '/Users/me/Project')], 'win32');
  assert.deepEqual(result.mapped, []);
  assert.equal(result.needsMapping, true);
});

test('validateMaps canonicalizes, strips extra fields, deduplicates, and does not mutate input', () => {
  const rules = [
    { windows: 'C:/Project//', mac: '/Users/me/Project//', extra: 'ignore' },
    { windows: 'C:\\Project', mac: '/Users/me/Project' }
  ];
  const before = JSON.stringify(rules);
  assert.deepEqual(STPathMap.validateMaps(rules), [{ windows: 'C:\\Project', mac: '/Users/me/Project' }]);
  assert.equal(JSON.stringify(rules), before);
});

test('validateMaps accepts nested absolute roots and rejects malformed map sides', () => {
  assert.deepEqual(STPathMap.validateMaps([
    map('\\\\Server\\Share\\Project', '/Volumes/Design/Project'),
    map('D:/Assets', '/Users/me/Assets')
  ]), [
    { windows: '\\\\Server\\Share\\Project', mac: '/Volumes/Design/Project' },
    { windows: 'D:\\Assets', mac: '/Users/me/Assets' }
  ]);
  expectBad(() => STPathMap.validateMaps([map('/not/windows', '/Users/me')]));
  expectBad(() => STPathMap.validateMaps([map('C:/Windows', 'relative')]));
  expectBad(() => STPathMap.validateMaps([map('C:/Windows', '\\\\server\\share')]));
});

test('validateMaps preserves explicit alternatives and rejects more than twenty unique pairs', () => {
  assert.equal(STPathMap.validateMaps([
    map('C:/Project', '/Users/me/One'),
    map('c:/project', '/Users/me/Two')
  ]).length, 2);
  assert.equal(STPathMap.validateMaps([
    map('C:/One', '/Users/me/Same'),
    map('D:/Two', '/Users/me/Same')
  ]).length, 2);
  const tooMany = [];
  for (let i = 0; i < 21; i += 1) tooMany.push(map(`C:/P${i}`, `/Users/me/P${i}`));
  expectBad(() => STPathMap.validateMaps(tooMany));
});

test('uses segment-boundary matching and longest nested source rule', () => {
  const rules = [
    map('C:/Project', '/Users/me/Project'),
    map('D:/Nested', '/Users/me/Project/Nested'),
    map('E:/Other', '/Users/me/Project-Other')
  ];
  const nested = STPathMap.candidates('/Users/me/Project/Nested/file.ai', rules, 'win32');
  assert.deepEqual(nested.mapped, [{
    path: 'D:\\Nested\\file.ai', root: 'D:\\Nested',
    from: '/Users/me/Project/Nested', mode: 'mapped'
  }]);
  const collision = STPathMap.candidates('/Users/me/Project-Other/file.ai', rules, 'win32');
  assert.equal(collision.mapped[0].path, 'E:\\Other\\file.ai');
  const noPrefix = STPathMap.candidates('/Users/me/Project-other/file.ai', rules, 'win32');
  assert.equal(noPrefix.needsMapping, true);
});

test('does not guess Volumes mappings and refuses POSIX backslash names to Windows', () => {
  const noGuess = STPathMap.candidates('/Volumes/Share-1/file.ai', [map('C:/Share', '/Volumes/Share')], 'win32');
  assert.deepEqual(noGuess.mapped, []);
  const unsafe = STPathMap.candidates('/Users/me/Project/file\\name.ai', [map('C:/Project', '/Users/me/Project')], 'win32');
  assert.equal(unsafe.needsMapping, true);
  assert.deepEqual(unsafe.mapped, []);
});

test('reports compatibility and never adds mappings when the original is native', () => {
  const rules = [map('C:/Project', '/Users/me/Project')];
  assert.deepEqual(STPathMap.candidates('C:/Project/a.ai', rules, 'win32'), {
    original: { path: 'C:\\Project\\a.ai', compatible: true }, mapped: [], needsMapping: false
  });
  assert.equal(STPathMap.candidates('/Users/me/Project/a.ai', rules, 'darwin').original.compatible, true);
  assert.equal(STPathMap.candidates('/Users/me/Project/a.ai', rules, 'linux').original.compatible, true);
  expectBad(() => STPathMap.candidates('/tmp/a', [], 'freebsd'));
});

test('returns all same-specificity mapped targets and deduplicates target identity', () => {
  const rules = [
    map('C:/One', '/Users/me/One'),
    map('D:/Two', '/Users/me/Two'),
    map('C:/Three', '/Users/me/Three')
  ];
  const result = STPathMap.candidates('D:/Two/file.ai', rules, 'darwin');
  assert.deepEqual(result.mapped, [{
    path: '/Users/me/Two/file.ai', root: '/Users/me/Two',
    from: 'D:\\Two', mode: 'mapped'
  }]);
  const alternatives = STPathMap.candidates('C:/Project/file.ai', [map('C:/Project', '/Volumes/a'), map('c:/project', '/Volumes/b')], 'darwin');
  assert.deepEqual(alternatives.mapped.map(x => x.path), ['/Volumes/a/file.ai', '/Volumes/b/file.ai']);
  const aliases = STPathMap.candidates('S:/file.ai', [map('S:/', '/Volumes/share'), map('\\\\server\\share', '/Volumes/share')], 'darwin');
  assert.equal(aliases.mapped[0].path, '/Volumes/share/file.ai');
});

test('equivalent is platform-aware, bidirectional, explicit, and boundary-safe', () => {
  const rules = [map('C:/Project', '/Users/me/Project')];
  assert.equal(STPathMap.equivalent('C:/PROJECT/Art.ai', 'c:/project/art.ai', []), true);
  assert.equal(STPathMap.equivalent('/Users/me/e\u0301', '/Users/me/é', []), true);
  assert.equal(STPathMap.equivalent('/Users/me/Project/Art.ai', 'C:/Project/Art.ai', rules), true);
  assert.equal(STPathMap.equivalent('C:/Project/Art.ai', '/Users/me/Project/Art.ai', rules), true);
  assert.equal(STPathMap.equivalent('/Users/me/Project/Art.ai', 'C:/Project/ART.ai', rules), false);
  assert.equal(STPathMap.equivalent('C:/Project/Art.ai', '/Users/me/Project/Other.ai', rules), false);
  assert.equal(STPathMap.equivalent('C:/Project/Art.ai', '/Users/me/ProjectX/Art.ai', rules), false);
  assert.equal(STPathMap.equivalent('C:/Project/Art.ai', '/Other/Project/Art.ai', rules), false);
  assert.equal(STPathMap.equivalent('/Users/me/Project/Art.ai', '/Users/me/Project/art.ai', []), false);
});

test('file URLs cannot hide traversal or Windows device paths', () => {
  for (const p of ['file:///Volumes/share/../private.ai', 'file:///Volumes/share/%2e%2e/private.ai', 'file:///C:/share/../private.ai', 'file://./share/file.ai']) {
    expectBad(() => STPathMap.normalize(p));
  }
  assert.equal(STPathMap.normalize('file:///Volumes/share/./file.ai').path, '/Volumes/share/file.ai');
});
