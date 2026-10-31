/* Sign Tools — panel logic */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- เรียก ExtendScript ----------
  function esc(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }
  function host(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(esc).join(',');
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน CorelDRAW' });
      window.__adobe_cep__.evalScript(fn + '(' + args + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: 'สคริปต์ผิดพลาด: ' + r }); }
      });
    });
  }
  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function report(r) { toast(r.error ? '⚠ ' + r.error : '✓ ' + r.msg); }
  function num(id, def) { var v = parseFloat($(id).value); return isNaN(v) ? def : v; }

  // ---------- จำค่าที่ตั้งไว้ ----------
  var SAVE_KEY = 'signtools_v1';
  function saveAll() {
    var d = {};
    document.querySelectorAll('.st input,.st select,.st textarea').forEach(function (el) {
      if (el.id) d[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    document.querySelectorAll('.seg').forEach(function (s) { d['seg_' + s.dataset.name] = segVal(s.dataset.name); });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function loadAll() {
    var d; try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) {}
    if (!d) return;
    Object.keys(d).forEach(function (k) {
      if (k.indexOf('seg_') === 0) { setSeg(k.slice(4), d[k]); return; }
      var el = $(k); if (!el) return;
      if (el.type === 'checkbox') el.checked = !!d[k]; else el.value = d[k];
    });
  }

  // ---------- แท็บ + ปุ่มแบ่งส่วน ----------
  document.querySelectorAll('.tab').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab); });
      if (b.dataset.tab === 'dup') refreshInfo();
      if (b.dataset.tab === 'dim') loadSw(true);
    };
  });
  function segVal(name) { var b = document.querySelector('.seg[data-name="' + name + '"] .on'); return b ? b.dataset.v : null; }
  function setSeg(name, v) {
    document.querySelectorAll('.seg[data-name="' + name + '"] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    if (name === 'runMode') runModeUI();
    if (name === 'qrMode') makeQR();
  }
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.onclick = function () { setSeg(b.parentNode.dataset.name, b.dataset.v); saveAll(); };
  });

  // ---------- ช่วง artboard: "ทั้งหมด", "1-10, 15" → index เริ่ม 0 ----------
  function parseRange(text, count) {
    var t = String(text || '').trim().toLowerCase();
    var all = [];
    for (var i = 0; i < count; i++) all.push(i);
    if (!t || t === 'ทั้งหมด' || t === 'all') return all;
    var set = {};
    t.split(/[,\s]+/).forEach(function (part) {
      if (!part) return;
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        var a = +m[1], b = +m[2], lo = Math.min(a, b), hi = Math.max(a, b);
        for (var k = lo; k <= hi; k++) set[k - 1] = 1;
      } else if (/^\d+$/.test(part)) set[+part - 1] = 1;
      else throw new Error('อ่านช่วง artboard ไม่ออก: "' + part + '"');
    });
    return Object.keys(set).map(Number).filter(function (n) { return n >= 0 && n < count; }).sort(function (a, b) { return a - b; });
  }
  function getInfo() { return host('st_info'); }
  function refreshInfo() {
    getInfo().then(function (r) {
      $('dupInfo').textContent = r.error ? '' : (r.artboards ? 'เอกสารนี้มี ' + r.artboards + ' artboard' : 'ยังไม่มีเอกสารเปิดอยู่');
    });
  }

  // =========== 1) รันเลข ===========
  function pad(n, d) { var neg = n < 0, s = String(Math.abs(n)); while (s.length < d) s = '0' + s; return (neg ? '-' : '') + s; }
  function runOpts() {
    return {
      mode: segVal('runMode'),
      start: Math.round(num('runStart', 1)), step: Math.round(num('runStep', 1)),
      digits: Math.max(1, Math.min(10, Math.round(num('runDigits', 1)))),
      prefix: $('runPrefix').value, suffix: $('runSuffix').value, order: $('runOrder').value
    };
  }
  function runPreview() {
    var o = runOpts(), out = [];
    for (var i = 0; i < 4; i++) out.push(o.prefix + pad(o.start + i * o.step, o.digits) + o.suffix);
    $('runPrev').textContent = out.join('   ') + '  …';
  }
  function runModeUI() {
    var ab = segVal('runMode') === 'ab';
    document.querySelectorAll('#tab-run .onlySel').forEach(function (e) { e.classList.toggle('hidden', ab); });
    document.querySelectorAll('#tab-run .onlyAb').forEach(function (e) { e.classList.toggle('hidden', !ab); });
  }
  $('runGo').onclick = function () {
    var o = runOpts();
    var go = function () { host('st_runNumber', o).then(report); };
    if (o.mode !== 'ab') return go();
    getInfo().then(function (r) {
      if (r.error) return report(r);
      try { o.range = parseRange($('runRange').value, r.artboards); } catch (e) { return toast('⚠ ' + e.message); }
      if (!o.range.length) return toast('⚠ ไม่มี artboard ในช่วงนี้');
      go();
    });
  };

  // =========== 2) ก็อปไปทุก artboard ===========
  $('dupGo').onclick = function () {
    getInfo().then(function (r) {
      if (r.error) return report(r);
      var range;
      try { range = parseRange($('dupRange').value, r.artboards); } catch (e) { return toast('⚠ ' + e.message); }
      if (!range.length) return toast('⚠ ไม่มี artboard ในช่วงนี้');
      host('st_duplicate', { range: range }).then(report);
    });
  };

  // =========== 3) QR ===========
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  var qrRows = null, qrCaption = '';
  function makeQR() {
    var pp = segVal('qrMode') === 'pp', text = $('qrText').value;
    document.getElementById('tab-qr').classList.toggle('isPP', pp);
    qrRows = null; qrCaption = '';
    var cv = $('qrCanvas'), ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (pp) {
      if (!$('qrPpId').value.trim()) { $('qrInfo').textContent = 'ใส่เบอร์มือถือ หรือเลขบัตร/เลขผู้เสียภาษีที่ผูกพร้อมเพย์'; return; }
      try { text = STPromptPay.payload($('qrPpId').value, $('qrPpAmt').value); }
      catch (e) { $('qrInfo').textContent = '⚠ ' + e.message; return; }
      if ($('qrPpCap').checked) {
        var amt = parseFloat($('qrPpAmt').value), nm = $('qrPpName').value.trim();
        qrCaption = 'พร้อมเพย์ ' + STPromptPay.fmtId($('qrPpId').value) + (nm ? '\r' + nm : '') +
          (amt > 0 ? '\r' + amt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท' : '');
      }
    }
    if (!text) { $('qrInfo').textContent = 'ใส่ข้อความหรือลิงก์'; return; }
    var q;
    try { q = qrcode(0, $('qrEc').value); q.addData(text, 'Byte'); q.make(); }
    catch (e) { $('qrInfo').textContent = '⚠ ข้อความยาวเกินไปสำหรับระดับกันเสียนี้'; return; }
    var n = q.getModuleCount(), quiet = Math.max(0, Math.round(num('qrQuiet', 4))), tot = n + quiet * 2;
    var rows = [];
    for (var r = 0; r < n; r++) { var s = ''; for (var c = 0; c < n; c++) s += q.isDark(r, c) ? '1' : '0'; rows.push(s); }
    qrRows = rows;
    var px = cv.width / tot;
    ctx.fillStyle = '#000';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++)
      if (rows[y].charAt(x) === '1') ctx.fillRect(Math.floor((x + quiet) * px), Math.floor((y + quiet) * px), Math.ceil(px), Math.ceil(px));
    var size = num('qrSize', 30), mod = size / tot;
    $('qrInfo').textContent = (pp ? 'พร้อมเพย์' + ((parseFloat($('qrPpAmt').value) > 0) ? ' · ล็อกยอด' : ' · ลูกค้าใส่ยอดเอง') + ' · ' : '') + 'เวอร์ชัน ' + ((n - 17) / 4) + ' · ' + n + '×' + n + ' ช่อง · ช่องละ ' + mod.toFixed(2) + ' มม.' +
      (mod < 0.4 ? '  ⚠ ช่องเล็กมาก อาจสแกนยาก ลองขยายขนาด' : '');
  }
  $('qrGo').onclick = function () {
    makeQR();
    if (!qrRows) return toast('⚠ ยังสร้าง QR ไม่ได้');
    host('st_qr', {
      rows: qrRows, sizeMM: num('qrSize', 30),
      quiet: Math.max(0, Math.round(num('qrQuiet', 4))), bg: $('qrBg').checked, caption: qrCaption
    }).then(report);
  };

  // =========== 4) บอกขนาด ===========
  // ชุดสีพื้นฐาน (มีให้เลือกเสมอ) + สวอตช์จากไฟล์
  var PRESETS = [
    { id: 'mag', n: 'Magenta', rgb: [236, 0, 140], cmyk: [0, 100, 0, 0] },
    { id: 'red', n: 'แดง', rgb: [237, 28, 36], cmyk: [0, 100, 100, 0] },
    { id: 'org', n: 'ส้ม', rgb: [247, 148, 29], cmyk: [0, 50, 100, 0] },
    { id: 'yel', n: 'เหลือง', rgb: [255, 242, 0], cmyk: [0, 0, 100, 0] },
    { id: 'grn', n: 'เขียว', rgb: [0, 166, 81], cmyk: [85, 10, 100, 0] },
    { id: 'cyn', n: 'Cyan', rgb: [0, 174, 239], cmyk: [100, 0, 0, 0] },
    { id: 'blu', n: 'น้ำเงิน', rgb: [0, 84, 166], cmyk: [100, 70, 0, 0] },
    { id: 'blk', n: 'ดำ', rgb: [0, 0, 0], cmyk: [0, 0, 0, 100] },
    { id: 'gry', n: 'เทา', rgb: [128, 130, 133], cmyk: [0, 0, 0, 60] },
    { id: 'wht', n: 'ขาว', rgb: [255, 255, 255], cmyk: [0, 0, 0, 0] }
  ];
  var docSw = [];
  function hexOf(rgb) { return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function chip(val, hex, title, spot) {
    var b = document.createElement('button');
    b.className = 'sw' + (spot ? ' spot' : '') + ($('dimColor').value === val ? ' on' : '');
    b.style.background = hex; b.title = title; b.dataset.v = val;
    b.onclick = function () { $('dimColor').value = val; renderSw(); saveAll(); };
    return b;
  }
  function renderSw() {
    var g = $('dimSw'); g.innerHTML = '';
    PRESETS.forEach(function (p) { g.appendChild(chip('p:' + p.id, hexOf(p.rgb), p.n, false)); });
    if (docSw.length) {
      var sep = document.createElement('div'); sep.className = 'swsep'; sep.textContent = 'สวอตช์ในไฟล์'; g.appendChild(sep);
      docSw.forEach(function (s) { g.appendChild(chip('d:' + s.n, s.h, s.n + (s.spot ? ' (spot)' : ''), s.spot)); });
    }
    var v = $('dimColor').value, label = '';
    if (v.indexOf('p:') === 0) { var p = PRESETS.filter(function (x) { return 'p:' + x.id === v; })[0]; label = p ? p.n : ''; }
    else label = v.slice(2) + (docSw.some(function (s) { return 'd:' + s.n === v; }) ? '' : ' (ไม่พบในไฟล์นี้ — จะใช้ดำ)');
    $('dimSwName').textContent = label;
  }
  function loadSw(quiet) {
    host('st_swatches').then(function (r) {
      if (r.error) { if (!quiet) toast('⚠ ' + r.error); return; }
      docSw = r.swatches || [];
      renderSw();
      if (!quiet) toast(r.doc ? 'ดึง ' + docSw.length + ' สวอตช์จาก ' + r.doc : 'ยังไม่มีเอกสารเปิดอยู่');
    });
  }
  $('dimSwLoad').onclick = function () { loadSw(false); };

  $('dimGo').onclick = function () {
    var v = $('dimColor').value, p = PRESETS[7], swatch = null;   // ค่าเริ่มต้น = ดำ
    if (v.indexOf('p:') === 0) p = PRESETS.filter(function (x) { return 'p:' + x.id === v; })[0] || PRESETS[0];
    else if (v.indexOf('d:') === 0) swatch = v.slice(2);
    host('st_dimension', {
      which: segVal('dimWhich'), unit: $('dimUnit').value,
      scale: Math.max(0.0001, num('dimScale', 1)), decimals: Math.max(0, Math.min(4, Math.round(num('dimDec', 0)))),
      offsetMM: num('dimOff', 8), textPt: Math.max(2, num('dimText', 10)), lineW: Math.max(0.1, num('dimLine', 0.5)),
      unitText: ($('dimUnitLang').value === 'th' ? { mm: 'มม.', cm: 'ซม.', 'in': 'นิ้ว', m: 'ม.' } : { mm: 'mm', cm: 'cm', 'in': 'in', m: 'm' })[$('dimUnit').value],
      showUnit: $('dimUnitShow').checked, each: $('dimEach').checked, rgb: p.rgb, cmyk: p.cmyk, swatch: swatch
    }).then(report);
  };

  // ---------- เริ่ม ----------
  loadAll();
  if (!/^[pd]:/.test($('dimColor').value)) $('dimColor').value = 'p:mag';
  renderSw();
  runModeUI();
  runPreview();
  makeQR();
  document.querySelectorAll('.st input,.st select,.st textarea').forEach(function (el) {
    el.addEventListener('input', function () {
      if (el.id.indexOf('run') === 0) runPreview();
      if (el.id.indexOf('qr') === 0) makeQR();
      saveAll();
    });
    el.addEventListener('change', saveAll);
  });
})();
