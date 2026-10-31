/* Sign Tools for CorelDRAW — ตัวเชื่อมแผงเดิม (เขียนสำหรับ Illustrator/CEP) เข้ากับ CorelDRAW
 * แผงทำงานใน WebView2 ภายใน Docker ของ Corel · โปรแกรม C# (SignToolsHost.dll) ทำงานกับ Corel/ไฟล์/เครือข่ายให้
 *  - __adobe_cep__.evalScript('st_xxx(args)')  → C# เรียกฟังก์ชันชื่อเดียวกันที่สั่งงาน Corel
 *  - cep_node.require('fs' | 'path' | 'os' | 'crypto' | 'https' | 'net' | ...) → แบบจำลองเล็กๆ ที่ส่งงานให้ C#
 */
(function () {
  'use strict';
  var W = window.chrome && window.chrome.webview;
  document.documentElement.classList.add('corel');
  if (!W) { console.warn('Sign Tools: ไม่ได้รันใน CorelDRAW'); return; }
  var H = W.hostObjects.sync.st;          // เรียกแบบรอผล (ไฟล์ / ข้อมูลเครื่อง)
  function call(o) {
    var r = JSON.parse(H.Call(JSON.stringify(o)));
    if (r && r.err) { var e = new Error(r.err); e.code = r.code; throw e; }
    return r ? r.v : undefined;
  }
  // งานที่ใช้เวลา (Corel / เน็ต / เครื่องตัด) → ส่งข้อความไป แล้วรอคำตอบกลับทาง message
  var seq = 1, waiting = {}, sockets = {};
  function post(o, cb) { o.id = seq++; if (cb) waiting[o.id] = cb; W.postMessage(o); return o.id; }
  W.addEventListener('message', function (ev) {
    var m = ev.data; if (!m) return;
    if (m.sock) { var s = sockets[m.sock]; if (s) s._ev(m); return; }
    var cb = waiting[m.id]; if (cb) { delete waiting[m.id]; cb(m); }
  });

  var SYS = call({ t: 'sys', op: 'info' });   // { appDir, appData, home, hostname, user, corel, version }
  window.ST_EXTDIR = SYS.appDir;
  window.ST_COREL = SYS;
  var B = window.Buffer;                     // จาก buffer.js (ไลบรารี buffer ของ Node แบบเบราว์เซอร์)
  function b64(buf) { return B.from(buf).toString('base64'); }

  // ---------- events แบบย่อ ----------
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (n, f) { (this._h[n] = this._h[n] || []).push(f); return this; };
  Emitter.prototype.addListener = Emitter.prototype.on;
  Emitter.prototype.once = function (n, f) { var self = this; function g() { self.off(n, g); f.apply(self, arguments); } return this.on(n, g); };
  Emitter.prototype.off = function (n, f) { var a = this._h[n] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); return this; };
  Emitter.prototype.removeListener = Emitter.prototype.off;
  Emitter.prototype.removeAllListeners = function (n) { if (n) delete this._h[n]; else this._h = {}; return this; };
  Emitter.prototype.emit = function (n) { var a = (this._h[n] || []).slice(), args = [].slice.call(arguments, 1); a.forEach(function (f) { f.apply(this, args); }, this); return a.length > 0; };
  function inherit(C) { C.prototype = Object.create(Emitter.prototype); C.prototype.constructor = C; }

  // ---------- path (Windows) ----------
  var path = {
    sep: '\\',
    normalize: function (p) {
      p = String(p).replace(/\//g, '\\');
      var unc = /^\\\\/.test(p), drive = (/^[A-Za-z]:/.exec(p) || [''])[0], rest = p.slice(drive.length), abs = /^\\/.test(rest);
      var out = [];
      rest.split('\\').forEach(function (s) { if (!s || s === '.') return; if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); } else out.push(s); });
      return (unc ? '\\\\' : drive + (abs ? '\\' : '')) + out.join('\\');
    },
    join: function () { return path.normalize([].slice.call(arguments).filter(function (x) { return x !== ''; }).join('\\')); },
    dirname: function (p) { p = path.normalize(p); var i = p.lastIndexOf('\\'); return i <= 0 ? p : (i === 2 && /^[A-Za-z]:/.test(p) ? p.slice(0, 3) : p.slice(0, i)); },
    basename: function (p, ext) { var b = path.normalize(p).split('\\').pop(); if (ext && b.slice(-ext.length) === ext) b = b.slice(0, -ext.length); return b; },
    extname: function (p) { var b = path.basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    resolve: function () { return path.join.apply(null, arguments); },
    isAbsolute: function (p) { return /^([A-Za-z]:)?[\\/]/.test(p); }
  };
  path.win32 = path;

  // ---------- fs (ผ่าน C#) ----------
  function Stat(o) { this._d = o.dir; this.size = o.size; this.mtime = new Date(o.mtime || 0); }
  Stat.prototype.isDirectory = function () { return this._d; };
  Stat.prototype.isFile = function () { return !this._d; };
  var fds = {}, fdn = 100;
  var fs = {
    existsSync: function (p) { return call({ t: 'fs', op: 'exists', p: p }); },
    mkdirSync: function (p) { call({ t: 'fs', op: 'mkdir', p: p }); },
    rmdirSync: function (p) { call({ t: 'fs', op: 'rmdir', p: p }); },
    unlinkSync: function (p) { call({ t: 'fs', op: 'unlink', p: p }); },
    readdirSync: function (p) { return call({ t: 'fs', op: 'readdir', p: p }); },
    lstatSync: function (p) { return new Stat(call({ t: 'fs', op: 'stat', p: p })); },
    statSync: function (p) { return new Stat(call({ t: 'fs', op: 'stat', p: p })); },
    renameSync: function (a, b) { call({ t: 'fs', op: 'rename', p: a, q: b }); },
    readFileSync: function (p, enc) {
      if (enc && typeof enc === 'object') enc = enc.encoding;
      var d = B.from(call({ t: 'fs', op: 'read', p: p }), 'base64');
      return enc ? d.toString(enc === 'utf-8' ? 'utf8' : enc) : d;
    },
    writeFileSync: function (p, data) { call({ t: 'fs', op: 'write', p: p, b: b64(typeof data === 'string' ? B.from(data, 'utf8') : data) }); },
    appendFileSync: function (p, data) { call({ t: 'fs', op: 'append', p: p, b: b64(typeof data === 'string' ? B.from(data, 'utf8') : data) }); },
    openSync: function (p) { var fd = fdn++; fds[fd] = p; fs.writeFileSync(p, ''); return fd; },
    writeSync: function (fd, s) { fs.appendFileSync(fds[fd], s); },
    closeSync: function (fd) { delete fds[fd]; }
  };

  // ---------- os / process / crypto / child_process ----------
  var os = {
    hostname: function () { return SYS.hostname; },
    userInfo: function () { return { username: SYS.user }; },
    platform: function () { return 'win32'; },
    homedir: function () { return SYS.home; },
    tmpdir: function () { return SYS.temp; },
    networkInterfaces: function () { return call({ t: 'sys', op: 'nics' }) || {}; },
    EOL: '\r\n'
  };
  var proc = { platform: 'win32', env: SYS.env || {}, versions: { node: '0.0.0-corel' }, cwd: function () { return SYS.appDir; } };
  var crypto = {
    createHash: function (alg) {
      var parts = [];
      return {
        update: function (d, enc) { parts.push(typeof d === 'string' ? B.from(d, enc || 'utf8') : B.from(d)); return this; },
        digest: function (fmt) { var hex = call({ t: 'sys', op: 'hash', alg: alg, b: b64(B.concat(parts)) }); return fmt === 'hex' ? hex : B.from(hex, 'hex').toString(fmt || undefined); }
      };
    },
    randomBytes: function (n) { var u = new Uint8Array(n); window.crypto.getRandomValues(u); return B.from(u); }
  };
  var child_process = {
    execSync: function (cmd) {
      if (/MachineGuid/.test(cmd)) return B.from('    MachineGuid    REG_SZ    ' + call({ t: 'sys', op: 'machineGuid' }) + '\r\n');
      throw new Error('ไม่รองรับใน CorelDRAW: ' + cmd);
    },
    spawn: function () { throw new Error('ไม่รองรับใน CorelDRAW'); },
    exec: function (cmd, o, cb) { cb = typeof o === 'function' ? o : cb; if (cb) setTimeout(function () { cb(new Error('ไม่รองรับใน CorelDRAW')); }, 0); }
  };

  // ---------- url ----------
  var url = {
    parse: function (u) { var x = new URL(u); return { protocol: x.protocol, hostname: x.hostname, host: x.host, port: x.port || null, path: x.pathname + x.search, pathname: x.pathname, search: x.search, href: x.href }; },
    resolve: function (a, b) { return new URL(b, a).href; }
  };

  // ---------- http / https (C# ทำ request ให้ — ไม่ติดเรื่อง CORS) ----------
  function ClientRequest(o, cb) {
    Emitter.call(this); var self = this;
    this._o = o; this._body = []; this._done = false;
    if (cb) this.on('response', cb);
    if (o.timeout) this._t = setTimeout(function () { if (!self._done) self.emit('timeout'); }, o.timeout);
  }
  inherit(ClientRequest);
  ClientRequest.prototype.setTimeout = function (ms, f) { var self = this; if (f) this.on('timeout', f); clearTimeout(this._t); this._t = setTimeout(function () { if (!self._done) self.emit('timeout'); }, ms); return this; };
  ClientRequest.prototype.write = function (d) { this._body.push(typeof d === 'string' ? B.from(d) : B.from(d)); return true; };
  ClientRequest.prototype.abort = ClientRequest.prototype.destroy = function () { this._done = true; clearTimeout(this._t); };
  ClientRequest.prototype.end = function (d) {
    if (d) this.write(d);
    var o = this._o, self = this, proto = o.protocol || (o._https ? 'https:' : 'http:');
    var u = proto + '//' + o.hostname + (o.port ? ':' + o.port : '') + (o.path || '/');
    post({ t: 'http', url: u, method: o.method || 'GET', headers: o.headers || {}, b: this._body.length ? b64(B.concat(this._body)) : '', timeout: o.timeout || 15000 }, function (m) {
      if (self._done) return; self._done = true; clearTimeout(self._t);
      if (m.err) { var e = new Error(m.err); e.code = m.code || 'ECONNRESET'; self.emit('error', e); return; }
      var res = new Emitter(); res.statusCode = m.status; res.headers = m.headers || {};
      res.resume = function () {}; res.setEncoding = function () {};
      self.emit('response', res);
      setTimeout(function () { if (m.b) res.emit('data', B.from(m.b, 'base64')); res.emit('end'); }, 0);
    });
    return this;
  };
  function mkHttp(isHttps) {
    return {
      request: function (o, cb) { if (typeof o === 'string') o = url.parse(o); o._https = isHttps; if (!o.protocol) o.protocol = isHttps ? 'https:' : 'http:'; return new ClientRequest(o, cb); },
      get: function (o, cb) { var r = this.request(o, cb); r.end(); return r; }
    };
  }

  // ---------- net (TCP ไปเครื่องตัด) ----------
  function Socket() { Emitter.call(this); this._id = 0; this.destroyed = false; this._to = 0; this._tt = null; }
  inherit(Socket);
  Socket.prototype._arm = function () { var self = this; clearTimeout(this._tt); if (this._to && !this.destroyed) this._tt = setTimeout(function () { self.emit('timeout'); }, this._to); };
  Socket.prototype.setTimeout = function (ms, f) { this._to = ms; if (f) this.once('timeout', f); this._arm(); return this; };
  Socket.prototype.setNoDelay = Socket.prototype.setKeepAlive = function () { return this; };
  Socket.prototype.connect = function (port, host, cb) {
    if (typeof port === 'object') { cb = host; host = port.host; port = port.port; }
    var self = this; if (cb) this.once('connect', cb);
    this._id = 's' + seq++; sockets[this._id] = this;
    post({ t: 'tcp', op: 'connect', sock: this._id, host: host, port: port, timeout: this._to || 8000 });
    this._arm();
    return this;
  };
  Socket.prototype._ev = function (m) {
    this._arm();
    if (m.ev === 'connect') this.emit('connect');
    else if (m.ev === 'data') this.emit('data', B.from(m.b, 'base64'));
    else if (m.ev === 'drain') { var cb = this._wcb && this._wcb[m.n]; if (cb) { delete this._wcb[m.n]; cb(); } this.emit('drain'); }
    else if (m.ev === 'error') { var e = new Error(m.err); e.code = m.code; this.emit('error', e); }
    else if (m.ev === 'end') this.emit('end');
    else if (m.ev === 'close') { this.destroyed = true; clearTimeout(this._tt); delete sockets[this._id]; var f = this._ecb; this._ecb = null; if (f) f(); this.emit('close', false); }
  };
  Socket.prototype.write = function (d, enc, cb) {
    if (typeof enc === 'function') { cb = enc; enc = null; }
    var buf = typeof d === 'string' ? B.from(d, enc || 'latin1') : B.from(d), n = seq++;
    if (cb) { this._wcb = this._wcb || {}; this._wcb[n] = cb; }
    post({ t: 'tcp', op: 'write', sock: this._id, n: n, b: buf.toString('base64') });
    return true;
  };
  Socket.prototype.end = function (d, cb) { if (typeof d === 'function') { cb = d; d = null; } if (d) this.write(d); this._ecb = cb || null; post({ t: 'tcp', op: 'end', sock: this._id }); return this; };
  Socket.prototype.destroy = function () { if (this.destroyed) return this; this.destroyed = true; clearTimeout(this._tt); post({ t: 'tcp', op: 'destroy', sock: this._id }); return this; };
  var net = {
    Socket: Socket,
    connect: function (port, host, cb) { var s = new Socket(); return s.connect(port, host, cb); },
    createConnection: function (port, host, cb) { var s = new Socket(); return s.connect(port, host, cb); },
    createServer: function () { throw new Error('ฟังก์ชันนี้ยังไม่รองรับใน CorelDRAW'); }
  };

  // ---------- require ----------
  var cache = {};
  var MODS = { fs: fs, path: path, os: os, crypto: crypto, child_process: child_process, url: url, http: mkHttp(false), https: mkHttp(true), net: net,
    buffer: { Buffer: B }, events: Emitter, process: proc };
  function req(name) {
    if (MODS[name]) return MODS[name];
    var p = path.normalize(name);
    if (cache[p]) return cache[p].exports;
    var code = fs.readFileSync(p, 'utf8'), module = { exports: {} };
    cache[p] = module;
    try {
      new Function('module', 'exports', 'require', 'Buffer', 'process', '__dirname', '__filename', code + '\n//# sourceURL=' + p.replace(/\\/g, '/'))(module, module.exports, req, B, proc, path.dirname(p), p);
    } catch (e) { delete cache[p]; throw e; }
    return module.exports;
  }
  req.cache = cache;

  window.cep_node = { require: req, process: proc, Buffer: B };

  // ---------- __adobe_cep__ ----------
  window.__adobe_cep__ = {
    evalScript: function (script, cb) {
      post({ t: 'eval', s: String(script) }, function (m) { if (cb) cb(m.err ? JSON.stringify({ error: m.err }) : m.r); });
    },
    closeExtension: function () { location.reload(); },
    getHostEnvironment: function () { return JSON.stringify({ appName: 'CDR', appVersion: SYS.corel || '' }); }
  };
  window.ST_openUrl = function (u) { call({ t: 'sys', op: 'open', url: u }); };
  window.cep = { util: { openURLInDefaultBrowser: function (u) { window.ST_openUrl(u); } } };
  // ลิงก์ภายนอก (หน้าสมาชิก ฯลฯ) → เปิดในเบราว์เซอร์ของเครื่อง
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a && /^https?:/i.test(a.href) && a.host !== location.host) { e.preventDefault(); window.ST_openUrl(a.href); }
  }, true);
  var _open = window.open;
  window.open = function (u) { if (/^https?:/i.test(String(u))) { window.ST_openUrl(String(u)); return null; } return _open.apply(window, arguments); };
})();
