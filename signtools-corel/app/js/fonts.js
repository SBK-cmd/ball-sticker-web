/* Thai Font Preview — panel logic */
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
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function store(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { return null; }
  }

  // ---------- แท็บ ----------
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab); });
      if (b.dataset.tab === 'glyphs') renderGlyphs();
    };
  });

  // =====================================================
  //  1) ฟอนต์ในเครื่อง
  // =====================================================
  var fonts = [], shown = [], rendered = 0, PAGE = 60;
  var favs = store('tfp_favs') || {};

  function weightOf(style) {
    var s = (style || '').toLowerCase().replace(/[\s-]/g, '');
    var w = 400;
    if (/thin|hairline/.test(s)) w = 100;
    else if (/extralight|ultralight/.test(s)) w = 200;
    else if (/semilight|light/.test(s)) w = 300;
    else if (/medium/.test(s)) w = 500;
    else if (/semibold|demibold|demi/.test(s)) w = 600;
    else if (/extrabold|ultrabold|heavy/.test(s)) w = 800;
    else if (/black/.test(s)) w = 900;
    else if (/bold/.test(s)) w = 700;
    return { w: w, i: /italic|oblique/.test(s) };
  }

  function fontItem(f) {
    var wt = weightOf(f.s);
    var el = document.createElement('div');
    el.className = 'fi';
    el.innerHTML = '<div class="nm"><span></span><button class="star" title="ติดดาว">★</button></div><div class="pv"></div>';
    el.querySelector('.nm span').textContent = f.f + ' — ' + f.s;
    var pv = el.querySelector('.pv');
    pv.style.fontFamily = '"' + f.n + '","' + f.f + '",sans-serif';
    pv.style.fontWeight = wt.w;
    pv.style.fontStyle = wt.i ? 'italic' : 'normal';
    pv.style.fontSize = $('fSize').value + 'px';
    pv.textContent = $('fSample').value || f.f;
    var star = el.querySelector('.star');
    if (favs[f.n]) star.classList.add('on');
    star.onclick = function (e) {
      e.stopPropagation();
      if (favs[f.n]) delete favs[f.n]; else favs[f.n] = 1;
      star.classList.toggle('on', !!favs[f.n]);
      store('tfp_favs', favs);
    };
    el.dataset.font = f.n;
    el.onclick = function () { applyFont(f, el); };
    return el;
  }

  var current = null, busy = false;
  function markActive(name) {
    current = name;
    document.querySelectorAll('.fi.on').forEach(function (e) { e.classList.remove('on'); });
    if (!name) return null;
    var el = document.querySelector('.fi[data-font="' + name.replace(/["\\]/g, '\\$&') + '"]');
    if (el) el.classList.add('on');
    return el;
  }
  function applyFont(f, el) {
    if (busy) return;
    busy = true;
    markActive(f.n);
    host('tfp_applyFont', f.n, $('fSample').value || f.f, +$('fSize').value).then(function (r) {
      busy = false;
      toast(r.error ? '⚠ ' + r.error : '✓ ' + r.msg);
    });
  }
  // ↑ ↓ = เลื่อนไปฟอนต์ถัดไปแล้วใช้ทันที
  document.addEventListener('keydown', function (e) {
    if (!$('tab-fonts').classList.contains('active')) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var tag = (document.activeElement || {}).tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'search')) return;
    e.preventDefault();
    var idx = -1;
    for (var i = 0; i < shown.length; i++) if (shown[i].n === current) { idx = i; break; }
    idx = Math.max(0, Math.min(shown.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
    while (idx >= rendered && rendered < shown.length) renderMore();
    var f = shown[idx]; if (!f) return;
    var el = markActive(f.n);
    if (el) el.scrollIntoView({ block: 'nearest' });
    applyFont(f, el);
  });
  // ไฮไลต์ฟอนต์ของข้อความที่เลือกอยู่ เมื่อเมาส์เข้าแผง
  function syncCurrent() {
    host('tfp_currentFont').then(function (r) {
      if (r && r.font && r.font !== current) { var el = markActive(r.font); if (el) el.scrollIntoView({ block: 'nearest' }); }
    });
  }
  document.addEventListener('mouseenter', syncCurrent);
  window.addEventListener('focus', syncCurrent);

  function renderMore() {
    var list = $('fList'), end = Math.min(rendered + PAGE, shown.length);
    var frag = document.createDocumentFragment();
    for (var i = rendered; i < end; i++) frag.appendChild(fontItem(shown[i]));
    var old = list.querySelector('.more'); if (old) old.remove();
    list.appendChild(frag);
    rendered = end;
    if (current) markActive(current);
    if (rendered < shown.length) {
      var m = document.createElement('div'); m.className = 'more'; m.textContent = 'เลื่อนลงเพื่อดูเพิ่ม…';
      list.appendChild(m);
    }
  }

  function filterFonts() {
    var q = $('fSearch').value.trim().toLowerCase(), onlyFav = $('fFav').checked;
    shown = fonts.filter(function (f) {
      if (onlyFav && !favs[f.n]) return false;
      return !q || (f.f + ' ' + f.s + ' ' + f.n).toLowerCase().indexOf(q) >= 0;
    });
    $('fCount').textContent = shown.length + ' / ' + fonts.length + ' ฟอนต์';
    $('fList').innerHTML = ''; rendered = 0;
    renderMore();
    if (current) markActive(current);
  }

  function updatePreviews() {
    var txt = $('fSample').value, sz = $('fSize').value + 'px';
    $('fSizeV').textContent = $('fSize').value;
    document.querySelectorAll('.fi .pv').forEach(function (p) { p.style.fontSize = sz; if (txt) p.textContent = txt; });
    store('tfp_sample', txt);
  }

  function loadFonts() {
    $('fCount').textContent = 'กำลังโหลดรายชื่อฟอนต์…';
    host('tfp_listFonts').then(function (r) {
      if (r.error) { $('fCount').textContent = '⚠ ' + r.error; return; }
      fonts = r.fonts.sort(function (a, b) { return (a.f + a.s).localeCompare(b.f + b.s); });
      filterFonts();
    });
  }

  var st = store('tfp_sample'); if (st) $('fSample').value = st;
  $('fSample').oninput = updatePreviews;
  $('fSize').oninput = updatePreviews;
  $('fSearch').oninput = filterFonts;
  $('fFav').onchange = filterFonts;
  $('fReload').onclick = loadFonts;
  $('tab-fonts').addEventListener('scroll', function () {
    var p = this;
    if (p.scrollTop + p.clientHeight > p.scrollHeight - 300 && rendered < shown.length) renderMore();
  });

  // =====================================================
  //  2) ตัวที่วาดเอง (อ่านจาก artboard)
  // =====================================================
  var glyphMap = {}, unknownBoards = [], emH = 1, stamp = 0;

  // สระบน/ล่าง/วรรณยุกต์ = ไม่กินที่ วางซ้อนบนตัวก่อนหน้า
  function isMark(c) {
    var k = c.charCodeAt(0);
    return k === 0x0E31 || (k >= 0x0E34 && k <= 0x0E3A) || (k >= 0x0E47 && k <= 0x0E4E);
  }

  // ชื่อ artboard → ตัวอักษร  รองรับ: "ก", "U+0E01", "uni0E01", "0E01", "ก_kokai"
  // ชื่อมาตรฐานแบบฟอนต์อังกฤษ (Adobe Glyph List)
  var AGL = {
    zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',
    period:'.',comma:',',colon:':',semicolon:';',exclam:'!',question:'?',quotesingle:"'",quotedbl:'"',
    hyphen:'-',endash:'\u2013',emdash:'\u2014',underscore:'_',parenleft:'(',parenright:')',
    bracketleft:'[',bracketright:']',braceleft:'{',braceright:'}',slash:'/',backslash:'\\',
    ampersand:'&',at:'@',numbersign:'#',dollar:'$',percent:'%',asterisk:'*',plus:'+',equal:'=',
    less:'<',greater:'>',bar:'|',asciitilde:'~',asciicircum:'^',grave:'`',
    quoteleft:'\u2018',quoteright:'\u2019',quotedblleft:'\u201C',quotedblright:'\u201D',
    ellipsis:'\u2026',bullet:'\u2022',baht:'\u0E3F'
  };

  function nameToChar(name) {
    var n = String(name).trim(), m;
    // ตัดคำต่อท้ายแบบ "A.uc", "a copy", "a-1" ออก (ถ้าข้างหน้าเป็นตัวเดียว)
    var base = n.split(/[.\s]/)[0];
    if (AGL[base.toLowerCase()]) return AGL[base.toLowerCase()];
    if ((m = base.match(/^(?:upper(?:case)?|cap)[_-]?([A-Za-z])$/i))) return m[1].toUpperCase();
    if ((m = base.match(/^(?:lower(?:case)?|lc)[_-]?([A-Za-z])$/i))) return m[1].toLowerCase();
    if (n.length > 1 && Array.from(base).length === 1 && !/[\u0E00-\u0E7F]/.test(n)) return base;
    if ((m = n.match(/U\+([0-9A-Fa-f]{4,5})/i))) return String.fromCodePoint(parseInt(m[1], 16));
    if (Array.from(n).length === 1) return n;
    if ((m = n.match(/^(?:uni|u)?([0-9A-Fa-f]{4,5})$/i))) return String.fromCodePoint(parseInt(m[1], 16));
    if ((m = n.match(/[฀-๿]/))) return m[0];
    return null;
  }

  function fileUrl(p) {
    return 'file:///' + encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23');
  }

  function loadGlyphs() {
    $('gStatus').textContent = 'กำลังส่งออกตัวอักษรจาก artboard… (ตัวเยอะอาจใช้เวลาสักครู่)';
    host('tfp_exportGlyphs').then(function (r) {
      if (r.error) { $('gStatus').textContent = '⚠ ' + r.error; return; }
      glyphMap = {}; unknownBoards = []; stamp = Date.now();
      var hs = {};
      r.glyphs.forEach(function (g) {
        var c = nameToChar(g.name);
        if (!c) { unknownBoards.push(g.name); return; }
        glyphMap[c] = g;
        var hk = Math.round(g.h); hs[hk] = (hs[hk] || 0) + 1;
      });
      // em = ความสูง artboard ที่พบบ่อยที่สุด
      var best = 0; Object.keys(hs).forEach(function (h) { if (hs[h] > best) { best = hs[h]; emH = +h; } });
      $('gStatus').textContent = r.doc + ' · พบ ' + Object.keys(glyphMap).length + ' ตัว จาก ' + r.glyphs.length + ' artboard';
      renderGlyphs();
    });
  }

  function renderGlyphs() {
    var stage = $('gStage'), size = +$('gSize').value, track = +$('gTrack').value / 100 * size;
    var lead = +$('gLead').value / 100;
    $('gSizeV').textContent = size; $('gTrackV').textContent = $('gTrack').value; $('gLeadV').textContent = $('gLead').value + '%';
    store('tfp_gtext', $('gText').value);
    stage.innerHTML = '';
    var missing = {};
    if (!Object.keys(glyphMap).length) {
      stage.innerHTML = '<div class="hint" style="color:#888">ยังไม่มีตัวอักษร — กด "ดึงตัวอักษรจาก Artboards"</div>';
      return;
    }
    var k = size / emH;
    var avail = Math.max(size, stage.clientWidth - 32);   // ความกว้างกล่อง ลบ padding

    // แยกเป็นกลุ่ม: พยัญชนะ + สระบน/ล่าง/วรรณยุกต์ที่ตามมา (ตัดบรรทัดจะไม่แยกออกจากกัน)
    function cw(c) { var g = glyphMap[c]; return g ? g.w * k : size * 0.5; }
    function clusters(t) {
      var out = [];
      Array.from(t).forEach(function (c) {
        if (c === ' ') out.push({ sp: true, w: size * 0.3 });
        else if (isMark(c) && out.length && !out[out.length - 1].sp) out[out.length - 1].ch.push(c);
        else out.push({ ch: [c], w: cw(c) });
      });
      return out;
    }
    // ตัดบรรทัดอัตโนมัติ: ตัดที่ช่องว่างก่อน ถ้าไม่มีช่องว่างตัดที่ตัวอักษร
    function wrap(items) {
      var lines = [], cur = [], x = 0;
      items.forEach(function (it) {
        var add = it.w + track;
        if (cur.length && x + it.w > avail && !it.sp) {
          var sp = -1;
          for (var i = cur.length - 1; i > 0; i--) if (cur[i].sp) { sp = i; break; }
          var rest = sp > 0 ? cur.splice(sp) : [];
          while (rest.length && rest[0].sp) rest.shift();
          lines.push(cur); cur = rest;
          x = cur.reduce(function (s, q) { return s + q.w + track; }, 0);
        }
        if (it.sp && !cur.length) return;   // ไม่เริ่มบรรทัดด้วยช่องว่าง
        cur.push(it); x += add;
      });
      lines.push(cur);
      return lines;
    }
    function place(line, c, x, w, isM) {
      var g = glyphMap[c], el, h = g ? g.h * k : size;
      if (g) {
        el = document.createElement('img');
        el.src = fileUrl(g.path) + '?t=' + stamp;
        el.style.width = w + 'px'; el.style.height = h + 'px';
        el.title = c + ' (' + g.name + ')';
      } else {
        missing[c] = 1;
        el = document.createElement('div'); el.className = 'miss'; el.textContent = c;
        el.style.width = w + 'px'; el.style.height = size + 'px';
      }
      el.style.left = x + 'px';
      el.style.top = ((size * lead - size) / 2) + 'px';
      line.appendChild(el);
    }

    $('gText').value.split('\n').forEach(function (hard) {
      wrap(clusters(hard)).forEach(function (items) {
        var line = document.createElement('div');
        line.className = 'line';
        line.style.height = (size * lead) + 'px';
        var x = 0;
        items.forEach(function (it) {
          if (!it.sp) {
            place(line, it.ch[0], x, it.w);
            // สระบน/ล่าง/วรรณยุกต์ ชิดขวากับตัวหลัก
            for (var m = 1; m < it.ch.length; m++) { var mw = cw(it.ch[m]); place(line, it.ch[m], x + it.w - mw, mw, true); }
          }
          x += it.w + track;
        });
        line.style.width = x + 'px';
        stage.appendChild(line);
      });
    });
    var miss = Object.keys(missing);
    var txt = '';
    if (miss.length) txt += 'ยังไม่มีตัว: ' + miss.join(' ') + '<br>';
    if (unknownBoards.length) txt += 'artboard ที่อ่านชื่อไม่ออก: ' + unknownBoards.map(function (s) { return '“' + s + '”'; }).join(', ') +
      '<br>ตั้งชื่อ artboard เป็นตัวอักษร (เช่น ก) หรือรหัส (U+0E01 / uni0E01)';
    $('gMissing').innerHTML = txt || 'ครบทุกตัวในข้อความนี้ ✓';
  }

  var gt = store('tfp_gtext'); if (gt) $('gText').value = gt;
  ['gText', 'gSize', 'gTrack', 'gLead'].forEach(function (id) { $(id).oninput = renderGlyphs; });
  $('gLoad').onclick = loadGlyphs;
  var rsT; window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(renderGlyphs, 120); });
  $('gBg').onclick = function () {
    var s = $('gStage'); var dark = s.classList.toggle('dark'); s.classList.toggle('light', !dark);
  };
  document.querySelectorAll('.chip').forEach(function (b) {
    b.onclick = function () { $('gText').value = b.dataset.t; renderGlyphs(); };
  });

  // ---------- เริ่ม ----------
  loadFonts();
  renderGlyphs();
})();
