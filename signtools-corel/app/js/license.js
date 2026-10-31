/* Sign Tools — license screen + update banner (browser side) */
(function () {
  'use strict';
  var C = window.ST_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var lock = $('lic'), msg = $('licMsg'), keyIn = $('licKey'), btn = $('licGo');

  function nodeReq() { return (window.cep_node && window.cep_node.require) || window.__testRequire || null; }
  function osPath(p) { p = decodeURIComponent(p); if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); return p; }
  function extDir() { return window.ST_EXTDIR || osPath(location.pathname).replace(/[\\/][^\\/]*$/, ''); }

  var core = null;
  try {
    var req = nodeReq();
    var proc = (window.cep_node && window.cep_node.process) || (req && req('process'));
    var env = proc ? proc.env : {};
    var base = env.APPDATA || ((env.HOME || '') + '/Library/Application Support');
    var corePath = extDir() + '/js/core.js';
    try { if (req.cache) Object.keys(req.cache).forEach(function (k) { if (/[\\/]js[\\/]core\.js$/.test(k)) delete req.cache[k]; }); } catch (e0) {}
    var NB = (window.cep_node && window.cep_node.Buffer) || req('buffer').Buffer;
    // ต่อเน็ตด้วยระบบของหน้าเว็บ (ไม่ค้างหลังแผงโหลดหน้าใหม่ ต่างจาก Node)
    var pageRequest = function (url, body, opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open(body ? 'POST' : 'GET', url, true);
        x.responseType = 'arraybuffer';
        x.timeout = opts.timeout || 15000;
        x.onload = function () {
          if (x.status !== 200) { var e = new Error('เซิร์ฟเวอร์ตอบ ' + x.status); e.http = x.status; return reject(e); }
          var u = new Uint8Array(x.response || new ArrayBuffer(0));
          if (opts.max && u.length > opts.max) return reject(new Error('ไฟล์ใหญ่ผิดปกติ'));
          var b = NB.alloc(u.length);
          for (var i = 0; i < u.length; i++) b[i] = u[i];      // คัดลอกเป็น Buffer ของ Node
          resolve(b);
        };
        x.onerror = function () { var e = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); e.offline = true; reject(e); };
        x.ontimeout = function () { var e = new Error('หมดเวลาเชื่อมต่อ'); e.offline = true; reject(e); };
        if (body) { x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8'); x.send(JSON.stringify(body)); }
        else x.send();
      });
    };
    core = req(corePath)({
      extDir: extDir(), dataDir: base + '/SignTools' + (C.dataSub || ''), product: C.product, server: C.server, pubkey: C.pubkey, allowHttp: !!C.allowHttp,
      request: pageRequest
    });
  } catch (e) {
    console.error(e);
  }

  function show(on) { lock.classList.toggle('show', on); document.body.classList.toggle('locked', on); }
  function say(t, bad) { msg.textContent = t || ''; msg.className = 'licmsg' + (bad ? ' bad' : ''); }
  var toastT;
  function toast(t) { var el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 3000); }

  // กันค้าง: ถ้าคำสั่งเครือข่ายไม่ตอบภายในเวลาที่กำหนด ให้ถือว่าเชื่อมต่อไม่ได้
  function within(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { var e = new Error('หมดเวลาเชื่อมต่อ'); e.offline = true; rej(e); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  if (!core) {
    show(true);
    say('เปิดระบบไลเซนส์ไม่ได้ — ติดตั้งเวอร์ชันล่าสุดใหม่อีกครั้ง หรือติดต่อ ' + (C.contact || 'ผู้ขาย'), true);
    btn.disabled = true;
    return;
  }

  $('ver').textContent = 'v' + core.version();

  // ---------- เปิดใช้คีย์ ----------
  var keyMode = false;
  function setMode(km) {
    keyMode = km;
    $('licAcc').classList.toggle('hidden', km); keyIn.classList.toggle('hidden', !km);
    $('licMode').textContent = km ? 'เข้าด้วยเบอร์ + รหัสผ่าน' : 'มีคีย์ ST-… ? ใช้คีย์แทน';
    $('licHint').textContent = km ? 'ใส่คีย์ไลเซนส์เพื่อเริ่มใช้งาน' : 'เข้าสู่ระบบด้วยเบอร์และรหัสผ่านสมาชิก';
    say(''); setTimeout(function () { (km ? keyIn : $('licPhone')).focus(); }, 50);
  }
  $('licMode').onclick = function () { setMode(!keyMode); };
  function doActivate() {
    var job;
    if (keyMode) {
      var k = keyIn.value.trim();
      if (!/^ST-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(k)) { say('รูปแบบคีย์: ST-XXXX-XXXX-XXXX-XXXX', true); return; }
      job = core.activate(k);
    } else {
      var ph = $('licPhone').value.replace(/\D/g, ''), pw = $('licPw').value;
      if (!/^0\d{9}$/.test(ph)) { say('ใส่เบอร์มือถือ 10 หลัก', true); return; }
      if (!pw) { say('ใส่รหัสผ่าน', true); return; }
      if (!core.activateAccount) { say('อัปเดตโปรแกรมเป็นเวอร์ชันล่าสุดก่อน', true); return; }
      job = core.activateAccount(ph, pw);
    }
    btn.disabled = true; say('กำลังตรวจสอบ…');
    var slow = setTimeout(function () { say('กำลังตรวจสอบ… (เน็ตช้า กำลังลองทางสำรอง)'); }, 7000);
    within(job, 70000).then(function (s) {
      clearTimeout(slow);
      btn.disabled = false; say(''); show(false); keyIn.value = ''; $('licPw').value = '';
      toast('✓ เปิดใช้งานแล้ว — ขอบคุณที่สนับสนุนครับ');
      afterUnlock(s);
    }, function (e) {
      clearTimeout(slow); btn.disabled = false; say(e.message, true);
    });
  }
  btn.onclick = doActivate;
  keyIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') doActivate(); });
  $('licPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doActivate(); });
  $('licPhone').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('licPw').focus(); });
  keyIn.addEventListener('input', function () {
    // จัดรูปแบบอัตโนมัติ ST-XXXX-…
    var raw = keyIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.indexOf('ST') === 0) raw = raw.slice(2);
    var g = raw.slice(0, 16).match(/.{1,4}/g) || [];
    var v = g.length ? 'ST-' + g.join('-') : keyIn.value.toUpperCase();
    if (v !== keyIn.value) keyIn.value = v;
  });

  // ---------- ปุ่มหน้าสมาชิก: เปิดเบราว์เซอร์ เข้าระบบให้อัตโนมัติ ----------
  function openUrl(u) {
    try { if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) { window.cep.util.openURLInDefaultBrowser(u); return; } } catch (e) {}
    try {
      var cp = nodeReq()('child_process'), pr = (window.cep_node && window.cep_node.process) || nodeReq()('process');
      if (pr.platform === 'win32') cp.exec('start "" "' + u.replace(/"/g, '') + '"'); else cp.exec('open "' + u.replace(/"/g, '') + '"');
    } catch (e2) { toast('เปิดเบราว์เซอร์ไม่ได้ — เข้าที่ ' + u); }
  }
  window.ST_core = core;
  $('memberBtn').onclick = function () {
    var b = $('memberBtn'); b.disabled = true;
    within(core.memberLink ? core.memberLink() : Promise.resolve(''), 40000).then(function (u) {
      b.disabled = false; if (u) { openUrl(u); toast('เปิดหน้าสมาชิกในเบราว์เซอร์แล้ว'); }
    }, function () { b.disabled = false; openUrl(String(C.server && C.server[0] || '').replace(/\/api\/?$/, '') + '/member'); });
  };

  // ---------- เมนูไลเซนส์ ----------
  $('licDiag').onclick = function () {
    var d = $('licDiag'); d.disabled = true; d.textContent = 'กำลังทดสอบ… (ไม่เกิน 1 นาที)';
    within(core.diag ? core.diag() : Promise.reject(new Error('ไม่รองรับ')), 120000).then(function (t) {
      d.disabled = false; d.textContent = 'ทดสอบการเชื่อมต่อ'; info('ผลทดสอบการเชื่อมต่อ', t + '\n\n(ส่งผลนี้ให้ร้านแล้ว)');
    }, function (e) { d.disabled = false; d.textContent = 'ทดสอบการเชื่อมต่อ'; info('ทดสอบไม่สำเร็จ', e.message); });
  };
  $('licInfoBtn').onclick = function () {
    var s = core.localStatus();
    $('licInfoText').textContent = s.state === 'ok'
      ? (s.phone ? 'บัญชี ' + s.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : 'คีย์ ' + s.masked) + ' · เปิดใช้งานบนเครื่องนี้'
      : 'ยังไม่ได้เปิดใช้';
    $('licInfo').classList.toggle('show');
  };
  $('licMove').onclick = function () {
    var mb = $('licMove');
    if (mb.dataset.sure !== '1') { mb.dataset.sure = '1'; mb.textContent = 'กดอีกครั้งเพื่อยืนยัน ย้ายเครื่อง'; setTimeout(function () { mb.dataset.sure = ''; mb.textContent = 'ย้ายไปเครื่องอื่น'; }, 5000); return; }
    mb.dataset.sure = ''; mb.disabled = true; mb.textContent = 'กำลังยกเลิกคีย์จากเครื่องนี้…';
    within(core.deactivate(), 60000).then(function () {
      mb.disabled = false; mb.textContent = 'ย้ายไปเครื่องอื่น';
      $('licInfo').classList.remove('show'); show(true); say('ออกจากเครื่องนี้แล้ว — เข้าสู่ระบบที่เครื่องใหม่ได้เลย');
    }, function (e) { mb.disabled = false; mb.textContent = 'ย้ายไปเครื่องอื่น'; toast('⚠ ' + e.message + ' (ต้องต่อเน็ต)'); });
  };

  // ---------- อัปเดต ----------
  // เจอเวอร์ชันใหม่ → ถามก่อน: ตกลง = อัปเดต / ไม่ตอนนี้ = แสดงสถานะ "มีอัปเดต" ค้างไว้
  var pending = null, asked = {}, busy = false;
  function setStatus(kind, text) {
    var st = $('updStatus');
    st.className = 'updstat ' + kind;            // ok | new | wait | err
    $('updStatusText').textContent = text;
    $('updBadge').classList.toggle('show', kind === 'new');
  }
  function openAsk() {
    if (!pending) return;
    $('updTitle').textContent = 'มีอัปเดต — เวอร์ชัน v' + pending.version + (pending.beta ? ' (เบต้า)' : '');
    $('updText').textContent = (pending.notes ? pending.notes + '\n' : '') + 'ตอนนี้ใช้ v' + pending.current + ' — อัปเดตเลยไหม?';
    $('updGo').disabled = false; $('updLater').disabled = false;
    $('updGo').classList.remove('hidden'); $('updGo').textContent = 'ตกลง อัปเดต'; $('updGo').onclick = doUpdate; $('updLater').textContent = 'ไม่ตอนนี้';
    $('upd').classList.add('show');
  }
  function closeAsk() { $('upd').classList.remove('show'); }
  function info(title, text) {
    $('updTitle').textContent = title; $('updText').textContent = text;
    $('updGo').classList.add('hidden');
    $('updLater').disabled = false; $('updLater').textContent = 'ตกลง';
    $('upd').classList.add('show');
  }
  var autoFail = 0;
  function checkUpdate(manual) {
    if (busy) return;
    busy = true; $('updCheck').disabled = true;
    if (manual) setStatus('wait', 'กำลังเช็คอัปเดต…');
    within(core.checkUpdate(), 60000).then(function (r) {
      busy = false; $('updCheck').disabled = false; autoFail = 0;
      if (r && r.newer) {
        pending = r;
        setStatus('new', 'มีอัปเดต v' + r.version + (r.beta ? ' (เบต้า)' : '') + ' — กดเพื่ออัปเดต');
        if (manual || !asked[r.version]) { asked[r.version] = 1; openAsk(); }
      } else {
        pending = null;
        setStatus('ok', 'v' + core.version() + ' · เป็นเวอร์ชันปัจจุบันแล้ว');
        if (manual) info('✓ เป็นเวอร์ชันปัจจุบันแล้ว', 'คุณใช้ Sign Tools v' + core.version() + ' ซึ่งเป็นเวอร์ชันล่าสุด');
      }
    }, function (e) {
      busy = false; $('updCheck').disabled = false;
      if (pending) return;                         // เคยเจออัปเดตแล้ว คงสถานะเดิมไว้
      if (!manual && autoFail < 3) {               // เช็คเองเบื้องหลังไม่ผ่าน (เน็ตสะดุด/เพิ่งตื่นจากพัก) → ลองใหม่เงียบๆ ไม่ขึ้นแดง
        autoFail++;
        if ($('updStatus').className.indexOf(' ok') < 0) setStatus('wait', 'กำลังเชื่อมต่อเซิร์ฟเวอร์… จะลองใหม่อัตโนมัติ');
        setTimeout(function () { lastCheck = Date.now(); checkUpdate(false); }, 20000 * autoFail);
        return;
      }
      autoFail = 0;
      setStatus('err', 'เช็คอัปเดตไม่ได้ (' + (e.offline ? 'ต่อเซิร์ฟเวอร์ไม่ได้' : e.message) + ') — กดเช็คอีกครั้ง');
      if (manual) info('เช็คอัปเดตไม่ได้', (e.offline ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ต แล้วลองใหม่อีกครั้ง' : e.message));
    });
  }
  $('updCheck').onclick = function () { lastCheck = Date.now(); checkUpdate(true); };
  $('updStatus').onclick = function () { if (pending) openAsk(); else $('updCheck').click(); };
  $('updBadge').onclick = openAsk;
  $('updLater').onclick = function () {
    closeAsk();
    if (pending) setStatus('new', 'มีอัปเดต v' + pending.version + ' — กดเพื่ออัปเดต');
  };
  function doUpdate() {
    if (!pending) return;
    var go = $('updGo'); go.disabled = true; $('updLater').disabled = true;
    within(core.applyUpdate(pending, function (t) { $('updText').textContent = t; }), 180000).then(function (res) {
      $('updTitle').textContent = '✓ อัปเดตเป็น v' + res.version + ' แล้ว';
      // ดาวน์โหลดผ่านหน้าเว็บสำเร็จ = โหลดแผงใหม่ได้ทันทีโดยไม่ต้องปิดเปิด
      if (false && !res.restart && res.via === 'page') {   // ปิดไว้: โหลดแผงใหม่ในตัวทำให้การเชื่อมต่อเน็ตของแผงค้างในบางเครื่อง → ให้ปิดเปิดแทน
        $('updText').textContent = 'กำลังเปิดเวอร์ชันใหม่…';
        go.classList.add('hidden');
        var jsx = (extDir() + '/jsx/host.jsx').replace(/\\/g, '/');
        try { localStorage.setItem('st_justUpdated', res.version); } catch (e5) {}
        var reload = function () { location.reload(); };
        if (window.__adobe_cep__) window.__adobe_cep__.evalScript('$.evalFile(new File(' + JSON.stringify(jsx) + '))', function () { setTimeout(reload, 300); });
        else setTimeout(reload, 300);
        return;
      }
      $('updText').textContent = 'ปิด CorelDRAW ทั้งโปรแกรมแล้วเปิดใหม่ 1 ครั้ง เพื่อใช้เวอร์ชันใหม่ (ปิดแค่แผงไม่พอ)';
      go.classList.add('hidden'); $('updLater').disabled = false; $('updLater').textContent = 'ไว้ทีหลัง';
      if (false && !res.restart && window.__adobe_cep__ && window.__adobe_cep__.closeExtension) {
        go.classList.remove('hidden'); go.disabled = false; go.textContent = 'ปิดแผงตอนนี้';
        go.onclick = function () { window.__adobe_cep__.closeExtension(); };
      }
      pending = null; setStatus('wait', 'อัปเดตแล้ว — ปิดแล้วเปิด CorelDRAW ใหม่');
    }, function (e) {
      $('updText').textContent = '⚠ ' + e.message + ' — ลองใหม่ได้';
      go.disabled = false; $('updLater').disabled = false;
    });
  }
  $('updGo').onclick = doUpdate;

  // เช็คตอนเปิดแผง + ทุก 30 นาที + ตอนกลับมาที่แผง (ถ้าไม่ได้เช็คเกิน 10 นาที)
  var lastCheck = 0, timer = null;
  function maybeCheck(minGap) { if (Date.now() - lastCheck >= minGap) { lastCheck = Date.now(); checkUpdate(false); } }
  function afterUnlock() {
    setTimeout(function () { maybeCheck(0); }, 1500);
    if (!timer) {
      timer = setInterval(function () { maybeCheck(0); }, 30 * 60 * 1000);
      window.addEventListener('focus', function () { maybeCheck(10 * 60 * 1000); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) maybeCheck(10 * 60 * 1000); });
    }
  }

  // ---------- เริ่ม ----------
  try { var ju = localStorage.getItem('st_justUpdated'); if (ju) { localStorage.removeItem('st_justUpdated'); setTimeout(function () { toast('✓ อัปเดตเป็น v' + ju + ' แล้ว'); }, 400); } } catch (e6) {}
  var s = core.localStatus();
  if (s.state === 'ok') {
    show(false); afterUnlock(s);
    within(core.refresh(), 70000).catch(function (e) {
      if (e.code) { show(true); say(e.message, true); }   // ถูกระงับ / ย้ายเครื่อง
    });
  } else {
    show(true);
    if (s.state === 'expired') {
      say('กำลังยืนยันไลเซนส์ออนไลน์…');
      within(core.refresh(), 70000).then(function (s2) { show(false); say(''); afterUnlock(s2); },
        function (e) { say(e.offline ? (s.clock ? 'เวลาในเครื่องไม่ถูกต้อง — ตั้งวันเวลาให้ตรง แล้วต่อเน็ตเพื่อยืนยันไลเซนส์' : 'ต้องต่อเน็ตเพื่อยืนยันไลเซนส์ — ต่อเน็ตแล้วเปิดแผงใหม่') : e.message, true); });
    } else if (s.state === 'invalid') say('ไลเซนส์ในเครื่องไม่ตรงกับเครื่องนี้ — ใส่คีย์อีกครั้ง', true);
    setTimeout(function () { $('licPhone').focus(); }, 100);
  }
})();
