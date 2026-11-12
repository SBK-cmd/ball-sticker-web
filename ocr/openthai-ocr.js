/* OpenThai 2.0 OCR Text (iApp, Apache-2.0) — รันในเบราว์เซอร์ด้วย onnxruntime-web
 * พอร์ตจาก runtime/line_engine.py ของโมเดล (ตัดส่วนที่ใบเสร็จไม่ต้องใช้: หมุนหน้า 90/180°, แยกคอลัมน์, ตัดช่องว่างในบรรทัด)
 * ใช้: const r = await OpenThaiOCR.read(imgOrCanvasOrDataURL, {onProgress}); r.text = ข้อความทีละบรรทัด
 * ไฟล์โมเดลอยู่ข้างไฟล์นี้: det.onnx, rec.onnx, rec_dict.txt (ดู NOTICE)
 */
(function () {
  'use strict';
  const ORT_VER = '1.20.1';
  const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/';
  const BASE = (function () { try { return new URL('.', document.currentScript.src).href; } catch (e) { return './ocr/'; } })();
  // ค่าตาม det.yml + config.json ของโมเดล
  const CFG = {
    det: {limit: 1280, thresh: 0.2, box_thresh: 0.4, unclip: 1.4, min_size: 3, max_candidates: 3000},
    rec: {height: 48, max_w: 3200, batch: 8, drop_below: 0.8, min_chars: 2, junk_below: 0.9, junk_invalid: 0.05},
    deskew_above: 2.5, max_side: 2800,
  };
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];   // ลำดับช่อง B,G,R ตามต้นฉบับ (OpenCV)
  let state = null;

  function loadScript(src) {
    return new Promise((res, rej) => { if (window.ort) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }
  async function init(onProgress) {
    if (state) return state;
    onProgress && onProgress('กำลังโหลดตัวอ่านบิล (ครั้งแรกประมาณ 4 MB)…');
    await loadScript(ORT_CDN + 'ort.wasm.min.js');
    ort.env.wasm.wasmPaths = ORT_CDN;
    ort.env.wasm.numThreads = 1;
    const opt = {executionProviders: ['wasm'], graphOptimizationLevel: 'all'};
    const [det, rec, dict] = await Promise.all([
      ort.InferenceSession.create(BASE + 'det.onnx', opt),
      ort.InferenceSession.create(BASE + 'rec.onnx', opt),
      fetch(BASE + 'rec_dict.txt').then(r => { if (!r.ok) throw new Error('rec_dict'); return r.text(); }),
    ]);
    const chars = [''].concat(dict.split('\n').filter(c => c), [' ']);
    state = {det, rec, chars};
    return state;
  }

  // ---------- ภาพ ----------
  async function toCanvas(src) {
    let img = src;
    if (typeof src === 'string') { img = new Image(); img.src = src; await img.decode(); }
    else if (src instanceof Blob) { img = await createImageBitmap(src); }
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, CFG.max_side / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const g = c.getContext('2d', {willReadFrequently: true}); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function rotateCanvas(c, deg) {   // หมุนให้บรรทัดเอียง deg องศากลับมาตรง ขยายผืนผ้าใบ เติมสีขาว
    const a = deg * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    const W = c.width, H = c.height, nW = Math.round(H * sn + W * cs), nH = Math.round(H * cs + W * sn);
    const o = document.createElement('canvas'); o.width = nW; o.height = nH;
    const g = o.getContext('2d', {willReadFrequently: true}); g.fillStyle = '#fff'; g.fillRect(0, 0, nW, nH);
    g.translate(nW / 2, nH / 2); g.rotate(-a); g.drawImage(c, -W / 2, -H / 2);
    return o;
  }

  // ---------- เรขาคณิต ----------
  function hull(pts) {   // monotone chain; pts = [[x,y],...]
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function minAreaRect(pts) {   // คืน {cx,cy,w,h,ux,uy} : u = ทิศตามแนวยาว (ความกว้าง)
    const H = hull(pts.slice());
    if (H.length < 3) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1, ux: 1, uy: 0}; }
    let best = null;
    for (let i = 0; i < H.length; i++) {
      const p = H[i], q = H[(i + 1) % H.length]; let ex = q[0] - p[0], ey = q[1] - p[1]; const L = Math.hypot(ex, ey); if (!L) continue; ex /= L; ey /= L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const r of H) { const a = r[0] * ex + r[1] * ey, b = -r[0] * ey + r[1] * ex; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
      const area = (a1 - a0) * (b1 - b0);
      if (!best || area < best.area) best = {area, ex, ey, a0, a1, b0, b1};
    }
    const {ex, ey, a0, a1, b0, b1} = best, am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
    let w = a1 - a0, h = b1 - b0, ux = ex, uy = ey;
    if (h > w) { [w, h] = [h, w]; ux = -ey; uy = ex; }
    if (ux < 0 || (ux === 0 && uy < 0)) { ux = -ux; uy = -uy; }
    return {cx: am * ex - bm * ey, cy: am * ey + bm * ex, w, h, ux, uy};
  }

  // ---------- หาบรรทัด (DB) ----------
  async function detect(c) {
    const {det} = state, D = CFG.det;
    const pad = Math.max(8, Math.floor(0.05 * Math.min(c.width, c.height)));
    const w = c.width + 2 * pad, h = c.height + 2 * pad;
    const s = Math.min(D.limit / Math.max(h, w), 4);
    const rw = Math.max(32, Math.round(w * s / 32) * 32), rh = Math.max(32, Math.round(h * s / 32) * 32);
    const t = document.createElement('canvas'); t.width = rw; t.height = rh;
    const g = t.getContext('2d', {willReadFrequently: true}); g.fillStyle = '#fff'; g.fillRect(0, 0, rw, rh);
    g.imageSmoothingQuality = 'high'; g.drawImage(c, pad * rw / w, pad * rh / h, c.width * rw / w, c.height * rh / h);
    const px = g.getImageData(0, 0, rw, rh).data, N = rw * rh, x = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {   // ช่อง 0=B 1=G 2=R
      x[i] = (px[i * 4 + 2] / 255 - MEAN[0]) / STD[0];
      x[N + i] = (px[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
      x[2 * N + i] = (px[i * 4] / 255 - MEAN[2]) / STD[2];
    }
    const out = await det.run({[det.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, rh, rw])});
    const prob = out[det.outputNames[0]].data;
    // ชิ้นส่วนที่ติดกัน (8 ทิศ) บนแผนที่ความน่าจะเป็น > thresh
    const lab = new Int32Array(N), boxes = [], sx = w / rw, sy = h / rh, stack = new Int32Array(N);
    let nComp = 0;
    for (let i0 = 0; i0 < N && nComp < D.max_candidates; i0++) {
      if (lab[i0] || prob[i0] <= D.thresh) continue;
      nComp++; let sp = 0; stack[sp++] = i0; lab[i0] = nComp;
      const edge = []; let sum = 0, cnt = 0;
      while (sp) {
        const i = stack[--sp], yy = (i / rw) | 0, xx = i - yy * rw; sum += prob[i]; cnt++;
        let border = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; const nx = xx + dx, ny = yy + dy;
          if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) { border = true; continue; }
          const j = ny * rw + nx;
          if (prob[j] > D.thresh) { if (!lab[j]) { lab[j] = nComp; stack[sp++] = j; } } else border = true;
        }
        if (border) edge.push([xx, yy], [xx + 1, yy + 1]);
      }
      if (cnt < 4) continue;
      const r = minAreaRect(edge);
      if (Math.min(r.w, r.h) < D.min_size || sum / cnt < D.box_thresh) continue;
      const d = (r.w * r.h) * D.unclip / (2 * (r.w + r.h));   // pyclipper offset = area*ratio/perimeter
      const W2 = r.w + 2 * d, H2 = r.h + 2 * d;
      if (H2 < D.min_size + 2) continue;
      boxes.push({cx: r.cx * sx - pad, cy: r.cy * sy - pad, w: W2 * sx, h: H2 * sy, ux: r.ux, uy: r.uy});
    }
    return boxes.filter(b => b.w >= 2 && b.h >= 2);
  }
  function pageSkew(boxes) {
    const a = boxes.filter(b => b.w >= 3 * Math.max(b.h, 1)).map(b => Math.atan2(b.uy, b.ux) * 180 / Math.PI).sort((p, q) => p - q);
    return a.length ? a[a.length >> 1] : 0;
  }

  // ---------- อ่านบรรทัด ----------
  function cropLine(c, b) {   // ตัดกล่องเอียงออกมา ย่อ/ขยายให้สูง 48 px
    const H = CFG.rec.height, W = Math.max(1, Math.min(CFG.rec.max_w, Math.ceil(H * b.w / Math.max(b.h, 1))));
    const o = document.createElement('canvas'); o.width = W; o.height = H;
    const g = o.getContext('2d', {willReadFrequently: true}); g.imageSmoothingQuality = 'high';
    const k = H / b.h, ang = Math.atan2(b.uy, b.ux);
    g.setTransform(k, 0, 0, k, W / 2, H / 2); g.rotate(-ang); g.translate(-b.cx, -b.cy);
    g.fillStyle = '#fff'; g.fillRect(b.cx - b.w, b.cy - b.h * 2, b.w * 2, b.h * 4);
    g.drawImage(c, 0, 0);
    const px = g.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return {gray: flatten(gray, W, H), W, H};
  }
  function median(arr) { const a = Array.from(arr).sort((p, q) => p - q); return a[a.length >> 1]; }
  function flatten(gr, w, h) {   // หักพื้นหลังรายคอลัมน์ (จากขอบบน/ล่าง) → ตัวหนังสือดำบนขาว ไม่ว่าสีอะไร
    const k = Math.max(2, Math.floor(h / 6)), bg0 = new Float32Array(w), col = new Float32Array(2 * k);
    for (let x = 0; x < w; x++) { for (let i = 0; i < k; i++) { col[i] = gr[i * w + x]; col[k + i] = gr[(h - 1 - i) * w + x]; } bg0[x] = Math.round(median(col)); }
    const win = Math.max(3, Math.min(h | 1, 255)), r = win >> 1, bg = new Float32Array(w), tmp = [];
    for (let x = 0; x < w; x++) { tmp.length = 0; for (let j = x - r; j <= x + r; j++) tmp.push(bg0[Math.min(w - 1, Math.max(0, j))]); bg[x] = median(tmp); }
    const d = new Float32Array(w * h), hist = new Uint32Array(256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.abs(gr[y * w + x] - bg[x]); d[y * w + x] = v; hist[Math.min(255, v | 0)]++; }
    let acc = 0, hi = 0; const lim = 0.98 * w * h; for (; hi < 256; hi++) { acc += hist[hi]; if (acc >= lim) break; }
    hi = Math.max(hi, 24);
    for (let i = 0; i < d.length; i++) d[i] = 255 - Math.min(255, d[i] * 255 / hi);
    return d;
  }
  async function recognize(crops) {
    const {rec, chars} = state, R = CFG.rec, H = R.height, out = new Array(crops.length);
    const order = crops.map((c, i) => i).sort((a, b) => crops[a].W - crops[b].W);
    for (let s = 0; s < order.length; s += R.batch) {
      const idx = order.slice(s, s + R.batch), W = Math.min(R.max_w, Math.max(16, Math.max(...idx.map(i => crops[i].W))));
      const n = idx.length, plane = H * W, x = new Float32Array(n * 3 * plane);   // 0 = เทากลางหลังทำ normalize
      idx.forEach((i, b) => { const c = crops[i]; for (let y = 0; y < H; y++) for (let xx = 0; xx < c.W; xx++) { const v = (c.gray[y * c.W + xx] / 255 - 0.5) / 0.5, o = b * 3 * plane + y * W + xx; x[o] = v; x[o + plane] = v; x[o + 2 * plane] = v; } });
      const res = await rec.run({[rec.inputNames[0]]: new ort.Tensor('float32', x, [n, 3, H, W])});
      const t = res[rec.outputNames[0]], [, T, C] = t.dims, p = t.data;
      idx.forEach((i, b) => {   // CTC: ตัดตัวซ้ำและช่องว่าง (index 0)
        let txt = '', sum = 0, cnt = 0, prev = -1;
        for (let k = 0; k < T; k++) { let m = 0, mv = -1, o = (b * T + k) * C; for (let j = 0; j < C; j++) if (p[o + j] > mv) { mv = p[o + j]; m = j; } if (m !== prev && m !== 0) { txt += chars[m] || ''; sum += mv; cnt++; } prev = m; }
        out[i] = {text: txt, conf: cnt ? sum / cnt : 0};
      });
    }
    return out;
  }

  // ---------- ข้อความไทยรูปแบบเดียว (thai_norm.canonical) + กรองขยะ ----------
  const PUA = {0xF700: 0x0E10, 0xF701: 0x0E34, 0xF702: 0x0E35, 0xF703: 0x0E36, 0xF704: 0x0E37, 0xF705: 0x0E48, 0xF706: 0x0E49, 0xF707: 0x0E4A, 0xF708: 0x0E4B, 0xF709: 0x0E4C, 0xF70A: 0x0E48, 0xF70B: 0x0E49, 0xF70C: 0x0E4A, 0xF70D: 0x0E4B, 0xF70E: 0x0E4C, 0xF70F: 0x0E0D, 0xF710: 0x0E31, 0xF711: 0x0E4D, 0xF712: 0x0E47, 0xF713: 0x0E48, 0xF714: 0x0E49, 0xF715: 0x0E4A, 0xF716: 0x0E4B, 0xF717: 0x0E4C, 0xF718: 0x0E38, 0xF719: 0x0E39, 0xF71A: 0x0E3A};
  const VOW = 'ัิีึืฺุู็', TONE = '่้๊๋์๎', NIK = 'ํ';
  function canonical(s) {
    s = Array.from(s || '').map(ch => { const c = ch.codePointAt(0); return PUA[c] ? String.fromCodePoint(PUA[c]) : c === 0xA0 ? ' ' : /[​‌‍⁠­﻿]/.test(ch) ? '' : ch; }).join('').normalize('NFC');
    s = s.replace(/[ัิีึืฺุู็่้๊๋์๎ํ]{2,}/g, run => { const o = []; Array.from(run).sort((a, b) => (VOW.includes(a) ? 0 : TONE.includes(a) ? 1 : 2) - (VOW.includes(b) ? 0 : TONE.includes(b) ? 1 : 2)).forEach(ch => { if (o[o.length - 1] !== ch) o.push(ch); }); return o.join(''); });
    s = s.replace(/([่-๋]?)ํ([่-๋]?)า/g, (m, a, b) => a + b + 'ำ').replace(/เเ/g, 'แ').replace(/ำำ/g, 'ำ');
    s = s.replace(/(?<![A-Za-z])[Ww](?=\.?[ก-ฮเ-ไ])/g, 'พ').replace(/(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g, '๐');
    return s.replace(/[ \t\f\v]+/g, ' ').trim();
  }
  const MARKS = new Set('ัิีึืฺุู็่้๊๋์ํ๎'), LEAD = new Set('เแโใไ');
  const isCons = ch => ch >= 'ก' && ch <= 'ฮ', isThai = ch => ch >= '฀' && ch <= '๿';
  function invalidShare(t) {
    let thai = 0, bad = 0;
    for (let i = 0; i < t.length; i++) { const ch = t[i]; if (!isThai(ch)) continue; thai++; const pv = i ? t[i - 1] : ' ';
      if (MARKS.has(ch) && !(isCons(pv) || (MARKS.has(pv) && i >= 2 && isCons(t[i - 2])))) bad++;
      else if (LEAD.has(ch) && !(i + 1 < t.length && isCons(t[i + 1]))) bad++; }
    return thai ? bad / thai : 0;
  }

  // ---------- ทั้งหน้า ----------
  async function read(src, opts) {
    opts = opts || {}; const t0 = performance.now();
    await init(opts.onProgress);
    opts.onProgress && opts.onProgress('กำลังหาบรรทัดตัวหนังสือ…');
    let c = await toCanvas(src), boxes = await detect(c);
    const skew = pageSkew(boxes);
    if (Math.abs(skew) >= CFG.deskew_above) { c = rotateCanvas(c, skew); boxes = await detect(c); }
    opts.onProgress && opts.onProgress('กำลังอ่าน ' + boxes.length + ' บรรทัด…');
    const res = await recognize(boxes.map(b => cropLine(c, b)));
    // เรียงบรรทัด: บนลงล่าง (หักมุมเอียงก่อน) แล้วซ้ายไปขวา
    const a = -pageSkew(boxes) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const items = boxes.map((b, i) => ({i, b, x: b.cx * ca - b.cy * sa, y: b.cx * sa + b.cy * ca, ...res[i]}));
    const hs = boxes.filter(b => b.w >= 2 * b.h).map(b => b.h).sort((p, q) => p - q), hmed = hs.length >= 3 ? hs[hs.length >> 1] : (boxes.map(b => b.h).sort((p, q) => p - q)[boxes.length >> 1] || 1);
    const R = CFG.rec, rows = [];
    items.sort((p, q) => p.y - q.y).forEach(it => {
      it.text = canonical(it.text);
      if (!it.text || it.conf < R.drop_below || it.text.replace(/ /g, '').length < R.min_chars || (it.conf < R.junk_below && invalidShare(it.text) > R.junk_invalid)) return;
      const row = rows.length && Math.abs(it.y - rows[rows.length - 1].cy) <= 0.5 * hmed ? rows[rows.length - 1] : null;
      if (row) { row.items.push(it); row.cy = row.items.reduce((s, o) => s + o.y, 0) / row.items.length; } else rows.push({cy: it.y, items: [it]});
    });
    const lines = rows.map(r => r.items.sort((p, q) => p.x - q.x).map(o => o.text).join(' '));
    return {text: lines.join('\n'), lines, nBoxes: boxes.length, skew, ms: Math.round(performance.now() - t0)};
  }

  window.OpenThaiOCR = {read, init, canonical, _cfg: CFG};
})();
