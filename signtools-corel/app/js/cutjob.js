/* Sign Tools — แปลงเส้นตัดเป็นคำสั่ง Graphtec (HP-GL / GP-GL). Pure JS, ไม่มี DOM — ทดสอบด้วย Node ได้
 * paths: [{c:0|1, p:[ax,ay,lx,ly,rx,ry, ...]}] หน่วย มม. y ขึ้น (จาก st_cutRead)
 * opt: { lang:'hpgl'|'gpgl', step:0.1 (มม./หน่วย GP-GL), rotate:bool, mirror:bool, overcut:มม., tol:มม. }
 * → { data:string, w, h (มม. หลังหมุน), n, segs, polys:[[[x,y]...]] (มม. พิกัดเครื่อง) } */
(function (root) {
  'use strict';

  function flatten(path, tol) {
    var p = path.p, n = p.length / 6, out = [];
    if (n < 2) return out;
    function A(i) { i = i % n; return [p[i * 6], p[i * 6 + 1], p[i * 6 + 2], p[i * 6 + 3], p[i * 6 + 4], p[i * 6 + 5]]; }
    out.push([p[0], p[1]]);
    var segN = path.c ? n : n - 1;
    for (var i = 0; i < segN; i++) {
      var a = A(i), b = A(i + 1);
      var x0 = a[0], y0 = a[1], x1 = a[4], y1 = a[5], x2 = b[2], y2 = b[3], x3 = b[0], y3 = b[1];
      var straight = Math.abs(x1 - x0) + Math.abs(y1 - y0) + Math.abs(x2 - x3) + Math.abs(y2 - y3) < 1e-6;
      if (straight) { out.push([x3, y3]); continue; }
      // จำนวนช่วงจากความโค้ง (ค่าเบี่ยงสูงสุดของโครง) → ความคลาดเคลื่อน ≤ tol
      var dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3));
      var k = Math.max(2, Math.min(400, Math.ceil(Math.sqrt(0.75 * dd / tol))));
      for (var s = 1; s <= k; s++) {
        var t = s / k, u = 1 - t;
        out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                  u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
    }
    // ตัดจุดซ้ำ
    var clean = [out[0]];
    for (var j = 1; j < out.length; j++) {
      var q = clean[clean.length - 1];
      if (Math.abs(out[j][0] - q[0]) > 1e-4 || Math.abs(out[j][1] - q[1]) > 1e-4) clean.push(out[j]);
    }
    if (path.c && clean.length > 1) {
      var f = clean[0], l = clean[clean.length - 1];
      if (Math.abs(f[0] - l[0]) > 1e-4 || Math.abs(f[1] - l[1]) > 1e-4) clean.push([f[0], f[1]]);
    }
    return clean;
  }

  function bbox(pl) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    pl.forEach(function (q) { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1]; });
    return b;
  }
  function overcut(pl, d) {           // เส้นปิด: ตัดเลยจุดเริ่มต่อไปอีก d มม. ให้ชิ้นหลุดสะอาด
    if (!(d > 0) || pl.length < 3) return pl;
    var out = pl.slice(), left = d;
    for (var i = 1; i < pl.length && left > 1e-6; i++) {
      var a = pl[i - 1], b = pl[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L <= left) { out.push(b); left -= L; }
      else { var t = left / L; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); left = 0; }
    }
    return out;
  }

  function build(paths, opt) {
    opt = opt || {};
    var tol = opt.tol || 0.02, polys = [];
    paths.forEach(function (pa) {
      var pl = flatten(pa, tol);
      if (pl.length >= 2) polys.push({ pts: pl, closed: !!pa.c, k: pa.k || 'kiss' });
    });
    if (!polys.length) return { error: 'ไม่พบเส้นตัด' };

    var all = bbox([].concat.apply([], polys.map(function (o) { return o.pts; })));
    var W = all[2] - all[0], H = all[3] - all[1], mk = opt.marks;
    polys.forEach(function (o) {
      o.pts = o.pts.map(function (q) {
        // มีมาร์ค: พิกัดเครื่อง = X จากจุดกลางมาร์คล่าง, Y จากจุดกลางมาร์คขวา · X เครื่อง (ทางป้อน) = แนวตั้งในงาน · Y = แนวนอน (แบบเดียวกับ Cutting Master 5)
        if (mk) return [q[1] - mk.oy, mk.ox + mk.dy - q[0]];   // Y วัดจากมาร์คขวา (เทียบกับไฟล์ CM5 แล้ว)
        var x = q[0] - all[0], y = q[1] - all[1];
        if (opt.mirror) x = W - x;
        if (opt.rotate) { var t = x; x = y; y = W - t; }   // หมุน 90° ทวนเข็ม → ยังอยู่ในพื้นที่บวก
        return [x, y];
      });
    });
    var outW = mk ? H : opt.rotate ? H : W, outH = mk ? W : opt.rotate ? W : H, nm = !mk && opt.nm, cop = 1, perRow = 1, nmWarn = '';
    if (nm) {   // ไม่อ่านมาร์ค แบบ Cutting Master 5: จุดเริ่ม = มุมขวาล่างของงาน · X เครื่อง (ทางป้อน) = ขึ้นบน · Y = ไปทางซ้าย · ทำซ้ำหลายชุด (Matrix Copy)
      var aw = outW, ah = outH, gx = Math.max(0, nm.gx || 0), gy = Math.max(0, nm.gy || 0), x0 = Math.max(0, nm.x0 || 0), y0 = Math.max(0, nm.y0 || 0);
      cop = Math.max(1, Math.min(500, Math.round(nm.copies || 1)));
      var roll = nm.rollW > 0 ? nm.rollW : 0;
      perRow = roll ? Math.max(1, Math.floor((roll - y0 + gy + 1e-6) / (aw + gy))) : cop;
      if (roll && y0 + aw > roll + 1e-6) nmWarn = 'งานกว้าง ' + (aw / 10).toFixed(1) + ' ซม. เกินหน้ากว้างวัสดุ ' + (roll / 10).toFixed(1) + ' ซม.';
      var base = polys; polys = [];
      for (var ci = 0; ci < cop; ci++) {
        var r0 = Math.floor(ci / perRow), c0 = ci % perRow, offX = x0 + r0 * (ah + gx), offY = y0 + c0 * (aw + gy);
        base.forEach(function (o) { polys.push({ pts: o.pts.map(function (q) { return [q[1] + offX, aw - q[0] + offY]; }), closed: o.closed, k: o.k }); });
      }
      var rows = Math.ceil(cop / perRow);
      outW = x0 + rows * ah + (rows - 1) * gx; outH = y0 + Math.min(cop, perRow) * aw + (Math.min(cop, perRow) - 1) * gy;
    }
    polys.forEach(function (o) {
      o.b = bbox(o.pts);
      o.area = (o.b[2] - o.b[0]) * (o.b[3] - o.b[1]);
    });

    // ลำดับตัด: ชิ้นด้านใน (รู/ตัวอักษร) ก่อนชิ้นที่ครอบ แล้วไล่ตัวที่ใกล้หัวมีดที่สุด
    polys.forEach(function (o) {
      o.depth = 0;
      polys.forEach(function (z) {
        if (z !== o && z.closed && z.area > o.area && z.b[0] <= o.b[0] + 1e-6 && z.b[1] <= o.b[1] + 1e-6 && z.b[2] >= o.b[2] - 1e-6 && z.b[3] >= o.b[3] - 1e-6) o.depth++;
      });
    });
    var maxD = 0; polys.forEach(function (o) { if (o.depth > maxD) maxD = o.depth; });
    // แยกกลุ่มตามชนิดเส้น (ตั้งแรงกด/ความเร็วต่างกันได้) · ไม่ตั้ง = กลุ่มเดียว
    var drvOf = {}, rank = {};
    (opt.drv || []).forEach(function (g, i) { drvOf[g.k] = g; rank[g.k] = i; });
    // perPiece = ตัดครบทุกเส้นของดวงหนึ่ง (Kiss → Die ตามลำดับที่ตั้ง) แล้วค่อยไปดวงถัดไป · ปกติ = ตัดชนิดแรกทั้งแผ่นก่อน
    var groups = opt.drv && opt.drv.length && !opt.perPiece ? opt.drv.map(function (g) { return { drv: g, polys: polys.filter(function (o) { return o.k === g.k; }) }; }).filter(function (g) { return g.polys.length; }) : [{ drv: null, polys: polys }];
    var order = [], odrv = [], okind = [], cur = [0, 0];
    // ลำดับตัด: เรียงทีละแถวตามทางป้อน (X เครื่อง) จากใกล้จุดเริ่มก่อน · แถวสลับไป-กลับ (ซิกแซก) ไม่กระโดดไปมา
    // ชิ้นที่ซ้อนกัน (รู/ตัวอักษรในกรอบ) ตัดด้านในก่อนกรอบนอกของชิ้นเดียวกัน
    function serp(list) {
      if (!list.length) return [];
      list.forEach(function (o) {
        var root = o; list.forEach(function (z) { if (z !== o && z.closed && z.area > root.area && z.b[0] <= o.b[0] + 1e-6 && z.b[1] <= o.b[1] + 1e-6 && z.b[2] >= o.b[2] - 1e-6 && z.b[3] >= o.b[3] - 1e-6) root = z; });
        o.root = root; o.cx = (root.b[0] + root.b[2]) / 2; o.cy = (root.b[1] + root.b[3]) / 2;
      });
      var roots = list.filter(function (o) { return o.root === o; });
      var ext = roots.map(function (o) { return o.b[2] - o.b[0]; }).sort(function (a, b) { return a - b; });
      var band = Math.max(1, (ext[Math.floor(ext.length / 2)] || 10) * 0.5);
      roots.sort(function (a, b) { return a.cx - b.cx; });
      var rows = [];
      roots.forEach(function (o) { var R = rows[rows.length - 1]; if (R && o.cx - R.x0 < band) R.items.push(o); else rows.push({ x0: o.cx, items: [o] }); });
      var seq = [];
      rows.forEach(function (R, i) {
        R.items.sort(function (a, b) { return i % 2 ? b.cy - a.cy : a.cy - b.cy; });
        R.items.forEach(function (r) {
          list.filter(function (o) { return o.root === r; }).sort(function (a, b) { return ((rank[a.k] || 0) - (rank[b.k] || 0)) || (b.depth - a.depth); }).forEach(function (o) { seq.push(o); });
        });
      });
      return seq;
    }
    groups.forEach(function (G) {
      serp(G.polys).forEach(function (o) {
        var pts = o.pts, bs = 0, bd = Infinity;
        if (o.closed) {          // เส้นปิดเริ่มที่จุดไหนก็ได้ → เลือกจุดที่ใกล้หัวมีดที่สุด
          for (var s2 = 0; s2 < pts.length - 1; s2++) { var dd = Math.hypot(pts[s2][0] - cur[0], pts[s2][1] - cur[1]); if (dd < bd) { bd = dd; bs = s2; } }
          if (bs > 0) pts = pts.slice(bs, pts.length - 1).concat(pts.slice(0, bs)).concat([pts[bs]]);
          pts = overcut(pts, opt.overcut || 0);
        } else {
          var e = pts[pts.length - 1];
          if (Math.hypot(e[0] - cur[0], e[1] - cur[1]) < Math.hypot(pts[0][0] - cur[0], pts[0][1] - cur[1])) pts = pts.slice().reverse();
        }
        order.push(pts); odrv.push(G.drv || drvOf[o.k] || null); okind.push(o.k || 'kiss');
        cur = pts[pts.length - 1];
      });
    });

    var lang = mk ? 'gpgl' : opt.lang === 'gpgl' ? 'gpgl' : 'hpgl';
    var f = lang === 'hpgl' ? 40 : mk ? 10 : 1 / (opt.step || 0.1);        // HP-GL = 0.025 มม./หน่วย · มีมาร์ค = 0.1 มม. เสมอ
    function c(v) { return Math.round(v * f); }
    var segs = 0, parts = [];
    if (lang === 'hpgl') {
      parts.push('IN;PA;');
      order.forEach(function (pl) {
        var pd = [];
        for (var i = 1; i < pl.length; i++) pd.push(c(pl[i][0]) + ',' + c(pl[i][1]));
        segs += pd.length;
        parts.push('PU' + c(pl[0][0]) + ',' + c(pl[0][1]) + ';PD' + pd.join(',') + ';');
      });
      parts.push('PU0,0;');
    } else {
      var T = '\x03';
      var g0 = odrv[0], cond0 = (g0 && g0.cond) || (mk && mk.cond) || 2;
      function drvCmds(g, first) {    // ความเร็ว / แรงกด แบบที่ CM5 ส่ง: !(100+speed),cond · *accel,force,cond
        var o = (first ? '' : 'J' + g.cond + T);
        if (g.speed) o += '!' + (100 + Math.round(g.speed)) + ',' + g.cond + T;
        if (g.force) o += '*' + Math.round(g.accel || 2) + ',' + Math.round(g.force) + ',' + g.cond + T;
        return o + 'L0,B0' + T;
      }
      if (mk) {   // หัวคำสั่งอ่านมาร์ค (คัดลอกจากที่ Cutting Master 5 ส่งให้ CE7000): 4 จุด = TB24 · Segment = TB25 + ระยะช่วง
        parts.push('\x1b.v:TC1007,4,20' + T + 'TB99' + T + 'TB57,1,1' + T + (mk.seg ? 'TB59,402,301' : 'TB59,401,300') + T + 'TB50,0' + T + 'TB51,' + Math.round(mk.lenMM * 10) + T +
          'TB52,1' + T + 'TB54,0,0' + T + 'TB55,1' + T +
          (mk.seg ? 'TB25,' + Math.floor(mk.dx * 10 + 1e-6) + ',' + Math.floor(mk.dy * 10 + 1e-6) + ',0,' + Math.round((mk.stepMM || 250) * 10)
                  : 'TB24,' + Math.floor(mk.dx * 10 + 1e-6) + ',' + Math.floor(mk.dy * 10 + 1e-6)) + T + 'TB99' + T +
          '&100,100,100,^0,0,\\0,0,J' + cond0 + T + (g0 ? '' : 'L0,B0' + T));
      }
      var lastK = null;
      order.forEach(function (pl, idx) {
        var dv = odrv[idx];
        if (dv && dv.k !== lastK) { parts.push(drvCmds(dv, idx === 0 && !!mk)); lastK = dv.k; }
        var dl = [];
        for (var i = 1; i < pl.length; i++) dl.push(c(pl[i][0]) + ',' + c(pl[i][1]));
        segs += dl.length;
        parts.push('M' + c(pl[0][0]) + ',' + c(pl[0][1]) + T + 'D' + dl.join(',') + T);
      });
      if (mk) parts.push('TB0' + T + 'M' + Math.floor((mk.dx + mk.lenMM) * 10 + 1e-6) + ',0' + T + 'SO0' + T + 'M0,0' + T);
      else parts.push('M0,0' + T);
    }
    return { data: parts.join(lang === 'hpgl' ? '\n' : ''), w: outW, h: outH, n: order.length, segs: segs, polys: order, kinds: okind, lang: lang, mk: !!mk, art: !!mk || !!nm, roll: nm && nm.rollW > 0 ? nm.rollW : 0, copies: cop, perRow: perRow, warn: nmWarn };
  }

  // ชิ้นทดสอบ 20×20 มม.: กรอบ + ลูกศรชี้ทาง X(+) + ขีดสั้นชี้ทาง Y(+) → ดูทิศและวัดขนาด
  function testPaths() {
    function line(pts, closed) { var p = []; pts.forEach(function (q) { p.push(q[0], q[1], q[0], q[1], q[0], q[1]); }); return { c: closed ? 1 : 0, p: p }; }
    return [
      line([[0, 0], [20, 0], [20, 20], [0, 20]], true),
      line([[4, 6], [15, 6]], false),
      line([[12, 3.5], [15, 6], [12, 8.5]], false),
      line([[4, 6], [4, 15]], false)
    ];
  }

  // ---------- เครือข่าย (Node net) ----------
  function net(R, Buf) {
    var N = R('net'); Buf = Buf || R('buffer').Buffer;
    function tryPort(h, p, ms) {
      return new Promise(function (resolve) {
        var done = false, s = new N.Socket();
        function fin(ok) { if (done) return; done = true; try { s.destroy(); } catch (e) {} resolve(ok); }
        s.setTimeout(ms, function () { fin(false); });
        s.once('error', function () { fin(false); });
        s.connect(p, h, function () { fin(true); });
      });
    }
    function send(h, p, data, ms) {
      return new Promise(function (resolve, reject) {
        var s = new N.Socket(), done = false, buf = Buf.from(data, 'latin1'), connected = false;
        function fin(err) { if (done) return; done = true; clearTimeout(t); try { s.destroy(); } catch (e) {} if (err) reject(err); else resolve(buf.length); }
        var t = setTimeout(function () { fin(new Error('ต่อเครื่องไม่ได้ (หมดเวลา)')); }, ms || 8000);
        s.once('error', function (e) { fin(new Error(e.code === 'ECONNREFUSED' ? 'เครื่องปฏิเสธการเชื่อมต่อที่พอร์ต ' + p : (e.code || e.message))); });
        s.connect(p, h, function () {
          connected = true; clearTimeout(t);
          var off = 0, CH = 16384;            // เขียนทีละก้อน รอเครื่องรับ (TCP flow control)
          (function pump() {
            while (off < buf.length) {
              var ok = s.write(buf.slice(off, off + CH)); off += CH;
              if (!ok) { s.once('drain', pump); return; }
            }
            s.end(function () { setTimeout(function () { fin(null); }, 300); });
          })();
        });
      });
    }
    return { tryPort: tryPort, send: send };
  }

  root.STCut = { build: build, flatten: flatten, testPaths: testPaths, net: net };
  if (typeof module === 'object' && module.exports) module.exports = root.STCut;
})(typeof window !== 'undefined' ? window : this);
