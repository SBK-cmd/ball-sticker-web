/* Sign Tools — แยกสีงานตัด */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) { return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); }
  function host(fn, arg) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน CorelDRAW' });
      window.__adobe_cep__.evalScript(fn + '(' + (arg === undefined ? '' : esc(arg)) + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: 'สคริปต์ผิดพลาด: ' + String(r).slice(0, 200) }); }
      });
    });
  }
  var toastT;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 3200); }
  function seg(n) { var b = document.querySelector('.seg[data-name="' + n + '"] .on'); return b ? b.dataset.v : null; }
  function num(id, d) { var v = parseFloat($(id).value); return isNaN(v) ? d : v; }
  var colors = [], off = {}, base = null;
  function pickBase() { var c = colors.filter(function (x) { return !off[x.key]; }); base = c.length ? c[c.length - 1].key : null; }   // ค่าเริ่ม = สีล่างสุดในงาน

  function ui() {
    var m = seg('sepMode') || 'base';
    $('sepModeHint').textContent = m === 'base'
      ? 'สีพื้น (กดเลือก "พื้น" ในรายการ) ตัดเต็มรูปทั้งชิ้นงาน ไว้รองใต้ · สีอื่นตัดเฉพาะส่วนที่เห็น แล้วแปะทับบนพื้น'
      : m === 'knock' ? 'ส่วนที่สีอื่นทับอยู่จะถูกตัดออก ทุกสีวางชิดกันพอดี ไม่มีสติ๊กเกอร์ซ้อน 2 ชั้น'
      : 'แต่ละสีตัดเต็มรูปของมัน ไม่หักส่วนที่ถูกทับ ติดซ้อนทับกันได้';
    document.getElementById('tab-sep').classList.toggle('isBase', m === 'base');
    document.querySelectorAll('#tab-sep .onlySepMarks').forEach(function (e) { e.classList.toggle('hidden', !$('sepMarks').checked); });
    document.querySelectorAll('#tab-sep .onlySepSide').forEach(function (e) { e.classList.toggle('hidden', $('sepLayout').value !== 'side'); });
    var on = colors.filter(function (c) { return !off[c.key]; }).length;
    $('sepGo').disabled = !on;
    $('sepGo').textContent = on ? '② แยกสี (' + on + ' สี)' : '② แยกสี';
  }
  function render() {
    var box = $('sepList'); box.innerHTML = '';
    colors.forEach(function (c) {
      var row = document.createElement('label'); row.className = 'seprow' + (off[c.key] ? ' off' : '');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !off[c.key];
      cb.onchange = function () { if (cb.checked) delete off[c.key]; else { off[c.key] = true; if (base === c.key) pickBase(); } render(); };
      var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = c.hex;
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name + (c.white ? ' (ขาว)' : '') + (c.grad ? ' ⚠ ไล่สี' : '');
      var ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = c.n + ' ชิ้น';
      var bb = document.createElement('button'); bb.className = 'basebtn' + (base === c.key ? ' on' : ''); bb.textContent = 'พื้น'; bb.title = 'ใช้สีนี้เป็นพื้นเต็มรูป';
      bb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); base = c.key; if (off[c.key]) delete off[c.key]; render(); };
      row.appendChild(cb); row.appendChild(sw); row.appendChild(nm); row.appendChild(ct); row.appendChild(bb); box.appendChild(row);
    });
    ui();
  }
  $('sepRead').onclick = function () {
    host('st_sepRead').then(function (r) {
      if (r.error) { toast('⚠ ' + r.error); $('sepHint').textContent = '⚠ ' + r.error; return; }
      colors = r.colors || []; off = {};
      colors.forEach(function (c) { if (c.white) off[c.key] = true; });   // สีขาวมักเป็นพื้นหลัง — ไม่ติ๊กไว้ก่อน
      pickBase();
      var h = 'พบ ' + colors.length + ' สี';
      if (r.text) h += ' · ตัวอักษร ' + r.text + ' ชิ้น (จะแปลงเป็นเส้นให้)';
      if (r.raster) h += ' · ⚠ มีรูปภาพ ' + r.raster + ' ชิ้น ตัดไม่ได้ จะถูกข้าม';
      if (colors.some(function (c) { return c.white; })) h += ' · สีขาวไม่ได้ติ๊กไว้ (มักเป็นพื้นหลัง)';
      $('sepHint').textContent = h; $('sepWarn').textContent = '';
      render();
    });
  };
  $('sepGo').onclick = function () {
    var b = $('sepGo'); b.disabled = true; b.textContent = 'กำลังแยกสี…'; $('sepWarn').textContent = '';
    host('st_sepRun', {
      mode: seg('sepMode') || 'base', base: base, layout: $('sepLayout').value,
      exclude: colors.filter(function (c) { return off[c.key]; }).map(function (c) { return c.key; }),
      marks: $('sepMarks').checked ? { lenMM: Math.max(3, num('sepMkLen', 10)), offMM: Math.max(0, num('sepMkOff', 5)) } : null,
      weed: null, label: false,
      gapMM: Math.max(0, num('sepGap', 20))
    }).then(function (r) {
      ui();
      if (r.error) { toast('⚠ ' + r.error); $('sepWarn').textContent = '⚠ ' + r.error; return; }
      toast('✓ ' + r.msg);
      if (r.warn && r.warn.length) $('sepWarn').textContent = '⚠ ' + r.warn.join(' · ');
    });
  };
  ['sepMarks', 'sepLayout'].forEach(function (id) { $(id).addEventListener('change', ui); });
  document.querySelectorAll('.seg[data-name="sepMode"] button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(ui, 0); }); });
  ui();
  window.__sep = { set: function (c) { colors = c; off = {}; colors.forEach(function (x) { if (x.white) off[x.key] = true; }); pickBase(); render(); } };
})();
