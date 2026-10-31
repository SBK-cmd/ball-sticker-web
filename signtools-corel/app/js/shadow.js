/* Sign Tools — ทำเงา / ขอบตัวหนังสือ (Drop · Box · Perspective · Cast · Edge) */
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
  var COLORS = [
    { id: 'blk', n: 'ดำ', rgb: [0, 0, 0], cmyk: [0, 0, 0, 100] },
    { id: 'gry', n: 'เทาเข้ม', rgb: [77, 77, 79], cmyk: [0, 0, 0, 80] },
    { id: 'gr2', n: 'เทา', rgb: [147, 149, 152], cmyk: [0, 0, 0, 50] },
    { id: 'wht', n: 'ขาว', rgb: [255, 255, 255], cmyk: [0, 0, 0, 0] },
    { id: 'red', n: 'แดง', rgb: [237, 28, 36], cmyk: [0, 100, 100, 0] },
    { id: 'org', n: 'ส้ม', rgb: [247, 148, 29], cmyk: [0, 50, 100, 0] },
    { id: 'yel', n: 'เหลือง', rgb: [255, 242, 0], cmyk: [0, 0, 100, 0] },
    { id: 'grn', n: 'เขียว', rgb: [0, 166, 81], cmyk: [85, 10, 100, 0] },
    { id: 'blu', n: 'น้ำเงิน', rgb: [0, 84, 166], cmyk: [100, 70, 0, 0] },
    { id: 'nav', n: 'กรมท่า', rgb: [16, 35, 63], cmyk: [100, 85, 40, 45] }
  ];
  function col() { var v = $('shColor').value; return COLORS.filter(function (c) { return c.id === v; })[0] || COLORS[0]; }
  function hexOf(rgb) { return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function renderSw() {
    var g = $('shSw'); g.innerHTML = ''; var cur = col();
    COLORS.forEach(function (c) {
      var b = document.createElement('button'); b.className = 'sw' + (c.id === cur.id ? ' on' : '');
      b.style.background = hexOf(c.rgb); b.title = c.n;
      b.onclick = function () { $('shColor').value = c.id; renderSw(); $('shColor').dispatchEvent(new Event('change', { bubbles: true })); };
      g.appendChild(b);
    });
    $('shColName').textContent = cur.n;
  }
  var HINT = {
    drop: 'เงาเลื่อนออกจากตัวงาน ตามระยะที่ใส่',
    box: 'เงาทึบยื่นต่อจากตัวงาน เหมือนตัวอักษร 3 มิติ',
    persp: 'เงายื่นแบบมีมุมมอง ด้านไกลเล็กลง (ใส่ % ขนาดด้านไกล)',
    cast: 'เงาทอดลงพื้นจากฐานตัวอักษร (มุม + ความยาว)',
    edge: 'ขอบรอบตัวงานทั้งชิ้น ตามความหนาที่ใส่'
  };
  function ui() {
    var t = seg('shType') || 'drop';
    $('shTypeHint').textContent = HINT[t];
    function show(cls, on) { document.querySelectorAll('#tab-shd .' + cls).forEach(function (e) { e.classList.toggle('hidden', !on); }); }
    show('onlyShMove', t === 'drop' || t === 'box' || t === 'persp');
    show('onlyShPersp', t === 'persp');
    show('onlyShCast', t === 'cast');
    show('onlyShEdge', t === 'edge');
    show('onlyShKnock', $('shKnock').checked);
    $('shGo').textContent = t === 'edge' ? 'ทำขอบ' : 'ทำเงา';
  }
  $('shGo').onclick = function () {
    var b = $('shGo'), c = col(); b.disabled = true; b.textContent = 'กำลังทำ…'; $('shWarn').textContent = '';
    host('st_shadow', {
      type: seg('shType') || 'drop',
      dxMM: num('shDx', 0), dyMM: num('shDy', 0), scale: num('shScale', 70),
      angle: num('shAngle', 30), len: num('shLen', 80),
      widthMM: num('shWidth', 3), join: $('shJoin').value,
      knock: $('shKnock').checked, gapMM: Math.max(0, num('shGap', 0)),
      holes: $('shHoles').checked, layer: $('shLayer').checked,
      rgb: c.rgb, cmyk: c.cmyk
    }).then(function (r) {
      b.disabled = false; ui();
      if (r.error) { toast('⚠ ' + r.error); $('shWarn').textContent = '⚠ ' + r.error; return; }
      toast('✓ ' + r.msg);
      if (r.warn && r.warn.length) $('shWarn').textContent = '⚠ ' + r.warn.join(' · ');
    });
  };
  $('shKnock').addEventListener('change', ui);
  document.querySelectorAll('.seg[data-name="shType"] button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(ui, 0); }); });
  setTimeout(function () { renderSw(); ui(); }, 0);       // หลังโหลดค่าที่จำไว้
})();
