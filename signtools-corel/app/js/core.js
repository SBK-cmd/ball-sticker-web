/* Sign Tools — license + online update core (Node.js, runs inside CEP via cep_node.require)
 * Written for old Node too (CEP 8/9 ship Node 7-8): no async/await, no fs recursive options. */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
var cp = require('child_process'), urlMod = require('url');

module.exports = function createCore(opt) {
  var extDir = opt.extDir, dataDir = opt.dataDir;
  var servers = [].concat(opt.server).filter(Boolean);   // ลองตามลำดับ ถ้าตัวแรกต่อไม่ได้ใช้ตัวถัดไป
  var nacl = opt.nacl || require(path.join(extDir, 'js/lib/nacl-fast.min.js'));
  var fflate = opt.fflate || require(path.join(extDir, 'js/lib/fflate.js'));
  var pub = new Uint8Array(Buffer.from(opt.pubkey, 'base64'));
  var now = opt.now || function () { return Math.floor(Date.now() / 1000); };
  var licFile = path.join(dataDir, 'license.json');

  // ---------- fs helpers ----------
  function mkdirp(d) { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); fs.mkdirSync(d); }
  function rmrf(p) {
    if (!fs.existsSync(p)) return;
    if (fs.lstatSync(p).isDirectory()) { fs.readdirSync(p).forEach(function (f) { rmrf(path.join(p, f)); }); fs.rmdirSync(p); }
    else fs.unlinkSync(p);
  }
  function b64uDec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Buffer.from(s, 'base64'); }
  function u8(buf) { return new Uint8Array(buf.buffer, buf.byteOffset, buf.length); }
  function verify(bytes, sig) { return sig.length === 64 && nacl.sign.detached.verify(u8(bytes), u8(sig), pub); }

  // ---------- version ----------
  function readVersion(dir) {
    var m = fs.readFileSync(path.join(dir || extDir, 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([^"]+)"/);
    return m ? m[1] : '0.0.0';
  }
  function cmpVer(a, b) {
    var x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
    return 0;
  }

  // ---------- machine id (stable hardware id, hashed) ----------
  var _mid = opt.machineIdOverride || null;   // ใช้ในการทดสอบเท่านั้น
  function machineId() {
    if (_mid) return _mid;
    var raw = '';
    try {
      if (process.platform === 'win32') {
        var o = cp.execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 4000, windowsHide: true }).toString();
        var m = o.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/); if (m) raw = m[1];
      } else if (process.platform === 'darwin') {
        var o2 = cp.execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 4000 }).toString();
        var m2 = o2.match(/"IOPlatformUUID" = "([^"]+)"/); if (m2) raw = m2[1];
      }
    } catch (e) {}
    if (!raw) raw = os.hostname() + '|' + (os.userInfo ? os.userInfo().username : '');
    _mid = crypto.createHash('sha256').update('signtools|' + raw.toLowerCase()).digest('hex');
    return _mid;
  }
  function machineName() {
    var u = ''; try { u = os.userInfo().username; } catch (e) {}
    return os.hostname() + (u ? ' (' + u + ')' : '') + ' · ' + (process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : process.platform);
  }

  // ---------- http ----------
  function request(url, body, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var u = urlMod.parse(url), lib = u.protocol === 'http:' ? require('http') : require('https');
      if (u.protocol !== 'https:' && !opt.allowHttp) return reject(new Error('ต้องใช้ https'));
      var data = body ? Buffer.from(JSON.stringify(body)) : null, done = false;
      // ตัวจับเวลาสำรอง: ถ้าเงียบเกินกำหนด (เช่น DNS ค้าง) ให้ยกเลิกเอง
      var hard = setTimeout(function () { if (done) return; done = true; try { req.abort(); } catch (e) {} var er = new Error('หมดเวลาเชื่อมต่อ'); er.offline = true; reject(er); }, (opts.timeout || 15000) + 2000);
      var _res = resolve, _rej = reject;
      resolve = function (v) { if (done) return; done = true; clearTimeout(hard); _res(v); };
      reject = function (e) { if (done) return; done = true; clearTimeout(hard); _rej(e); };
      var req = lib.request({
        method: data ? 'POST' : 'GET', hostname: u.hostname, port: u.port, path: u.path,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, timeout: opts.timeout || 15000
      }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if ((opts.redirects || 0) > 4) return reject(new Error('redirect มากเกินไป'));
          return resolve(request(urlMod.resolve(url, res.headers.location), body, { timeout: opts.timeout, redirects: (opts.redirects || 0) + 1, max: opts.max }));
        }
        var chunks = [], size = 0;
        res.on('data', function (c) { size += c.length; if (opts.max && size > opts.max) { req.abort(); reject(new Error('ไฟล์ใหญ่ผิดปกติ')); } else chunks.push(c); });
        res.on('end', function () {
          if (res.statusCode !== 200) return reject(new Error('เซิร์ฟเวอร์ตอบ ' + res.statusCode));
          resolve(Buffer.concat(chunks));
        });
      });
      req.on('timeout', function () { req.abort(); reject(new Error('หมดเวลาเชื่อมต่อ')); });
      req.on('error', function (e) { var er = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); er.offline = true; er.cause = e; reject(er); });
      if (data) req.write(data);
      req.end();
    });
  }
  // ทางที่ 3: เรียก curl ของระบบ (Windows 10+ / Mac มีอยู่แล้ว) — แยก process ไม่โดนปัญหาเน็ตค้างในแผง
  function curlRequest(url, body, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var exe = process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\curl.exe' : '/usr/bin/curl';
      if (!fs.existsSync(exe)) { var e0 = new Error('ไม่มี curl ในเครื่อง'); e0.offline = true; return reject(e0); }
      var sec = String(Math.max(3, Math.round((opts.timeout || 15000) / 1000)));
      var args = ['-sS', '-f', '-L', '--max-redirs', '5', '-m', sec, '--connect-timeout', '6'];
      if (body) args.push('-X', 'POST', '-H', 'Content-Type: text/plain;charset=UTF-8', '--data-binary', '@-');
      args.push(url);
      var ch, out = [], size = 0, err = '', done = false;
      function fin(e, v) { if (done) return; done = true; clearTimeout(hard); if (e) reject(e); else resolve(v); }
      var hard = setTimeout(function () { try { ch.kill(); } catch (e) {} var er = new Error('หมดเวลาเชื่อมต่อ'); er.offline = true; fin(er); }, (opts.timeout || 15000) + 3000);
      try { ch = cp.spawn(exe, args, { windowsHide: true }); } catch (e1) { var er1 = new Error('เรียก curl ไม่ได้'); er1.offline = true; return fin(er1); }
      ch.stdout.on('data', function (c) { size += c.length; if (opts.max && size > opts.max) { try { ch.kill(); } catch (e) {} fin(new Error('ไฟล์ใหญ่ผิดปกติ')); } else out.push(c); });
      ch.stderr.on('data', function (c) { err += c; });
      ch.on('error', function () { var er2 = new Error('เรียก curl ไม่ได้'); er2.offline = true; fin(er2); });
      ch.on('close', function (code) {
        if (code === 0) return fin(null, Buffer.concat(out));
        var er3 = new Error(/22/.test(String(code)) ? 'เซิร์ฟเวอร์ตอบผิดพลาด' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); er3.offline = true; er3.detail = 'curl ' + code + ' ' + err.slice(0, 120); fin(er3);
      });
      if (body) { ch.stdin.on('error', function () {}); ch.stdin.end(JSON.stringify(body)); } else ch.stdin.end();
    });
  }
  // เครือข่าย: หน้าเว็บในแผง → Node → curl ของระบบ · แต่ละทางรอไม่นาน แล้วไปทางถัดไป · จำทางที่ได้ผลไว้ใช้ก่อนครั้งหน้า
  var via = { last: null, good: null };
  try { via.good = JSON.parse(fs.readFileSync(path.join(dataDir, 'net.json'), 'utf8')).good || null; } catch (e0) {}   // จำทางที่ใช้ได้ข้ามการเปิดแผง
  function rememberWay(w) { if (via.good === w) return; via.good = w; try { mkdirp(dataDir); fs.writeFileSync(path.join(dataDir, 'net.json'), JSON.stringify({ good: w })); } catch (e) {} }
  var WAYS = {
    page: function (u, b, o) { return opt.request ? opt.request(u, b, o) : Promise.reject(Object.assign(new Error('no page'), { offline: true })); },
    node: request, curl: curlRequest
  };
  function cap(p, ms) {                       // กันทางที่เงียบหาย (ไม่ตอบ ไม่ error) ให้ตัดไปทางถัดไปเอง
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { var e = new Error('หมดเวลาเชื่อมต่อ'); e.offline = true; rej(e); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function net(url, body, opts) {
    opts = opts || {};
    var order = ['page', 'node', 'curl'];
    if (via.good && via.good !== 'page') order = [via.good].concat(order.filter(function (w) { return w !== via.good; }));
    var step = opts.timeout && opts.timeout > 20000 ? opts : { timeout: 6000, max: opts.max };
    function at(i) {
      return cap(WAYS[order[i]](url, body, step), (step.timeout || 6000) + 1500).then(function (b) { via.last = order[i]; rememberWay(order[i]); return b; }, function (e) {
        if (e && e.http) throw e;                     // เซิร์ฟเวอร์ตอบ error จริง ไม่ต้องลองทางอื่น
        if (i + 1 < order.length) return at(i + 1);
        throw e;
      });
    }
    return at(0);
  }
  // ทดสอบการเชื่อมต่อทุกทาง → ข้อความสรุป (ส่งให้ร้านดูได้)
  function diag() {
    var rows = [], jobs = [];
    servers.forEach(function (sv) {
      ['page', 'node', 'curl'].forEach(function (w) {
        jobs.push(function () {
          var t0 = Date.now();
          return cap(WAYS[w](sv, { action: 'latest' }, { timeout: 8000 }), 9500).then(function (b) {
            var ok = false; try { ok = JSON.parse(b.toString('utf8')).ok; } catch (e) {}
            rows.push(sv.split('/')[2].split('.')[1] + ' ' + w + ': ' + (ok ? 'OK' : 'ตอบผิดรูปแบบ') + ' ' + (Date.now() - t0) + 'ms');
          }, function (e) { rows.push(sv.split('/')[2].split('.')[1] + ' ' + w + ': ✗ ' + e.message + (e.detail ? ' (' + e.detail + ')' : '') + ' ' + (Date.now() - t0) + 'ms'); });
        });
      });
    });
    return jobs.reduce(function (p, j) { return p.then(j); }, Promise.resolve()).then(function () {
      var text = rows.join('\n');
      return api({ action: 'diag', text: (process.platform + ' v' + readVersion() + '\n' + text).slice(0, 900) }).then(function () { return text; }, function () { return text; });
    });
  }
  function api(body) {
    if (opt.product && body && !body.product) body.product = opt.product;   // ai = CorelDRAW (ค่าเดิม) · cdr = CorelDRAW
    var T = {};
    function parse(b) { var j; try { j = JSON.parse(b.toString('utf8')); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ'); } return j; }
    function retryable(e) { return e.offline || /เซิร์ฟเวอร์ตอบ|หมดเวลา|ผิดรูปแบบ|เชื่อมต่อ/.test(e.message); }
    // คำขออ่านอย่างเดียว: ถ้าเซิร์ฟเวอร์แรกเงียบเกิน 3 วิ ยิงเซิร์ฟเวอร์สำรองคู่กันไปเลย ใครตอบก่อนใช้อันนั้น
    if ((body.action === 'latest' || body.action === 'refresh' || body.action === 'member_link' || body.action === 'activate') && servers.length > 1) {
      return new Promise(function (resolve, reject) {
        var done = false, started = 0, failed = 0, lastErr = null, timer;
        function start(i) {
          started++;
          net(servers[i], body, T).then(parse).then(function (j) {
            if (done) return; done = true; clearTimeout(timer); resolve(j);
          }, function (e) {
            lastErr = e; failed++;
            if (done) return;
            if (started < servers.length && retryable(e)) { clearTimeout(timer); start(started); return; }
            if (failed >= started) { done = true; clearTimeout(timer); reject(lastErr); }
          });
        }
        start(0);
        timer = setTimeout(function () { if (!done && started < servers.length) start(started); }, 4000);
      });
    }
    function tryAt(i) {
      return net(servers[i], body, T).then(parse).catch(function (e) {
        if (i + 1 < servers.length && retryable(e)) return tryAt(i + 1);
        throw e;
      });
    }
    return tryAt(0);
  }

  // ---------- license ----------
  function readLic() { try { return JSON.parse(fs.readFileSync(licFile, 'utf8')); } catch (e) { return null; } }
  function writeLic(o) { mkdirp(dataDir); fs.writeFileSync(licFile, JSON.stringify(o)); }
  function clearLic() { try { fs.unlinkSync(licFile); } catch (e) {} }
  function parseToken(tok) {
    var p = String(tok || '').split('.');
    if (p.length !== 2) return null;
    var payload = b64uDec(p[0]);
    if (!verify(payload, b64uDec(p[1]))) return null;
    try { return JSON.parse(payload.toString('utf8')); } catch (e) { return null; }
  }
  function maskKey(k) { return k ? k.replace(/^(ST-\w{4})-\w{4}-\w{4}-(\w{4})$/, '$1-••••-••••-$2') : ''; }

  // สถานะในเครื่อง (ไม่ต่อเน็ต): none | invalid | expired | ok
  function localStatus() {
    var lic = readLic();
    if (!lic || !lic.token) return { state: 'none' };
    var t = parseToken(lic.token);
    if (!t || t.m !== machineId()) return { state: 'invalid' };
    var n = now(), base = { key: t.k, masked: maskKey(t.k), exp: t.exp, phone: lic.phone || null };
    // กันตั้งนาฬิกาเครื่องย้อนหลัง: เวลาต้องไม่ถอยก่อนเวลาที่เซิร์ฟเวอร์ออกโทเคน และไม่ถอยจากเวลาล่าสุดที่เคยเห็น
    var seen = Math.max(lic.seen || 0, t.iat || 0);
    if (n < seen - 600) { base.state = 'expired'; base.clock = true; return base; }
    if (n - (lic.seen || 0) > 60) { lic.seen = n; try { writeLic(lic); } catch (e) {} }
    var left = t.exp - n;
    base.state = left > 0 ? 'ok' : 'expired';
    base.daysLeft = Math.max(0, Math.ceil(left / 86400));
    return base;
  }
  function acceptToken(j) {
    if (!j.ok) { var e = new Error(j.error || 'ผิดพลาด'); e.code = j.code; throw e; }
    var t = parseToken(j.token);
    if (!t || t.m !== machineId()) throw new Error('โทเคนจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    var old = readLic(); writeLic({ token: j.token, seen: now(), phone: (j.phone || (old && old.phone)) || undefined });
    return localStatus();
  }
  function activate(key) {
    return api({ action: 'activate', key: String(key || '').trim().toUpperCase(), machine: machineId(), name: machineName() }).then(acceptToken);
  }
  // เข้าด้วยเบอร์ + รหัสผ่าน (บัญชีสมาชิก) — รหัสผ่านไม่ถูกเก็บในเครื่อง
  function activateAccount(phone, password) {
    return api({ action: 'activate', phone: String(phone || ''), password: String(password || ''), machine: machineId(), name: machineName() }).then(function (j) {
      var st = acceptToken(j);
      if (j.phone) { var lic = readLic(); if (lic) { lic.phone = j.phone; try { writeLic(lic); } catch (e) {} } st.phone = j.phone; }
      return st;
    });
  }
  // ต่ออายุออนไลน์ ; ถ้าเซิร์ฟเวอร์บอกว่าคีย์ใช้ไม่ได้แล้ว → ลบไลเซนส์ในเครื่อง
  function refresh() {
    var lic = readLic(); if (!lic) return Promise.resolve(localStatus());
    return api({ action: 'refresh', token: lic.token }).then(function (j) {
      if (!j.ok && (j.code === 'revoked' || j.code === 'moved' || j.code === 'bad_token')) { clearLic(); var e = new Error(j.error); e.code = j.code; throw e; }
      return acceptToken(j);
    });
  }
  // ลิงก์เข้าหน้าสมาชิกแบบล็อกอินให้แล้ว (ใช้ได้ 5 นาที)
  function memberLink() {
    var lic = readLic();
    var base = String((Array.isArray(opt.server) ? opt.server[0] : opt.server) || '').replace(/\/api\/?$/, '') + '/member';
    if (!lic || !lic.token) return Promise.resolve(base);
    return api({ action: 'member_link', token: lic.token }).then(function (j) { return (j && j.ok && j.url) || base; }, function () { return base; });
  }
  function deactivate() {
    var lic = readLic(); if (!lic) return Promise.resolve(true);
    return api({ action: 'deactivate', token: lic.token }).then(function (j) {
      if (!j.ok && j.code !== 'revoked' && j.code !== 'moved') throw new Error(j.error);
      clearLic(); return true;
    });
  }

  // ---------- update ----------
  function checkUpdate() {
    var lic = readLic();          // ส่งโทเคนไปด้วย → เครื่องทดสอบเบต้าได้รุ่นเบต้า
    return api(lic && lic.token ? { action: 'latest', token: lic.token } : { action: 'latest' }).then(function (j) {
      if (!j.ok || !j.release) return null;
      var m = Buffer.from(j.release.manifest, 'utf8');
      if (!verify(m, Buffer.from(j.release.sig, 'base64'))) throw new Error('ลายเซ็นอัปเดตไม่ถูกต้อง — ไม่ติดตั้ง');
      var r = JSON.parse(j.release.manifest);
      r.current = readVersion();
      r.newer = cmpVer(r.version, r.current) > 0;
      r.beta = !!j.beta;
      return r;
    });
  }
  function normManifest(s) { return s.replace(/Version="\d+\.\d+\.\d+"/g, 'Version="x"').replace(/\s+/g, ' '); }

  function applyUpdate(r, onProgress) {
    var say = onProgress || function () {};
    say('กำลังดาวน์โหลด…');
    var dlVia = null;
    return net(r.url, null, { timeout: 120000, max: (r.size || 0) + 1024 * 1024 }).then(function (buf) {
      dlVia = via.last;
      say('กำลังตรวจไฟล์…');
      if (r.size && buf.length !== r.size) throw new Error('ขนาดไฟล์ไม่ตรง — ดาวน์โหลดไม่ครบ');
      if (crypto.createHash('sha256').update(buf).digest('hex') !== r.sha256) throw new Error('ไฟล์ไม่ตรงกับที่ผู้ขายเซ็นไว้ — ไม่ติดตั้ง');
      var files = fflate.unzipSync(u8(buf)), names = Object.keys(files);
      var man = files['SignTools/CSXS/manifest.xml'];
      if (!man) throw new Error('ไฟล์อัปเดตไม่สมบูรณ์');
      var newMan = Buffer.from(man).toString('utf8');
      if (newMan.indexOf('ExtensionBundleVersion="' + r.version + '"') < 0) throw new Error('เวอร์ชันในไฟล์ไม่ตรง');

      say('กำลังติดตั้ง…');
      // 1) แตกไฟล์ลงโฟลเดอร์ชั่วคราวก่อน
      var stage = path.join(dataDir, 'update_tmp');
      rmrf(stage); mkdirp(stage);
      names.forEach(function (n) {
        if (n.indexOf('SignTools/') !== 0 || n.indexOf('..') >= 0) return;
        var rel = n.slice('SignTools/'.length); if (!rel) return;
        var dst = path.join(stage, rel);
        if (n.charAt(n.length - 1) === '/') { mkdirp(dst); return; }
        mkdirp(path.dirname(dst)); fs.writeFileSync(dst, Buffer.from(files[n]));
      });
      // 2) สำรองของเดิม แล้วก็อปของใหม่ทับ
      var oldMan = fs.readFileSync(path.join(extDir, 'CSXS', 'manifest.xml'), 'utf8');
      var backup = path.join(dataDir, 'backup_' + readVersion());
      rmrf(backup); copyDir(extDir, backup);
      try { copyDir(stage, extDir); }
      catch (e) { copyDir(backup, extDir); throw new Error('ติดตั้งไม่สำเร็จ คืนค่าเวอร์ชันเดิมแล้ว: ' + e.message); }
      rmrf(stage);
      return { version: r.version, restart: normManifest(oldMan) !== normManifest(newMan), via: dlVia };
    });
  }
  function copyDir(src, dst) {
    mkdirp(dst);
    fs.readdirSync(src).forEach(function (f) {
      var s = path.join(src, f), d = path.join(dst, f);
      if (fs.lstatSync(s).isDirectory()) copyDir(s, d); else fs.writeFileSync(d, fs.readFileSync(s));
    });
  }

  return {
    machineId: machineId, machineName: machineName, version: readVersion, localStatus: localStatus,
    activate: activate, activateAccount: activateAccount, refresh: refresh, via: function () { return via.last; }, deactivate: deactivate, memberLink: memberLink, diag: diag, report: function (t) { return api({ action: 'diag', text: String(t).slice(0, 900) }).catch(function () {}); }, checkUpdate: checkUpdate, applyUpdate: applyUpdate, cmpVer: cmpVer
  };
};
