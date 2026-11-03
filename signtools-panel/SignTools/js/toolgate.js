/* Sign Tools — แอดมินเปิด/ปิดเครื่องมือรายสมาชิก (ซ่อนเมนูของเครื่องมือที่ถูกปิด) · จำค่าล่าสุดไว้ใช้ตอนออฟไลน์ */
(function () {
  'use strict';
  var KEY = 'st_tools_off_v1';
  function apply(off) {
    window.ST_toolsOff = off || [];
    document.querySelectorAll('.tab.tool[data-tab]').forEach(function (b) {
      var gone = window.ST_toolsOff.indexOf(b.dataset.tab) >= 0;
      if (gone) {
        if (b.dataset.wasHidden === undefined) b.dataset.wasHidden = b.classList.contains('hidden') ? '1' : '0';
        b.classList.add('hidden');
      } else if (b.dataset.wasHidden !== undefined) {
        if (b.dataset.wasHidden === '0') b.classList.remove('hidden');
        delete b.dataset.wasHidden;
      }
    });
    var cur = document.querySelector('.pane.active');
    if (cur && window.ST_toolsOff.indexOf((cur.id || '').replace('tab-', '')) >= 0) { var back = document.querySelector('.tab.back'); if (back) back.click(); }
  }
  try { var saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (saved.length) apply(saved); } catch (e) {}
  var tries = 0;
  (function wait() {
    var c = window.ST_core;
    if (c && c.features && !document.body.classList.contains('locked')) {
      c.features().then(function (f) {
        if (!f || !Array.isArray(f.tools_off)) return;      // เซิร์ฟเวอร์ไม่ตอบ → คงค่าที่จำไว้
        try { localStorage.setItem(KEY, JSON.stringify(f.tools_off)); } catch (e) {}
        apply(f.tools_off);
      });
      return;
    }
    if (++tries < 900) setTimeout(wait, 2000);
  })();
})();
