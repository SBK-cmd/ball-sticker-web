/* Sign Tools — ภาพตัวอย่างลูกค้า · ข้อความขอบแผ่น · คิวงาน */
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
  function seg(name) { var b = document.querySelector('.seg[data-name="' + name + '"] .on'); return b ? b.dataset.v : null; }
  function onSeg(name, fn) { document.querySelectorAll('.seg[data-name="' + name + '"] button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(fn, 0); }); }); }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sizeTxt(a) { return a.w >= 1000 || a.h >= 1000 ? (a.w / 10).toFixed(1).replace(/\.0$/, '') + ' × ' + (a.h / 10).toFixed(1).replace(/\.0$/, '') + ' ซม.' : a.w + ' × ' + a.h + ' มม.'; }
  var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(d) { return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // ======================= ภาพตัวอย่าง (#19) =======================
  $('prevGo').onclick = function () {
    var b = $('prevGo'); b.disabled = true; $('prevMsg').textContent = 'กำลังบันทึก…';
    host('st_docInfo').then(function (info) {
      if (info.error) { b.disabled = false; $('prevMsg').textContent = '⚠ ' + info.error; return; }
      var st = info.artboards.map(function (a) { return 'ขนาด ' + sizeTxt(a); });
      return host('st_preview', {
        which: seg('prevWhich') || 'active', text: $('prevText').value.trim(),
        opacity: Math.max(5, Math.min(100, parseFloat($('prevOp').value) || 25)), px: parseInt($('prevPx').value, 10) || 1600,
        size: $('prevSize').checked, sizeText: st, open: $('prevOpen').checked
      }).then(function (r) {
        b.disabled = false;
        if (r.error) { $('prevMsg').textContent = '⚠ ' + r.error; return; }
        $('prevMsg').textContent = '✓ ' + r.msg + ' · ' + r.folder; toast('✓ ' + r.msg);
      });
    });
  };

  function expUI() { document.querySelectorAll('#tab-prev .onlyTif').forEach(function (e) { e.classList.toggle('hidden', $('expFmt').value !== 'tif'); }); }
  $('expFmt').addEventListener('change', expUI); setTimeout(expUI, 0);
  $('expGo').onclick = function () {
    var b = $('expGo'); b.disabled = true; $('expMsg').textContent = 'กำลังบันทึก… (ไฟล์ใหญ่อาจใช้เวลาสักครู่)';
    host('st_exportPrint', { fmt: $('expFmt').value, ppi: parseInt($('expPpi').value, 10) || 300, cmyk: $('expCmyk').value === '1', which: seg('expWhich') || 'active', open: $('expOpen').checked }).then(function (r) {
      b.disabled = false;
      if (r.error) { $('expMsg').textContent = '⚠ ' + r.error; toast('⚠ ' + r.error); return; }
      $('expMsg').textContent = '✓ ' + r.msg + ' · ' + r.folder; toast('✓ ' + r.msg);
    });
  };

  // ======================= ข้อความขอบแผ่น (#95) =======================
  var docInfo = null;
  function slugText(a, idx, total) {
    var p = [];
    if ($('slugCust').value.trim()) p.push($('slugCust').value.trim());
    if ($('slugJob').value.trim()) p.push($('slugJob').value.trim());
    if ($('slugFile').checked && docInfo) p.push(docInfo.name);
    if ($('slugSheet').checked) p.push('แผ่น ' + (idx + 1) + '/' + total);
    if ($('slugDim').checked && a) p.push(sizeTxt(a));
    if ($('slugDate').checked) p.push(thDate(new Date()));
    return p.join('  ·  ');
  }
  function slugPreview() {
    var a = docInfo && docInfo.artboards[docInfo.active], n = docInfo ? docInfo.artboards.length : 1;
    var t = slugText(a, docInfo ? docInfo.active : 0, n);
    $('slugPrev').textContent = t || '(ยังไม่ได้เลือกข้อมูล)';
  }
  ['slugCust', 'slugJob', 'slugFile', 'slugDate', 'slugSheet', 'slugDim'].forEach(function (id) { $(id).addEventListener('input', slugPreview); $(id).addEventListener('change', slugPreview); });
  function refreshDoc() { return host('st_docInfo').then(function (r) { docInfo = r.error ? null : r; slugPreview(); return r; }); }
  document.querySelector('.tab[data-tab="slug"]').addEventListener('click', refreshDoc);
  $('slugGo').onclick = function () {
    refreshDoc().then(function (r) {
      if (r.error) { toast('⚠ ' + r.error); return; }
      var all = $('slugWhich').value === 'all', n = r.artboards.length, items = [];
      r.artboards.forEach(function (a, i) { if (all || i === r.active) items.push({ i: i, text: slugText(a, i, n) }); });
      if (!items[0] || !items[0].text) { toast('⚠ เลือกข้อมูลที่จะใส่อย่างน้อย 1 อย่าง'); return; }
      host('st_slug', { items: items, pt: parseFloat($('slugPt').value) || 7, offMM: Math.max(0, parseFloat($('slugOff').value) || 0), pos: $('slugPos').value })
        .then(function (x) { toast(x.error ? '⚠ ' + x.error : '✓ ' + x.msg); });
    });
  };
  slugPreview();

  // ======================= คิวงาน (#62) =======================
  var QK = 'st_queue_v1', ST = ['print', 'cut', 'ready', 'done'];
  var SN = { print: 'รอพิมพ์', cut: 'รอตัด', ready: 'พร้อมส่ง', done: 'ส่งแล้ว' };
  var jobs = [];
  try { jobs = JSON.parse(localStorage.getItem(QK)) || []; } catch (e) { jobs = []; }
  function save() { try { localStorage.setItem(QK, JSON.stringify(jobs)); } catch (e) { toast('⚠ บันทึกคิวไม่ได้'); } }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dueLabel(due) {
    if (!due) return '';
    var t = today();
    if (due < t) return '<span class="due late">เลยกำหนด ' + h(fmtDue(due)) + '</span>';
    if (due === t) return '<span class="due now">ส่งวันนี้</span>';
    return '<span class="due">ส่ง ' + h(fmtDue(due)) + '</span>';
  }
  function fmtDue(d) { var p = d.split('-'); return +p[2] + ' ' + TH_M[+p[1] - 1]; }
  function renderQ() {
    var f = seg('qFilter') || 'open';
    var c = { print: 0, cut: 0, ready: 0, done: 0 }, late = 0, t = today();
    jobs.forEach(function (j) { c[j.status]++; if (j.status !== 'done' && j.due && j.due < t) late++; });
    $('qSum').innerHTML = ST.slice(0, 3).map(function (s) { return '<div class="qs ' + s + '"><b>' + c[s] + '</b><span>' + SN[s] + '</span></div>'; }).join('') +
      '<div class="qs late' + (late ? ' on' : '') + '"><b>' + late + '</b><span>เลยกำหนด</span></div>';
    var list = jobs.filter(function (j) { return f === 'all' || (f === 'done' ? j.status === 'done' : j.status !== 'done'); });
    list.sort(function (a, b) {
      if (f === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
      var ad = a.due || '9999', bd = b.due || '9999';
      return ad < bd ? -1 : ad > bd ? 1 : ST.indexOf(b.status) - ST.indexOf(a.status) || a.created - b.created;
    });
    $('qList').innerHTML = list.length ? list.map(function (j) {
      return '<div class="qjob" data-id="' + h(j.id) + '">' +
        '<div class="qtop"><button class="qst ' + j.status + '" data-act="next" title="เลื่อนขั้น">' + SN[j.status] + '</button>' + dueLabel(j.status === 'done' ? '' : j.due) + '</div>' +
        '<div class="qmain"><b>' + h(j.cust || '(ไม่ระบุลูกค้า)') + '</b>' + (j.job ? ' · ' + h(j.job) : '') + '</div>' +
        (j.size || j.note ? '<div class="qsub">' + h([j.size, j.note].filter(Boolean).join(' · ')) + '</div>' : '') +
        '<div class="qact">' + (j.file ? '<button class="btn ghost sm" data-act="open">เปิดไฟล์</button>' : '') +
        (j.status !== 'print' ? '<button class="btn ghost sm" data-act="back">ย้อนขั้น</button>' : '') +
        '<button class="btn ghost sm del" data-act="del">ลบ</button></div></div>';
    }).join('') : '<div class="qempty">' + (f === 'done' ? 'ยังไม่มีงานที่ส่งแล้ว' : 'ไม่มีงานค้าง · กด "+ เพิ่มงาน" ด้านบน') + '</div>';
  }
  onSeg('qFilter', renderQ);
  var delArm = null;
  $('qList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var id = b.closest('.qjob').dataset.id, j = jobs.filter(function (x) { return x.id === id; })[0]; if (!j) return;
    var a = b.dataset.act, i = ST.indexOf(j.status);
    if (a === 'next' && i < 3) { j.status = ST[i + 1]; if (j.status === 'done') { j.doneAt = Date.now(); toast('✓ ' + (j.cust || 'งาน') + ' ส่งแล้ว'); } }
    else if (a === 'back' && i > 0) { j.status = ST[i - 1]; delete j.doneAt; }
    else if (a === 'open') { host('st_openFile', j.file).then(function (r) { toast(r.error ? '⚠ ' + r.error : '✓ ' + r.msg); }); return; }
    else if (a === 'del') {
      if (delArm !== id) { delArm = id; b.textContent = 'กดอีกครั้งเพื่อลบ'; setTimeout(function () { if (delArm === id) { delArm = null; renderQ(); } }, 3000); return; }
      jobs = jobs.filter(function (x) { return x.id !== id; }); delArm = null;
    } else return;
    save(); renderQ();
  });
  $('qFromDoc').onclick = function () {
    host('st_docInfo').then(function (r) {
      if (r.error) { toast('⚠ ' + r.error); return; }
      var a = r.artboards[r.active];
      $('qJob').value = r.name.replace(/\.[^.]+$/, '');
      if (a && !$('qSize').value) $('qSize').value = sizeTxt(a) + (r.artboards.length > 1 ? ' · ' + r.artboards.length + ' แผ่น' : '');
      $('qFile').value = r.path || '';
      $('qFileHint').textContent = r.path ? 'ผูกกับไฟล์: ' + r.path : 'ไฟล์ยังไม่ได้บันทึก — ปุ่ม "เปิดไฟล์" จะไม่มี';
    });
  };
  $('qAdd').onclick = function () {
    var cust = $('qCust').value.trim(), job = $('qJob').value.trim();
    if (!cust && !job) { toast('⚠ ใส่ชื่อลูกค้าหรือชื่องานก่อน'); return; }
    jobs.push({ id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cust: cust, job: job, size: $('qSize').value.trim(),
      due: $('qDue').value || '', note: $('qNote').value.trim(), file: $('qFile').value || '', status: 'print', created: Date.now() });
    save();
    ['qCust', 'qJob', 'qSize', 'qDue', 'qNote', 'qFile'].forEach(function (id) { $(id).value = ''; });
    $('qFileHint').textContent = ''; $('qAddBox').open = false;
    if (seg('qFilter') === 'done') document.querySelector('.seg[data-name="qFilter"] [data-v="open"]').click();
    renderQ(); toast('✓ เพิ่มเข้าคิวแล้ว');
  };
  renderQ();
  setInterval(renderQ, 10 * 60 * 1000);   // อัปเดตป้าย "เลยกำหนด/วันนี้" เมื่อข้ามวัน
})();
