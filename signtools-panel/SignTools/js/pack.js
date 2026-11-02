/* Sign Tools — sticker sheet packing (pure JS, no DOM). Units: points.
 * pack({ sheetW, sheetH, margin, gap, rotate, items:[{w,h,qty}], fill:bool })
 *  → { sheets:[ [ {d, x, y, w, h, r} ] ], placed, tooBig:[d], perSheet }
 *  x,y = top-left of the cut-line box inside the sheet (origin = sheet top-left, y down).
 *  r = 1 when rotated 90°, w/h are the placed (rotated) size.
 * fill:true (single design) fills ONE sheet with as many as fit. */
(function (root) {
  'use strict';

  // ---------- MaxRects (Best Short Side Fit) ----------
  function MaxRects(W, H, rule) { this.W = W; this.H = H; this.rule = rule || 'tl'; this.free = [{ x: 0, y: 0, w: W, h: H }]; }
  MaxRects.prototype.find = function (w, h, rot) {
    var best = null, bs = Infinity, bl = Infinity;
    for (var i = 0; i < this.free.length; i++) {
      var f = this.free[i];
      var tries = [[w, h, 0]];
      if (rot && w !== h) tries.push([h, w, 1]);
      for (var t = 0; t < tries.length; t++) {
        var tw = tries[t][0], th = tries[t][1];
        if (tw <= f.w + 1e-6 && th <= f.h + 1e-6) {
          // Top-Left rule: lowest bottom edge first, then leftmost → fills in rows from the top (good for roll media)
          var s = this.rule === 'bssf' ? Math.min(f.w - tw, f.h - th) : f.y + th, l = this.rule === 'bssf' ? Math.max(f.w - tw, f.h - th) : f.x;
          if (s < bs - 1e-6 || (Math.abs(s - bs) < 1e-6 && l < bl - 1e-6)) {
            bs = s; bl = l; best = { x: f.x, y: f.y, w: tw, h: th, r: tries[t][2] };
          }
        }
      }
    }
    return best;
  };
  MaxRects.prototype.place = function (n) {
    var out = [];
    for (var i = 0; i < this.free.length; i++) {
      var f = this.free[i];
      if (n.x >= f.x + f.w || n.x + n.w <= f.x || n.y >= f.y + f.h || n.y + n.h <= f.y) { out.push(f); continue; }
      if (n.x > f.x) out.push({ x: f.x, y: f.y, w: n.x - f.x, h: f.h });
      if (n.x + n.w < f.x + f.w) out.push({ x: n.x + n.w, y: f.y, w: f.x + f.w - n.x - n.w, h: f.h });
      if (n.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: n.y - f.y });
      if (n.y + n.h < f.y + f.h) out.push({ x: f.x, y: n.y + n.h, w: f.w, h: f.y + f.h - n.y - n.h });
    }
    // prune rectangles contained in others
    var pr = [];
    for (var a = 0; a < out.length; a++) {
      var A = out[a], inside = false;
      if (A.w < 1e-6 || A.h < 1e-6) continue;
      for (var b = 0; b < out.length && !inside; b++) {
        if (a === b) continue;
        var B = out[b];
        if (A.x >= B.x - 1e-9 && A.y >= B.y - 1e-9 && A.x + A.w <= B.x + B.w + 1e-9 && A.y + A.h <= B.y + B.h + 1e-9) {
          if (!(A.x === B.x && A.y === B.y && A.w === B.w && A.h === B.h) || b < a) inside = true;
        }
      }
      if (!inside) pr.push(A);
    }
    this.free = pr;
  };

  // simple grid (best for many copies of one design)
  function grid(UW, UH, w, h, rot) {
    var best = { n: 0 };
    var opts = [[w, h, 0]];
    if (rot && w !== h) opts.push([h, w, 1]);
    opts.forEach(function (o) {
      var c = Math.floor((UW + 1e-6) / o[0]), r = Math.floor((UH + 1e-6) / o[1]);
      if (c * r > best.n) best = { n: c * r, cols: c, rows: r, w: o[0], h: o[1], r: o[2] };
    });
    return best;
  }

  function pack(o) {
    var g = o.gap || 0, m = o.margin || 0;
    // inflate every box by the gap; usable area gets one extra gap so the last column fits flush
    var UW = o.sheetW - 2 * m + g, UH = o.sheetH - 2 * m + g;
    var res = { sheets: [], placed: 0, tooBig: [], perSheet: 0 };
    if (UW <= 0 || UH <= 0) { res.error = 'ขอบกระดาษใหญ่เกินแผ่น'; return res; }

    var list = [];
    o.items.forEach(function (it, d) {
      var w = it.w + g, h = it.h + g;
      var fits = (w <= UW + 1e-6 && h <= UH + 1e-6) || (o.rotate && h <= UW + 1e-6 && w <= UH + 1e-6);
      if (!fits) { res.tooBig.push(d); return; }
      var q = o.fill ? 100000 : Math.max(0, Math.floor(it.qty || 0));
      for (var k = 0; k < q; k++) list.push({ d: d, w: w, h: h });
    });
    function out(p) { return { d: p.d, x: m + p.x, y: m + p.y, w: p.w - g, h: p.h - g, r: p.r }; }

    if (o.fill) {
      if (!list.length) return res;
      var it0 = list[0];
      // compare a plain grid with MaxRects and keep whichever fits more
      var gr = grid(UW, UH, it0.w, it0.h, o.rotate);
      var mp = [];
      ['tl', 'bssf'].forEach(function (rule) {          // ลอง 2 วิธี เก็บแบบที่ได้มากกว่า
        var mr = new MaxRects(UW, UH, rule), got = [], p;
        while ((p = mr.find(it0.w, it0.h, o.rotate))) { p.d = it0.d; mr.place(p); got.push(p); if (got.length > 5000) break; }
        if (got.length > mp.length) mp = got;
      });
      var sheet = [];
      if (gr.n >= mp.length) {
        for (var rr = 0; rr < gr.rows; rr++) for (var cc = 0; cc < gr.cols; cc++)
          sheet.push(out({ d: it0.d, x: cc * gr.w, y: rr * gr.h, w: gr.w, h: gr.h, r: gr.r }));
      } else mp.forEach(function (q) { sheet.push(out(q)); });
      res.sheets.push(sheet); res.placed = sheet.length; res.perSheet = sheet.length;
      return res;
    }

    // multi design: biggest first, new sheet when nothing else fits
    list.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h) || a.d - b.d; });
    var guard = 0;
    while (list.length && guard++ < 500) {
      var mrs = new MaxRects(UW, UH), sh = [], rest = [];
      for (var i = 0; i < list.length; i++) {
        var q2 = mrs.find(list[i].w, list[i].h, o.rotate);
        if (q2) { q2.d = list[i].d; mrs.place(q2); sh.push(out(q2)); } else rest.push(list[i]);
      }
      if (!sh.length) break;
      sh.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      res.sheets.push(sh); res.placed += sh.length; list = rest;
    }
    res.perSheet = res.sheets.length ? res.sheets[0].length : 0;
    return res;
  }

  root.STPack = { pack: pack };
  if (typeof module === 'object' && module.exports) module.exports = root.STPack;
})(typeof window !== 'undefined' ? window : this);
