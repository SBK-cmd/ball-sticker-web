/* Sign Tools — Extract: Kiss Cut (ชมพู Spot ไม่พิมพ์) + Die Cut (ตามเส้น Kiss / สี่เหลี่ยม / มุมมน) + มาร์ค CM5 จากงานที่เลือก */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
  function host(fn, arg) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน Illustrator' });
      window.__adobe_cep__.evalScript(fn + '(' + (arg === undefined ? '' : esc(arg)) + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: 'สคริปต์ผิดพลาด: ' + String(r).slice(0, 200) }); }
      });
    });
  }
  function num(id, d) { var v = parseFloat($(id).value); return isFinite(v) ? v : d; }
  function ui() {
    var ks = $('extKissShape').value, d = $('extDie').value, kon = $('extKiss').checked;
    $('extKissBox').classList.toggle('hidden', !kon);
    $('extKissRadRow').classList.toggle('hidden', ks === 'contour' || ks === 'rect');
    $('extDieBox').classList.toggle('hidden', d === 'none');
    $('extDieRadRow').classList.toggle('hidden', d !== 'round');
  }
  ['extKiss', 'extKissShape', 'extDie'].forEach(function (id) { $(id).addEventListener('change', ui); });
  setTimeout(ui, 0);
  function opts() {
    return {
      kiss: { on: $('extKiss').checked, shape: $('extKissShape').value, offMM: num('extKissOff', 2), radMM: num('extKissRad', 3) },
      die: { shape: $('extDie').value, offMM: Math.max(0, num('extDieOff', 3)), radMM: Math.max(0, num('extDieRad', 5)) },
      marks: { on: $('extMarks').checked, thrMM: 500 },
      smooth: Math.max(0, Math.min(10, Math.round(num('extSmooth', 4))))
    };
  }
  $('extSmooth').addEventListener('input', function () { $('extSmVal').textContent = $('extSmooth').value; });
  $('extSmVal').textContent = $('extSmooth').value;
  function run(preview) {
    var o = opts(), b = preview ? $('extPv') : $('extGo');
    o.preview = !!preview;
    if (!o.kiss.on && o.die.shape === 'none') { $('extRes').textContent = 'เลือกทำ Kiss Cut หรือ Die Cut อย่างน้อยหนึ่งอย่าง'; return; }
    b.disabled = true; $('extRes').textContent = (preview ? 'กำลังทำพรีวิว… ' : 'กำลังสร้างเส้นตัด… ') + ' (งานเยอะอาจใช้เวลาหลายนาที อย่าแตะ Illustrator)'; $('extWarn').textContent = '';
    host('st_extract', o).then(function (r) {
      b.disabled = false;
      if (r.error) { $('extRes').textContent = '⚠ ' + r.error; return; }
      $('extRes').textContent = '✓ ' + r.msg;
      $('extWarn').textContent = (r.warn || []).join(' · ');
    });
  }

  /* ---------- พรีวิวในจอ: เกลาเส้นฝั่งแผง (พอร์ตจาก st_smoothPath) แล้ววาดสดตามตัวเลื่อน ---------- */
  var pv = null;   // { items:[{vb,paths}], key:'shape|off' }
  function bez(a, b, t) { var u = 1 - t; return [u*u*u*a[0] + 3*u*u*t*a[4] + 3*u*t*t*b[2] + t*t*t*b[0], u*u*u*a[1] + 3*u*u*t*a[5] + 3*u*t*t*b[3] + t*t*t*b[1]]; }
  // flat = [ax,ay,lx,ly,rx,ry,...] (มม.) → จุดโพลีไลน์ปิดที่เกลาแล้ว (level 0 = ตามเดิมเป๊ะ ไม่เกลา)
  function smoothPts(flat, level) {
    var n = flat.length / 6, i, j, k, P = [];
    for (i = 0; i < n; i++) P.push(flat.slice(i * 6, i * 6 + 6));
    var pts = [];
    for (i = 0; i < n; i++) { var A = P[i], B = P[(i + 1) % n]; for (j = 0; j < 6; j++) pts.push(bez(A, B, j / 6)); }
    if (level <= 0) return pts;
    var step = 0.25, rs = [pts[0]], acc = 0;
    for (i = 1; i <= pts.length; i++) {
      var P0 = pts[i - 1], P1 = pts[i % pts.length], sl = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
      while (acc + sl >= step && sl > 0) { var f = (step - acc) / sl; P0 = [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f]; rs.push(P0); sl -= (step - acc); acc = 0; }
      acc += sl;
    }
    if (rs.length > 8) pts = rs;
    var m = pts.length;
    for (k = 0; k < level * 2; k++) {
      var q = [];
      for (i = 0; i < m; i++) { var L = pts[(i - 1 + m) % m], C = pts[i], R = pts[(i + 1) % m]; q.push([(L[0] + 2 * C[0] + R[0]) / 4, (L[1] + 2 * C[1] + R[1]) / 4]); }
      pts = q;
    }
    var tol = level * 0.03, far = 0, fd = -1;
    for (i = 1; i < m; i++) { var d0 = Math.pow(pts[i][0] - pts[0][0], 2) + Math.pow(pts[i][1] - pts[0][1], 2); if (d0 > fd) { fd = d0; far = i; } }
    function dp(a, b, out) {
      var A = pts[a], B = pts[b % m], dx = B[0] - A[0], dy = B[1] - A[1], len = Math.sqrt(dx * dx + dy * dy) || 1e-9, best = -1, bi = -1;
      for (var x = a + 1; x < b; x++) { var Q = pts[x % m], dd = Math.abs(dy * (Q[0] - A[0]) - dx * (Q[1] - A[1])) / len; if (dd > best) { best = dd; bi = x; } }
      if (best > tol) { dp(a, bi, out); dp(bi, b, out); } else out.push(A);
    }
    var res = []; dp(0, far, res); dp(far, m, res);
    if (res.length < 3) return pts;
    // Catmull-Rom → โค้งเรียบผ่านจุด (วาดเป็นเบซิเยร์ตรงๆ ใน drawSmooth)
    return { cr: res };
  }
  function trace(ctx, pts, X, Y) {
    ctx.beginPath();
    if (pts.cr) {
      var r = pts.cr, N = r.length, i;
      ctx.moveTo(X(r[0][0]), Y(r[0][1]));
      for (i = 0; i < N; i++) {
        var Pm = r[(i - 1 + N) % N], Pc = r[i], Pn = r[(i + 1) % N], Pq = r[(i + 2) % N];
        ctx.bezierCurveTo(X(Pc[0] + (Pn[0] - Pm[0]) / 6), Y(Pc[1] + (Pn[1] - Pm[1]) / 6), X(Pn[0] - (Pq[0] - Pc[0]) / 6), Y(Pn[1] - (Pq[1] - Pc[1]) / 6), X(Pn[0]), Y(Pn[1]));
      }
    } else { pts.forEach(function (p, i) { i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])); }); }
    ctx.closePath();
  }
  function rr(ctx, L, B, R, T, rad, X, Y) {   // สี่เหลี่ยม/มุมมน (มม., y ขึ้น)
    var x0 = X(L), x1 = X(R), y0 = Y(T), y1 = Y(B), w = x1 - x0, h = y1 - y0, r = Math.max(0, Math.min(rad * (x1 - x0) / (R - L || 1), w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r); ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r); ctx.closePath();
  }
  function kissKey(o) { return o.kiss.shape + '|' + o.kiss.offMM; }
  function draw() {
    var cv = $('extCanvas'), ctx = cv.getContext('2d'), o = opts(), lvl = o.smooth;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!pv) return;
    var bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, pad = 0;
    var pd = Math.max(o.kiss.on ? Math.abs(o.kiss.offMM) : 0, 0) + (o.die.shape !== 'none' ? o.die.offMM : 0) + 2;
    pv.items.forEach(function (it) { bx0 = Math.min(bx0, it.vb[0] - pd); bx1 = Math.max(bx1, it.vb[2] + pd); by0 = Math.min(by0, it.vb[3] - pd); by1 = Math.max(by1, it.vb[1] + pd); });
    var W = cv.width, H = cv.height, sc = Math.min((W - 12) / (bx1 - bx0 || 1), (H - 12) / (by1 - by0 || 1));
    var ox = (W - (bx1 - bx0) * sc) / 2, oy = (H - (by1 - by0) * sc) / 2;
    var X = function (x) { return ox + (x - bx0) * sc; }, Y = function (y) { return H - oy - (y - by0) * sc; };
    ctx.lineJoin = 'round';
    pv.items.forEach(function (it) {
      var vb = it.vb, kb = [vb[0], vb[3], vb[2], vb[1]];   // L,B,R,T ของ Kiss
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(X(vb[0]), Y(vb[1]), (vb[2] - vb[0]) * sc, (vb[1] - vb[3]) * sc); ctx.setLineDash([]);
      var kissPaths = [];
      if (o.kiss.on) {
        var ko = o.kiss.offMM;
        if (o.kiss.shape === 'contour') { it.paths.forEach(function (f) { kissPaths.push(smoothPts(f, lvl)); }); }
        else { kb = [vb[0] - ko, vb[3] - ko, vb[2] + ko, vb[1] + ko]; }
      }
      var db = kb;
      if (o.die.shape === 'rect' || o.die.shape === 'round') {
        var de = o.die.offMM, dr = o.die.shape === 'round' ? o.die.radMM : 0;
        rr(ctx, db[0] - de, db[1] - de, db[2] + de, db[3] + de, dr, X, Y);
        ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2; ctx.stroke();
      } else if (o.die.shape === 'same' && o.kiss.shape === 'contour') {
        kissPaths.forEach(function (pt) { trace(ctx, pt, X, Y); ctx.strokeStyle = 'rgba(61,220,132,.35)'; ctx.lineWidth = Math.max(2, 2 * o.die.offMM * sc); ctx.stroke(); });
      }
      if (o.kiss.on) {
        ctx.strokeStyle = '#ff4fb0'; ctx.lineWidth = 1.6;
        if (o.kiss.shape === 'contour') kissPaths.forEach(function (pt) { trace(ctx, pt, X, Y); ctx.stroke(); });
        else { rr(ctx, kb[0], kb[1], kb[2], kb[3], o.kiss.shape === 'round' ? o.kiss.radMM : 0, X, Y); ctx.stroke(); }
      }
    });
    var stale = pv.key !== kissKey(o) && o.kiss.on && o.kiss.shape === 'contour';
    $('extStale').textContent = stale ? 'ค่า "ออกจากขอบงาน" เปลี่ยนแล้ว — กดพรีวิวในจอใหม่เพื่ออัปเดตเส้นตามรูป' : '';
    $('extStale').classList.toggle('hidden', !stale);
  }
  $('extView').onclick = function () {
    var o = opts(), b = $('extView');
    if (!o.kiss.on) { $('extRes').textContent = 'เปิด Kiss Cut ก่อนจึงจะพรีวิวในจอได้'; return; }
    b.disabled = true; $('extRes').textContent = 'กำลังอ่านเส้น…'; $('extWarn').textContent = '';
    host('st_extractRead', { kiss: { shape: o.kiss.shape, offMM: o.kiss.offMM } }).then(function (r) {
      b.disabled = false;
      if (r.error) { $('extRes').textContent = '⚠ ' + r.error; return; }
      if (!r.items || !r.items.length) { $('extRes').textContent = 'ยังไม่ได้เลือกงาน'; return; }
      pv = { items: r.items, key: kissKey(o) };
      ['extCanvas', 'extLegend'].forEach(function (id) { $(id).classList.remove('hidden'); });
      $('extRes').textContent = 'พรีวิว ' + r.items.length + ' ดวง' + (r.total > r.items.length ? ' (จาก ' + r.total + ')' : '') + ' — เลื่อน Smooth ดูได้เลย';
      $('extWarn').textContent = (r.warn || []).join(' · ');
      draw();
    });
  };
  ['extSmooth', 'extKissOff', 'extKissRad', 'extDieOff', 'extDieRad'].forEach(function (id) { $(id).addEventListener('input', draw); });
  ['extKiss', 'extKissShape', 'extDie'].forEach(function (id) { $(id).addEventListener('change', draw); });
  $('extGo').onclick = function () { run(false); };
  $('extPv').onclick = function () { run(true); };
  $('extPvClear').onclick = function () {
    host('st_stkPreviewClear', undefined).then(function (r) { $('extRes').textContent = r.error ? '⚠ ' + r.error : r.msg; $('extWarn').textContent = ''; });
  };
})();
