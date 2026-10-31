/* Sign Tools — home menu: เปิดมาเห็นเมนู กดเข้าเครื่องมือ มีปุ่มกลับ */
(function () {
  'use strict';
  var NAMES = { stk: 'เรียงสติ๊กเกอร์', cut: 'ส่งตัด', sep: 'แยกสีงานตัด', shd: 'ทำเงา / ขอบ', name: 'ตั้งชื่อไฟล์', prev: 'ภาพตัวอย่าง / ไฟล์พิมพ์', slug: 'ข้อความขอบแผ่น', queue: 'คิวงาน', fonts: 'ฟอนต์', glyphs: 'วาดเอง', run: 'รันเลข', dup: 'ก็อป Artboard', qr: 'QR Code', dim: 'บอกขนาด' };
  function go(tab) {
    document.body.classList.toggle('intool', tab !== 'home');
    document.getElementById('toolTitle').textContent = NAMES[tab] || '';
    var pane = document.getElementById('tab-' + tab);
    if (pane) pane.scrollTop = 0;
  }
  // ปุ่มทุกอันมี class "tab" → สคริปต์เดิมสลับหน้าให้อยู่แล้ว ตรงนี้แค่จัดแถบด้านบน
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.tab); });
  });
  // Esc = กลับเมนู (ถ้าไม่ได้พิมพ์อยู่)
  document.addEventListener('keydown', function (e) {
    var t = (document.activeElement || {}).tagName;
    if (e.key === 'Escape' && t !== 'INPUT' && t !== 'TEXTAREA' && document.body.classList.contains('intool')) {
      document.querySelector('.tab.back').click();
    }
  });
  go('home');
})();
