/* Sign Tools — สร้างข้อความ QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment) — pure JS
 * STPromptPay.payload(id, amount?) → string | throws
 * id: เบอร์มือถือ 10 หลัก, เลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก, หรือ e-Wallet 15 หลัก */
(function (root) {
  'use strict';
  function f(id, v) { return id + ('0' + v.length).slice(-2) + v; }
  function crc16(s) {                 // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)
    var c = 0xFFFF;
    for (var i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (var b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return ('000' + c.toString(16).toUpperCase()).slice(-4);
  }
  function target(id) {
    var d = String(id || '').replace(/\D/g, '');
    if (d.length === 10 && d.charAt(0) === '0') return { type: '01', value: ('0000000000000' + '66' + d.slice(1)).slice(-13), kind: 'phone', digits: d };
    if (d.length === 13) return { type: '02', value: d, kind: 'id', digits: d };
    if (d.length === 15) return { type: '03', value: d, kind: 'wallet', digits: d };
    throw new Error('ใส่เบอร์มือถือ 10 หลัก หรือเลขบัตร/เลขผู้เสียภาษี 13 หลัก');
  }
  function payload(id, amount) {
    var t = target(id), amt = parseFloat(amount);
    var has = amt > 0;
    if (amount !== '' && amount != null && !(amt >= 0)) throw new Error('ยอดเงินไม่ถูกต้อง');
    if (has && amt > 9999999.99) throw new Error('ยอดเงินเกินที่ QR รองรับ');
    var s = f('00', '01') + f('01', has ? '12' : '11') +
      f('29', f('00', 'A000000677010111') + f(t.type, t.value)) +
      f('58', 'TH') + f('53', '764') + (has ? f('54', amt.toFixed(2)) : '') + '6304';
    return s + crc16(s);
  }
  function fmtId(id) {
    var t = target(id), d = t.digits;
    if (t.kind === 'phone') return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (t.kind === 'id') return d.charAt(0) + '-' + d.slice(1, 5) + '-' + d.slice(5, 10) + '-' + d.slice(10, 12) + '-' + d.charAt(12);
    return d;
  }
  root.STPromptPay = { payload: payload, crc16: crc16, fmtId: fmtId, target: target };
  if (typeof module === 'object' && module.exports) module.exports = root.STPromptPay;
})(typeof window !== 'undefined' ? window : this);
