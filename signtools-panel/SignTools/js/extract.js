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
    var o = opts(), b = $('extGo');
    o.preview = false;
    if (!o.kiss.on && o.die.shape === 'none') { $('extRes').textContent = 'เลือกทำ Kiss Cut หรือ Die Cut อย่างน้อยหนึ่งอย่าง'; return; }
    b.disabled = true; $('extRes').textContent = (preview ? 'กำลังทำพรีวิว… ' : 'กำลังสร้างเส้นตัด… ') + ' (งานเยอะอาจใช้เวลาหลายนาที อย่าแตะ Illustrator)'; $('extWarn').textContent = '';
    host('st_extract', o).then(function (r) {
      b.disabled = false;
      if (r.error) { $('extRes').textContent = '⚠ ' + r.error; return; }
      $('extRes').textContent = '✓ ' + r.msg;
      $('extWarn').textContent = (r.warn || []).join(' · ');
    });
  }

  $('extGo').onclick = function () { run(false); };
})();
