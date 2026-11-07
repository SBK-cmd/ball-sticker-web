/* Sign Tools — คิวงานเชื่อมแอปร้าน (app.ballsticker.co.th · Firestore คอลเลกชัน jobs) — เฉพาะบัญชีทดสอบ (เซิร์ฟเวอร์เป็นคนเปิดให้)
 * อ่านใบงานจากแอป เปลี่ยนสถานะ (รอทำ → ทำไฟล์แล้ว → ผลิตแล้ว → จัดส่ง) ผูกไฟล์ Illustrator กับใบงาน แล้วกดเปิดไฟล์จากคิวได้ */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ST = ['pending', 'filed', 'printed', 'shipped'];
  var SN = { pending: 'รอทำ', filed: 'ทำไฟล์แล้ว', printed: 'ผลิตแล้ว', shipped: 'จัดส่ง' };
  var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var compact = false, cfg = null, jobs = [], filter = 'open', q = '', loading = false, lastErr = '', loadedAt = 0, openIds = {};
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var toastT;
  function toast(t) { var el = $('toast'); if (!el) return; el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 3000); }
  function host(fn, arg) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve({ error: 'ไม่ได้รันใน Illustrator' });
      window.__adobe_cep__.evalScript(fn + '(' + (arg === undefined ? '' : JSON.stringify(arg).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); })) + ')', function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ error: String(r).slice(0, 200) }); }
      });
    });
  }

  // ---------- เครือข่าย ----------
  function xhr(method, url, body, headers) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(); x.open(method, url, true); x.timeout = 20000;
      Object.keys(headers || {}).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
      x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300) resolve(j); else { var er = new Error((j && j.error && (j.error.message || j.error.status)) || ('HTTP ' + x.status)); er.status = x.status; reject(er); } };
      x.onerror = function () { reject(new Error('ต่อเน็ตไม่ได้')); };
      x.ontimeout = function () { reject(new Error('หมดเวลาเชื่อมต่อ')); };
      x.send(body == null ? null : typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  // บัญชีนิรนามของ Firebase (แบบเดียวกับแอปร้าน) · เก็บ refresh token ไว้ใช้ซ้ำ
  var tok = null, tokExp = 0;
  function token() {
    if (tok && Date.now() < tokExp - 60000) return Promise.resolve(tok);
    var rt = ''; try { rt = localStorage.getItem('st_fb_rt') || ''; } catch (e) {}
    var p = rt
      ? xhr('POST', 'https://securetoken.googleapis.com/v1/token?key=' + cfg.apiKey, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rt), { 'Content-Type': 'application/x-www-form-urlencoded' })
          .then(function (j) { return { idToken: j.id_token, refreshToken: j.refresh_token, expiresIn: j.expires_in }; })
      : Promise.reject(new Error('no rt'));
    return p.catch(function () {
      return xhr('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + cfg.apiKey, { returnSecureToken: true }, { 'Content-Type': 'application/json' });
    }).then(function (j) {
      tok = j.idToken; tokExp = Date.now() + (parseInt(j.expiresIn, 10) || 3600) * 1000;
      try { localStorage.setItem('st_fb_rt', j.refreshToken); } catch (e) {}
      return tok;
    });
  }
  function base() { return 'https://firestore.googleapis.com/v1/projects/' + cfg.projectId + '/databases/(default)/documents/'; }
  function fv(v) {                       // ค่าแบบ Firestore → JS
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return +v.integerValue;
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv);
    if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fv(f[k]); }); return o; }
    return null;
  }
  var FIELDS = ['no', 'date', 'jName', 'jPhone', 'jAddr', 'page', 'account', 'items', 'note', 'due', 'status', 'savedAt', 'aiFile', 'aiFileName', 'aiFiles', 'photos', 'createdBy'];
  function load(quiet) {
    if (loading) return; loading = true; if (!quiet) render();
    var all = [];
    function page(col, fields, pt) {
      return token().then(function (t) {
        var u = base() + col + '?pageSize=300' + fields.map(function (f) { return '&mask.fieldPaths=' + f; }).join('') + (pt ? '&pageToken=' + encodeURIComponent(pt) : '');
        return xhr('GET', u, null, { Authorization: 'Bearer ' + t });
      }).then(function (j) {
        (j && j.documents || []).forEach(function (d) {
          var o = { id: d.name.split('/').pop(), _col: col }, f = d.fields || {};
          Object.keys(f).forEach(function (k) { o[k] = fv(f[k]); });
          if (col === 'wholesale') {          // ใบราคาส่ง → แยก 1 รายการ = 1 งาน (คนละลาย คนละไฟล์) · สถานะ/ไฟล์ของแต่ละรายการเก็บในช่อง stq ของใบนั้น (แอปไม่ใช้ช่องนี้)
            var its = (o.items || []).map(function (it, ix) { return { it: it, ix: ix }; }).filter(function (x) { return x.it && String(x.it.name || '').trim(); });
            var fresh = Date.now() - (o.savedAt || 0) < 7 * 86400000, stq = o.stq || {};
            if (!its.length) its = [{ it: { name: '(ไม่มีรายการ)' }, ix: 0 }];
            its.forEach(function (x, pos) {
              var q = stq['i' + x.ix] || {};
              all.push({ id: o.id + '#' + x.ix, _col: col, _doc: o.id, _idx: x.ix, ws: true, wsN: its.length, wsI: pos + 1, jName: o.buyerName, no: o.ref || '', date: o.date, savedAt: o.savedAt, createdBy: o.createdBy,
                note: o.note, paid: o.paid, items: [x.it], status: q.status || (fresh ? 'pending' : 'shipped'), aiFile: q.aiFile || '', aiFileName: q.aiFileName || '' });   // ใบเก่าที่ยังไม่เคยตั้งสถานะ = ถือว่าส่งแล้ว
            });
            return;
          }
          all.push(o);
        });
        if (j && j.nextPageToken && all.length < 3000) return page(col, fields, j.nextPageToken);
      });
    }
    page('jobs', FIELDS, '').then(function () {
      return page('wholesale', ['ref', 'date', 'buyerName', 'items', 'discount', 'note', 'paid', 'stq', 'savedAt', 'createdBy'], '').catch(function (e) { lastErr = 'ใบราคาส่ง: ' + e.message; });
    }).then(function () { jobs = dedupe(all).concat(localJobs()); if (!/ราคาส่ง/.test(lastErr)) lastErr = ''; loadedAt = Date.now();
      document.dispatchEvent(new CustomEvent('st:qrjobs', {detail:jobs.filter(function(j){return window.STJobQR && STJobQR.eligible(j);}).map(function(j){return {id:j.id,no:j.no,jName:j.jName};})}));
    }, function (e) { lastErr = e.message; })
      .then(function () { loading = false; render(); });
  }
  // รายการในใบราคาส่งที่มีใบคอนเฟิร์มงานของลูกค้าคนเดียวกัน + ชื่องานเดียวกันอยู่แล้ว → ไม่แสดงซ้ำ (ใช้ใบงานแทน)
  function norm(t) { return String(t || '').toLowerCase().replace(/[\s.,:;()\-_/]+/g, ''); }
  function dayOf(j) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(j.date || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : (j.savedAt || 0); }
  function dedupe(list) {
    var have = {}, custDays = {};
    list.forEach(function (j) {
      if (j.ws) return; var c = norm(j.jName);
      (custDays[c] = custDays[c] || []).push(dayOf(j));
      (j.items || []).forEach(function (i) { if (i && i.name) have[c + '|' + norm(i.name)] = true; });
    });
    var hidden = 0;
    var out = list.filter(function (j) {
      if (!j.ws) return true;
      var c = norm(j.jName), name = String(j.items && j.items[0] && j.items[0].name || ''), n = norm(name);
      if (/^\s*(ค่า)?(จัด)?ส่ง|ค่าขนส่ง|ค่าจัดส่ง|ค่าส่ง/.test(name)) { hidden++; return false; }      // ค่าส่ง ไม่ใช่งานผลิต
      if (n && have[c + '|' + n]) { hidden++; return false; }
      // ลูกค้าคนนี้มีใบคอนเฟิร์มงานใกล้วันเดียวกัน (±7 วัน) → ใบราคาส่งเป็นแค่ใบราคา งานจริงอยู่ในใบงานแล้ว
      var d = dayOf(j);
      if ((custDays[c] || []).some(function (x) { return Math.abs(x - d) <= 7 * 86400000; })) { hidden++; return false; }
      return true;
    });
    dupHidden = hidden;
    return out;
  }
  var dupHidden = 0;
  // ใบงานที่เพิ่มเองในแผงนี้ (ไม่ส่งเข้าระบบร้าน ไม่มีเลขใบ) — เก็บในเครื่องนี้เท่านั้น
  var LQK = 'st_qlocal';
  function localJobs() { try { var a = JSON.parse(localStorage.getItem(LQK) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function localSave(a) { try { localStorage.setItem(LQK, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function localSet(id, fields) { var a = localJobs(); a.forEach(function (x) { if (x.id === id) Object.keys(fields).forEach(function (k) { x[k] = fields[k]; }); }); return localSave(a); }
  function lclTag(j) { return j._col === 'local' ? '<span class="cqws lcl" title="เก็บในแผงนี้เท่านั้น ไม่อยู่ในระบบร้าน">เฉพาะแผงนี้</span>' : ''; }
  function addLocal() {
    var cust = $('cqAC').value.trim(), job = $('cqAJ').value.trim(), useFile = $('cqAF').checked;
    (useFile ? host('st_docInfo') : Promise.resolve(null)).then(function (r) {
      var files = [];
      if (r && !r.error && r.path) files.push({ p: r.path, n: String(r.path).split(/[\\/]/).pop() });
      var nm = cust || (files[0] ? files[0].n.replace(/\.[^.]+$/, '') : '');
      if (!nm && !job) return toast('⚠ ใส่ชื่อลูกค้าหรือชื่องาน หรือเปิดไฟล์ไว้ใน Illustrator ก่อน');
      if (useFile && !files.length) toast('ไม่ได้ผูกไฟล์ (' + ((r && r.error) || 'ไฟล์ยังไม่ได้บันทึก') + ') — เพิ่มงานให้แล้ว');
      var now = Date.now(), nj = { id: 'L' + now, _col: 'local', no: '', jName: nm, items: job ? [{ name: job }] : [], status: 'pending', savedAt: now, createdBy: 'แผง',
        aiFiles: files.length ? JSON.stringify(files) : '', aiFile: files[0] ? files[0].p : '', aiFileName: files[0] ? files[0].n : '' };
      var a = localJobs(); a.push(nj);
      if (!localSave(a)) return toast('⚠ บันทึกในแผงไม่ได้');
      jobs.push(nj); $('cqAC').value = ''; $('cqAJ').value = ''; $('cqAdd').open = false;
      if (filter === 'done') { filter = 'open'; [].forEach.call($('cqSeg').children, function (x) { x.classList.toggle('on', x.dataset.v === 'open'); }); }
      render(); toast('✓ เพิ่มงาน ' + nm + ' แล้ว' + (files.length ? ' · ผูกไฟล์ ' + files[0].n : ''));
    });
  }
  function patch(j, fields) {
    if (j._col === 'local') return localSet(j.id, fields) ? Promise.resolve() : Promise.reject(new Error('บันทึกในแผงไม่ได้'));
    if (j._doc) {                        // รายการในใบราคาส่ง → stq.i<ลำดับ>.<ช่อง>
      var key = 'i' + j._idx, inner = {};
      Object.keys(fields).forEach(function (k) { inner[k] = { stringValue: String(fields[k]) }; });
      var bodyW = { fields: { stq: { mapValue: { fields: {} } } } }; bodyW.fields.stq.mapValue.fields[key] = { mapValue: { fields: inner } };
      var maskW = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=stq.' + key + '.' + k; }).join('&');
      return token().then(function (t) { return xhr('PATCH', base() + 'wholesale/' + encodeURIComponent(j._doc) + '?' + maskW + '&currentDocument.exists=true', bodyW, { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }); });
    }
    var mask = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&'), body = { fields: {} };
    Object.keys(fields).forEach(function (k) { var v = fields[k]; body.fields[k] = typeof v === 'number' ? { integerValue: String(Math.round(v)) } : { stringValue: String(v) }; });
    return token().then(function (t) { return xhr('PATCH', base() + (j._col || 'jobs') + '/' + encodeURIComponent(j.id) + '?' + mask + '&currentDocument.exists=true', body, { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }); });
  }

  // ---------- หน้าจอ ----------
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtD(s) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || '')); return m ? +m[3] + ' ' + TH_M[+m[2] - 1] : String(s || ''); }
  function dueTag(j) {
    if (!j.due || j.status === 'shipped') return '';
    var d = String(j.due).slice(0, 10), t = today();
    if (d < t) return '<span class="due late">เลยกำหนด ' + h(fmtD(d)) + '</span>';
    if (d === t) return '<span class="due now">ส่งวันนี้</span>';
    return '<span class="due">ส่ง ' + h(fmtD(d)) + '</span>';
  }
  function build() {
    var pane = $('tab-queue');
    pane.innerHTML =
      '<div class="qsum" id="cqSum"></div>' +
      '<div class="seg" id="cqSeg"><button data-v="open" class="on">ยังไม่ส่ง</button><button data-v="done">จัดส่งแล้ว</button><button data-v="all">ทั้งหมด</button></div>' +
      '<div class="cqbar"><input id="cqQ" type="text" placeholder="ค้นหา ชื่อลูกค้า / เลขใบ / งาน"><button class="btn ghost sm" id="cqCmp" title="ย่อ/ขยายรายการ">▤ ย่อ</button><button class="btn ghost sm" id="cqRe">รีเฟรช</button></div>' +
      '<details class="card" id="cqAdd"><summary><b>+ เพิ่มงานเอง</b> <span class="mut">ไม่ต้องคีย์ในระบบ · เก็บในแผงนี้</span></summary>' +
        '<div class="grid"><label>ลูกค้า<input id="cqAC" type="text" placeholder="เว้นว่าง = ใช้ชื่อไฟล์"></label><label>งาน / ขนาด × จำนวน<input id="cqAJ" type="text" placeholder="เช่น สะท้อนแสง 50cm × 6"></label></div>' +
        '<label class="chk"><input type="checkbox" id="cqAF" checked> ผูกไฟล์ที่เปิดอยู่ใน Illustrator</label>' +
        '<button class="btn" id="cqAddGo">เพิ่มเข้าคิว</button></details>' +
      '<div id="cqList" class="qlist"></div>' +
      '<div class="hint" id="cqHint"></div>';
    $('cqSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call($('cqSeg').children, function (x) { x.classList.toggle('on', x === b); }); filter = b.dataset.v; render(); });
    $('cqQ').addEventListener('input', function () { q = this.value.trim().toLowerCase(); render(); });
    try { compact = localStorage.getItem('st_cq_compact') === '1'; } catch (e) {}
    function paintCmp() { var b = $('cqCmp'); if (b) { b.textContent = compact ? '▦ ขยาย' : '▤ ย่อ'; b.classList.toggle('on', compact); } }
    paintCmp();
    $('cqCmp').onclick = function () { compact = !compact; try { localStorage.setItem('st_cq_compact', compact ? '1' : '0'); } catch (e) {} paintCmp(); render(); };
    $('cqRe').onclick = function () { load(); };
    $('cqAddGo').onclick = addLocal;
    $('cqList').addEventListener('click', onClick);
    $('cqList').addEventListener('change', onChange);
  }
  // เวลาที่สร้างใบ: id ของใบเป็น 'j'/'w' + เวลา (ms) ตอนสร้าง · ไม่มี → ใช้วันที่สั่งงาน/เวลาบันทึก
  function bornOf(j) {
    var m = /^[a-z]+(\d{12,14})/i.exec(String(j._doc || j.id || ''));
    return m ? +m[1] : (dayOf(j) || j.savedAt || 0);
  }
  function render() {
    if (!$('cqList')) return;
    setTimeout(refreshDetail, 0);
    var t = today(), c = { pending: 0, filed: 0, printed: 0 }, late = 0;
    jobs.forEach(function (j) { var s = j.status || 'pending'; if (c[s] != null) c[s]++; if (s !== 'shipped' && j.due && String(j.due).slice(0, 10) < t) late++; });
    $('cqSum').innerHTML = ['pending', 'filed', 'printed'].map(function (s) { return '<div class="qs ' + s + '"><b>' + c[s] + '</b><span>' + SN[s] + '</span></div>'; }).join('') +
      '<div class="qs late' + (late ? ' on' : '') + '"><b>' + late + '</b><span>เลยกำหนด</span></div>';
    var list = jobs.filter(function (j) {
      var s = j.status || 'pending';
      if (filter === 'open' && s === 'shipped') return false;
      if (filter === 'done' && s !== 'shipped') return false;
      if (!q) return true;
      var txt = [j.no, j.jName, j.jPhone, j.note].concat((j.items || []).map(function (i) { return i && i.name; })).join(' ').toLowerCase();
      return txt.indexOf(q) >= 0;
    });
    list.sort(function (a, b) {
      if ((a._col === 'local') !== (b._col === 'local')) return a._col === 'local' ? -1 : 1;   // ใบที่เพิ่มเองในแผงอยู่บนสุด เห็นทันที
      if (filter !== 'open') return (b.savedAt || 0) - (a.savedAt || 0);
      return bornOf(a) - bornOf(b);      // ยังไม่ส่ง: ใบที่เข้ามาก่อนอยู่บน ใบหลังอยู่ล่าง (เวลาสร้างใบ ไม่ใช่เวลาที่แก้ล่าสุด)
    });
    var shown = list.slice(0, 150);
    $('cqList').innerHTML = loading && !jobs.length ? '<div class="qempty">กำลังโหลดคิวจากแอปร้าน…</div>' : shown.length ? shown.map(function (j) {
      var s = j.status || 'pending', its = (j.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
      var thumb = (j.photos || []).filter(function (p) { return /^https:/.test(p); })[0];
      if (compact) {   // มุมมองย่อ: 2 บรรทัดต่อใบ · แตะเพื่อเปิดหน้าต่างรายละเอียด
        var firstIt = its[0] ? h(its[0].name) + (its[0].qty ? ' × ' + h(its[0].qty) : '') + (its.length > 1 ? ' <i>+' + (its.length - 1) + '</i>' : '') : '';
        return '<div class="qjob cq cmp" data-id="' + h(j.id) + '"><div class="cmp1"><span class="cqst ' + s + '">' + SN[s] + '</span><b>' + h(j.jName || '(ไม่ระบุลูกค้า)') + '</b>' + dueTag(j) + cutChip(j) + lclTag(j) + '</div>' +
          '<div class="cmp2"><span class="mut">' + h(j.no || (j.ws && j.date ? fmtD(j.date) : '')) + '</span>' + (j.ws ? '<span class="cqws">ราคาส่ง</span>' : '') + '<span class="cmpit">' + firstIt + '</span>' + (filesOf(j).length ? '<span title="ผูกไฟล์แล้ว">📄</span>' : '') + '</div></div>';
      }
      return '<div class="qjob cq" data-id="' + h(j.id) + '">' +
        '<div class="qtop"><select class="cqst ' + s + '" data-act="st">' + ST.map(function (k) { return '<option value="' + k + '"' + (k === s ? ' selected' : '') + '>' + SN[k] + '</option>'; }).join('') + '</select>' +
          '<span class="mut">' + h(j.no || (j.ws && j.date ? fmtD(j.date) : '')) + '</span>' + (j.ws ? '<span class="cqws">ราคาส่ง' + (j.wsN > 1 ? ' ' + j.wsI + '/' + j.wsN : '') + '</span>' : '') + dueTag(j) + cutChip(j) + lclTag(j) + '</div>' +
        '<div class="cqrow">' + (thumb ? '<img class="cqth" src="' + h(thumb) + '" alt="">' : '') +
          '<div><div class="qmain"><b>' + h(j.jName || '(ไม่ระบุลูกค้า)') + '</b></div>' +
          '<div class="qsub">' + (its.length ? its.slice(0, openIds[j.id] ? 99 : 3).map(function (i) { return h(i.name) + (i.qty ? ' × ' + h(i.qty) : ''); }).join('<br>') + (!openIds[j.id] && its.length > 3 ? '<br><a href="#" data-act="more">+ อีก ' + (its.length - 3) + ' รายการ</a>' : '') : '—') + '</div>' +
          (j.note && openIds[j.id] ? '<div class="qsub">📝 ' + h(j.note) + '</div>' : '') +
          foldFiles(j) + '</div></div>' +
        '<div class="qact">' +
          '<button class="btn ghost sm" data-act="link">' + linkLabel(j) + '</button>' +
          (s === 'pending' ? '<button class="btn sm" data-act="filed">✓ ทำไฟล์แล้ว</button>' : '') + '</div></div>';
    }).join('') : '<div class="qempty">' + (q ? 'ไม่พบงานที่ค้นหา' : filter === 'done' ? 'ยังไม่มีงานที่จัดส่ง' : 'ไม่มีงานค้าง 🎉') + '</div>';
    $('cqHint').textContent = lastErr ? '⚠ โหลดคิวไม่ได้: ' + lastErr : (loadedAt ? 'เชื่อมแอปร้าน · ' + jobs.length + ' ใบ · อัปเดต ' + new Date(loadedAt).toTimeString().slice(0, 5) + (list.length > shown.length ? ' · แสดง 150 ใบแรก (ใช้ค้นหา)' : '') + (dupHidden ? ' · ซ่อนราคาส่งที่ซ้ำกับใบงาน ' + dupHidden + ' รายการ' : '') : '');
  }
  // ไฟล์ที่ผูกกับใบงาน: เก็บเป็น JSON ในช่อง aiFiles (หลายไฟล์) · ช่องเดิม aiFile/aiFileName = ไฟล์แรก (ให้ใบงานเก่ายังใช้ได้)
  function filesOf(j) {
    var a = [];
    try { a = JSON.parse(j.aiFiles || '[]'); } catch (e) { a = []; }
    a = (Array.isArray(a) ? a : []).filter(function (f) { return f && f.p; });
    if (!a.length && j.aiFile) a = [{ p: j.aiFile, n: j.aiFileName || String(j.aiFile).split(/[\\/]/).pop() }];
    return a;
  }
  // ---------- รอตัด: สแกนเส้นตัดเก็บไว้ในแผงนี้ก่อน แล้วค่อยกด "ตัด" ตอนแผ่นขึ้นเครื่อง (ไม่พึ่งให้ Graphtec ถืองาน) ----------
  var CQK = 'st_cutq';
  function cqAll() { try { var d = JSON.parse(localStorage.getItem(CQK) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; } }
  function cqSaveAll(d) { try { localStorage.setItem(CQK, JSON.stringify(d)); return true; } catch (e) { return false; } }
  var REMOTE_SHEETS='st_remote_sheets_v1';
  function remoteSheets(){try {var a=JSON.parse(localStorage.getItem(REMOTE_SHEETS)||'[]');return Array.isArray(a)?a:[];}catch(e){return [];}}
  function archiveRemote(q){
    var c=window.ST_core,meta;
    if(!c||!c.hash||!q.scanVerified||!q.snap||q.snap.src!=='cut'||!q.mtime)return;
    try{meta=JSON.parse(q.snap.jobNote||'');}catch(e){return;}
    if(meta.kind!=='st-job-qr'||meta.jobId!==q.jid||!Number.isInteger(meta.sheet)||!Number.isInteger(meta.total)||meta.sheet<1||meta.sheet>meta.total)return;
    q.rid=c.hash(JSON.stringify([q.jid,q.p,q.mtime,q.savedAt,q.snap]));q.sheet=meta.sheet;q.total=meta.total;
    var a=remoteSheets().filter(function(x){return !(x.jid===q.jid&&x.p===q.p&&x.sheet===q.sheet);});a.unshift(q);
    try{localStorage.setItem(REMOTE_SHEETS,JSON.stringify(a.slice(0,200)));}catch(e){toast('พื้นที่เก็บแผ่นมือถือเต็ม สแกนไฟล์ได้แต่ยังส่งจากมือถือไม่ได้');}
  }
  function remoteEntries(){
    return remoteSheets().filter(function(q){
      var j=jobs.filter(function(j){return j.id===q.jid&&window.STJobQR&&STJobQR.eligible(j);})[0];
      if(!j||!q.rid||!q.scanVerified||!q.snap||q.snap.src!=='cut'||!q.snap.n||!q.snap.marks||[1,7].indexOf(q.snap.marks.style)<0)return false;
      if(!filesOf(j).some(function(f){return f.p===q.p;}))return false;
      var mt=fileMtime(q.p);return !!(mt&&q.mtime&&Math.abs(mt-q.mtime)<1);
    }).slice(0,100);
  }
  window.ST_queueRemote={
    catalog:function(){return remoteEntries().map(function(q){
      var j=jobs.filter(function(x){return x.id===q.jid;})[0]||{},m=q.snap&&q.snap.marks||{},kinds={kiss:0,die:0};
      ((q.snap&&q.snap.paths)||[]).forEach(function(p){kinds[p.k==='die'?'die':'kiss']++;});
      var cl=function(s,n){return String(s==null?'':s).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);};
      var items=(j.items||[]).filter(function(i){return i&&cl(i.name,1);}).slice(0,6).map(function(i){return cl(i.name,100)+(i.qty?' × '+cl(i.qty,16):'');});
      var wd=Math.round(m.dy*10)/10,ht=Math.round(m.dx*10)/10;
      return{id:q.rid,job:q.jid,no:q.no,name:String(q.n||q.p).split(/[\\/]/).pop().slice(0,180),sheet:q.sheet,total:q.total,thumb:q.thumb&&q.thumb.length<=60000?q.thumb:'',
        cust:cl(j.jName||q.jName,120),items:items,kinds:kinds,w:wd>0&&wd<100000?wd:0,h:ht>0&&ht<100000?ht:0};});},
    prepare:function(ref,machine,drv){
      var q=remoteEntries().filter(function(q){return q.rid===ref;})[0];
      if(!q)throw new Error('ไฟล์เปลี่ยน ถูกยกเลิกการผูก หรือยังไม่ได้สแกนแผ่นนี้ใหม่');
      return window.ST_cutApi.remotePrepare(machine,q.snap,{key:q.jid+'|'+q.p},drv);
    }
  };
  function cqKey(j, f) { return j.id + '|' + f.p; }
  function cqGet(j, f) { return cqAll()[cqKey(j, f)] || null; }
  function cqTime(t) { var d = new Date(t); return d.toTimeString().slice(0, 5) + (new Date().toDateString() === d.toDateString() ? '' : ' ' + d.getDate() + '/' + (d.getMonth() + 1)); }
  function fileMtime(path) {   // เวลาแก้ไขไฟล์ล่าสุดบนดิสก์ (null = อ่านไม่ได้ เช่น ไดรฟ์เครือข่ายไม่ตอบ)
    try { var R = window.cep_node && window.cep_node.require; if (!R) return null; return R('fs').statSync(path).mtimeMs || null; } catch (e) { return null; }
  }
  // สรุปบนหัวใบงาน: กี่ไฟล์ที่ส่งตัดเข้าเครื่องแล้ว / กี่ไฟล์ที่สแกนไว้รอตัด ("ส่งตัดแล้ว" = ส่งข้อมูลเข้าเครื่องสำเร็จ แผงรู้ไม่ได้ว่าเครื่องตัดเสร็จจริงหรือยัง)
  function cutChip(j) {
    var fs = filesOf(j), all = cqAll(), sent = 0, wait = 0;
    fs.forEach(function (f) { var q = all[cqKey(j, f)]; if (q) { if (q.sentAt) sent++; else wait++; } });
    if (!sent && !wait) return '';
    return '<span class="cqchip' + (sent && sent === fs.length ? ' done' : '') + '">' + (sent ? '✅ ส่งตัดแล้ว ' + sent + '/' + fs.length : '') + (sent && wait ? ' · ' : '') + (wait ? '⏳ รอตัด ' + wait : '') + '</span>';
  }
  // รูปพรีวิวเล็กของไฟล์: ให้ Illustrator ส่งออก PNG ชั่วคราว → ย่อเหลือ ~160px ด้วย canvas → เก็บเป็น data URL (ล้มเหลวก็ไม่มีรูป ไม่กระทบการสแกน)
  function makeThumb(captured) {
    return (captured ? Promise.resolve(captured) : host('st_thumb')).then(function (r) {
      if (!r || r.error || !r.path) return '';
      var R = window.cep_node && window.cep_node.require; if (!R) return '';
      var fs = R('fs'), b64 = '';
      try { b64 = fs.readFileSync(r.path).toString('base64'); } catch (e) { return ''; }
      try { fs.unlinkSync(r.path); } catch (e2) {}
      return new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () {
          try {
            var m = Math.max(im.naturalWidth, im.naturalHeight, 1), k = Math.min(1, 160 / m), cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
            var u = cv.toDataURL('image/png'); resolve(u.length < 120000 ? u : cv.toDataURL('image/jpeg', 0.8));
          } catch (e3) { resolve(''); }
        };
        im.onerror = function () { resolve(''); };
        im.src = 'data:image/png;base64,' + b64;
      });
    }).catch(function () { return ''; });
  }
  // ยุบ/ขยายรายการไฟล์ในการ์ดใบงาน: ค่าเริ่มต้น = ใบที่มี 2 ไฟล์ขึ้นไปยุบไว้ · กดหัวข้อเพื่อสลับ (จำต่อใบ)
  var FOLDK = 'st_cq_fold';
  function foldMap() { try { var d = JSON.parse(localStorage.getItem(FOLDK) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; } }
  function isFolded(j) { var m = foldMap(), v = m[j.id]; return v == null ? filesOf(j).length >= 2 : !!v; }
  function foldFiles(j) {
    var fs = filesOf(j); if (!fs.length) return '';
    var folded = isFolded(j), all = cqAll(), sent = 0, wait = 0, none = 0;
    fs.forEach(function (f) { var q = all[cqKey(j, f)]; if (!q) none++; else if (q.sentAt) sent++; else wait++; });
    var sum = [sent ? '<i class="s">✅ ' + sent + '</i>' : '', wait ? '<i class="w">⏳ ' + wait + '</i>' : '', none ? '<i class="n">ยังไม่สแกน ' + none + '</i>' : ''].filter(Boolean).join(' ');
    return '<button type="button" class="cqfold" data-act="fold" aria-expanded="' + (!folded) + '"><span>📄 ไฟล์งาน ' + fs.length + ' ไฟล์</span><span class="cqfs">' + sum + '</span><span class="cqch">' + (folded ? '▾' : '▴') + '</span></button>' + (folded ? '' : fileBlock(j, false));
  }
  function fileBlock(j, withRemove) {
    var fs = filesOf(j);
    if (!fs.length) return '';
    return '<div class="cqfiles">' + fs.map(function (f, i) {
      var cq = cqGet(j, f), key = cqKey(j, f), nm = f.n || String(f.p).split(/[\\/]/).pop(), st = cq ? (cq.sentAt ? 'sent' : 'wait') : 'none', ar = armed === key;
      var th = cq && cq.thumb ? '<img class="cqth3" data-act="cutprev" data-i="' + i + '" src="' + h(cq.thumb) + '" alt="">' : '<div class="cqth3 ph">' + (/\.eps$/i.test(nm) ? 'EPS' : /\.pdf$/i.test(nm) ? 'PDF' : 'AI') + '</div>';
      var badge = st === 'sent' ? '<span class="cqbd sent">✅ ส่งตัดแล้ว ' + h(cqTime(cq.sentAt)) + '</span>' : st === 'wait' ? '<span class="cqbd wait">⏳ รอตัด</span>' : '<span class="cqbd none">ยังไม่สแกน</span>';
      var meta = cq ? '<span class="cqmeta">สแกน ' + h(cqTime(cq.savedAt)) + ' · ' + h(cq.snap && cq.snap.n || 0) + ' เส้น</span>' : '';
      var acts = (cq ? '<button class="btn sm cqmain' + (ar ? ' arm' : '') + '" data-act="cutnow" data-i="' + i + '">' + (ar ? 'กดอีกครั้งเพื่อตัด' : cq.sentAt ? '✂ ตัดอีกครั้ง' : '✂ ตัด') + '</button>' +
          '<button class="btn ghost sm" data-act="cutprev" data-i="' + i + '">👁 พรีวิว</button>' +
          '<button class="btn ghost sm" data-act="scan" data-i="' + i + '">↻ สแกนใหม่</button>'
        : '<button class="btn sm cqmain scan" data-act="scan" data-i="' + i + '">✂ สแกนตัด</button>') +
        '<button class="btn ghost sm" data-act="open" data-i="' + i + '">เปิด</button>' +
        (cq ? '<button class="btn ghost sm cqx" data-act="cutdrop" data-i="' + i + '" title="ล้างรายการรอตัด" aria-label="ล้างรายการรอตัด">✕</button>' : '');
      return '<div class="cqfc ' + st + '">' + th + '<div class="cqfb"><div class="cqfnm" title="' + h(f.p) + '">' + h(nm) + '</div>' +
        '<div class="cqfst">' + badge + meta + '</div><div class="cqfa">' + acts + '</div></div>' +
        (withRemove ? '<button class="cqunl" data-act="unlink" data-i="' + i + '" title="เอาไฟล์นี้ออกจากใบงาน" aria-label="เอาไฟล์นี้ออกจากใบงาน">✕</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function linkLabel(j) { return filesOf(j).length ? '+ ผูกไฟล์เพิ่ม' : 'ผูกไฟล์ที่เปิดอยู่'; }
  function saveFiles(j, arr) {
    var first = arr[0] || null;
    return patch(j, { aiFiles: JSON.stringify(arr), aiFile: first ? first.p : '', aiFileName: first ? first.n : '' }).then(function () {
      j.aiFiles = JSON.stringify(arr); j.aiFile = first ? first.p : ''; j.aiFileName = first ? first.n : '';
    });
  }
  function find(el) { var c = el.closest('.qjob'); if (!c) return null; var id = c.dataset.id; return jobs.filter(function (x) { return x.id === id; })[0] || null; }
  function setStatus(j, s) {
    var old = j.status; j.status = s; render();
    patch(j, { status: s }).then(function () { toast('✓ ' + (j.jName || j.no || 'งาน') + ' → ' + SN[s]); }, function (e) { j.status = old; render(); toast('⚠ อัปเดตไม่ได้: ' + e.message); });
  }
  function onChange(e) { var t = e.target; if (t.dataset.act !== 'st') return; var j = find(t); if (j) setStatus(j, t.value); }
  function openUrl(u) { try { if (window.cep && window.cep.util) return window.cep.util.openURLInDefaultBrowser(u); } catch (e) {} window.open(u); }
  function onClick(e) {
    if(window.ST_remoteBusy)return toast('กำลังจัดการคำสั่งจากมือถือ กรุณารอสักครู่');
    var b = e.target.closest('[data-act]');
    if (!b) { var card = e.target.closest('#cqList .qjob'); if (card) { var jj = find(card); if (jj) showDetail(jj); } return; }
    if (b.tagName === 'SELECT') return;
    var j = find(b); if (!j) return; e.preventDefault();
    var a = b.dataset.act;
    if (a === 'more') showDetail(j);
    else if (a === 'close') hideDetail();
    else if (a === 'img') openUrl(b.dataset.src);
    else if (a === 'copy') { try { navigator.clipboard.writeText(b.dataset.t); toast('✓ คัดลอกแล้ว'); } catch (ec) { toast(b.dataset.t); } }
    else if (a === 'fold') { var fm = foldMap(); fm[j.id] = !isFolded(j); try { localStorage.setItem(FOLDK, JSON.stringify(fm)); } catch (ef) {} render(); }
    else if (a === 'filed') setStatus(j, 'filed');
    else if (a === 'jobqr') {
      if (!window.STJobQR || !STJobQR.eligible(j) || !window.__stk || !window.__stk.selectJob) return toast('เลือกใบงานจากแอปร้านก่อน');
      if (!window.__stk.selectJob(j.id)) return toast('โหลดคิวงานใหม่ก่อน');
      hideDetail(); var stkTab = document.querySelector('.tab[data-tab="stk"]'); if (stkTab) stkTab.click();
      toast('เลือก QR ใบงาน ' + j.no + ' แล้ว · ตรวจชื่อก่อนสร้างแผ่น');
    }
    else if (a === 'ldel') {         // ลบใบที่เพิ่มเองในแผง (2 ครั้ง) · ลบรายการรอตัดของใบนั้นด้วย · ไม่ลบไฟล์จริง
      if (armed !== 'L:' + j.id) { armed = 'L:' + j.id; clearTimeout(armT); armT = setTimeout(function () { armed = ''; refreshDetail(); }, 4000); b.textContent = 'กดอีกครั้งเพื่อลบ'; return; }
      armed = ''; clearTimeout(armT); localSave(localJobs().filter(function (x) { return x.id !== j.id; }));
      var qa = cqAll(); Object.keys(qa).forEach(function (k) { if (k.indexOf(j.id + '|') === 0) delete qa[k]; }); cqSaveAll(qa);
      jobs = jobs.filter(function (x) { return x.id !== j.id; }); hideDetail(); render(); toast('✓ ลบงาน ' + (j.jName || '') + ' แล้ว (ไม่ได้ลบไฟล์จริง)');
    }
    else if (a === 'scan') {         // เปิดไฟล์ → อ่านเส้นตัด → เก็บเข้า "รอตัด" (ยังไม่ส่งเครื่อง)
      var cf = filesOf(j)[+b.dataset.i || 0]; if (!cf) return toast('⚠ ไม่พบไฟล์ที่ผูกไว้');
      if (!window.ST_cutApi) return toast('⚠ หน้าส่งตัดยังไม่พร้อม');
      toast('กำลังเปิดไฟล์และสแกนเส้นตัด…');
      host('st_openFile', cf.p).then(function (r) {
        if (r.error) return toast('⚠ ' + r.error);
        var before=fileMtime(cf.p),capture=!!window.ST_cutApi.snapshot;
        var read=capture?window.ST_cutApi.snapshot(cf.p):window.ST_cutApi.read();
        return read.then(function (packet) {
          if(packet.error)return toast('⚠ '+packet.error);
          var rd=capture?packet.read:packet;
          if (rd.error) return toast('⚠ ' + rd.error);
          if (!rd.n) return toast('⚠ ไม่พบเส้นตัด (Kiss Cut / Die Cut) ในไฟล์นี้');
          return Promise.all([capture?Promise.resolve(packet.mark):window.ST_cutApi.markCheck(), makeThumb(capture?packet.thumb:null)]).then(function (pair) {
            var mv = pair[0], thumb = pair[1];   // จุดมาร์คทุกจุด + artboard ไว้วาดพรีวิว (ไม่มีมาร์คก็ได้)
            var after=fileMtime(cf.p);
            if(before&&after&&Math.abs(before-after)>=1)return toast('⚠ ไฟล์ถูกแก้ระหว่างสแกน กรุณาบันทึกและสแกนใหม่');
            if(capture&&(!packet.scan||packet.scan.path!==cf.p))return toast('⚠ ไฟล์ที่สแกนไม่ตรงกับไฟล์ที่ผูกไว้');
            var verified=!!(capture&&before&&after&&Math.abs(before-after)<1);
            var view = (mv && !mv.error && mv.why === 'ok' && mv.marks && mv.marks.length) ? { ab: mv.ab, marks: mv.marks } : null;
            if(!thumb){try{var cv=document.createElement('canvas');cv.width=240;cv.height=320;drawPrev(cv,{snap:rd,view:view});thumb=cv.toDataURL('image/png');if(thumb.length>60000)thumb=cv.toDataURL('image/jpeg',0.7);}catch(eth){thumb='';}}
            var all = cqAll();
            all[cqKey(j, cf)] = { jid: j.id, p: cf.p, n: cf.n || '', no: j.no || '', jName: j.jName || '', savedAt: Date.now(), mtime: verified?after:null, scanVerified:verified, snap: rd, view: view, thumb: thumb || '', viewNote: view ? '' : String(mv && (mv.error || mv.why) || 'no-reply') };
            if (!cqSaveAll(all)) return toast('⚠ เก็บไม่ได้ (พื้นที่เก็บของแผงเต็ม) — ลบรายการรอตัดเก่าออกก่อน');
            archiveRemote(all[cqKey(j,cf)]);
            render(); refreshDetail();
            toast('✓ สแกนแล้ว ' + rd.n + ' เส้น' + (rd.marks ? ' + มาร์ค' : ' (ไม่พบมาร์ค)') + ' — เก็บไว้ในรอตัด');
          });
        });
      });
    }
    else if (a === 'cutprev') {      // ป็อบอัพพรีวิวเส้นตัด + มาร์ค (ส่งตัดจากในป็อบอัพได้เลย)
      var pf = filesOf(j)[+b.dataset.i || 0]; if (!pf) return;
      var pq = cqGet(j, pf); if (!pq) return toast('⚠ ยังไม่ได้สแกน');
      showPrev(j, pf, pq);
    }
    else if (a === 'cutnow') {       // ตัดเลย: กด 2 ครั้งยืนยัน → ส่งเข้าเครื่องจากคิว ไม่ต้องไปหน้าส่งตัด
      var nf = filesOf(j)[+b.dataset.i || 0]; if (!nf) return toast('⚠ ไม่พบไฟล์ที่ผูกไว้');
      var nk = cqKey(j, nf), cq = cqGet(j, nf); if (!cq) return toast('⚠ ยังไม่ได้สแกน');
      if (armed !== nk) { armed = nk; clearTimeout(armT); armT = setTimeout(function () { armed = ''; render(); refreshDetail(); }, 4000); render(); refreshDetail(); return; }
      armed = ''; clearTimeout(armT); render(); refreshDetail();
      doCut(j, nf, cq).then(function (r) { toast('✓ ส่งตัดแล้ว ' + r.lines + ' เส้น → ' + r.ip); }, function (er) { toast('⚠ ' + er.message); });
    }
    else if (a === 'cutdrop') {
      var df = filesOf(j)[+b.dataset.i || 0]; if (!df) return;
      var al = cqAll(); delete al[cqKey(j, df)]; cqSaveAll(al);
      try{localStorage.setItem(REMOTE_SHEETS,JSON.stringify(remoteSheets().filter(function(q){return !(q.jid===j.id&&q.p===df.p);})));}catch(er){}
      render(); refreshDetail(); toast('ลบรายการรอตัดแล้ว');
    }
    else if (a === 'open') { var of = filesOf(j)[+b.dataset.i || 0]; if (!of) return toast('⚠ ไม่พบไฟล์ที่ผูกไว้'); host('st_openFile', of.p).then(function (r) { toast(r.error ? '⚠ ' + r.error : '✓ ' + r.msg); }); }
    else if (a === 'unlink') {
      var ul = filesOf(j), ui = +b.dataset.i, gone = ul[ui]; if (!gone) return;
      ul.splice(ui, 1);
      saveFiles(j, ul).then(function () { render(); refreshDetail(); toast('✓ เอาไฟล์ ' + (gone.n || '') + ' ออกจาก ' + (j.no || 'ใบงาน') + ' แล้ว (ไม่ได้ลบไฟล์จริง)'); }, function (er) { toast('⚠ ' + er.message); });
    }
    else if (a === 'link') host('st_docInfo').then(function (r) {
      if (r.error) return toast('⚠ ' + r.error);
      if (!r.path) return toast('⚠ บันทึกไฟล์ก่อน แล้วค่อยผูกกับใบงาน');
      var nm = r.path.split(/[\\/]/).pop(), cur = filesOf(j);
      if (cur.some(function (f) { return f.p === r.path; })) return toast('ไฟล์ ' + nm + ' ผูกกับใบงานนี้อยู่แล้ว');
      cur.push({ p: r.path, n: nm });
      saveFiles(j, cur).then(function () { render(); refreshDetail(); toast('✓ ผูกไฟล์ ' + nm + ' กับ ' + (j.no || 'ใบงาน') + ' (รวม ' + cur.length + ' ไฟล์)'); }, function (er) { toast('⚠ ' + er.message); });
    });
  }

  // ---------- รายละเอียดใบงาน (เด้งขึ้นเมื่อคลิกที่งาน) ----------
  var detailId = null;
  function thFull(s) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || '')); return m ? +m[3] + ' ' + TH_M[+m[2] - 1] + ' ' + (+m[1] + 543) : h(s); }
  function money(n) { return (Math.round(n * 100) / 100).toLocaleString('th-TH'); }
  function showDetail(j) {
    detailId = j.id;
    var M = $('cqModal');
    if (!M) {
      M = document.createElement('div'); M.id = 'cqModal'; M.className = 'cqmodal';
      M.addEventListener('click', function (e) { if (e.target === M) hideDetail(); else onClick(e); });
      M.addEventListener('change', onChange);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && detailId) { e.stopPropagation(); hideDetail(); } }, true);
      document.body.appendChild(M);
    }
    var s = j.status || 'pending', its = (j.items || []).filter(function (i) { return i && String(i.name || '').trim(); });
    var ph = (j.photos || []).filter(function (p) { return /^https:/.test(p); });
    var tel = String(j.jPhone || '').trim();
    M.innerHTML = '<div class="qjob cqbox" data-id="' + h(j.id) + '">' +
      '<div class="cqhead"><b>' + h(j.no || (j.ws ? 'ใบราคาส่ง ' + fmtD(j.date) : 'ใบงาน')) + (j.ws ? ' <span class="cqws">ราคาส่ง</span> <span class="mut">' + (j.paid ? 'ชำระแล้ว' : 'รอชำระ') + '</span>' : '') + '</b><button class="btn ghost sm" data-act="close">✕</button></div>' +
      '<div class="qtop"><select class="cqst ' + s + '" data-act="st">' + ST.map(function (k) { return '<option value="' + k + '"' + (k === s ? ' selected' : '') + '>' + SN[k] + '</option>'; }).join('') + '</select>' + dueTag(j) + cutChip(j) + lclTag(j) + '</div>' +
      '<div class="cqk">ลูกค้า</div><div class="cqv"><b>' + h(j.jName || '(ไม่ระบุ)') + '</b>' +
        (tel ? ' · ' + h(tel) + ' <a href="#" data-act="copy" data-t="' + h(tel) + '">คัดลอก</a>' : '') +
        (j.jAddr ? '<div class="mut">' + h(j.jAddr).replace(/\n/g, '<br>') + '</div>' : '') + '</div>' +
      '<div class="cqk">รายการงาน</div><div class="cqv">' + (its.length ? '<ol>' + its.map(function (i) {
          return '<li><b>' + h(i.name) + '</b>' + (i.qty ? ' × ' + h(i.qty) : '') + (j.ws && i.price ? ' <span class="mut">@ ' + h(i.price) + ' = ' + money((+i.qty || 0) * (+i.price || 0)) + ' บาท</span>' : '') + (i.note && String(i.note).trim() ? ' <span class="mut">(' + h(i.note) + ')</span>' : '') + '</li>';
        }).join('') + '</ol>' : '—') + '</div>' +
      (j.ws ? (function () { var t = (j.items || []).reduce(function (a2, i) { return a2 + (+i.qty || 0) * (+i.price || 0); }, 0) - (+j.discount || 0); return '<div class="cqv"><b>รวม ' + money(t) + ' บาท</b>' + (+j.discount ? ' <span class="mut">(ส่วนลด ' + money(+j.discount) + ')</span>' : '') + '</div>'; })() : '') +
      (j.note && String(j.note).trim() ? '<div class="cqk">หมายเหตุ</div><div class="cqv cqnote">' + h(j.note).replace(/\n/g, '<br>') + '</div>' : '') +
      (j.due ? '<div class="cqk">กำหนดส่ง</div><div class="cqv">' + thFull(j.due) + '</div>' : '') +
      (filesOf(j).length ? '<div class="cqk">ไฟล์งาน (' + filesOf(j).length + ')</div>' + fileBlock(j, true) : '') +
      (ph.length ? '<div class="cqk">รูปอ้างอิง</div><div class="cqph">' + ph.map(function (p) { return '<img src="' + h(p) + '" data-act="img" data-src="' + h(p) + '" alt="">'; }).join('') + '</div>' : '') +
      '<div class="cqv mut small">' + [j.date ? 'วันที่ ' + thFull(j.date) : '', j.createdBy ? 'โดย ' + h(j.createdBy) : ''].filter(Boolean).join(' · ') + '</div>' +
      '<div class="qact">' +
        (window.STJobQR && STJobQR.eligible(j) ? '<button class="btn ghost sm" data-act="jobqr">QR ใบงาน → เรียงไฟล์</button>' : '') +
        '<button class="btn ghost sm" data-act="link">' + linkLabel(j) + '</button>' +
        (s === 'pending' ? '<button class="btn sm" data-act="filed">✓ ทำไฟล์แล้ว</button>' : '') +
        (j._col === 'local' ? '<button class="btn ghost sm" data-act="ldel">🗑 ลบงานนี้</button>' : '') + '</div></div>';
    M.classList.add('show');
  }
  function hideDetail() { detailId = null; var M = $('cqModal'); if (M) M.classList.remove('show'); }
  function refreshDetail() { if (!detailId) return; var j = jobs.filter(function (x) { return x.id === detailId; })[0]; if (j) showDetail(j); else hideDetail(); }

  var armed = '', armT = 0;
  // โหลดเส้นที่สแกนไว้เข้าตัวส่งตัด (เช็กไฟล์เปลี่ยน) แล้วส่งเข้าเครื่อง
  function doCut(j, f, cq) {
    var mt = fileMtime(f.p);
    if (mt && cq.mtime && Math.abs(mt - cq.mtime) > 1500) return Promise.reject(new Error('ไฟล์ถูกแก้/บันทึกหลังสแกน (' + cqTime(cq.savedAt) + ') — กด "สแกนใหม่" ก่อนตัด'));
    window.ST_cutApi.load(cq.snap, { key: cqKey(j, f) });
    var inf = window.ST_cutApi.info();
    if (!inf.ok) return Promise.reject(new Error(inf.blocked ? 'มาร์คแบบนี้ยังส่งตัดจากแผงไม่ได้ — ใช้ Cutting Master' : 'ไม่มีเส้นให้ตัด'));
    return window.ST_cutApi.send();
  }
  // ---------- ป็อบอัพพรีวิว ----------
  var COLK = { kiss: '#ff4fa3', die: '#2fd27a' };
  function drawPrev(cv, cq) {
    var g = cv.getContext('2d'), pad = 14, paths = (cq.snap && cq.snap.paths) || [], v = cq.view;
    var xs = [], ys = [];
    paths.forEach(function (pt) { var a = pt.p || []; for (var i = 0; i + 1 < a.length; i += 6) { xs.push(a[i]); ys.push(a[i + 1]); } });
    if (v) { xs.push(v.ab[0], v.ab[2]); ys.push(v.ab[1], v.ab[3]); v.marks.forEach(function (m) { xs.push(m[0]); ys.push(m[1]); }); }
    var est = (!v && cq.snap && cq.snap.marks) ? estMarks(cq.snap.marks) : null;   // สแกนไว้ด้วยรุ่นเก่า ไม่มีจุดมาร์คจริง → ประมาณจากมุมมาร์ค
    if (est) est.forEach(function (m) { xs.push(m[0]); ys.push(m[1]); });
    if (!xs.length) return;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var W = Math.max(x1 - x0, 1), H = Math.max(y1 - y0, 1), sc = Math.min((cv.width - 2 * pad) / W, (cv.height - 2 * pad) / H);
    var offX = pad + ((cv.width - 2 * pad) - W * sc) / 2, offY = pad + ((cv.height - 2 * pad) - H * sc) / 2;
    var X = function (x) { return offX + (x - x0) * sc; }, Y = function (y) { return cv.height - offY - (y - y0) * sc; };
    g.clearRect(0, 0, cv.width, cv.height);
    if (v) { g.strokeStyle = 'rgba(255,255,255,.3)'; g.setLineDash([4, 4]); g.strokeRect(X(Math.min(v.ab[0], v.ab[2])), Y(Math.max(v.ab[1], v.ab[3])), Math.abs(v.ab[2] - v.ab[0]) * sc, Math.abs(v.ab[1] - v.ab[3]) * sc); g.setLineDash([]); }
    paths.forEach(function (pt) {
      var a = pt.p || []; if (a.length < 12) return;
      g.strokeStyle = COLK[pt.k || 'kiss']; g.lineWidth = 1; g.beginPath();
      var np = a.length / 6; g.moveTo(X(a[0]), Y(a[1]));
      for (var j = 0; j < (pt.c ? np : np - 1); j++) { var A0 = j * 6, B0 = ((j + 1) % np) * 6; g.bezierCurveTo(X(a[A0 + 4]), Y(a[A0 + 5]), X(a[B0 + 2]), Y(a[B0 + 3]), X(a[B0]), Y(a[B0 + 1])); }
      if (pt.c) g.closePath(); g.stroke();
    });
    if (v) v.marks.forEach(function (m) { g.fillStyle = m[2] === 1 ? '#4da3ff' : '#ff5d5d'; g.fillRect(X(m[0]) - 4, Y(m[1]) - 4, 8, 8); });
    if (est) { g.strokeStyle = '#4da3ff'; g.lineWidth = 2; est.forEach(function (m) { g.strokeRect(X(m[0]) - 5, Y(m[1]) - 5, 10, 10); }); }
  }
  // มุมทั้ง 4 ของกรอบมาร์ค (ประมาณ) จากข้อมูลที่แผงเก็บไว้: เริ่ม (ox,oy) · กว้างตามแกน X = dy · สูงตามแกน Y = dx
  function estMarks(m) {
    if (!m || !isFinite(m.ox) || !isFinite(m.oy) || !isFinite(m.dx) || !isFinite(m.dy)) return null;
    return [[m.ox, m.oy], [m.ox + m.dy, m.oy], [m.ox, m.oy + m.dx], [m.ox + m.dy, m.oy + m.dx]];
  }
  // ตั้งความเร็ว/แรงกด Kiss Cut และ Die Cut ในป็อบอัพ (ค่าเดียวกับหน้า "ส่งตัด") — ไม่ติ๊ก = ใช้ค่าที่ตั้งไว้ในตัวเครื่อง
  var DRV_LIM = { kS: [1, 100], kA: [1, 3], kF: [1, 60], dS: [1, 100], dA: [1, 3], dF: [1, 60] };
  var DRV_DEF = { kS: 71, kA: 2, kF: 38, dS: 50, dA: 2, dF: 25 };
  function drvBlock(cq) {
    var d = window.ST_cutApi.getDrv(), ps = (cq.snap && cq.snap.paths) || [], nk = 0, nd = 0;
    ps.forEach(function (x) { if (x.k === 'die') nd++; else nk++; });
    function inp(k) { return '<input type="number" data-dv="' + k + '" min="' + DRV_LIM[k][0] + '" max="' + DRV_LIM[k][1] + '" placeholder="' + DRV_DEF[k] + '" value="' + h(d[k]) + '"' + (d.on ? '' : ' disabled') + '>'; }
    return '<div class="cqdrv"><label class="chk"><input type="checkbox" data-dv="on"' + (d.on ? ' checked' : '') + '> <b>ตั้งแรงกด / ความเร็ว แยก Kiss Cut – Die Cut</b></label>' +
      '<div class="cqdg"><span></span><span class="mut">ความเร็ว cm/s</span><span class="mut">อัตราเร่ง</span><span class="mut">แรงกด</span>' +
        '<b style="color:#ff4fa3">Kiss Cut <small class="mut">' + nk + ' เส้น</small></b>' + inp('kS') + inp('kA') + inp('kF') +
        '<b style="color:#2fd27a">Die Cut <small class="mut">' + nd + ' เส้น</small></b>' + inp('dS') + inp('dA') + inp('dF') + '</div>' +
      '<div class="cqdn mut small" id="cqDrvNote">' + drvNote(d, nd) + '</div></div>';
  }
  function drvNote(d, nd) {
    if (!d.on) return nd ? '⚠ มีเส้น Die Cut ' + nd + ' เส้น แต่ยังไม่ได้ติ๊ก — จะตัดทุกเส้นด้วยแรงกดที่ตั้งไว้ที่ตัวเครื่อง' : 'ไม่ติ๊ก = ใช้แรงกดที่ตั้งไว้ที่ตัวเครื่อง';
    var empty = Object.keys(DRV_DEF).filter(function (k) { return !(parseFloat(d[k]) > 0); });
    return empty.length ? '⚠ ช่องที่เว้นว่างจะใช้ค่าเริ่มต้นของแผง (ตามตัวเลขจางในช่อง)' : 'ค่าจะถูกจำไว้กับเครื่องตัดที่เลือกในหน้า "ส่งตัด"';
  }
  function onDrv(e) {
    var t = e.target, k = t && t.dataset && t.dataset.dv; if (!k || !window.ST_cutApi) return;
    var M = $('cqPrev');
    if (k === 'on') {
      window.ST_cutApi.setDrv({ on: t.checked });
      [].forEach.call(M.querySelectorAll('input[data-dv]:not([data-dv="on"])'), function (x) { x.disabled = !t.checked; });
    } else {
      var v = parseFloat(t.value), lim = DRV_LIM[k];
      if (e.type === 'change' && t.value !== '' && !(v >= lim[0] && v <= lim[1])) { v = Math.min(lim[1], Math.max(lim[0], isFinite(v) ? v : DRV_DEF[k])); t.value = v; toast('ปรับเป็น ' + v + ' (ช่วงที่ตั้งได้ ' + lim[0] + '–' + lim[1] + ')'); }
      if (e.type === 'change') { var o = {}; o[k] = t.value; window.ST_cutApi.setDrv(o); }
    }
    var d = window.ST_cutApi.getDrv(), nd = ((prevCtx && prevCtx.cq.snap.paths) || []).filter(function (x) { return x.k === 'die'; }).length, n = $('cqDrvNote');
    if (n) n.textContent = drvNote(d, nd);
  }
  var prevCtx = null;
  function showPrev(j, f, cq) {
    prevCtx = { j: j, f: f, cq: cq };
    var M = $('cqPrev');
    if (!M) {
      M = document.createElement('div'); M.id = 'cqPrev'; M.className = 'cqmodal';
      M.addEventListener('click', function (e) {
        if (e.target === M || e.target.closest('[data-pv="x"]')) return hidePrev();
        var sb = e.target.closest('[data-pv="sim"]');
        if (sb && prevCtx) {   // จำลองลำดับการตัด (ไม่ส่งเข้าเครื่อง) ใช้ค่าของหน้า "ส่งตัด" เช่น หมุน/กลับซ้ายขวา/ตัด Die ทีหลัง
          var cv = $('cqPrevCv'), pc2 = prevCtx;
          if (sb.dataset.on === '1') { window.ST_cutApi.stopSim(); sb.dataset.on = ''; sb.textContent = '▶ จำลองการตัด'; drawPrev(cv, pc2.cq); return; }
          window.ST_cutApi.load(pc2.cq.snap, null);
          if (!window.ST_cutApi.info().ok) return toast('⚠ ไม่มีเส้นให้จำลอง');
          sb.dataset.on = '1'; sb.textContent = '■ หยุด';
          window.ST_cutApi.sim(cv, sb, function () { sb.dataset.on = ''; sb.textContent = '▶ จำลองการตัด'; });
          return;
        }
        var b = e.target.closest('[data-pv="go"]'); if (!b || !prevCtx) return;
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'กดอีกครั้งเพื่อตัด'; clearTimeout(armT); armT = setTimeout(function () { b.classList.remove('arm'); b.textContent = '✂ ส่งตัด'; }, 4000); return; }
        b.classList.remove('arm'); b.disabled = true; b.textContent = 'กำลังส่ง…';
        var pc = prevCtx;
        doCut(pc.j, pc.f, pc.cq).then(function (r) { toast('✓ ส่งตัดแล้ว ' + r.lines + ' เส้น → ' + r.ip); hidePrev(); }, function (er) { toast('⚠ ' + er.message); b.disabled = false; b.textContent = '✂ ส่งตัด'; });
      });
      M.addEventListener('input', onDrv); M.addEventListener('change', onDrv);
      document.body.appendChild(M);
    }
    var sn = cq.snap || {}, mk = sn.marks;
    M.innerHTML = '<div class="qjob cqbox"><div class="cqhead"><b>พรีวิว · ' + h(j.no || '') + ' ' + h(j.jName || '') + '</b><button class="btn ghost sm" data-pv="x" type="button">✕</button></div>' +
      '<canvas id="cqPrevCv" width="620" height="380" style="width:100%;background:#2b2b31;border-radius:8px"></canvas>' +
      '<div class="cqv mut small"><span style="color:#ff4fa3">▬ Kiss Cut</span> · <span style="color:#2fd27a">▬ Die Cut</span> · <span style="color:#4da3ff">■ มาร์ค</span><br>' +
      h(f.n || '') + ' · ' + h(sn.n || 0) + ' เส้น · ' + (mk ? 'มาร์ค ' + (mk.seg ? 'Segment' : '4 Points') + (cq.view ? ' (' + cq.view.marks.length + ' จุด)' : '') + ' — เครื่องสแกนมาร์คก่อนตัด' + (cq.view ? '' : '<br><span style="color:#ffd23f">⚠ ' + (cq.viewNote ? 'อ่านจุดมาร์คมาวาดพรีวิวไม่ได้ (' + h(cq.viewNote) + ')' : 'สแกนไว้ก่อนรุ่น 1.13.44 จึงไม่มีจุดมาร์คจริง') + ' · กรอบสี่เหลี่ยมโปร่งคือตำแหน่งโดยประมาณ' + (cq.viewNote ? '' : ' — กด "สแกนใหม่" เพื่อดูตำแหน่งจริง') + '</span>') : 'ไม่พบมาร์ค (ตัดแบบไม่อ่านมาร์ค)') + ' · สแกน ' + h(cqTime(cq.savedAt)) + '</div>' +
      drvBlock(cq) + '<div class="qact"><button class="btn" data-pv="go" type="button">✂ ส่งตัด</button><button class="btn ghost sm" data-pv="sim" type="button">▶ จำลองการตัด</button><button class="btn ghost sm" data-pv="x" type="button">ปิด</button></div></div>';
    M.classList.add('show');
    drawPrev($('cqPrevCv'), cq);
  }
  function hidePrev() { try { window.ST_cutApi.stopSim(); } catch (e) {} prevCtx = null; var M = $('cqPrev'); if (M) M.classList.remove('show'); }
  document.addEventListener('st:cutsent', function (e) {   // ส่งตัดสำเร็จ → จดเวลาไว้ที่รายการรอตัด (ไม่ลบ เผื่อต้องตัดซ้ำ)
    var k = e.detail && e.detail.key; if (!k) return;
    var all = cqAll(); if (!all[k]) return; all[k].sentAt = Date.now(); cqSaveAll(all); render(); refreshDetail();
  });
  // ---------- เปิดใช้เมื่อเซิร์ฟเวอร์อนุญาต ----------
  function start(f) {
    if (!f || !f.queue || cfg) return;
    if ((f.tools_off || []).indexOf('queue') >= 0) return;      // แอดมินปิดเครื่องมือนี้ให้สมาชิก
    cfg = f.queue; window.ST_cloudQueue = true;
    var btn = document.querySelector('.tab[data-tab="queue"]');
    if (btn) { btn.classList.remove('hidden'); var sp = btn.querySelector('span'); if (sp) sp.textContent = 'ใบงานจากแอปร้าน · เบต้า'; }
    build(); window.ST_queueReady=true; jobs = localJobs(); render(); load();
    if (btn) btn.addEventListener('click', function () { if (Date.now() - loadedAt > 30000) load(true); });
    setInterval(function () { var p = $('tab-queue'); if (p && p.classList.contains('active') && !document.hidden) load(true); }, 60000);
  }
  var tries = 0;
  (function wait() {
    var c = window.ST_core;
    if (c && c.features && !document.body.classList.contains('locked')) { c.features().then(start); return; }
    if (++tries < 900) setTimeout(wait, 2000);
  })();
})();
