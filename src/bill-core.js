/* ตัวอ่านบิลกลาง — ใช้ทั้งหน้า bill-check.html และ Worker line-bills (worker/line-bills/bill-core.mjs)
   ต้นฉบับ: src/bill-core.js · สร้างไฟล์ด้วย python3 tools/mk_billcheck.py · ห้ามใช้ DOM ในไฟล์นี้ (ต้องรันบน Worker ได้)
   ฟังก์ชัน parseReceiptText/docSourceOf/parseSlipShop/thaiTaxIdValid คัดจาก src/app.html ช่วง @@BILLPARSE */
  // ข้อมูลร้านที่ตัวอ่านบิลต้องใช้ (ตรงกับ SHOP_DEFAULT ในแอป · ที่อยู่ตาม ภ.พ.20)
  const shop = {name: 'บอลสติ๊กเกอร์ พิษณุโลก', taxId: '1659900519381', address: '8 หมู่ 19 ต.บางระกำ อ.บางระกำ จ.พิษณุโลก 65140', promptpayName: 'นาย กิติพงษ์ สีทอง'};
  const pad2 = n => String(n).padStart(2, '0');
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const todayISO = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);   // เวลาไทย (Worker รันเป็น UTC)
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : 0; };
  const money = n => n.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const thMonthFull = m => { const [y, mo] = String(m).split('-').map(Number); return TH_MONTHS[mo - 1] + ' ' + (y + 543); };

  /*@@BILLPARSE@@*/

  const PURCH_CATS = ['วัสดุ สติ๊กเกอร์ กระดาษ ฟิล์ม', 'หมึกพิมพ์', 'บรรจุภัณฑ์ / วัสดุสิ้นเปลือง', 'อุปกรณ์ / เครื่องมือ', 'ค่าขนส่ง / ไปรษณีย์', 'ค่าไฟ น้ำ อินเทอร์เน็ต โทรศัพท์', 'ค่าเช่า', 'ค่าโฆษณา / การตลาด', 'ซ่อมบำรุง', 'ค่าเดินทาง / น้ำมัน', 'อื่นๆ'];
  function guessCat(vendor, text) {
    const t = [vendor, text].join(' ').toLowerCase();
    if (/หมึก|ink|toner|โทนเนอร์/.test(t)) return 'หมึกพิมพ์';
    if (/สติ๊กเกอร์|สติกเกอร์|sticker|กระดาษ|ฟิล์ม|film|pvc|ไวนิล|vinyl|โฮโลแกรม|สะท้อนแสง|ลามิเนต|laminat/.test(t)) return 'วัสดุ สติ๊กเกอร์ กระดาษ ฟิล์ม';
    if (/เทป|กาว|เชือก|กล่อง|ซอง|ถุง|บับเบิ้ล|bubble|แพ็ค|packing/.test(t)) return 'บรรจุภัณฑ์ / วัสดุสิ้นเปลือง';
    if (/ขนส่ง|ไปรษณีย์|kerry|flash|j&t|ems|ค่าส่ง|lalamove/.test(t)) return 'ค่าขนส่ง / ไปรษณีย์';
    if (/การไฟฟ้า|ไฟฟ้า|ประปา|ทรู|true|ais|dtac|3bb|อินเทอร์เน็ต|internet|โทรศัพท์/.test(t)) return 'ค่าไฟ น้ำ อินเทอร์เน็ต โทรศัพท์';
    if (/น้ำมัน|ปตท|ptt|บางจาก|shell|caltex/.test(t)) return 'ค่าเดินทาง / น้ำมัน';
    if (/เครื่อง|ใบมีด|cutter|plotter|อุปกรณ์/.test(t)) return 'อุปกรณ์ / เครื่องมือ';
    return '';
  }
  const ownNameRe = () => /กิติพงษ์|กิดิพงษ์|บอลสติ๊กเกอร์|บอล สติ๊กเกอร์|บอลสติกเกอร์/;
  const brRe = /(ส[ำา]?นักงาน\s*[ใไ]?หญ|สนง\.?\s*ใหญ่|head\s*office|สาขา(?:ที่)?\s*[0-9๐-๙]{1,5})/i;
  function addrKeys(a) {
    a = String(a || '');
    return {moo: (a.match(/หมู่(?:ที่)?\s*(\d+)/) || [])[1] || '', tb: (a.match(/(?:ต\.|ตำบล|แขวง)\s*([ก-๙]+)/) || [])[1] || '', zip: (a.match(/(\d{5})(?!\d)/) || [])[1] || ''};
  }
  // ดึงสาขา/ที่อยู่ผู้ขาย + เช็กลิสต์จากข้อความ (ตรรกะเดียวกับ autoTaxChecklist ในแอป)
  function readExtras(T, f) {
    const lines = T.split('\n'), own = shop.taxId, digits = T.replace(/[^\d\n]/g, '');
    const vtax = String(f.vendorTax || '').replace(/\D/g, '');
    const vLine = vtax ? (lines.find(l => l.replace(/\D/g, '').indexOf(vtax) >= 0) || '') : '';
    const vName = String(f.vendor || '').slice(0, 8), nameLine = vName ? (lines.find(l => l.indexOf(vName) >= 0) || '') : '';
    const out = {auto: {}};
    const brM = (vLine.match(brRe) || nameLine.match(brRe) || [])[1] || '';
    if (brM) out.vendorBranch = /สาขา/.test(brM) ? brM.replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c))).replace(/สาขา\s*(ที่)?\s*/, 'สาขาที่ ') : 'สำนักงานใหญ่';
    else if (/สาขา(ที่)?/.test(nameLine + vLine)) out.vendorBranch = 'สาขาที่ ';
    const addrRe = /(ถนน|ถ\.|ตำบล|ต\.|แขวง|เขต|อำเภอ|อ\.|จังหวัด|จ\.|หมู่|ซอย|(?<!\d)\d{5}(?!\d))/;
    const ni = nameLine ? lines.indexOf(nameLine) : -1, vi = vLine ? lines.indexOf(vLine) : -1;
    const cand = [ni + 1, ni + 2, vi, ni, vi - 1].filter(i => i >= 0 && i < lines.length).map(i => lines[i]);
    const aLine = cand.find(l => addrRe.test(l) && l.replace(/\D/g, '').indexOf(own) < 0 && !ownNameRe().test(l));
    const vAddr = aLine ? aLine.replace(/(เลขประจำตัว|เลขที่ผู้เสีย|โทร|tel|fax|เอกสารออก|www\.|e-?mail).*/i, '').replace(/^(บริษัท|ห้างหุ้นส่วน)[^0-9]*?(จำกัด|$)\s*/, '').replace(/\s+/g, ' ').trim() : '';
    if (vAddr.length >= 10) out.vendorAddr = vAddr.slice(0, 160);
    const a = out.auto, ownLine = lines.find(l => l.replace(/\D/g, '').indexOf(own) >= 0) || '', buyerNameLine = lines.find(l => ownNameRe().test(l)) || '';
    a.title = /ใบกำกับภาษี|ใบกํากับภาษี|tax\s*invoice/i.test(T);
    a.buyer = ownNameRe().test(T);
    a.buyerTax = digits.indexOf(own) >= 0 ? (brRe.test(ownLine) || brRe.test(buyerNameLine)) : false;
    const k = addrKeys(shop.address);
    a.buyerAddr = T.indexOf(k.zip) >= 0 && T.indexOf(k.tb) >= 0 && (!k.moo || new RegExp('หมู่(?:ที่)?\\s*' + k.moo + '(?!\\d)').test(T));
    a.itemsVat = /ภาษีมูลค่าเพิ่ม|vat/i.test(T);
    return out;
  }
  function claimWindow(date) {
    const m = String(date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(m)) return [];
    const [y, mo] = m.split('-').map(Number), list = [];
    for (let i = 0; i <= 6; i++) { const d = new Date(y, mo - 1 + i, 1); list.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1)); }
    return list;
  }
  // รอบใช้สิทธิ์เริ่มต้น: เดือนที่ออกใบกำกับ ถ้ายื่นรอบนั้นไปแล้ว (เลยวันที่ 15 ของเดือนถัดไป) ใช้เดือนปัจจุบันแทน
  function defaultClaimMonth(date) {
    const w = claimWindow(date); let def = w[0] || '';
    if (def) { const [y, m] = def.split('-').map(Number), due = y + '-' + pad2(m === 12 ? 1 : m + 1) + '-15', now = todayISO(); const dueISO = m === 12 ? (y + 1) + '-01-15' : due; if (now > dueISO && w.indexOf(now.slice(0, 7)) >= 0) def = now.slice(0, 7); }
    return def;
  }
  // อ่านทั้งใบ: ข้อความ OCR → ช่องข้อมูล + ผลตรวจทุกช่อง (ใช้ใน Worker เพื่อตอบการ์ดในแชต · หน้าเว็บใช้ readExtras/check ของตัวเอง)
  function analyzeBill(text, vendors, edits) {   // edits: ช่องที่ผู้ใช้แก้แล้ว (เช่น {vendorBranch:'สำนักงานใหญ่'}) ทับผลอ่าน
    const T = String(text || ''), docSrc = docSourceOf(T);
    let f = T.trim() ? parseReceiptText(T) : {};
    if (docSrc) { const s = parseSlipShop(T, docSrc); f.vendor = s.vendor || f.vendor; f.amount = s.amount || f.amount; if (s.invoiceNo && !f.invoiceNo) f.invoiceNo = s.invoiceNo; }
    const vt = String(f.vendorTax || '').replace(/\D/g, ''), known = (vendors || []).find(v => vt && String(v.tax || '').replace(/\D/g, '') === vt);
    if (known && known.name) f.vendor = known.name;
    const ex = T.trim() ? readExtras(T, f) : {auto: {}};
    f.vendorBranch = (known && known.branch) || ex.vendorBranch || '';
    f.vendorAddr = (known && known.addr) || ex.vendorAddr || '';
    f.cat = (known && known.cat) || guessCat(f.vendor, T);
    f.claim = docSrc ? 'expense' : (num(f.vat) > 0 ? 'vat' : 'expense');
    f.claimMonth = f.claim === 'vat' ? defaultClaimMonth(f.date) : '';
    f.docSrc = docSrc; delete f._matched;
    Object.keys(edits || {}).forEach(k => { if (['vendor', 'vendorTax', 'vendorBranch', 'vendorAddr', 'invoiceNo', 'date', 'amount', 'vat', 'cat', 'claim', 'claimMonth'].indexOf(k) >= 0 && edits[k] != null) f[k] = String(edits[k]); });
    if (edits && edits.date && !edits.claimMonth && f.claim === 'vat') f.claimMonth = defaultClaimMonth(f.date);
    const isVat = f.claim === 'vat', amt = num(f.amount), vat = num(f.vat), br = String(f.vendorBranch || '').trim(), vt2 = String(f.vendorTax || '').replace(/\D/g, '');
    const st = {};
    st.vendor = !!String(f.vendor || '').trim();
    st.vendorTax = !vt2 ? (isVat ? false : null) : thaiTaxIdValid(vt2);
    st.vendorBranch = !br ? (isVat ? false : null) : (/สาขา/.test(br) && !/\d/.test(br)) ? false : true;
    st.invoiceNo = f.invoiceNo ? true : (isVat ? false : null);
    st.date = !f.date ? false : f.date <= todayISO();
    st.amount = amt > 0;
    st.vat = !isVat ? null : vat > 0 && Math.abs(round2((amt - vat) * 0.07) - vat) <= 0.05;
    const a = ex.auto, chk = {title: a.title, seller: st.vendor && st.vendorTax === true && !!f.vendorAddr, sellerBranch: st.vendorBranch, buyer: a.buyer, buyerTax: a.buyerTax, buyerAddr: a.buyerAddr, itemsVat: a.itemsVat && vat > 0, noDate: st.invoiceNo === true && st.date === true};
    Object.keys(chk).forEach(k => { if (chk[k] == null) delete chk[k]; else chk[k] = !!chk[k]; });
    const LBL = {vendor: 'ชื่อร้าน', vendorTax: 'เลขผู้เสียภาษีผู้ขาย', vendorBranch: 'สาขาผู้ขาย', invoiceNo: 'เลขที่ใบกำกับ', date: 'วันที่', amount: 'ยอดรวม', vat: 'VAT 7%'};
    const bad = Object.keys(st).filter(k => st[k] === false).map(k => LBL[k]);
    const CHL = {title: 'ไม่มีคำว่าใบกำกับภาษี', buyer: 'ชื่อผู้ซื้อไม่ใช่ชื่อร้าน', buyerTax: 'เลขภาษี/สาขาผู้ซื้อไม่ครบ', buyerAddr: 'ที่อยู่ผู้ซื้อไม่ตรง ภ.พ.20'};
    const warn = isVat ? Object.keys(CHL).filter(k => chk[k] === false).map(k => CHL[k]) : [];
    return {fields: f, status: st, chk, bad, warn, readable: !!T.trim()};
  }
  // ---------- แก้ในแชต: "สาขา: 00001" "วันที่ 2/11/69" "ยอด 3,302" ----------
  const EDIT_FIELDS = {vendor: 'ร้าน', vendorTax: 'เลขภาษี', vendorBranch: 'สาขา', invoiceNo: 'เลขที่', date: 'วันที่', amount: 'ยอด', vat: 'VAT'};
  const EDIT_ALIAS = [['vendorTax', /^(เลข\s*ภาษี|เลขผู้เสียภาษี|tax\s*id)/i], ['vendorBranch', /^(สาขา(ผู้ขาย)?|branch)/i], ['invoiceNo', /^(เลขที่(ใบกำกับ)?|เลขใบกำกับ|invoice(\s*no)?)/i],
    ['date', /^(วันที่|date)/i], ['vat', /^(vat|แวท|ภาษีมูลค่าเพิ่ม|ภาษี)/i], ['amount', /^(ยอด(รวม|เงิน)?|รวม|amount|total)/i], ['vendor', /^(ร้าน(ค้า)?|ผู้ขาย|ชื่อร้าน|บริษัท)/i]];
  function parseEditText(text) {   // คืน {field, value, label} หรือ {field, error} หรือ null (ไม่ใช่ข้อความแก้)
    const t = String(text || '').trim().replace(/^แก้\s*/, '');
    const hit = EDIT_ALIAS.find(([, re]) => re.test(t)); if (!hit) return null;
    const field = hit[0], label = EDIT_FIELDS[field];
    let v = t.replace(hit[1], '').replace(/^\s*[:：=]?\s*/, '').trim().replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)));
    if (field === 'vendor' && /^บริษัท/.test(t) && !v) v = t;
    if (!v) return {field, label, error: 'พิมพ์ค่าหลัง "' + label + ':" ด้วย'};
    if (field === 'vendorTax') { const d = v.replace(/\D/g, ''); if (d.length !== 13) return {field, label, error: 'เลขภาษีต้องมี 13 หลัก'}; return {field, label, value: d, warn: thaiTaxIdValid(d) ? '' : 'เลขนี้ไม่ผ่านสูตรตรวจ ตรวจอีกครั้ง'}; }
    if (field === 'vendorBranch') {
      if (/ใหญ่|hq|head/i.test(v)) return {field, label, value: 'สำนักงานใหญ่'};
      const d = v.replace(/\D/g, ''); if (!d) return {field, label, error: 'พิมพ์ "สำนักงานใหญ่" หรือเลขสาขา เช่น 00001'};
      return {field, label, value: 'สาขาที่ ' + d.padStart(5, '0')};
    }
    if (field === 'amount' || field === 'vat') { const n = parseFloat(v.replace(/[,฿\s]|บาท/g, '')); if (!isFinite(n) || n < 0) return {field, label, error: 'พิมพ์เป็นตัวเลข เช่น 3,302.00'}; return {field, label, value: n.toFixed(2)}; }
    if (field === 'date') {
      let y, mo, d, m;
      if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if ((m = v.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
      else if ((m = v.match(new RegExp('^(\\d{1,2})\\s*(' + TH_MON_RE + ')\\s*(\\d{2}|\\d{4})$', 'i')))) { d = +m[1]; mo = thMonIdx(m[2]); y = +m[3]; }
      else return {field, label, error: 'พิมพ์วันที่แบบ 2/11/69 หรือ 2 พ.ย. 69'};
      if (y < 100) y += y >= 50 ? 2500 : 2000; if (y > 2400) y -= 543;
      const iso = y + '-' + pad2(mo) + '-' + pad2(d), dt = new Date(y, mo - 1, d);
      if (!(mo >= 1 && mo <= 12) || dt.getDate() !== d) return {field, label, error: 'วันที่ไม่ถูกต้อง'};
      if (iso > todayISO()) return {field, label, error: 'วันที่อยู่ในอนาคต'};
      return {field, label, value: iso};
    }
    return {field, label, value: v.slice(0, field === 'vendor' ? 80 : 40)};
  }
  // การ์ดผลอ่านบิลสำหรับ LINE (Flex bubble) — links: {edit: url ไปหน้า bill-check}, postback data ให้ Worker จัดการ
  function billFlex(r, id, links) {
    const f = r.fields, st = r.status, isVat = f.claim === 'vat';
    const RED = '#b4372f', OK = '#1f7a4d', SUB = '#7a8499', INK = '#1b2333';
    // แตะแถว → LINE เปิดคีย์บอร์ดพร้อมพิมพ์ "สาขา: " ให้ พิมพ์ค่าใหม่แล้วส่ง (Worker อ่านด้วย parseEditText)
    const edit = k => ({type: 'postback', label: 'แก้' + EDIT_FIELDS[k], data: 'act=edit&f=' + k + '&id=' + id, inputOption: 'openKeyboard', fillInText: EDIT_FIELDS[k] + ': '});
    const row = (label, val, ok, k) => ({type: 'box', layout: 'horizontal', spacing: 'md', action: k ? edit(k) : undefined, contents: [
      {type: 'text', text: label, size: 'sm', color: SUB, flex: 3},
      {type: 'text', text: (ok === false ? '✗ ' : '') + (String(val || '').trim() || 'อ่านไม่ได้'), size: 'sm', color: ok === false ? RED : INK, flex: 6, wrap: true},
      {type: 'text', text: k ? '✎' : ' ', size: 'sm', color: '#9aa3b5', flex: 1, align: 'end'}]});
    const okAll = r.readable && !r.bad.length;
    const title = !r.readable ? 'อ่านบิลไม่ได้' : okAll ? (r.warn.length ? 'อ่านบิลแล้ว · มีข้อควรระวัง' : 'อ่านบิลแล้ว ข้อมูลครบ') : 'อ่านบิลแล้ว · ต้องแก้ ' + r.bad.length + ' ช่อง';
    const body = [
      {type: 'text', text: num(f.amount) ? money(num(f.amount)) + ' บาท' : '— บาท', size: 'xxl', weight: 'bold', color: st.amount === false ? RED : INK, action: edit('amount')},
      {type: 'text', action: isVat ? edit('vat') : undefined, text: isVat ? (num(f.vat) ? 'VAT ' + money(num(f.vat)) + (st.vat === false ? ' ✗ ไม่ตรง 7%' : '') : 'ไม่พบ VAT') + (f.claimMonth ? ' · รอบ ' + thMonthFull(f.claimMonth) : '') : 'ค่าใช้จ่าย (ไม่ใช้สิทธิ์ภาษีซื้อ)', size: 'sm', color: st.vat === false ? RED : SUB, wrap: true},
      {type: 'separator', margin: 'lg'},
      {type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: [
        row('ร้านค้า', f.vendor, st.vendor, 'vendor'), row('เลขภาษี', f.vendorTax, st.vendorTax, 'vendorTax'), row('สาขา', f.vendorBranch, st.vendorBranch, 'vendorBranch'),
        row('เลขที่', f.invoiceNo, st.invoiceNo, 'invoiceNo'), row('วันที่', f.date ? (+f.date.slice(8, 10)) + ' ' + TH_MONTHS[+f.date.slice(5, 7) - 1].slice(0, 3) + '. ' + (+f.date.slice(0, 4) + 543) : '', st.date, 'date'), row('หมวด', f.cat || '—')]},
      {type: 'text', text: 'แตะยอดเงินหรือแถวที่มี ✎ เพื่อพิมพ์แก้ในแชต', size: 'xxs', color: '#9aa3b5', margin: 'md', wrap: true}
    ];
    // Flex ไม่รับ action: undefined → ลบทิ้ง
    const strip = o => { if (Array.isArray(o)) o.forEach(strip); else if (o && typeof o === 'object') { Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; else strip(o[k]); }); } return o; };
    strip(body);
    if (r.warn.length) body.push({type: 'text', text: '⚠ ' + r.warn.join(' · '), size: 'xs', color: '#8a5a00', wrap: true, margin: 'lg'});
    const btns = [];
    if (r.readable && st.amount) btns.push({type: 'button', style: 'primary', color: '#14234b', height: 'sm', action: {type: 'postback', label: 'บันทึกเข้าภาษีซื้อ', data: 'act=save&id=' + id, displayText: 'บันทึกบิลนี้'}});
    if (st.vendorBranch === false) btns.push({type: 'button', style: 'secondary', height: 'sm', action: {type: 'postback', label: 'ผู้ขายเป็นสำนักงานใหญ่', data: 'act=hq&id=' + id, displayText: 'สาขาผู้ขาย: สำนักงานใหญ่'}});
    btns.push({type: 'button', style: 'link', height: 'sm', action: {type: 'uri', label: '✏️ แก้ไข', uri: links.edit}});
    btns.push({type: 'button', style: 'link', height: 'sm', color: SUB, action: {type: 'postback', label: 'ไม่ใช่บิล', data: 'act=skip&id=' + id, displayText: 'ไม่ใช่บิล'}});
    return {type: 'bubble', size: 'kilo',
      header: {type: 'box', layout: 'vertical', backgroundColor: okAll ? '#e8f5ee' : '#fff4d6', paddingAll: 'md', contents: [{type: 'text', text: (okAll ? '✅ ' : '⚠️ ') + title, weight: 'bold', size: 'md', color: okAll ? OK : '#8a5a00', wrap: true}]},
      body: {type: 'box', layout: 'vertical', contents: body},
      footer: {type: 'box', layout: 'vertical', spacing: 'sm', contents: btns}};
  }
  // การ์ดหลังบันทึก
  function savedFlex(rec) {
    const isVat = rec.claim === 'vat';
    return {type: 'bubble', size: 'kilo', body: {type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      {type: 'text', text: '✅ บันทึกแล้ว', weight: 'bold', color: '#1f7a4d'},
      {type: 'text', text: (rec.vendor || 'ไม่ระบุร้าน'), size: 'sm', wrap: true},
      {type: 'text', text: money(num(rec.amount)) + ' บาท' + (isVat && num(rec.vat) ? ' · VAT ' + money(num(rec.vat)) + ' รอบ ' + thMonthFull(rec.claimMonth) : ''), size: 'sm', color: '#5a6580', wrap: true}]}};
  }
