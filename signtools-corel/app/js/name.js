/* Sign Tools — ตั้งชื่อไฟล์จากข้อความในงาน */
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
  var TEL = /(^|\D)0\d{1,2}[-\s.]?\d{3}[-\s.]?\d{3,4}(\D|$)/;
  var items = [], sizeTxt = '';
  function clean(s) { return String(s).replace(/[\\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function thDate() { var d = new Date(); return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + String(d.getFullYear() + 543).slice(-2); }
  function full() {
    var n = clean($('nmName').value);
    if (n && $('nmSize').checked && sizeTxt) n += ' ' + sizeTxt;
    if (n && $('nmDate').checked) n += ' ' + thDate();
    return n.slice(0, 150);
  }
  function ui() {
    var n = full();
    $('nmPreview').textContent = n ? 'จะได้ไฟล์: ' + n + '.ai' : '';
    $('nmSave').disabled = !n;
    var cur = clean($('nmName').value);
    document.querySelectorAll('#nmChips .nmchip').forEach(function (c) { c.classList.toggle('used', cur.indexOf(c.dataset.t) >= 0); });
  }
  function add(t) {
    var cur = clean($('nmName').value);
    if (cur.indexOf(t) >= 0) cur = clean(cur.replace(t, ' '));          // กดซ้ำ = เอาออก
    else cur = cur ? cur + ' ' + t : t;
    $('nmName').value = cur; ui();
  }
  function render() {
    var box = $('nmChips'); box.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.className = 'nmchip' + (TEL.test(it.t) ? ' tel' : ''); b.dataset.t = clean(it.t); b.title = it.t;
      b.textContent = clean(it.t);
      var sm = document.createElement('small'); sm.textContent = it.s + ' มม.'; b.appendChild(sm);
      b.onclick = function () { add(clean(it.t)); };
      box.appendChild(b);
    });
    ui();
  }
  $('nmScan').onclick = function () {
    var b = $('nmScan'); b.disabled = true;
    host('st_nameScan', { which: seg('nmWhich') || 'active' }).then(function (r) {
      b.disabled = false;
      if (r.error) { $('nmHint').textContent = '⚠ ' + r.error; return; }
      items = r.items || []; sizeTxt = r.size || '';
      if (!items.length) { $('nmHint').textContent = 'ไม่พบข้อความ — ถ้าตัวหนังสือถูกแปลงเป็นเส้น (Create Outlines) แล้วจะอ่านไม่ได้ พิมพ์ชื่อเองได้'; render(); return; }
      $('nmHint').textContent = 'พบ ' + items.length + ' ข้อความ · ขนาดงาน ' + sizeTxt + ' · กดคำเพื่อเพิ่ม/เอาออก';
      // เดาชื่อให้ก่อน: ข้อความใหญ่สุด + เบอร์โทร (ถ้ามี)
      var guess = clean(items[0].t), tel = items.filter(function (x) { return TEL.test(x.t); })[0];
      if (tel && guess.indexOf(clean(tel.t)) < 0) guess += ' ' + clean(tel.t);
      $('nmName').value = guess;
      render();
    });
  };
  $('nmClear').onclick = function () { $('nmName').value = ''; ui(); $('nmName').focus(); };
  $('nmName').addEventListener('input', ui);
  ['nmSize', 'nmDate'].forEach(function (id) { $(id).addEventListener('change', ui); });
  $('nmSave').onclick = function () {
    var n = full(); if (!n) return;
    var b = $('nmSave'); b.disabled = true;
    host('st_nameSave', { name: n }).then(function (r) {
      ui();
      if (r.error) { $('nmMsg').textContent = '⚠ ' + r.error; toast('⚠ ' + r.error); return; }
      $('nmMsg').textContent = '✓ ' + r.msg + (r.path ? ' · ' + r.path : ''); toast('✓ ' + r.msg);
    });
  };
  ui();
})();
