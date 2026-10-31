/* Sign Tools — เรียงสติ๊กเกอร์ลงแผ่น + เส้น kiss cut */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MM0 = 72 / 25.4, MM = MM0;   // MM = หน่วยสคริปต์ต่อ 1 มม. (ไฟล์ Large Canvas หาร 10)
  var COLORS = ['#ffd23f', '#7fd3ef', '#ff6fa0', '#6fdc9a', '#b38cff', '#ff9f5a', '#5ab0ff', '#e6e6e6'];

  function esc(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
  }
  function host(fn, arg) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน CorelDRAW' });
      window.__adobe_cep__.evalScript(fn + '(' + (arg === undefined ? '' : esc(arg)) + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: 'สคริปต์ผิดพลาด: ' + r }); }
      });
    });
  }
  var toastT;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 3200); }
  function num(id, d) { var v = parseFloat($(id).value); return isNaN(v) ? d : v; }
  function mode() { var b = document.querySelector('.seg[data-name="stkMode"] .on'); return b ? b.dataset.v : 'fill'; }
  // ---------- หน่วย: ค่าภายในเป็น มม. เสมอ ช่องกรอก/ที่แสดงใช้หน่วยที่เลือก ----------
  var UF = { mm: 1, cm: 10, 'in': 25.4, m: 1000 }, UN = { mm: 'มม.', cm: 'ซม.', 'in': 'นิ้ว', m: 'ม.' }, UD = { mm: 1, cm: 2, 'in': 3, m: 4 };
  var UST = { mm: '0.5', cm: '0.05', 'in': '0.02', m: '0.001' };
  var LEN = ['stkOff', 'stkRad', 'stkGap', 'stkW', 'stkH', 'stkMargin', 'stkMkIn', 'stkMkLen', 'stkMkW', 'stkMkGap', 'stkDieOff', 'stkDieRad', 'stkCrW', 'stkCrIn'];
  function unit() { var u = $('stkUnit').value; return UF[u] ? u : 'mm'; }
  function mmv(id, dMM) { var v = parseFloat($(id).value); return isNaN(v) ? dMM : v * UF[unit()]; }   // อ่านช่อง → มม.
  function round(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }
  function fmt(mm) { var u = unit(); return round(mm / UF[u], UD[u]).toString(); }
  function U_() { return UN[unit()]; }
  var curUnit = null;
  function applyUnit(newU) {
    var old = curUnit || newU;
    if (old !== newU) LEN.forEach(function (id) { var v = parseFloat($(id).value); if (!isNaN(v)) $(id).value = round(v * UF[old] / UF[newU], UD[newU] + 1); });
    curUnit = newU; $('stkUnit').value = newU;
    document.querySelectorAll('#tab-stk .u').forEach(function (e) { e.textContent = UN[newU]; });
    LEN.forEach(function (id) { $(id).step = UST[newU]; });
    document.querySelectorAll('.seg[data-name="stkUnitSeg"] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === newU); });
  }

  var items = [], qty = {}, result = null, page = 0;

  // ---------- ขนาดเส้นตัดของแต่ละลาย (มม.) ----------
  // ขยายออก: ติดลบได้ = หดเส้นตัดเข้าในงาน (ให้งานพิมพ์เลยเส้นตัด ไม่เห็นขอบขาว) สูงสุด -10 มม.
  function kissOff() { return Math.max(-10, Math.min(100, mmv('stkOff', 0))); }
  // เส้นตัดหดเข้าในงาน → งานพิมพ์ยื่นเลยกรอบตัด ต้องเว้นห่างพอไม่ให้งานดวงข้างๆ ทับกัน
  function bleedOut() { var d = die(); return Math.max(0, -kissOff() - (d ? d.offMM : 0)); }
  function effGap() { return Math.max(Math.max(0, mmv('stkGap', 3)), 2 * bleedOut()); }
  function die() { return $('stkDie').checked ? { shape: $('stkDieShape').value, offMM: Math.max(0, mmv('stkDieOff', 3)), radMM: Math.max(0, mmv('stkDieRad', 5)) } : null; }
  function credit() {
    if (!$('stkCredit').checked) return null;
    return { file: $('stkCrFile').value || '', text: $('stkCrText').value.trim() || 'บอล สติ๊กเกอร์', pos: $('stkCrPos').value, wMM: Math.max(3, mmv('stkCrW', 20)), inMM: Math.max(0, mmv('stkCrIn', 2)) };
  }
  function cutSize(it) { var s = kissSize(it), d = die(); if (d) { s.w += 2 * d.offMM; s.h += 2 * d.offMM; } return s; }
  function kissSize(it) {
    var cut = $('stkCut').value, off = kissOff();
    var b = (cut === 'own' && it.cut) ? it.cut : it.vb;
    var w = (b[2] - b[0]) / MM, h = (b[1] - b[3]) / MM;
    if (cut === 'own' && it.cut) return { w: w, h: h };
    if (cut === 'own') return { w: w + 2 * off, h: h + 2 * off };        // ไม่มีเส้น → สี่เหลี่ยมแทน
    if (cut === 'circle') { var d = Math.max(w, h) + 2 * off; return { w: d, h: d }; }
    return { w: w + 2 * off, h: h + 2 * off };
  }
  function sheetSize() {
    var v = $('stkSheet').value, w, h;
    if (v === 'custom') return { w: Math.max(20, mmv('stkW', 210)), h: Math.max(20, mmv('stkH', 297)) };   // ใช้ตามที่พิมพ์
    var p = v.split('x'); w = +p[0]; h = +p[1];
    if ($('stkOrient').value === 'l') { var t = w; w = Math.max(w, h); h = Math.min(t, h); }
    else { var t2 = w; w = Math.min(w, h); h = Math.max(t2, h); }
    return { w: w, h: h };
  }

  function cm5On() { return $('stkCm5').checked; }
  function marks() {
    if (!$('stkMarks').checked || cm5On()) return null;
    return { insetMM: Math.max(0, mmv('stkMkIn', 10)), lenMM: Math.max(3, mmv('stkMkLen', 10)), wMM: Math.max(0.2, mmv('stkMkW', 0.5)), gapMM: Math.max(0, mmv('stkMkGap', 3)) };
  }
  // ขอบที่สติ๊กเกอร์วางได้ = ไกลกว่าขอบกระดาษที่ตั้ง และพ้นแนวมาร์ค
  function effMargin() {
    var m = Math.max(0, mmv('stkMargin', 5)), mk = marks();
    if (mk) m = Math.max(m, mk.insetMM + mk.wMM + mk.gapMM);
    if (cm5On()) m = Math.max(m, 19);          // มาร์ค CM5 อยู่นอกงาน 18.5 มม. → ต้องมีที่ในแผ่น
    return Math.max(m, bleedOut());
  }

  // ---------- คำนวณ + แสดงตัวอย่าง ----------
  function recalc() {
    var custom = $('stkSheet').value === 'custom', isRect = $('stkCut').value === 'rect';
    document.querySelectorAll('#tab-stk .onlyCustom').forEach(function (e) { e.classList.toggle('hidden', !custom); });
    $('stkOrient').parentNode.classList.toggle('hidden', custom);
    $('stkSheet').parentNode.style.gridColumn = custom ? '1 / -1' : '';
    document.querySelectorAll('#tab-stk .onlyRect').forEach(function (e) { e.classList.toggle('hidden', !isRect); });
    document.querySelectorAll('#tab-stk .onlyMarks').forEach(function (e) { e.classList.toggle('hidden', !$('stkMarks').checked || cm5On()); });
    $('stkMarks').parentNode.classList.toggle('hidden', cm5On());
    document.querySelectorAll('#tab-stk .onlyFill').forEach(function (e) { e.classList.toggle('hidden', mode() !== 'fill'); });
    document.querySelectorAll('#tab-stk .onlyDie').forEach(function (e) { e.classList.toggle('hidden', !$('stkDie').checked); });
    document.querySelectorAll('#tab-stk .onlyDieRect').forEach(function (e) { e.classList.toggle('hidden', $('stkDieShape').value !== 'rect'); });
    document.querySelectorAll('#tab-stk .onlyCredit').forEach(function (e) { e.classList.toggle('hidden', !$('stkCredit').checked); });
    var hasF = !!$('stkCrFile').value;
    $('stkCrName').textContent = hasF ? $('stkCrFile').value.split(/[\\/]/).pop() : 'ยังไม่ได้เลือก · ใช้ข้อความแทน';
    $('stkCrClear').classList.toggle('hidden', !hasF);
    document.querySelector('#tab-stk .crtext').classList.toggle('hidden', hasF);
    var m = mode();
    renderList(m);
    result = null; page = 0;
    if (!items.length) { $('stkRes').textContent = 'ยังไม่มีสติ๊กเกอร์'; $('stkGo').disabled = true; draw(); return; }
    var sh = sheetSize();
    var list = (m === 'fill' ? [items[0]] : items).map(function (it, i) {
      var s = cutSize(it);
      return { w: s.w * MM, h: s.h * MM, qty: m === 'fill' ? 0 : (qty[i] == null ? 10 : qty[i]) };
    });
    result = STPack.pack({ sheetW: sh.w * MM, sheetH: sh.h * MM, margin: effMargin() * MM,
      gap: effGap() * MM, rotate: $('stkRot').checked, fill: m === 'fill', items: list });
    var msg = '', sub = '', need = Math.max(0, Math.floor(parseFloat($('stkNeed').value) || 0));
    if (m === 'fill' && !result.error && result.perSheet && need > 0) applyNeed(result, need, $('stkFullRow').checked);
    if (result.error) msg = '⚠ ' + result.error;
    else if (m === 'fill' && result.need) {
      msg = 'ต้องการ ' + result.need + ' → ได้ ' + result.placed + ' ดวง' + (result.over ? ' (เกิน ' + result.over + ')' : ' (พอดี)');
      var sA = cutSize(items[0]), ns = result.sheets.length, last = result.sheets[ns - 1].length;
      sub = ns + ' แผ่น · ' + (ns > 1 ? 'เต็ม ' + (last === result.perSheet ? ns : ns - 1) + ' แผ่น × ' + result.perSheet + (last === result.perSheet ? '' : ' + แผ่นสุดท้าย ' + last + ' ดวง') : last + ' ดวง (แผ่นละ ' + result.perSheet + ')') +
        ' · ขนาดเส้นตัด ' + fmt(sA.w) + ' × ' + fmt(sA.h) + ' ' + U_() + ' · แผ่น ' + fmt(sh.w) + ' × ' + fmt(sh.h) + ' ' + U_();
    } else if (m === 'fill') {
      msg = result.perSheet ? 'ได้ ' + result.perSheet + ' ดวง / แผ่น' : '⚠ สติ๊กเกอร์ใหญ่กว่าแผ่น';
      var s0 = cutSize(items[0]); sub = 'ขนาดเส้นตัด ' + fmt(s0.w) + ' × ' + fmt(s0.h) + ' ' + U_() + ' · แผ่น ' + fmt(sh.w) + ' × ' + fmt(sh.h) + ' ' + U_();
      if (items.length > 1) sub += ' · ใช้ลายแรกเท่านั้น (เปลี่ยนเป็น "หลายลาย" เพื่อใช้ทุกลาย)';
    } else {
      var want = list.reduce(function (a, x) { return a + x.qty; }, 0);
      msg = result.sheets.length + ' แผ่น · ' + result.placed + ' ดวง';
      var parts = result.sheets.slice(0, 6).map(function (s, i) { return 'แผ่น ' + (i + 1) + ': ' + s.length; });
      if (result.sheets.length > 6) parts.push('…');
      sub = parts.join(' · ');
      if (result.sheets.length > 20) sub += ' · ⚠ จำนวนแผ่นเยอะมาก ตรวจขนาดแผ่น/จำนวนดวงอีกครั้ง';
      if (result.placed < want && !result.tooBig.length) sub += ' · ⚠ วางได้ไม่ครบ';
    }
    if (effGap() > Math.max(0, mmv('stkGap', 3)) + 1e-6) sub += ' · ระยะห่างจริง ' + fmt(effGap()) + ' ' + U_() + ' (เส้นตัดอยู่ในงาน เว้นเพิ่มไม่ให้งานทับดวงข้างๆ)';
    var mk0 = marks(); if (mk0) sub += ' · มาร์คห่างกัน ' + fmt(sh.w - 2 * mk0.insetMM) + ' × ' + fmt(sh.h - 2 * mk0.insetMM) + ' ' + U_() + ' (ขอบวางงาน ' + fmt(effMargin()) + ' ' + U_() + ')';
    if (result.tooBig && result.tooBig.length) sub += ' · ⚠ ใหญ่เกินแผ่น: ' + result.tooBig.map(function (d) { return items[d].name; }).join(', ');
    $('stkRes').innerHTML = '';
    $('stkRes').appendChild(document.createTextNode(msg));
    var sm = document.createElement('small'); sm.textContent = sub; $('stkRes').appendChild(sm);
    $('stkGo').disabled = !(result && result.placed);
    draw();
  }

  // จำนวนที่ต้องการ: แผ่นเต็ม + แผ่นสุดท้าย (เติมให้ครบแถว) — ใช้ layout ของแผ่นเต็มซ้ำ
  function applyNeed(r, need, fullRow) {
    var base = r.sheets[0].slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var per = base.length, full = Math.floor(need / per), rest = need - full * per, sheets = [], i;
    for (i = 0; i < full; i++) sheets.push(base);
    if (rest > 0) {
      var take = rest;
      if (fullRow) {
        var rows = [], tol = 0.5;
        base.forEach(function (p) { var L = rows[rows.length - 1]; if (L && Math.abs(p.y - L.y) < tol) L.n++; else rows.push({ y: p.y, n: 1 }); });
        take = 0;
        for (i = 0; i < rows.length && take < rest; i++) take += rows[i].n;
      }
      sheets.push(base.slice(0, take));
    }
    r.sheets = sheets; r.need = need;
    r.placed = sheets.reduce(function (a, s) { return a + s.length; }, 0);
    r.over = r.placed - need;
  }
  // ข้อความบอกจำนวนบน artboard: วางใต้แถวล่างสุด (ถ้ามีที่ว่าง) ไม่งั้นชิดขอบล่าง
  // ความสูงแต่ละแผ่นเมื่อ "ตัดแผ่นให้พอดีงาน": ขอบล่างของดวงล่างสุด + ระยะขอบ (+ที่ใส่ข้อความ)
  function sheetHeights(r, sh, withNote) {
    if (!$('stkTrim').checked) return null;
    var m = effMargin();
    return (r.sheets || []).map(function (s) {
      var bottom = 0; s.forEach(function (p) { bottom = Math.max(bottom, (p.y + p.h) / MM); });
      return Math.min(sh.h, bottom + Math.max(m, withNote ? 7 : 0)) * MM;
    });
  }
  function needNotes(r, sh, hs) {
    var multi = mode() === 'multi';
    if (!r.need && !multi) return null;
    var gap = effGap(), m = effMargin(), sheets = r.sheets || [];
    var tot = {}; sheets.forEach(function (s) { s.forEach(function (p) { tot[p.d] = (tot[p.d] || 0) + 1; }); });
    return sheets.map(function (s, i) {
      var bottom = 0; s.forEach(function (p) { bottom = Math.max(bottom, (p.y + p.h) / MM); });
      var H = hs ? hs[i] / MM : sh.h;
      var yMM = H - bottom >= 6 ? bottom + Math.min(gap + 1, (H - bottom) / 2) : H - 3;
      var text;
      if (multi) {         // หลายลาย: บอกแยกทีละลาย (แผ่นนี้ / ทั้งหมด / ที่ต้องการ)
        var here = {}; s.forEach(function (p) { here[p.d] = (here[p.d] || 0) + 1; });
        var parts = items.map(function (it, d) {
          if (!tot[d] || !here[d]) return null;
          var want = qty[d] == null ? 10 : qty[d];
          return 'ลาย ' + (d + 1) + ' (' + it.name + ') ' + (here[d] || 0) + ' ดวง' + (sheets.length > 1 ? ' [รวม ' + tot[d] + ']' : '') + (want && tot[d] !== want ? ' ต้องการ ' + want : '');
        }).filter(Boolean);
        text = parts.join(' · ') + ' · แผ่น ' + (i + 1) + '/' + sheets.length + ' = ' + s.length + ' ดวง';
      } else text = 'ต้องการ ' + r.need + ' ดวง · ได้ ' + r.placed + ' ดวง' + (r.over ? ' (เกิน ' + r.over + ')' : ' (พอดี)') + ' · แผ่น ' + (i + 1) + '/' + sheets.length + ' = ' + s.length + ' ดวง';
      return { x: Math.max(2, m) * MM, y: yMM * MM, text: text };
    });
  }

  function renderList(m) {
    var box = $('stkList'); box.innerHTML = '';
    items.forEach(function (it, i) {
      var s = cutSize(it), row = document.createElement('div'); row.className = 'stkrow';
      if (m === 'fill' && i > 0) row.style.opacity = '.45';
      row.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="sz"></span>';
      row.querySelector('.dot').style.background = COLORS[i % COLORS.length];
      row.querySelector('.nm').textContent = it.name + (it.raster ? ' · ภาพ' : '') + (it.cut ? ' · มีเส้นตัด' : '');
      var aw = (it.vb[2] - it.vb[0]) / MM, ah = (it.vb[1] - it.vb[3]) / MM;
      row.querySelector('.sz').innerHTML = '';
      row.querySelector('.sz').appendChild(document.createTextNode('งาน ' + fmt(aw) + '×' + fmt(ah)));
      var cs = document.createElement('small'); cs.textContent = 'เส้นตัด ' + fmt(s.w) + '×' + fmt(s.h) + ' ' + U_(); row.querySelector('.sz').appendChild(cs);
      if (m === 'multi') {
        var q = document.createElement('input'); q.type = 'number'; q.min = '0'; q.value = qty[i] == null ? 10 : qty[i]; q.title = 'จำนวนดวง';
        q.oninput = function () { qty[i] = Math.max(0, Math.floor(+q.value || 0)); recalcSoon(); };
        row.appendChild(q);
      }
      box.appendChild(row);
    });
  }
  var rt; function recalcSoon() { clearTimeout(rt); rt = setTimeout(recalcKeepFocus, 120); }
  function recalcKeepFocus() {
    var a = document.activeElement, idx = -1, rows = Array.prototype.slice.call(document.querySelectorAll('#stkList input'));
    idx = rows.indexOf(a);
    recalc();
    if (idx >= 0) { var n = document.querySelectorAll('#stkList input')[idx]; if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
  }

  function draw() { draw0(); shadeTrim(); }
  function shadeTrim() {
    if (!$('stkTrim').checked || !result || !result.sheets || !result.sheets[page]) return;
    var cv = $('stkCanvas'), ctx = cv.getContext('2d'), sh = sheetSize(), k = cv.width / sh.w;
    var hs = sheetHeights(result, sh, !!(result.need || mode() === 'multi')); if (!hs) return;
    var y = hs[page] / MM * k; if (y >= cv.height - 1) return;
    ctx.fillStyle = 'rgba(90,90,90,.6)'; ctx.fillRect(0, y, cv.width, cv.height - y);
    ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.fillText('ตัดทิ้ง ' + (sh.h - hs[page] / MM).toFixed(0) + ' มม.', 6, Math.min(cv.height - 6, y + 16));
  }
  function draw0() {
    var cv = $('stkCanvas'), ctx = cv.getContext('2d'), sh = sheetSize();
    var maxW = 300, maxH = 400, k = Math.min(maxW / sh.w, maxH / sh.h);
    cv.width = Math.round(sh.w * k); cv.height = Math.round(sh.h * k);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    var mg = effMargin() * k;
    ctx.setLineDash([4, 3]); ctx.strokeStyle = '#c8c8c8'; ctx.lineWidth = 1;
    ctx.strokeRect(mg + .5, mg + .5, cv.width - 2 * mg - 1, cv.height - 2 * mg - 1); ctx.setLineDash([]);
    var mk = marks();
    if (mk) {
      ctx.fillStyle = '#000';
      var ins = mk.insetMM * k, ln = Math.max(7, mk.lenMM * k), w = Math.max(1.5, mk.wMM * k), X0 = ins, X1 = cv.width - ins, Y0 = ins, Y1 = cv.height - ins;
      [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X0, Y1, 1, -1], [X1, Y1, -1, -1]].forEach(function (c) {
        ctx.fillRect(Math.min(c[0], c[0] + c[2] * ln), Math.min(c[1], c[1] + c[3] * w), ln, w);
        ctx.fillRect(Math.min(c[0], c[0] + c[2] * w), Math.min(c[1], c[1] + c[3] * ln), w, ln);
      });
    }
    var sheets = result && result.sheets || [];
    $('stkNav').classList.toggle('hidden', sheets.length < 2);
    $('stkPage').textContent = sheets.length ? 'แผ่น ' + (page + 1) + ' / ' + sheets.length : '';
    var s = sheets[page] || [], cut = $('stkCut').value, rad = Math.max(0, mmv('stkRad', 3));
    var kp = k / MM;
    s.forEach(function (p) {
      var x = p.x * kp, y = p.y * kp, w = p.w * kp, h = p.h * kp;
      ctx.fillStyle = COLORS[p.d % COLORS.length] + '55';
      ctx.strokeStyle = '#ec008c'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (cut === 'circle' || cut === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else {
        var r = cut === 'rect' ? Math.min(rad * k, w / 2, h / 2) : Math.min(2 * k, w / 4, h / 4);
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
    });
  }

  // ---------- คำสั่ง ----------
  $('stkRead').onclick = function () {
    host('st_stkRead').then(function (r) {
      if (r.error) { toast('⚠ ' + r.error); return; }
      items = r.items; qty = {};
      MM = MM0 / (r.sf || 1);
      $('stkHint').textContent = 'อ่านได้ ' + items.length + ' ลาย' + (r.sf > 1 ? ' · ไฟล์ Large Canvas (สเกล 1:' + r.sf + ')' : '') + (items.length > 1 && mode() === 'fill' ? ' — เลือก "หลายลาย" เพื่อใส่จำนวนแต่ละลาย' : '');
      $('stkWarn').textContent = '';
      recalc();
    });
  };
  var bigArm = false;
  ['stkTrim'].forEach(function (id) { $(id).addEventListener('change', draw); });
  // CorelDRAW เด้งระหว่างสร้างแผ่นครั้งก่อน → บอกขั้นที่ค้าง + ส่งให้ร้านดู
  setTimeout(function () {
    host('st_lastCrash').then(function (r) {
      if (!r || !r.step) return;
      $('stkWarn').textContent = '⚠ ครั้งก่อน CorelDRAW ปิดไประหว่างสร้างแผ่นงาน (ค้างที่: ' + r.step.split(' | ').pop() + ') · ส่งข้อมูลให้ร้านแล้ว';
      try { if (window.ST_core && window.ST_core.report) window.ST_core.report('crash stkPlace: ' + r.step); } catch (e) {}
    });
  }, 2500);
  $('stkPv').onclick = function () {
    var b = $('stkPv'); b.disabled = true; b.textContent = 'กำลังวาดเส้นตัด…'; $('stkPvMsg').textContent = '';
    host('st_stkPreview', { cutType: $('stkCut').value, offsetMM: kissOff(), radiusMM: Math.max(0, mmv('stkRad', 0)), die: die(), credit: credit() }).then(function (r) {
      b.disabled = false; b.textContent = 'ดูเส้นตัดบนงานอีกครั้ง';
      if (r.error) { $('stkPvMsg').textContent = '⚠ ' + r.error; toast('⚠ ' + r.error); return; }
      $('stkPvMsg').textContent = '✓ ' + r.msg + (r.warn && r.warn.length ? ' · ⚠ ' + r.warn.join(' · ') : '') + ' · ถูกใจแล้วกด ② สร้างแผ่นงาน';
      $('stkPvClear').classList.remove('hidden'); toast('✓ ' + r.msg);
    });
  };
  $('stkPvClear').onclick = function () {
    host('st_stkPreviewClear').then(function (r) { $('stkPvClear').classList.add('hidden'); $('stkPv').textContent = 'ดูเส้นตัดบนงานก่อน'; $('stkPvMsg').textContent = r.error ? '⚠ ' + r.error : r.msg; });
  };
  $('stkGo').onclick = function () {
    if (!result || !result.placed) return;
    var sh = sheetSize(), go = $('stkGo');
    var hasRaster = items.some(function (it) { return it.raster; }), sym = $('stkSym').checked;
    var limit = hasRaster && !sym ? 60 : 400;
    if (result.placed > limit && !bigArm) {
      bigArm = true; setTimeout(function () { bigArm = false; }, 6000);
      $('stkWarn').textContent = '⚠ ' + result.placed + ' ดวง' + (hasRaster && !sym ? ' เป็นภาพแบบก็อปทุกดวง — ไฟล์จะหนักมาก CorelDRAW อาจค้าง แนะนำติ๊ก "วางภาพเป็น Symbol"' : ' — อาจใช้เวลานาน') + ' · กดสร้างอีกครั้งเพื่อยืนยัน';
      return;
    }
    bigArm = false;
    go.disabled = true; go.textContent = 'กำลังสร้าง… (ลายเยอะอาจใช้เวลาสักครู่)'; $('stkWarn').textContent = '';
    var ord = $('stkOrder').value;   // ลำดับวาง = ลำดับตัด: zz = ล่างขึ้นบนซิกแซก (เริ่มขวาล่าง = จุดเริ่มเครื่อง) · bu = ล่างขึ้นบนทีละแถว · td = บนลงล่าง
    var sheets = result.sheets.map(function (s) {
      var bu = ord !== 'td', rows = [], tol = 0.5 * MM;
      s.slice().sort(function (a, b) { return bu ? (b.y + b.h) - (a.y + a.h) : a.y - b.y; }).forEach(function (p) {
        var key = bu ? p.y + p.h : p.y, R = rows[rows.length - 1];
        if (R && Math.abs(R.k - key) < tol) R.items.push(p); else rows.push({ k: key, items: [p] });
      });
      var out = [];
      rows.forEach(function (R, i) {
        var rtl = ord === 'zz' && i % 2 === 0;            // แถวแรก (ล่างสุด) ขวา→ซ้าย แถวถัดไปซ้าย→ขวา สลับไป
        R.items.sort(function (a, b) { return rtl ? b.x - a.x : a.x - b.x; });
        out = out.concat(R.items);
      });
      return out.map(function (p) { return { d: p.d, x: p.x, y: p.y, r: p.r }; });
    });
    var hasNote = !!(result.need || mode() === 'multi'), hs = sheetHeights(result, sh, hasNote);
    // ความสูงแผ่นหลังใส่มาร์ค CM5 (ไว้เลือกแบบมาร์ค: เกิน 50 ซม. = Segment)
    var hs2 = result.sheets.map(function (s) { var t = Infinity, b = 0; s.forEach(function (p) { t = Math.min(t, p.y); b = Math.max(b, p.y + p.h); }); return (b - t) + 37 * MM; });
    host('st_stkPlace', {
      cutType: $('stkCut').value, offsetMM: kissOff(), radiusMM: Math.max(0, mmv('stkRad', 0)),
      sheetW: sh.w * MM, sheetH: sh.h * MM, sheetHs: hs, sheetHs2: hs2, cm5: cm5On() ? { thrMM: 500 } : null, delEmptyAB: $('stkDelAB').checked, count: items.length, sheets: sheets, marks: marks(), symbol: $('stkSym').checked ? null : false, die: die(), credit: credit(), notes: needNotes(result, sh, hs)
    }).then(function (r) {
      go.disabled = false; go.textContent = '② สร้างแผ่นงาน'; $('stkPvClear').classList.add('hidden'); $('stkPv').textContent = 'ดูเส้นตัดบนงานก่อน';
      if (r.error) { toast('⚠ ' + r.error); $('stkWarn').textContent = '⚠ ' + r.error; return; }
      toast('✓ ' + r.msg);
      if (r.warn && r.warn.length) $('stkWarn').textContent = '⚠ ' + r.warn.join(' · ');
    });
  };
  $('stkPrev').onclick = function () { if (page > 0) { page--; draw(); } };
  $('stkNext').onclick = function () { if (result && page < result.sheets.length - 1) { page++; draw(); } };

  $('stkCrPick').onclick = function () {
    host('st_pickFile', 'เลือกไฟล์โลโก้เครดิตร้าน').then(function (r) {
      if (r.cancel) return;
      if (r.error) { toast('⚠ ' + r.error); return; }
      $('stkCrFile').value = r.path; $('stkCrFile').dispatchEvent(new Event('change')); recalc();
    });
  };
  $('stkCrClear').onclick = function () { $('stkCrFile').value = ''; $('stkCrFile').dispatchEvent(new Event('change')); recalc(); };
  ['stkCut', 'stkOff', 'stkRad', 'stkGap', 'stkSheet', 'stkOrient', 'stkW', 'stkH', 'stkMargin', 'stkRot', 'stkMarks', 'stkCm5', 'stkMkIn', 'stkMkLen', 'stkMkW', 'stkMkGap', 'stkDie', 'stkDieShape', 'stkDieOff', 'stkDieRad', 'stkCredit', 'stkCrPos', 'stkNeed', 'stkFullRow'].forEach(function (id) {
    $(id).addEventListener('input', recalcSoon); $(id).addEventListener('change', recalcSoon);
  });
  document.querySelectorAll('.seg[data-name="stkMode"] button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(recalc, 0); }); });
  document.querySelectorAll('.seg[data-name="stkUnitSeg"] button').forEach(function (b) {
    b.addEventListener('click', function () { applyUnit(b.dataset.v); recalc(); try { $('stkUnit').dispatchEvent(new Event('change')); } catch (e) {} });
  });
  applyUnit(unit());
  setTimeout(recalc, 0);

  window.__stk = { setItems: function (x) { items = x; qty = {}; recalc(); }, result: function () { return result; } };   // สำหรับทดสอบ
})();
