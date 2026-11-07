/* สถิติคนเข้าเว็บหน้าร้าน (Google Analytics 4) — ตัวนับเดียวทั้งเว็บ
   - ไม่นับเมื่อเปิดจากหน้า -preview, localhost, ไฟล์ในเครื่อง (กันข้อมูลปนตอนทดสอบ)
   - นับ: เข้าชมหน้า + กดโทร / LINE / Messenger / Facebook / แผนที่ แยกชนิด
   - ปิดสัญญาณโฆษณา (ไม่ใช้ Google signals / ad personalization) */
(function () {
  var ID = 'G-D9CNDC6L08';
  var h = location.hostname, p = location.pathname;
  var skip = !window.__GA_FORCE && (location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || /-preview/.test(p) || /^preview/.test(p.replace(/^\//, '')));
  if (skip || navigator.doNotTrack === '1') return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', ID, {allow_google_signals: false, allow_ad_personalization_signals: false});
  var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID; document.head.appendChild(s);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a'); if (!a) return;
    var u = (a.getAttribute('href') || ''), n = '';
    if (/^tel:/i.test(u)) n = 'click_call';
    else if (a.hasAttribute('data-line') || /line\.me/i.test(u)) n = 'click_line';
    else if (/m\.me\//i.test(u)) n = 'click_messenger';
    else if (/facebook\.com/i.test(u)) n = 'click_facebook';
    else if (/maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i.test(u)) n = 'click_map';
    else if (/designer\.html/i.test(u)) n = 'click_designer';
    if (n) gtag('event', n, {link_url: u.slice(0, 100), page_path: p});
  }, true);
})();
