/* SignTools per-computer path IO. Does not modify cloud paths or file contents. */
(function (root) {
  'use strict';
  var KEY = 'st_path_maps_v1', LIMIT_MS = 2500;
  function mapper() { if (!root.STPathMap) throw new Error('โมดูลเทียบพาธยังไม่พร้อม'); return root.STPathMap; }
  function requireNode(name) {
    var R = root.cep_node && root.cep_node.require;
    if (!R) throw new Error('ตรวจไฟล์ได้เฉพาะใน Illustrator ที่เปิดใช้ CEP Node');
    return R(name);
  }
  function platform() {
    try { var p = requireNode('os').platform(); if (p === 'win32' || p === 'darwin' || p === 'linux') return p; } catch (e) {}
    var p0 = root.navigator && root.navigator.platform || '';
    return /win/i.test(p0) ? 'win32' : /mac/i.test(p0) ? 'darwin' : 'linux';
  }
  function readMaps() {
    var text;
    try { text = root.localStorage.getItem(KEY); } catch (e) { throw new Error('อ่านการตั้งค่าพาธของเครื่องนี้ไม่ได้'); }
    if (!text) return [];
    var config;
    try { config = JSON.parse(text); } catch (e2) { throw new Error('การตั้งค่าพาธเสีย — เปิดตั้งค่า NAS แล้วล้าง/ตั้งใหม่ (ใบงานไม่ถูกลบ)'); }
    if (!config || config.v !== 1 || !Array.isArray(config.rules)) throw new Error('การตั้งค่าพาธรุ่นนี้อ่านไม่ได้ — กรุณาตั้งใหม่');
    return mapper().validateMaps(config.rules);
  }
  function saveMaps(rules) {
    var valid = mapper().validateMaps(rules);
    try { root.localStorage.setItem(KEY, JSON.stringify({ v: 1, rules: valid })); }
    catch (e) { throw new Error('เก็บการตั้งค่าพาธไม่ได้ — พื้นที่/สิทธิ์ localStorage ของเครื่องนี้ไม่พร้อม'); }
    return valid;
  }
  function clearMaps() {
    try { root.localStorage.removeItem(KEY); } catch (e) { throw new Error('ล้างการตั้งค่าพาธไม่ได้'); }
  }
  function ioError(message, code) { var e = new Error(message); e.code = code || 'EPATH'; return e; }
  function stat(p) {
    return new Promise(function (resolve, reject) {
      var fs;
      try { fs = requireNode('fs'); } catch (e) { reject(e); return; }
      if (typeof fs.stat !== 'function') { reject(ioError('CEP Node ไม่มี fs.stat สำหรับตรวจไฟล์', 'EPATHIO')); return; }
      var finished = false, timer = setTimeout(function () {
        if (finished) return; finished = true;
        reject(ioError('หมดเวลาตรวจไฟล์/NAS — ตรวจการเชื่อมต่อแล้วลองใหม่', 'ETIMEDOUT'));
      }, LIMIT_MS);
      try {
        fs.stat(p, function (error, info) {
          if (finished) return; finished = true; clearTimeout(timer);
          if (error) reject(error); else resolve(info);
        });
      } catch (e2) { if (!finished) { finished = true; clearTimeout(timer); reject(e2); } }
    });
  }
  function mtimeOf(info) { return typeof info.mtimeMs === 'number' ? info.mtimeMs : info.mtime && typeof info.mtime.getTime === 'function' ? info.mtime.getTime() : null; }
  function absent(e) { return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'); }
  function isFile(s) { return s && typeof s.isFile === 'function' && s.isFile(); }
  function inspectCandidate(c) {
    return stat(c.path).then(function (s) {
      if (!isFile(s)) return { candidate: c, missing: true };
      return { candidate: c, found: { path: c.path, mapped: !!c.mapped, root: c.root || null, mtime: mtimeOf(s) } };
    }, function (e) { return { candidate: c, missing: absent(e), error: e }; });
  }
  function resolveFile(p) {
    var plan;
    try { plan = mapper().candidates(p, readMaps(), platform()); }
    catch (e) { return Promise.reject(e); }
    var direct = plan.original.compatible ? inspectCandidate({ path: plan.original.path, mapped: false }) : Promise.resolve(null);
    return direct.then(function (d) {
      if (d && d.found) return d.found;
      if (d && d.error && !d.missing) throw ioError('เปิดพาธเดิมไม่ได้: ' + (d.error.code || d.error.message) + ' — ตรวจสิทธิ์/NAS ก่อน', d.error.code);
      if (!plan.mapped.length) {
        if (plan.needsMapping) throw ioError('พาธคนละระบบ — กด “ตั้งค่า NAS / พาธ” แล้วเลือกโฟลเดอร์รากของเครื่องนี้ครั้งเดียว', 'ENEEDMAP');
        throw ioError('ไม่พบไฟล์ตามพาธเดิม — ตรวจ NAS/ไฟล์ที่ย้าย (ยังไม่ค้นหาไฟล์ชื่อคล้ายกัน)', 'ENOENT');
      }
      var paths = plan.mapped.map(function (c) { return { path: c.path, root: c.root, mapped: true }; });
      return Promise.all(paths.map(inspectCandidate)).then(function (results) {
        var found = results.filter(function (x) { return x.found; }), uncertain = results.filter(function (x) { return x.error && !x.missing; });
        // Unknown/unreachable candidate must never be ignored in favour of another file.
        if (uncertain.length) throw ioError('ตรวจทุกพาธที่ตั้งไว้ไม่ได้ (' + (uncertain[0].error.code || 'NAS/สิทธิ์') + ') — ยังไม่เลือกไฟล์แทน', uncertain[0].error.code);
        if (found.length > 1) throw ioError('พบไฟล์มากกว่า 1 พาธที่ตั้งไว้ — กรุณาแก้การเทียบโฟลเดอร์ให้ชัดเจน ยังไม่เปิดไฟล์แทน', 'EAMBIGUOUS');
        var roots = [];
        results.forEach(function (x) { if (!x.found && roots.indexOf(x.candidate.root) < 0) roots.push(x.candidate.root); });
        return Promise.all(roots.map(function (r) { return stat(r).then(function (s) { return typeof s.isDirectory === 'function' && s.isDirectory(); }, function () { return false; }); })).then(function (present) {
          if (present.some(function (v) { return !v; })) throw ioError('โฟลเดอร์ราก NAS ยังเข้าไม่ได้ — เชื่อม NAS หรือเลือกโฟลเดอร์ที่เมานต์จริงในตั้งค่า', 'ENASOFFLINE');
          if (found.length === 1) return found[0].found;
          throw ioError('NAS เข้าได้ แต่ไม่พบไฟล์ในตำแหน่งย่อยเดิม — ไฟล์อาจย้าย ยังไม่ค้นหา/เดาชื่อแทน', 'ENOENT');
        });
      });
    });
  }
  function mtime(p) {
    // Optional freshness check only; missing source or NAS never blocks a stored cut.
    var plan, path;
    try {
      plan = mapper().candidates(p, readMaps(), platform());
      path = plan.original.compatible ? plan.original.path : plan.mapped.length === 1 ? plan.mapped[0].path : null;
    } catch (e) { return Promise.resolve(null); }
    if (!path) return Promise.resolve(null);
    return stat(path).then(function (s) { return isFile(s) ? mtimeOf(s) : null; }, function () { return null; });
  }
  function equivalent(a, b) { return mapper().equivalent(a, b, readMaps()); }
  function pickFolder() {
    return new Promise(function (resolve, reject) {
      if (!root.__adobe_cep__) { reject(new Error('เลือกโฟลเดอร์ได้เฉพาะใน Illustrator')); return; }
      // Reuses existing JSON quoting helpers; no modification of stable host.jsx.
      var code = '(function(){try{var f=Folder.selectDialog("เลือกโฟลเดอร์ NAS ที่เครื่องนี้เปิดได้ (เช่น ballsticker)");return f ? "{\\"ok\\":true,\\"path\\":"+st_q(f.fsName)+"}" : "{\\"cancel\\":true}";}catch(e){return st_err(e.message);}})()';
      code = code.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
      root.__adobe_cep__.evalScript(code, function (result) {
        var data;
        try { data = JSON.parse(result); } catch (e) { reject(new Error('ตัวเลือกโฟลเดอร์ยังไม่พร้อม: ' + String(result).slice(0, 150))); return; }
        if (data.cancel) { resolve(data); return; }
        if (data.error || !data.path) { reject(new Error(data.error || 'ไม่ได้รับพาธโฟลเดอร์')); return; }
        var p;
        try { p = mapper().normalize(data.path).path; } catch (e2) { reject(e2); return; }
        stat(p).then(function (s) {
          if (!s || typeof s.isDirectory !== 'function' || !s.isDirectory()) throw new Error('พาธที่เลือกไม่ใช่โฟลเดอร์ที่อ่านได้');
          resolve({ path: p });
        }).catch(reject);
      });
    });
  }
  root.STPathIO = { platform: platform, readMaps: readMaps, saveMaps: saveMaps, clearMaps: clearMaps,
    resolveFile: resolveFile, mtime: mtime, equivalent: equivalent, pickFolder: pickFolder };
}(window));
