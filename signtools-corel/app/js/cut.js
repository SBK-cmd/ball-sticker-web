/* Sign Tools — ส่งตัดเข้า Graphtec ผ่าน LAN (Node net, TCP ดิบ) */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var PORTS = [9100, 9101, 9102, 8000, 4000, 2000, 10001, 515, 23];

  function esc(v) { return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
  function host(fn, arg) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน CorelDRAW' });
      window.__adobe_cep__.evalScript(fn + '(' + (arg === undefined ? '' : esc(arg)) + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: 'สคริปต์ผิดพลาด: ' + String(r).slice(0, 200) }); }
      });
    });
  }
  function req() { return (window.cep_node && window.cep_node.require) || window.__testRequire || null; }
  var toastT;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 3600); }
  function seg(name) { var b = document.querySelector('.seg[data-name="' + name + '"] .on'); return b ? b.dataset.v : null; }
  function ip() { return ($('cutIp').value || '').replace(/\s+/g, ''); }
  function port() { var p = parseInt($('cutPort').value, 10); return p > 0 && p < 65536 ? p : 0; }
  function validIp(s) { return /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every(function (n) { return +n <= 255; }); }
  function status(t, cls) { var s = $('cutStatus'); s.textContent = t; s.className = 'hint ' + (cls || ''); }
  function opts() {
    var mk = marks && $('cutUseMk').checked ? { ox: marks.ox, oy: marks.oy, dx: marks.dx, dy: marks.dy, lenMM: marks.lenMM, cond: parseInt($('cutCond').value, 10) || 2 } : null;
    if (mk) { mk.seg = !!marks.seg; mk.stepMM = marks.stepMM || 250; }
    var cond = parseInt($('cutCond').value, 10) || 2, drv = null;
    if ($('cutDrv').checked) {
      var n = function (id, d) { var v = parseFloat($(id).value); return v > 0 ? v : d; };
      var die = { k: 'die', cond: cond, speed: n('dDieS', 50), accel: n('dDieA', 2), force: n('dDieF', 25) };
      var kis = { k: 'kiss', cond: cond, speed: n('dKisS', 71), accel: n('dKisA', 2), force: n('dKisF', 38) };
      drv = $('cutFirst').value === 'die' ? [die, kis] : [kis, die];
    }
    return { lang: seg('cutLang') || 'gpgl', step: parseFloat($('cutStep').value) || 0.1, rotate: $('cutRot').checked, mirror: $('cutMirror').checked, overcut: Math.max(0, parseFloat($('cutOver').value) || 0), marks: mk, drv: drv, perPiece: !!drv && $('cutFirst').value === 'piece', nm: mk || isTest ? null : nmOpt() };
  }

  // ไม่อ่านมาร์ค (แบบ CM5): หน้ากว้างวัสดุ · ตำแหน่งเริ่ม X/Y · จำนวนชุด + ระยะห่าง — หน่วยในช่อง = ซม. → ส่งเป็น มม.
  function nmOpt() {
    var v = function (id, d) { var x = parseFloat($(id).value); return isFinite(x) && x >= 0 ? x * 10 : d; };
    return { rollW: v('nmW', 0), x0: v('nmX', 0), y0: v('nmY', 0), copies: Math.max(1, parseInt($('nmN').value, 10) || 1), gx: v('nmGX', 0), gy: v('nmGY', 0) };
  }
  var isTest = false;
  function nmUI() { $('cutNmBox').classList.toggle('hidden', !!(marks && $('cutUseMk').checked) || isTest); }
  function tryPort(h, p, ms) { return STCut.net(req()).tryPort(h, p, ms); }
  function send(h, p, data) { return STCut.net(req(), window.cep_node && window.cep_node.Buffer).send(h, p, data); }

  // ---------- อ่านงาน ----------
  var job = null;
  // ---------- ภาพตัวอย่าง: สีตามเลเยอร์ (Kiss ชมพู · Die เขียว) + จำลองการตัดตามลำดับจริง ----------
  var COL = { kiss: '#ff4fa3', die: '#2fd27a' }, anim = null;
  // มีมาร์ค: วาดตามแนวงานใน CorelDRAW (บน = ทางป้อน X, จุดเริ่มเครื่องอยู่มุมขวาล่าง) จะได้เห็นลำดับตัดตรงกับงานจริง
  function geom() {
    var cv = $('cutCanvas'), pad = 14, mx = 1, my = 1;
    if (job.art) job.polys.forEach(function (pl) { pl.forEach(function (q) { if (q[0] > mx) mx = q[0]; if (q[1] > my) my = q[1]; }); });
    if (job.roll && job.roll > my) my = job.roll;   // ไม่อ่านมาร์ค: กรอบ = หน้ากว้างวัสดุ
    var W = job.art ? my : job.w, H = job.art ? mx : job.h;
    var sc = Math.min((cv.width - 2 * pad) / Math.max(W, 1), (cv.height - 2 * pad) / Math.max(H, 1));
    return { cv: cv, g: cv.getContext('2d'), sc: sc, ox: pad, oy: cv.height - pad, art: !!job.art, W: W, H: H };
  }
  function P(G, q) { return G.art ? [G.ox + (G.W - q[1]) * G.sc, G.oy - q[0] * G.sc] : [G.ox + q[0] * G.sc, G.oy - q[1] * G.sc]; }
  function frame(G) {
    var g = G.g; g.clearRect(0, 0, G.cv.width, G.cv.height);
    var bw = G.art ? G.W : job.w, bh = G.art ? G.H : job.h;
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([3, 3]); g.strokeRect(G.ox, G.oy - bh * G.sc, bw * G.sc, bh * G.sc); g.setLineDash([]);
  }
  function axes(G) {
    var g = G.g, o = P(G, [0, 0]), sx = G.art ? -1 : 1;
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(o[0], o[1], 3.5, 0, 7); g.fill();
    g.font = '10px sans-serif'; g.strokeStyle = '#ffd23f'; g.lineWidth = 1; g.beginPath();
    if (G.art) { g.fillText('X+', o[0] - 14, o[1] - 22); g.fillText('Y+', o[0] - 34, o[1] - 4); g.moveTo(o[0], o[1]); g.lineTo(o[0], o[1] - 18); g.moveTo(o[0], o[1]); g.lineTo(o[0] - 18, o[1]); }
    else { g.fillText('X+', o[0] + 22, o[1] - 4); g.fillText('Y+', o[0] + 4, o[1] - 22); g.moveTo(o[0], o[1]); g.lineTo(o[0] + 18 * sx, o[1]); g.moveTo(o[0], o[1]); g.lineTo(o[0], o[1] - 18); }
    g.stroke();
  }
  function stroke(G, pl, col, alpha, upto) {
    var g = G.g; g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath();
    var n = upto == null ? pl.length : upto;
    for (var i = 0; i < n && i < pl.length; i++) { var p = P(G, pl[i]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    g.stroke(); g.globalAlpha = 1;
  }
  function draw() {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    var cv = $('cutCanvas'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    $('cutPlay').disabled = !job; $('cutPlay').textContent = '▶ จำลองการตัด';
    if (!job) return;
    var G = geom(); frame(G);
    job.polys.forEach(function (pl, i) { stroke(G, pl, COL[(job.kinds && job.kinds[i]) || 'kiss'], 1); });
    axes(G);
  }
  function play() {
    if (!job) return;
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; draw(); return; }
    var G = geom(), segs = [], cur = [0, 0], total = 0;
    job.polys.forEach(function (pl, i) {   // ยกมีดไปจุดเริ่ม แล้วตัดตามเส้น
      var d0 = Math.hypot(pl[0][0] - cur[0], pl[0][1] - cur[1]); segs.push({ up: true, a: cur, b: pl[0], len: d0 }); total += d0 * 0.25;
      for (var j = 1; j < pl.length; j++) { var L = Math.hypot(pl[j][0] - pl[j - 1][0], pl[j][1] - pl[j - 1][1]); segs.push({ i: i, j: j, a: pl[j - 1], b: pl[j], len: L }); total += L; }
      cur = pl[pl.length - 1];
    });
    var dur = Math.min(14000, Math.max(4000, job.n * 120)), t0 = null, b = $('cutPlay');
    b.textContent = '■ หยุด';
    anim = { raf: 0 };
    function step(ts) {
      if (!t0) t0 = ts;
      var target = Math.min(1, (ts - t0) / dur) * total, acc = 0, k, lastUp = null, done = {}, partial = null, head = [0, 0];
      frame(G);
      job.polys.forEach(function (pl, i) { stroke(G, pl, COL[(job.kinds && job.kinds[i]) || 'kiss'], 0.18); });
      for (k = 0; k < segs.length; k++) {
        var sg = segs[k], w = sg.up ? sg.len * 0.25 : sg.len;
        if (acc + w <= target) { acc += w; if (!sg.up) done[sg.i] = sg.j + 1; head = sg.b; lastUp = sg.up ? sg : null; continue; }
        var f = w ? (target - acc) / w : 1; head = [sg.a[0] + (sg.b[0] - sg.a[0]) * f, sg.a[1] + (sg.b[1] - sg.a[1]) * f];
        if (sg.up) lastUp = { a: sg.a, b: head }; else { done[sg.i] = sg.j; partial = { i: sg.i, pt: head }; lastUp = null; }
        break;
      }
      Object.keys(done).forEach(function (i) {
        var pl = job.polys[i], col = COL[(job.kinds && job.kinds[i]) || 'kiss'];
        if (partial && +i === partial.i) { stroke(G, pl.slice(0, done[i]).concat([partial.pt]), col, 1); } else stroke(G, pl, col, 1, done[i]);
      });
      if (lastUp) { var g = G.g, a = P(G, lastUp.a), c = P(G, lastUp.b); g.setLineDash([2, 3]); g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); g.setLineDash([]); }
      var h = P(G, head); G.g.fillStyle = '#ffd23f'; G.g.beginPath(); G.g.arc(h[0], h[1], 3.5, 0, 7); G.g.fill();
      axes(G);
      if (target < total) anim.raf = requestAnimationFrame(step);
      else { anim = null; b.textContent = '▶ จำลองการตัด'; }
    }
    anim.raf = requestAnimationFrame(step);
  }
  var raw = null, rawLabel = '', marks = null, blockMk = false;
  function rebuild() {
    if (!raw) { job = null; draw(); $('cutGo').disabled = true; return; }
    var r = STCut.build(raw, opts());
    if (r.error) { job = null; $('cutRes').textContent = r.error; $('cutGo').disabled = true; draw(); return; }
    job = r; nmUI();
    $('cutRes').innerHTML = rawLabel + '<small>' + r.n + ' เส้น · ขนาดงาน ' + r.w.toFixed(1) + ' × ' + r.h.toFixed(1) + ' มม. (X × Y) · ' + (r.copies > 1 ? r.copies + ' ชุด (แถวละ ' + r.perRow + ') · ' : '') + (r.mk ? 'อ่านมาร์ค · ' : 'ไม่อ่านมาร์ค · ') + Math.round(r.data.length / 1024 * 10) / 10 + ' KB</small>';
    $('cutGo').disabled = blockMk;
    $('cutNmWarn').textContent = r.warn || '';
    draw();
  }
  $('cutRead').onclick = function () {
    $('cutRead').disabled = true;
    host('st_cutRead').then(function (r) {
      $('cutRead').disabled = false;
      if (r.error) { raw = null; $('cutRes').textContent = '⚠ ' + r.error; rebuild(); return; }
      var w = [];
      if (r.text) w.push('มีตัวอักษร ' + r.text + ' ชิ้นที่ยังไม่ได้ Create Outlines — ไม่ได้ส่งตัด');
      if (r.other) w.push('ข้าม ' + r.other + ' ชิ้นที่ไม่ใช่เส้น (รูปภาพ/อื่นๆ)');
      $('cutWarn').textContent = w.join(' · ');
      if (!r.n) {
        raw = null; rebuild();
        $('cutRes').textContent = r.src === 'sel' ? 'ไม่มีเส้นในสิ่งที่เลือก' : 'ไม่พบเส้นตัด (Kiss Cut / Die Cut) ใน artboard นี้ — เลือกเส้นที่จะตัดแล้วกดอ่านใหม่';
        return;
      }
      isTest = false; raw = r.paths; rawLabel = r.src === 'sel' ? 'เส้นที่เลือก' : 'เส้นตัด (Kiss Cut / Die Cut) ใน artboard';
      marks = r.marks || null;
      blockMk = !!(marks && marks.style !== 1 && marks.style !== 7);
      if (blockMk) { w.push('มาร์คแบบนี้ (รหัส ' + marks.style + ') ยังส่งตัดจากแผงไม่ได้ — ใช้ Cutting Master ไปก่อน'); marks = null; }
      $('cutMkRow').classList.toggle('hidden', !marks);
      if (marks) $('cutMkInfo').textContent = 'พบมาร์ค ' + (marks.seg ? 'Segment ทุก 25 ซม.' : '4 Points') + ' · ห่างกัน ' + (marks.dy / 10).toFixed(1) + ' × ' + (marks.dx / 10).toFixed(1) + ' ซม. · เครื่องจะสแกนมาร์คก่อนตัด';
      var nd = (r.paths || []).filter(function (p) { return p.k === 'die'; }).length;
      if (nd && !$('cutDrv').checked) w.push('มีเส้น Die Cut ' + nd + ' เส้น — ติ๊ก "ตั้งความเร็ว / แรงกดแยกตามเส้น" เพื่อใช้แรงกดต่างจาก Kiss Cut');
      $('cutWarn').textContent = w.join(' · ');
      rebuild();
    });
  };
  $('cutTest').onclick = function () {
    marks = null; blockMk = false; $('cutMkRow').classList.add('hidden');
    isTest = true; raw = STCut.testPaths(); rawLabel = 'ชิ้นทดสอบ 20×20 มม.'; $('cutWarn').textContent = '';
    rebuild();
    status('ชิ้นทดสอบ: กรอบ 20 มม. · ลูกศรชี้ทาง X · ขีดสั้นชี้ทาง Y — วัดว่าได้ 20 มม. จริงไหม', '');
  };
  $('cutPlay').onclick = function () { if (anim) { cancelAnimationFrame(anim.raf); anim = null; $('cutPlay').textContent = '▶ จำลองการตัด'; draw(); } else play(); };
  ['cutFirst', 'cutDrv'].forEach(function (id) { $(id).addEventListener('change', function () { setTimeout(function () { if (job) play(); }, 30); }); });
  ['cutRot', 'cutMirror', 'cutOver', 'cutStep', 'cutUseMk', 'cutCond', 'cutDrv', 'dDieS', 'dDieA', 'dDieF', 'dKisS', 'dKisA', 'dKisF', 'cutFirst', 'nmW', 'nmX', 'nmY', 'nmN', 'nmGX', 'nmGY'].forEach(function (id) { $(id).addEventListener('change', rebuild); });
  ['nmW', 'nmX', 'nmY', 'nmN', 'nmGX', 'nmGY'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(nmT); nmT = setTimeout(rebuild, 250); }); });
  var nmT;
  document.querySelectorAll('.seg[data-name="cutLang"] button').forEach(function (b) {
    b.addEventListener('click', function () { setTimeout(function () { langUI(); rebuild(); }, 0); });
  });
  function drvUI() { $('cutDrvBox').classList.toggle('hidden', !$('cutDrv').checked); }
  $('cutDrv').addEventListener('change', drvUI); setTimeout(drvUI, 0);
  function langUI() { document.getElementById('tab-cut').classList.toggle('isGpgl', seg('cutLang') === 'gpgl'); }

  // ---------- ตรวจหาพอร์ต ----------
  $('cutProbe').onclick = function () {
    var h = ip();
    if (!validIp(h)) { status('ใส่ IP ของเครื่องตัดก่อน (ดูที่เครื่อง: MENU › I/F › LAN)', 'warn'); return; }
    if (!req()) { status('ใช้ได้เฉพาะใน CorelDRAW', 'warn'); return; }
    $('cutProbe').disabled = true; status('กำลังตรวจหาพอร์ตที่ ' + h + ' …', '');
    Promise.all(PORTS.map(function (p) { return tryPort(h, p, 2500).then(function (ok) { return ok ? p : 0; }); })).then(function (list) {
      $('cutProbe').disabled = false;
      var open = list.filter(Boolean);
      if (!open.length) { fullScan(h); return; }
      $('cutPort').value = open[0]; $('cutPort').dispatchEvent(new Event('change'));
      status('✓ เจอเครื่อง · พอร์ตที่เปิด: ' + open.join(', ') + ' (ใช้ ' + open[0] + ')', 'ok');
    });
  };



  // พอร์ตที่รู้จักไม่เปิด → สแกนทุกพอร์ต 1–65535 ของเครื่องนั้น (ในวง LAN พอร์ตที่ปิดตอบกลับเร็ว)
  function fullScan(h) {
    var btn = $('cutProbe'), next = 1, active = 0, done = 0, found = [], MAX = 65535, stop = false;
    btn.disabled = true; status('พอร์ตที่รู้จักไม่เปิด · กำลังสแกนทุกพอร์ตของ ' + h + ' (ไม่เกิน 2 นาที)…', '');
    function finish() {
      btn.disabled = false;
      if (!found.length) { status('ไม่เจอพอร์ตที่เปิดเลย · เช็คว่าเครื่องตัดเปิดอยู่, IP ถูก, คอมอยู่วงแลนเดียวกัน · ถ้าเพิ่งอัปเดตแผง ให้ปิดเปิด CorelDRAW 1 ครั้ง', 'warn'); return; }
      found.sort(function (a, b) { return a - b; });
      $('cutPort').value = found[0]; $('cutPort').dispatchEvent(new Event('change'));
      status('✓ เจอพอร์ตที่เปิด: ' + found.join(', ') + ' (ใช้ ' + found[0] + ') · บอก Claude เลขพอร์ตนี้ด้วย', 'ok');
    }
    function pump() {
      while (active < 300 && next <= MAX && !stop) {
        (function (p) {
          active++;
          tryPort(h, p, 600).then(function (ok) {
            active--; done++;
            if (ok) { found.push(p); if (found.length >= 8) stop = true; }
            if (done % 2000 === 0) status('กำลังสแกนพอร์ต… ' + done + '/' + MAX + (found.length ? ' · เจอ ' + found.join(',') : ''), '');
            if ((next > MAX || stop) && active === 0) finish(); else pump();
          });
        })(next++);
      }
    }
    pump();
  }
  // ---------- ค้นหาเครื่องตัดในวง LAN (สแกน x.x.x.1–254 ที่พอร์ตเครื่องตัด) ----------
  $('cutScan').onclick = function () {
    var R = req(); if (!R) { status('ใช้ได้เฉพาะใน CorelDRAW', 'warn'); return; }
    var os = R('os'), nets = os.networkInterfaces(), bases = [];
    Object.keys(nets).forEach(function (k) { (nets[k] || []).forEach(function (a) { if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !/^169\.254\./.test(a.address)) { var b = a.address.split('.').slice(0, 3).join('.'); if (bases.indexOf(b) < 0) bases.push(b); } }); });
    if (!bases.length) { status('ไม่พบการเชื่อมต่อ LAN ของคอมนี้', 'warn'); return; }
    var hosts = []; bases.forEach(function (b) { for (var i = 1; i < 255; i++) hosts.push(b + '.' + i); });
    var ports = [9100, 8000, 4000, 2000, 10001], found = {}, idx = 0, active = 0, done = 0, total = hosts.length;
    var btn = $('cutScan'); btn.disabled = true; $('cutFound').innerHTML = '';
    status('กำลังค้นหาในวง ' + bases.map(function (b) { return b + '.x'; }).join(', ') + ' …', '');
    function show() {
      var box = $('cutFound'); box.innerHTML = '';
      Object.keys(found).forEach(function (h) {
        var b = document.createElement('button'); b.className = 'btn ghost sm'; b.textContent = h + ' : ' + found[h].join(',');
        b.onclick = function () { $('cutIp').value = h; $('cutPort').value = found[h][0]; $('cutIp').dispatchEvent(new Event('change')); $('cutPort').dispatchEvent(new Event('change')); status('✓ ใช้ ' + h + ':' + found[h][0], 'ok'); };
        box.appendChild(b);
      });
    }
    function next() {
      while (active < 48 && idx < hosts.length) {
        (function (h) {
          active++;
          Promise.all(ports.map(function (p) { return tryPort(h, p, 700).then(function (ok) { return ok ? p : 0; }); })).then(function (l) {
            var open = l.filter(Boolean); if (open.length) { found[h] = open; show(); }
            active--; done++;
            if (done % 32 === 0) status('กำลังค้นหา… ' + done + '/' + total, '');
            if (done === total) { btn.disabled = false; var n = Object.keys(found).length; status(n ? '✓ เจอ ' + n + ' เครื่องที่เปิดพอร์ตเครื่องพิมพ์/เครื่องตัด · กดเลือกด้านล่าง' : 'ไม่เจอเครื่องในวง LAN · ปิด Cutting Master แล้วลองใหม่ หรือดู IP ที่หน้าจอเครื่องตัด (MENU › I/F › LAN)', n ? 'ok' : 'warn'); }
            else next();
          });
        })(hosts[idx++]);
      }
    }
    next();
  };
  // ---------- ส่งตัด (กด 2 ครั้งเพื่อยืนยัน) ----------
  var armT = null;

  // ======== ดักคำสั่ง CM5: proxy 127.0.0.1:capPort ↔ เครื่องตัด ip:port · จดทั้งสองทาง ========
  var cap = null;
  function capStop(msg) {
    if (!cap) return;
    try { cap.srv.close(); } catch (e) {}
    cap.socks.forEach(function (s) { try { s.destroy(); } catch (e) {} });
    try { cap.fs.closeSync(cap.fd); } catch (e) {}
    $('capGo').textContent = 'เริ่มดัก'; $('capMsg').textContent = (msg || 'หยุดดักแล้ว') + ' · ไฟล์: ' + cap.file;
    cap = null;
  }
  $('capGo').onclick = function () {
    if (cap) return capStop();
    var R = req(); if (!R) return toast('⚠ ต้องรันใน CorelDRAW');
    var h = ip(), p = port(), lp = parseInt($('capPort').value, 10) || 9100;
    if (!validIp(h) || !p) return toast('⚠ ใส่ IP และพอร์ตของเครื่องตัดด้านบนก่อน (กดตรวจหา)');
    var net = R('net'), fs = R('fs'), path = R('path'), env = (window.cep_node && window.cep_node.process ? window.cep_node.process : R('process')).env;
    var dir = path.join(env.USERPROFILE || env.HOME || '.', 'Desktop', 'SignTools-capture');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir); } catch (e) {}
    var d = new Date(), stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + ('0' + d.getSeconds()).slice(-2);
    var file = path.join(dir, 'cm5-' + stamp + '.jsonl'), fd = fs.openSync(file, 'w'), t0 = Date.now(), nIn = 0, nOut = 0, conns = 0;
    function log(dir2, buf) { try { fs.writeSync(fd, JSON.stringify({ t: Date.now() - t0, d: dir2, b: buf.toString('base64') }) + '\n'); } catch (e) {} }
    function upd() { $('capMsg').textContent = 'กำลังดัก · การเชื่อมต่อ ' + conns + ' · CM5→เครื่อง ' + nOut + ' ไบต์ · เครื่อง→CM5 ' + nIn + ' ไบต์ · ' + file; }
    var srv = net.createServer(function (c) {
      conns++; log('open', Buffer.from(''));
      var up = net.connect(p, h); cap && cap.socks.push(c, up);
      c.on('data', function (b) { nOut += b.length; log('>', b); up.write(b); upd(); });
      up.on('data', function (b) { nIn += b.length; log('<', b); c.write(b); upd(); });
      c.on('end', function () { log('close-cm5', Buffer.from('')); try { up.end(); } catch (e) {} });
      up.on('end', function () { log('close-cutter', Buffer.from('')); try { c.end(); } catch (e) {} });
      c.on('error', function () {}); up.on('error', function (e) { log('err', Buffer.from(String(e.code || e.message))); try { c.destroy(); } catch (x) {} upd(); });
      upd();
    });
    srv.on('error', function (e) { capStop('⚠ เปิดพอร์ต ' + lp + ' ไม่ได้ (' + (e.code || e.message) + ')'); });
    srv.listen(lp, '127.0.0.1', function () { upd(); });
    cap = { srv: srv, socks: [], fs: fs, fd: fd, file: file };
    $('capGo').textContent = 'หยุดดัก';
  };
  $('cutGo').onclick = function () {
    if (!job || blockMk) return;
    var h = ip(), p = port();
    if (!validIp(h) || !p) { status('ตั้ง IP และพอร์ตก่อน (กด "ตรวจหา")', 'warn'); return; }
    if (!req()) { status('ใช้ได้เฉพาะใน CorelDRAW', 'warn'); return; }
    var b = $('cutGo');
    if (!b.classList.contains('arm')) {
      b.classList.add('arm'); b.textContent = 'กดอีกครั้งเพื่อตัด · ' + job.w.toFixed(0) + '×' + job.h.toFixed(0) + ' มม.';
      clearTimeout(armT); armT = setTimeout(disarm, 4000); return;
    }
    disarm(); b.disabled = true; status('กำลังส่งงานไป ' + h + ':' + p + ' …', '');
    try {   // ส่งสรุปงานให้ร้านดู (คำสั่งที่ไม่ใช่การเดินมีด + จำนวนเส้นแต่ละชนิด) — ไว้ตรวจปัญหา
      var hdr = job.data.split('\x03').filter(function (x) { return !/^(D|M\d|BZ)/.test(x); }).join(' | ').replace(/[\x00-\x1f]/g, '');
      var kinds = (raw || []).reduce(function (a, q) { a[q.k || 'kiss'] = (a[q.k || 'kiss'] || 0) + 1; return a; }, {});
      if (window.ST_core && window.ST_core.report) window.ST_core.report('sendcut ' + h + ':' + p + ' drv=' + $('cutDrv').checked + ' kinds=' + JSON.stringify(kinds) + ' n=' + job.n + ' :: ' + hdr.slice(0, 600));
    } catch (er) {}
    send(h, p, job.data).then(function (n) {
      b.disabled = false;
      status('✓ ส่งแล้ว ' + Math.round(n / 1024 * 10) / 10 + ' KB · ' + job.n + ' เส้น', 'ok'); toast('✓ ส่งงานเข้าเครื่องตัดแล้ว');
    }, function (e) {
      b.disabled = false; status('⚠ ส่งไม่ได้: ' + e.message + ' · ถ้า Cutting Master เปิดค้างอยู่ให้ปิดก่อน', 'warn');
    });
  };
  function disarm() { clearTimeout(armT); var b = $('cutGo'); b.classList.remove('arm'); b.textContent = 'ส่งตัด'; }

  langUI(); draw();

  // ======== หลายเครื่องตัด: เก็บชุดตั้งค่าแต่ละเครื่อง (ชื่อ IP พอร์ต ภาษา สเต็ป condition) ========
  var MKEY = 'st_cutters', machines = [], cur = 0;
  function mLoad() { try { var d = JSON.parse(localStorage.getItem(MKEY)); if (d && d.list && d.list.length) { machines = d.list; cur = Math.min(d.cur || 0, machines.length - 1); } } catch (e) {} }
  function mSave() { try { localStorage.setItem(MKEY, JSON.stringify({ list: machines, cur: cur })); } catch (e) {} }
  var DRVF = ['cutDrv', 'dDieS', 'dDieA', 'dDieF', 'dKisS', 'dKisA', 'dKisF', 'cutFirst', 'nmW', 'nmX', 'nmY', 'nmGX', 'nmGY'];
  function mFromUI() { var m = { name: $('cutMName').value.trim(), ip: $('cutIp').value.trim(), port: $('cutPort').value, lang: seg('cutLang') || 'gpgl', step: $('cutStep').value, cond: $('cutCond') ? $('cutCond').value : '2', drv: {} }; DRVF.forEach(function (id) { m.drv[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value; }); return m; }
  function mToUI(m) {
    $('cutMName').value = m.name || ''; $('cutIp').value = m.ip || ''; $('cutPort').value = m.port || '';
    if (m.step) $('cutStep').value = m.step; if ($('cutCond') && m.cond) $('cutCond').value = m.cond;
    if (m.drv) DRVF.forEach(function (id) { if (m.drv[id] === undefined) return; if ($(id).type === 'checkbox') $(id).checked = !!m.drv[id]; else $(id).value = m.drv[id]; });
    drvUI();
    document.querySelectorAll('.seg[data-name="cutLang"] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === (m.lang || 'gpgl')); });
    langUI(); rebuild();
  }
  function mRender() {
    var sel = $('cutMachine'); sel.innerHTML = '';
    machines.forEach(function (m, i) { var o = document.createElement('option'); o.value = i; o.textContent = (m.name || 'เครื่อง ' + (i + 1)) + (m.ip ? ' · ' + m.ip : ''); sel.appendChild(o); });
    sel.value = cur; $('cutDelM').disabled = machines.length < 2;
  }
  function mSync() { machines[cur] = mFromUI(); mSave(); mRender(); }
  mLoad();
  if (!machines.length) { machines = [mFromUI()]; if (!machines[0].name) machines[0].name = 'เครื่อง 1'; }
  mRender(); mToUI(machines[cur]);
  ['cutMName', 'cutIp', 'cutPort', 'cutStep', 'cutCond'].concat(DRVF).forEach(function (id) { if ($(id)) $(id).addEventListener('change', mSync); });
  $('cutMName').addEventListener('input', function () { machines[cur].name = $('cutMName').value; mSave(); mRender(); });
  document.querySelectorAll('.seg[data-name="cutLang"] button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(mSync, 0); }); });
  $('cutMachine').onchange = function () { var nx = parseInt($('cutMachine').value, 10) || 0; mSync(); cur = nx; mSave(); mToUI(machines[cur]); mRender(); status('เลือก ' + (machines[cur].name || 'เครื่อง ' + (cur + 1)), ''); };
  $('cutAddM').onclick = function () { mSync(); machines.push({ name: 'เครื่อง ' + (machines.length + 1), ip: '', port: '', lang: 'gpgl', step: '0.1', cond: '2' }); cur = machines.length - 1; mSave(); mRender(); mToUI(machines[cur]); $('cutMName').focus(); $('cutMName').select(); };
  $('cutDelM').onclick = function () {
    var b = $('cutDelM'); if (machines.length < 2) return;
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'ยืนยันลบ'; setTimeout(function () { b.classList.remove('arm'); b.textContent = 'ลบ'; }, 3000); return; }
    b.classList.remove('arm'); b.textContent = 'ลบ';
    machines.splice(cur, 1); cur = Math.max(0, cur - 1); mSave(); mRender(); mToUI(machines[cur]);
  };
})();
