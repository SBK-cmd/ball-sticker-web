// สร้างอัตโนมัติจาก src/bill-core.js + src/app.html (@@BILLPARSE) ด้วย tools/mk_billcheck.py — ห้ามแก้ไฟล์นี้ตรงๆ
const $ = () => null;   // ตัวอ่านในแอปอ้างช่องในหน้า (sTax/sName) — บน Worker ไม่มี DOM
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

  // ---- คัดจาก src/app.html อัตโนมัติ ห้ามแก้ตรงนี้ ----
  function thaiTaxIdValid(t) {
    const d = String(t || '').replace(/\D/g, ''); if (d.length !== 13) return false;
    let sum = 0; for (let i = 0; i < 12; i++) sum += (+d[i]) * (13 - i);
    return (11 - sum % 11) % 10 === +d[12];
  }
  const ownTaxId = () => String(($('sTax') && $('sTax').value) || (shop && shop.taxId) || '').replace(/\D/g, '');
  const moneyNum = s => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : NaN; };
  const TH_MON = [['ม.ค.', 'มกราคม', 'jan'], ['ก.พ.', 'กุมภาพันธ์', 'feb'], ['มี.ค.', 'มีนาคม', 'mar'], ['เม.ย.', 'เมษายน', 'apr'], ['พ.ค.', 'พฤษภาคม', 'may'], ['มิ.ย.', 'มิถุนายน', 'jun'], ['ก.ค.', 'กรกฎาคม', 'jul'], ['ส.ค.', 'สิงหาคม', 'aug'], ['ก.ย.', 'กันยายน', 'sep'], ['ต.ค.', 'ตุลาคม', 'oct'], ['พ.ย.', 'พฤศจิกายน', 'nov'], ['ธ.ค.', 'ธันวาคม', 'dec']];
  const TH_MON_RE = TH_MON.map(a => a.map((x, k) => k === 2 ? x + '[a-z]*' : x.replace(/\./g, '\\.?')).join('|')).join('|');
  const thMonIdx = t => { t = String(t).toLowerCase().replace(/[\s.]/g, ''); return TH_MON.findIndex(a => a.some((x, k) => k === 2 ? t.indexOf(x) === 0 : t === x.replace(/\./g, ''))) + 1; };
  // ชนิดเอกสาร: สลิปโอนเงิน / คำสั่งซื้อ Shopee Lazada TikTok (ไม่ใช่ใบกำกับภาษี)
  function docSourceOf(T) {
    T = String(T || '');
    if (/ใบกำกับภาษี|tax\s*invoice/i.test(T)) return '';
    if (/shopee|ช้อปปี้/i.test(T)) return 'shopee';
    if (/lazada|ลาซาด้า/i.test(T)) return 'lazada';
    if (/tiktok\s*shop|ติ๊กต็อก/i.test(T)) return 'tiktok';
    if (/โอนเงินสำเร็จ|รายการสำเร็จ|ทำรายการสำเร็จ|จ่ายบิลสำเร็จ|ชำระเงินสำเร็จ|เลขที่รายการ|transaction|transfer\s*(successful|completed)|ค่าธรรมเนียม|k\s*plus|make by kbank|scb\s*easy|krungthai\s*next|bualuang|พร้อมเพย์|promptpay/i.test(T)) return 'slip';
    return '';
  }
  function parseSlipShop(T, src) {   // ยอด ผู้รับ เลขคำสั่งซื้อ จากสลิป/หน้าคำสั่งซื้อ
    const lines = String(T || '').split('\n').map(l => l.trim()).filter(Boolean), out = {};
    const nums = l => (l.match(/(\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)/g) || []).map(x => moneyNum(x));
    const kw = src === 'slip' ? /จำนวนเงิน|amount|ยอดเงิน|ยอดโอน|จำนวน/i : /ยอดชำระทั้งหมด|ยอดคำสั่งซื้อทั้งหมด|รวมการสั่งซื้อ|รวมทั้งหมด|ยอดรวม|order\s*total|total/i;
    let amt = null;
    lines.forEach((l, i) => { if (amt == null && kw.test(l)) { const n = nums(l).concat(nums(lines[i + 1] || '')); if (n.length) amt = n[0]; } });
    if (amt == null) { const all = lines.flatMap(nums).filter(v => v > 0); if (all.length) amt = src === 'slip' ? all[0] : Math.max(...all); }
    if (amt != null) out.amount = amt.toFixed(2);
    if (src === 'slip') {   // ผู้รับ: บรรทัดที่ขึ้นต้นด้วย ไปยัง/ถึง/ผู้รับ/To (หรือบรรทัดถัดไป)
      const i = lines.findIndex(l => /^(ไปยัง|ไปที่|ถึง|ผู้รับเงิน|ผู้รับ|to\b)/i.test(l));
      if (i >= 0) { const rest = lines[i].replace(/^(ไปยัง|ไปที่|ถึง|ผู้รับเงิน|ผู้รับ|to)\s*:?\s*/i, ''); out.vendor = (rest.length > 2 ? rest : lines[i + 1] || '').slice(0, 60); }
      const ref = (String(T).match(/(?:เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง|ref(?:erence)?(?:\s*no)?\.?)\s*:?\s*([A-Za-z0-9]{8,})/i) || [])[1]; if (ref) out.invoiceNo = ref;
    } else {
      out.vendor = {shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop'}[src];
      const shop = lines.find(l => /^(ร้านค้า|ร้าน|ผู้ขาย)\s*:?\s*\S|^(shop|seller)\s*:/i.test(l)); if (shop) out.vendor += ' · ' + shop.replace(/^(ร้านค้า|ร้าน|ผู้ขาย|shop|seller)\s*:?\s*/i, '').slice(0, 40);
      const oid = (String(T).match(/(?:หมายเลขคำสั่งซื้อ|รหัสคำสั่งซื้อ|order\s*(?:id|no\.?|number|sn))\s*:?\s*([A-Za-z0-9]{8,})/i) || [])[1]; if (oid) out.invoiceNo = oid;
    }
    return out;
  }
  function parseReceiptText(text) {
    let clean = String(text || '').replace(/\r/g, '').replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)));
    // OCR มักอ่านจุดทศนิยมเป็นจุลภาค/มีช่องว่างแทรก: "3,302 ,00" "3,085,98" → "3,302.00" "3,085.98"
    clean = clean.replace(/(\d)\s+([,.]\d{2})(?!\d)/g, '$1$2').replace(/(\d{1,3}(?:,\d{3})*),(\d{2})(?![\d,])/g, '$1.$2');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const out = {};
    const own = ownTaxId();

    // เลขผู้เสียภาษี: ทุกชุด 13 หลักที่ไม่ใช่ของร้านเรา · ถ้ามีหลายชุด (เช่นมีกระดาษใบอื่นติดมาในรูป)
    // เลือกชุดที่อยู่ใกล้กล่องชื่อลูกค้ามากที่สุด และต้องผ่านสูตรตรวจก่อน
    const custLine = lines.findIndex(l => /ชื่อลูกค้า|นามลูกค้า|messrs|customer'?s?\s*name/i.test(l));
    const taxCands = [];
    lines.forEach((l, li) => { const re = /(?<!\d)(?:\d[\s-]?){12}\d(?!\d)/g; let m; while ((m = re.exec(l))) { const d = m[0].replace(/\D/g, ''); if (d.length === 13 && d !== own) taxCands.push({d, li, ok: thaiTaxIdValid(d)}); } });
    taxCands.sort((a, b) => (b.ok - a.ok) || (custLine >= 0 ? Math.abs(a.li - custLine) - Math.abs(b.li - custLine) : a.li - b.li));
    if (taxCands.length) out.vendorTax = taxCands[0].d;

    // วันที่: รองรับ 2026-10-28 (ค.ศ./พ.ศ.) และ 28/10/69 · ข้ามวันในอนาคต · บรรทัดที่มี วันที่/DATE มาก่อน
    const today = todayISO();
    const dateCands = [];
    lines.forEach((l, li) => {
      const pri = /วันที่|date/i.test(l) ? 0 : 1; let m;
      const iso = /(?<!\d)((?:20|25)\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/g;
      while ((m = iso.exec(l))) dateCands.push({y: +m[1], mo: +m[2], d: +m[3], pri: pri - 0.5, li});
      const dmy = /(?<![\d-])(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2}|\d{4})(?![\d-])/g;
      while ((m = dmy.exec(l))) dateCands.push({y: +m[3], mo: +m[2], d: +m[1], pri, li});
      // 12 พ.ย. 69 / 12 พฤศจิกายน 2569 / 12 Nov 2026 (สลิปธนาคาร แอปช้อปปิ้ง)
      const thm = new RegExp('(?<!\\d)(\\d{1,2})\\s*(' + TH_MON_RE + ')\\s*(\\d{2}|\\d{4})(?!\\d)', 'gi');
      while ((m = thm.exec(l))) dateCands.push({y: +m[3], mo: thMonIdx(m[2]), d: +m[1], pri: pri - 0.25, li});
    });
    dateCands.sort((a, b) => a.pri - b.pri || a.li - b.li);
    for (const c of dateCands) {
      let {y, mo, d} = c;
      if (y < 100) y += y >= 50 ? 2500 : 2000;   // 69 → 2569 (พ.ศ.), 26 → 2026
      if (y > 2400) y -= 543;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2015 && y < 2100) {
        const iso = y + '-' + pad2(mo) + '-' + pad2(d);
        if (iso <= today) { out.date = iso; break; }
      }
    }

    // เลขที่ใบกำกับ: หารหัสรูปแบบเลขเอกสาร (IV202610327, PL-2610/0257) ทั้งที่อยู่ติดป้ายและคนละบรรทัด
    // ข้ามบรรทัดเลข SO / ใบสั่งขาย และรหัสสินค้า
    const invRe = /(?<![A-Za-z0-9])([A-Z]{2,4}-?\d{4,}(?:\/\d{2,6})?)(?![A-Za-z0-9])/g;
    const invCands = [];
    lines.forEach((l, li) => { if (/\bSO\b|S0-|ใบสั่ง/i.test(l) && !/invoice|ใบกำกับ|เลขที่/i.test(l)) return; let m; invRe.lastIndex = 0; while ((m = invRe.exec(l))) { if (/^S[O0]-/.test(m[1])) continue; invCands.push({v: m[1], pri: /invoice\s*no|เลขที่|no\./i.test(l) ? 0 : 1, li}); } });
    invCands.sort((a, b) => a.pri - b.pri || a.li - b.li);
    if (invCands.length) out.invoiceNo = invCands[0].v;
    else { const im = clean.match(/(?:เลขที่ใบกำกับภาษี|เลขที่ใบเสร็จ|เลขที่เอกสาร|เลขที่บิล|Invoice\s*No\.?|Doc(?:ument)?\s*No\.?)[\s:#.]*([A-Za-z0-9][A-Za-z0-9\-\/]{2,24})/i); if (im && /\d/.test(im[1])) out.invoiceNo = im[1]; }

    // ตัวเลขเงิน (ต้องมีทศนิยม 2 ตำแหน่ง)
    const moneyRe = /(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
    const nums = [];
    lines.forEach(l => { let m; moneyRe.lastIndex = 0; while ((m = moneyRe.exec(l))) nums.push({v: moneyNum(m[0]), l}); });
    const vals = Array.from(new Set(nums.map(n => n.v))).filter(v => v > 0);
    // หาคู่ ยอดรวม กับ ยอดก่อน VAT ที่ (รวม − ก่อน VAT) = 7% ของก่อน VAT (คลาดไม่เกิน 0.05) — ใช้ได้แม้ OCR อ่านตัวเลข VAT ไม่ออก
    let best = null;
    vals.forEach(tot => vals.forEach(base => {
      if (base >= tot) return; const vat = round2(tot - base);
      if (Math.abs(base * 0.07 - vat) <= 0.05) { const seen = vals.some(x => Math.abs(x - vat) <= 0.01); if (!best || tot > best.tot || (tot === best.tot && seen && !best.seen)) best = {tot, vat, seen}; }
    }));
    if (best) { out.amount = best.tot.toFixed(2); out.vat = best.vat.toFixed(2); out._matched = true; }
    else {
      const onLine = re => nums.filter(n => re.test(n.l)).map(n => n.v);
      const v = onLine(/ภาษีมูลค่าเพิ่ม|vat/i).filter(x => x !== 7); if (v.length) out.vat = Math.max(...v).toFixed(2);
      const t = onLine(/ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|จำนวนเงินรวม|จำนวนเงินทั้งสิ้น|ยอดสุทธิ|grand\s*total|net\s*total|total/i); if (t.length) out.amount = Math.max(...t).toFixed(2);
    }

    // ชื่อร้าน: บรรทัดแรกที่มี บริษัท/หจก./ร้าน (ข้ามชื่อร้านเราและฝั่งลูกค้า) — ถ้าเลขภาษีตรงกับประวัติร้าน ระบบจะใช้ชื่อจากประวัติแทน
    const ownName = (($('sName') && $('sName').value) || '').trim();
    const notOwn = l => !(ownName && l.indexOf(ownName) >= 0) && !/บอล\s*สติ|กิติพงษ์|กิดิพงษ์/.test(l);
    // เลือกบรรทัดชื่อบริษัทที่อยู่ใกล้บรรทัดเลขผู้เสียภาษีผู้ขายที่สุด (มักอยู่เหนือขึ้นไปไม่กี่บรรทัด) · ข้าม "บริษัทฯ" ในหมายเหตุ
    const taxLi = taxCands.length ? taxCands[0].li : 0;
    // ตัดเฉพาะท่อน "บริษัท ... จำกัด" ออกจากบรรทัด (บรรทัดเดียวอาจมีชื่อลูกค้าปนอยู่) แล้วเลือกท่อนที่อยู่ใกล้เลขภาษีผู้ขาย
    const coRe = /((?:บริษ[ัิ]?[ทหพ](?!ฯ)|ห้างหุ้นส่วน(?:จำกัด)?|หจก\.?)\s*[^/()]*?(?:จำกัด(?:\s*\(มหาชน\))?|$))/;
    const coLines = [];
    lines.forEach((l, li) => { const m = l.match(coRe); if (!m) return; const name = m[1].trim(); if (!notOwn(name) || /ทราบ|ภายใน|ชำรุด|ตรวจสอบ|แก้ไข|ในนาม|เช็ค/.test(name) || /^(for|ในนาม)\s/i.test(l)) return; coLines.push({name, li}); });
    const ltd = o => /จำกัด/.test(o.name) ? 0 : 1000;   // ท่อนที่ลงท้ายด้วย จำกัด มาก่อน
    coLines.sort((x, y) => ltd(x) - ltd(y) + (Math.abs(x.li - taxLi) + (x.li > taxLi ? 0.5 : 0)) - (Math.abs(y.li - taxLi) + (y.li > taxLi ? 0.5 : 0)));
    const fallback = lines.find(l => l.replace(/[^ก-๙]/g, '').length >= 4 && notOwn(l) && !/ใบกำกับ|ใบส่งของ|ใบเสร็จ/.test(l));
    const vname = coLines[0] ? coLines[0].name : fallback;
    if (vname) out.vendor = vname.replace(/^(ผู้ขาย|ชื่อ)\s*[:：]?\s*/, '').replace(/\s+สาขา.*$/, '').trim().slice(0, 60);
    return out;
  }

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
  // การ์ดผลอ่านบิลสำหรับ LINE (Flex bubble) — links: {edit: url ไปหน้า bill-check}, postback data ให้ Worker จัดการ
  function billFlex(r, id, links) {
    const f = r.fields, st = r.status, isVat = f.claim === 'vat';
    const RED = '#b4372f', OK = '#1f7a4d', SUB = '#7a8499', INK = '#1b2333';
    const row = (label, val, ok) => ({type: 'box', layout: 'horizontal', spacing: 'md', contents: [
      {type: 'text', text: label, size: 'sm', color: SUB, flex: 3},
      {type: 'text', text: (ok === false ? '✗ ' : '') + (String(val || '').trim() || 'อ่านไม่ได้'), size: 'sm', color: ok === false ? RED : INK, flex: 6, wrap: true}]});
    const okAll = r.readable && !r.bad.length;
    const title = !r.readable ? 'อ่านบิลไม่ได้' : okAll ? (r.warn.length ? 'อ่านบิลแล้ว · มีข้อควรระวัง' : 'อ่านบิลแล้ว ข้อมูลครบ') : 'อ่านบิลแล้ว · ต้องแก้ ' + r.bad.length + ' ช่อง';
    const body = [
      {type: 'text', text: num(f.amount) ? money(num(f.amount)) + ' บาท' : '— บาท', size: 'xxl', weight: 'bold', color: INK},
      {type: 'text', text: isVat ? (num(f.vat) ? 'VAT ' + money(num(f.vat)) + (st.vat === false ? ' ✗ ไม่ตรง 7%' : '') : 'ไม่พบ VAT') + (f.claimMonth ? ' · รอบ ' + thMonthFull(f.claimMonth) : '') : 'ค่าใช้จ่าย (ไม่ใช้สิทธิ์ภาษีซื้อ)', size: 'sm', color: st.vat === false ? RED : SUB, wrap: true},
      {type: 'separator', margin: 'lg'},
      {type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: [
        row('ร้านค้า', f.vendor, st.vendor), row('เลขภาษี', f.vendorTax, st.vendorTax), row('สาขา', f.vendorBranch, st.vendorBranch),
        row('เลขที่', f.invoiceNo, st.invoiceNo), row('วันที่', f.date ? (+f.date.slice(8, 10)) + ' ' + TH_MONTHS[+f.date.slice(5, 7) - 1].slice(0, 3) + '. ' + (+f.date.slice(0, 4) + 543) : '', st.date), row('หมวด', f.cat || '—')]}
    ];
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

export { analyzeBill, billFlex, savedFlex, parseReceiptText, defaultClaimMonth, claimWindow, thaiTaxIdValid, PURCH_CATS };
