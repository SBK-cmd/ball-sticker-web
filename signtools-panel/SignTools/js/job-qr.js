/* Job QR experiment: pure geometry in current document units. No network or writes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.STJobQR = factory();
})(this, function () {
  'use strict';
  function eligible(j) {
    return !!(j && typeof j.id === 'string' && j.id.trim() && j.id.length <= 180 && typeof j.no === 'string' && j.no.trim() && !/[\r\n]/.test(j.no) && j.no.length <= 80 && !j.ws && !j._doc && (!j._col || j._col === 'jobs'));
  }
  function create(j, encoder) {
    if (!eligible(j)) throw new Error('เลือกใบงานจริงจากแอปร้านก่อน (ใบราคาส่ง/งานเฉพาะแผงยังใช้ไม่ได้)');
    var url = 'https://signtools.organic-parmesan.workers.dev/cut?job=' + encodeURIComponent(j.id);
    if (url.length > 500) throw new Error('รหัสใบงานยาวเกินไปสำหรับ QR รุ่นทดลอง');
    var q = encoder(0, 'M'); q.addData(url, 'Byte'); q.make();
    var n = q.getModuleCount(), rows = [];
    for (var y = 0; y < n; y++) { var row = ''; for (var x = 0; x < n; x++) row += q.isDark(y,x) ? '1' : '0'; rows.push(row); }
    return {jobId:j.id, no:j.no.trim(), url:url, rows:rows, quiet:4, sizeMM:Math.max(28,(n+8)*0.4)};
  }
  function reserveMM(q,bleed) { return q ? q.sizeMM + 20 + (bleed || 0) : 0; }
  function bottom(sheet) { return sheet.reduce(function (b,p) { return Math.max(b,p.y+p.h); },0); }
  function trimHeight(q,sheet,maxH,margin,unit,bleed) {
    return Math.min(maxH,bottom(sheet)+(margin+reserveMM(q,bleed))*unit);
  }
  function footer(q,sheet,W,H,margin,unit,bleed,index,total) {
    var x=margin*unit, y=bottom(sheet)+((bleed||0)+8)*unit, size=q.sizeMM*unit;
    if (!(unit>0 && sheet.length && size <= W-2*x && y+size+9*unit <= H+0.001)) throw new Error('แผ่นเล็กเกินไปสำหรับ QR ใบงานและขอบว่าง กรุณาเพิ่มขนาดแผ่น');
    return {jobId:q.jobId, no:q.no, url:q.url, rows:q.rows, quiet:q.quiet, size:size, x:x, y:y,
      caption:q.no+'\rแผ่น '+(index+1)+'/'+total, maxWidth:W-2*x, sheet:index+1, total:total};
  }
  return {eligible:eligible,create:create,reserveMM:reserveMM,trimHeight:trimHeight,footer:footer};
});
