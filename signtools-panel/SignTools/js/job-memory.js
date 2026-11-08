/* SignTools job-memory: Firestore production data adapter (pure ES5, no DOM/Node APIs). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (root) root.STJobMemory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  var hop = Object.prototype.hasOwnProperty;
  var MAX_BYTES = 650000;

  function has(o, k) { return o != null && hop.call(o, k); }
  function finiteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function plainObject(o) {
    var p;
    if (!o || Object.prototype.toString.call(o) !== '[object Object]') return false;
    if (!Object.getPrototypeOf) return true;
    p = Object.getPrototypeOf(o);
    return p === Object.prototype || p === null;
  }
  function ownKeys(o) { return Object.keys(o); }
  function thai(scope, message) { throw new Error(scope + ' ไม่ถูกต้อง: ' + message); }

  /* Clone only JSON-compatible data. This also rejects NaN, Infinity, functions,
   * host objects, and cycles before JSON.stringify can silently alter them. */
  function cloneValue(v, scope, stack) {
    var i, k, out, j;
    scope = scope || 'ข้อมูล';
    stack = stack || [];
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!finiteNumber(v)) thai(scope, 'พบตัวเลขที่ไม่เป็น finite');
      return v;
    }
    if (typeof v !== 'object') thai(scope, 'ชนิดข้อมูลไม่ปลอดภัย');
    for (j = 0; j < stack.length; j++) if (stack[j] === v) thai(scope, 'ข้อมูลวนซ้ำ');
    stack.push(v);
    if (Array.isArray(v)) {
      out = [];
      for (i = 0; i < v.length; i++) out.push(cloneValue(v[i], scope, stack));
      stack.pop();
      return out;
    }
    if (!plainObject(v)) thai(scope, 'ต้องเป็น plain object');
    out = {};
    ownKeys(v).forEach(function (key) {
      var val = cloneValue(v[key], scope + '.' + key, stack);
      /* Assignment to __proto__ is magical on older Chrome; define it as a
       * data property so unknown metadata remains intact without pollution. */
      if (key === '__proto__' && Object.defineProperty) {
        try { Object.defineProperty(out, key, { value: val, enumerable: true, writable: true, configurable: true }); return; } catch (e) {}
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') thai(scope, 'ชื่อ property ไม่ปลอดภัย: ' + key);
      out[key] = val;
    });
    stack.pop();
    return out;
  }

  function mergeValue(a, b, scope) {
    var out, key;
    if (plainObject(a) && plainObject(b)) {
      out = cloneValue(a, scope || 'ข้อมูล');
      ownKeys(b).forEach(function (k) {
        if (has(out, k) && plainObject(out[k]) && plainObject(b[k])) out[k] = mergeValue(out[k], b[k], (scope || 'ข้อมูล') + '.' + k);
        else out[k] = cloneValue(b[k], (scope || 'ข้อมูล') + '.' + k);
      });
      return out;
    }
    return cloneValue(b, scope || 'ข้อมูล');
  }

  function numberValue(v, scope, min, max, integer) {
    var n;
    if (typeof v === 'string') {
      if (!v.trim()) thai(scope, 'ห้ามเป็นค่าว่าง');
      n = Number(v);
    } else n = v;
    if (!finiteNumber(n)) thai(scope, 'ต้องเป็นตัวเลข finite');
    if (integer && Math.floor(n) !== n) thai(scope, 'ต้องเป็นจำนวนเต็ม');
    if (min != null && n < min) thai(scope, 'ต้องไม่น้อยกว่า ' + min);
    if (max != null && n > max) thai(scope, 'ต้องไม่เกิน ' + max);
    return n;
  }
  function boolValue(v, scope) {
    if (typeof v !== 'boolean') thai(scope, 'ต้องเป็น boolean');
    return v;
  }
  function nonemptyPath(v, scope) {
    if (typeof v !== 'string' || !v.trim()) thai(scope, 'p ต้องเป็น path string ที่ไม่ว่าง');
    return v;
  }
  function basename(path) {
    var s = String(path), m = /[^\\\/]+$/.exec(s);
    return m ? m[0] : s;
  }

  function parseJsonString(v, scope) {
    var text, parsed;
    if (typeof v !== 'string') return v;
    text = v.trim();
    if (!text) return null;
    try { parsed = JSON.parse(text); } catch (e) { thai(scope, 'JSON เสียหรืออ่านไม่ได้'); }
    return parsed;
  }

  function normalizeDrv(d) {
    var out, fields = [
      ['kS', 1, 100], ['dS', 1, 100],
      ['kF', 1, 60], ['dF', 1, 60],
      ['kA', 1, 3], ['dA', 1, 3]
    ];
    if (d == null) return null;
    if (!plainObject(d)) thai('drv', 'ต้องเป็น plain object');
    out = cloneValue(d, 'drv');
    if (!has(d, 'on')) thai('drv', 'ต้องมี on เป็น boolean');
    out.on = boolValue(d.on, 'drv.on');
    fields.forEach(function (f) {
      if (has(d, f[0])) out[f[0]] = numberValue(d[f[0]], 'drv.' + f[0], f[1], f[2], true);
    });
    return out;
  }

  function normalizeSettings(s) {
    var out, nm, nmk = ['rollW', 'x0', 'y0', 'gx', 'gy'], i, k;
    if (s == null) return null;
    if (!plainObject(s)) thai('settings', 'ต้องเป็น plain object');
    out = cloneValue(s, 'settings');
    if (has(s, 'lang') && s.lang !== 'gpgl' && s.lang !== 'hpgl') thai('settings.lang', 'ต้องเป็น gpgl หรือ hpgl');
    if (has(s, 'step')) {
      out.step = numberValue(s.step, 'settings.step', 0, 10, false);
      if (!(out.step > 0)) thai('settings.step', 'ต้องมากกว่า 0');
    }
    if (has(s, 'rotate')) out.rotate = boolValue(s.rotate, 'settings.rotate');
    if (has(s, 'mirror')) out.mirror = boolValue(s.mirror, 'settings.mirror');
    if (has(s, 'overcut')) out.overcut = numberValue(s.overcut, 'settings.overcut', 0, 100, false);
    if (has(s, 'useMk')) out.useMk = boolValue(s.useMk, 'settings.useMk');
    if (has(s, 'cond')) out.cond = numberValue(s.cond, 'settings.cond', 1, 8, true);
    if (has(s, 'first') && s.first !== 'kiss' && s.first !== 'die' && s.first !== 'piece') thai('settings.first', 'ต้องเป็น kiss, die หรือ piece');
    if (has(s, 'nm')) {
      nm = s.nm;
      if (!plainObject(nm)) thai('settings.nm', 'ต้องเป็น plain object');
      out.nm = cloneValue(nm, 'settings.nm');
      ownKeys(nm).forEach(function (name) {
        if (name === 'copies') out.nm[name] = numberValue(nm[name], 'settings.nm.copies', 1, 500, true);
        else if (nmk.indexOf(name) >= 0) out.nm[name] = numberValue(nm[name], 'settings.nm.' + name, 0, 1000000, false);
        /* Unknown nm metadata is retained, but remains constrained to safe
         * JSON by cloneValue above. */
      });
    }
    return out;
  }

  function normalizePrintRef(ref, scope) {
    var out, p;
    scope = scope || 'print';
    if (typeof ref === 'string') {
      p = nonemptyPath(ref, scope);
      return { p: p, n: basename(p) };
    }
    if (!plainObject(ref)) thai(scope, 'ต้องเป็น path string หรือ plain object');
    out = cloneValue(ref, scope);
    p = nonemptyPath(ref.p, scope + '.p');
    out.p = p;
    if (has(ref, 'n')) {
      if (ref.n == null) out.n = '';
      else if (typeof ref.n !== 'string' && typeof ref.n !== 'number') thai(scope + '.n', 'ต้องเป็น string');
      else out.n = String(ref.n);
    } else out.n = basename(p);
    return out;
  }

  function parsePrintRefs(value, scope) {
    var parsed, arr, text;
    scope = scope || 'prints';
    if (value == null) return [];
    if (typeof value === 'string') {
      text = value.trim();
      if (!text) return [];
      try { parsed = JSON.parse(text); } catch (e) { return [normalizePrintRef(value, scope + '[0]')]; }
      if (parsed === null) return [];
      /* A plain non-JSON path string is a supported single print path. */
      if (typeof parsed === 'string') return [normalizePrintRef(parsed, scope + '[0]')];
      value = parsed;
    }
    if (Array.isArray(value)) arr = value;
    else if (plainObject(value) && has(value, 'p')) arr = [value];
    else thai(scope, 'ต้องเป็น array หรือ print path');
    return arr.map(function (r, i) { return normalizePrintRef(r, scope + '[' + i + ']'); });
  }

  function mergePrints(a, b, scope) {
    var out = [], index = {}, all = (a || []).concat(b || []), i, r, old;
    scope = scope || 'prints';
    for (i = 0; i < all.length; i++) {
      r = normalizePrintRef(all[i], scope + '[' + i + ']');
      if (!has(index, r.p)) { index[r.p] = out.length; out.push(r); }
      else {
        old = out[index[r.p]];
        out[index[r.p]] = normalizePrintRef(mergeValue(old, r, scope + '[' + i + ']'), scope + '[' + i + ']');
      }
    }
    return out;
  }

  function validateSnap(snap) {
    var out, paths, i, path, p, j;
    if (!plainObject(snap)) thai('cut.snap', 'ต้องเป็น st_cutRead plain object');
    out = cloneValue(snap, 'cut.snap');
    if (!has(snap, 'paths') || !Array.isArray(snap.paths)) thai('cut.snap.paths', 'ต้องเป็น array');
    paths = snap.paths;
    for (i = 0; i < paths.length; i++) {
      path = paths[i];
      if (!plainObject(path)) thai('cut.snap.paths[' + i + ']', 'ต้องเป็น plain object');
      if (!has(path, 'c') || (path.c !== 0 && path.c !== 1)) thai('cut.snap.paths[' + i + '].c', 'ต้องเป็น 0 หรือ 1');
      if (!has(path, 'k') || (path.k !== 'kiss' && path.k !== 'die')) thai('cut.snap.paths[' + i + '].k', 'ต้องเป็น kiss หรือ die');
      if (!has(path, 'p') || !Array.isArray(path.p) || path.p.length < 12 || path.p.length % 6) thai('cut.snap.paths[' + i + '].p', 'ต้องมีพิกัด 6 ค่า/จุด อย่างน้อย 2 จุด');
      p = path.p;
      for (j = 0; j < p.length; j++) if (!finiteNumber(p[j])) thai('cut.snap.paths[' + i + '].p[' + j + ']', 'พิกัดต้องเป็น finite number');
    }
    if (has(snap, 'n') && (!finiteNumber(snap.n) || snap.n !== paths.length)) thai('cut.snap.n', 'จำนวนเส้นไม่ตรงกับ paths');
    if (has(snap, 'marks') && snap.marks != null) {
      if (!plainObject(snap.marks)) thai('cut.snap.marks', 'ต้องเป็น plain object');
      ['style', 'ox', 'oy', 'dx', 'dy', 'lenMM'].forEach(function (key) {
        if (!has(snap.marks, key) || !finiteNumber(snap.marks[key])) thai('cut.snap.marks.' + key, 'ต้องมีตัวเลข finite');
      });
      if (!(snap.marks.dx > 0 && snap.marks.dy > 0 && snap.marks.lenMM > 0)) thai('cut.snap.marks', 'ขนาด/ระยะมาร์คต้องมากกว่า 0');
      if (has(snap.marks, 'seg')) boolValue(snap.marks.seg, 'cut.snap.marks.seg');
      if (has(snap.marks, 'stepMM') && !(finiteNumber(snap.marks.stepMM) && snap.marks.stepMM > 0)) thai('cut.snap.marks.stepMM', 'ต้องมากกว่า 0');
    }
    /* cloneValue above checks finite values in marks and every other unknown
     * snap field, while this keeps the original paths/marks representation. */
    return out;
  }

  function validateCut(cut) {
    var out;
    if (cut == null) return null;
    if (!plainObject(cut)) thai('cut', 'ต้องเป็น plain object');
    out = cloneValue(cut, 'cut');
    if (!has(cut, 'snap')) thai('cut.snap', 'ต้องมี snapshot');
    out.snap = validateSnap(cut.snap);
    if (has(cut, 'view') && cut.view != null) {
      if (!plainObject(cut.view) || !Array.isArray(cut.view.ab) || cut.view.ab.length !== 4 || !Array.isArray(cut.view.marks)) thai('cut.view', 'ต้องมี ab 4 ค่า และรายการจุดมาร์ค');
      cut.view.ab.forEach(function (v) { if (!finiteNumber(v)) thai('cut.view.ab', 'พิกัดต้องเป็น finite number'); });
      cut.view.marks.forEach(function (m) {
        if (!Array.isArray(m) || m.length < 2 || !finiteNumber(m[0]) || !finiteNumber(m[1])) thai('cut.view.marks', 'จุดมาร์คต้องเป็นพิกัด finite');
      });
    }
    if (has(cut, 'drv')) {
      if (cut.drv == null) thai('cut.drv', 'ห้ามเป็น null เมื่อระบุ field นี้');
      out.drv = normalizeDrv(cut.drv);
    }
    if (has(cut, 'settings')) {
      if (cut.settings == null) thai('cut.settings', 'ห้ามเป็น null เมื่อระบุ field นี้');
      out.settings = normalizeSettings(cut.settings);
    }
    return out;
  }

  function normalizeFile(f) {
    var out, prints, printAlias;
    if (!plainObject(f)) thai('file', 'ต้องเป็น plain object');
    out = cloneValue(f, 'file');
    out.p = nonemptyPath(f.p, 'file.p');
    if (has(f, 'n')) {
      if (f.n == null) out.n = '';
      else if (typeof f.n !== 'string' && typeof f.n !== 'number') thai('file.n', 'ต้องเป็น string');
      else out.n = String(f.n);
    } else out.n = basename(out.p);
    if (has(f, 'prints')) prints = parsePrintRefs(f.prints, 'file.prints');
    else if (has(f, 'printFiles')) prints = parsePrintRefs(f.printFiles, 'file.printFiles');
    else prints = [];
    out.prints = mergePrints([], prints, 'file.prints');
    out.cut = has(f, 'cut') ? validateCut(f.cut) : null;
    return out;
  }

  function mergeCut(oldCut, newCut) {
    var out = mergeValue(oldCut, newCut, 'cut');
    // Snapshot/ตัวเลือกชุดใหม่แทนทั้งชุด: มาร์คที่หายไปต้องไม่สืบทอดจากสแกนเก่า
    ['snap', 'view', 'drv', 'settings'].forEach(function (k) { if (has(newCut, k)) out[k] = cloneValue(newCut[k], 'cut.' + k); });
    return out;
  }

  function mergeFiles(a, b) {
    var out = [], index = {}, all = (a || []).concat(b || []), i, f, old, merged, prints;
    for (i = 0; i < all.length; i++) {
      f = normalizeFile(all[i]);
      if (!has(index, f.p)) { index[f.p] = out.length; out.push(f); }
      else {
        old = out[index[f.p]];
        merged = mergeValue(old, f, 'file.' + f.p);
        if (all[i].cut) merged.cut = mergeCut(old.cut, f.cut);
        prints = mergePrints(old.prints || [], f.prints || [], 'file.' + f.p + '.prints');
        merged.prints = prints;
        if (!has(all[i], 'n') && has(old, 'n')) merged.n = old.n;
        if (!has(all[i], 'prints') && !has(all[i], 'printFiles')) merged.prints = old.prints;
        /* An omitted cut cannot erase a stored cut; an explicit null can. */
        if (!has(all[i], 'cut') && has(old, 'cut')) merged.cut = old.cut;
        merged = normalizeFile(merged);
        merged.prints = prints;
        out[index[f.p]] = merged;
      }
    }
    return out;
  }

  function parseLegacyFiles(value) {
    var parsed;
    if (value == null) return [];
    if (typeof value === 'string') {
      if (!value.trim()) return [];
      parsed = parseJsonString(value, 'aiFiles');
      value = parsed;
    }
    if (Array.isArray(value)) return value;
    if (plainObject(value) && has(value, 'p')) return [value];
    thai('aiFiles', 'ต้องเป็น JSON array หรือ file object');
  }

  function normalizeRecord(record) {
    var out, files = [], prints = [];
    if (!plainObject(record)) thai('stProduction', 'ต้องเป็น record plain object');
    if (!has(record, 'v') || record.v !== 1) thai('stProduction.v', 'รองรับเฉพาะ v=1');
    out = cloneValue(record, 'stProduction');
    out.v = 1;
    out.no = has(record, 'no') ? String(record.no == null ? '' : record.no) : '';
    if (has(record, 'files')) {
      if (!Array.isArray(record.files)) thai('stProduction.files', 'ต้องเป็น array');
      files = mergeFiles([], record.files);
    }
    if (has(record, 'printFiles')) prints = parsePrintRefs(record.printFiles, 'stProduction.printFiles');
    out.files = files;
    out.printFiles = mergePrints([], prints, 'stProduction.printFiles');
    return out;
  }

  function storedRecord(value) {
    var parsed;
    if (value == null) return null;
    if (typeof value === 'string') {
      if (!value.trim()) return null;
      parsed = parseJsonString(value, 'stProduction');
    } else parsed = value;
    if (!plainObject(parsed)) thai('stProduction', 'ต้องเป็น JSON record map');
    return normalizeRecord(parsed);
  }

  function read(job) {
    var j = job || {}, stored = storedRecord(j.stProduction), legacy, files, topPrints, out;
    legacy = parseLegacyFiles(j.aiFiles);
    if (!legacy.length && has(j, 'aiFile') && j.aiFile != null && String(j.aiFile) !== '') legacy.push({ p: String(j.aiFile), n: has(j, 'aiFileName') ? j.aiFileName : basename(String(j.aiFile)) });
    files = mergeFiles(legacy, stored ? stored.files : []);
    topPrints = mergePrints(parsePrintRefs(j.printFiles, 'job.printFiles'), stored ? stored.printFiles : [], 'printFiles');
    out = stored ? cloneValue(stored, 'record') : { v: 1, no: '', files: [], printFiles: [] };
    out.v = 1;
    /* The current Firestore job number is authoritative; the stored record's
     * no is retained through setFile/stringify and is never guessed from paths. */
    out.no = String(j.no || '');
    out.files = files;
    out.printFiles = topPrints;
    return out;
  }

  function setFile(record, file) {
    var base = normalizeRecord(record), f = normalizeFile(file), out = cloneValue(base, 'record'), i, old, merged;
    for (i = 0; i < base.files.length; i++) if (base.files[i].p === f.p) break;
    if (i === base.files.length) base.files.push(f);
    else {
      old = base.files[i];
      merged = mergeValue(old, f, 'file.' + f.p);
      if (file.cut) merged.cut = mergeCut(old.cut, f.cut);
      merged.prints = mergePrints(old.prints || [], f.prints || [], 'file.' + f.p + '.prints');
      if (!has(file, 'cut') && has(old, 'cut')) merged.cut = old.cut;
      base.files[i] = normalizeFile(merged);
      base.files[i].prints = merged.prints;
    }
    out.files = mergeFiles([], base.files);
    return out;
  }

  function utf8Bytes(s) {
    var i, c, d, n = 0;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + (c - 0xD800) * 0x400 + d - 0xDC00; i++; }
      }
      if (c <= 0x7F) n += 1;
      else if (c <= 0x7FF) n += 2;
      else if (c <= 0xFFFF) n += 3;
      else n += 4;
    }
    return n;
  }

  function stringify(record) {
    var normalized = normalizeRecord(record), text;
    /* normalizeRecord validates every cut, including all coordinates, drv, and
     * settings, and clones unknown data so no caller-owned object is changed. */
    text = JSON.stringify(normalized);
    if (utf8Bytes(text) > MAX_BYTES) thai('stProduction', 'JSON ใหญ่เกิน 650000 ไบต์ UTF-8');
    return text;
  }

  return {
    read: read,
    setFile: setFile,
    stringify: stringify,
    normalizeFile: normalizeFile,
    normalizeDrv: normalizeDrv,
    normalizeSettings: normalizeSettings,
    validateCut: validateCut,
    utf8Bytes: utf8Bytes,
    MAX_BYTES: MAX_BYTES
  };
}));
