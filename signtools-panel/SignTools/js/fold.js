/* การ์ดที่มีหัว (.chead) ยุบ/ขยายได้ด้วยการกดที่หัว — จำสถานะไว้ในเครื่อง · การ์ดตั้งค่าที่ไม่ค่อยแก้เริ่มต้นแบบยุบ */
(function () {
  var KEY = 'st_fold_v2', saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  var DEF_FOLD = /^(เครื่องตัด|ดักคำสั่งจาก)/;
  document.querySelectorAll('.pane .card').forEach(function (card) {
    var head = card.querySelector(':scope > .chead');
    if (!head) return;
    var pane = card.closest('.pane');
    var title = (head.querySelector('b') || head).textContent.trim();
    var id = (pane.id || '') + '#' + title;      // จำตามชื่อการ์ด (ย้ายลำดับการ์ดแล้วสถานะไม่เพี้ยน)
    var folded = id in saved ? !!saved[id] : DEF_FOLD.test(title);
    card.classList.add('foldable');
    card.classList.toggle('folded', folded);
    head.setAttribute('role', 'button'); head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', folded ? 'false' : 'true');
    function toggle() {
      folded = !card.classList.contains('folded');
      card.classList.toggle('folded', folded);
      head.setAttribute('aria-expanded', folded ? 'false' : 'true');
      saved[id] = folded; persist();
    }
    head.addEventListener('click', function (e) { if (e.target.closest('button,input,select,a')) return; toggle(); });
    head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
})();
