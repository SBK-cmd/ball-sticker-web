// ===FIT-BEGIN=== (ชุดเดียวกันใช้ทั้งแผง js/fitcurve.js และ jsx/host.jsx — แก้ที่ js/fitcurve.js แล้วรัน tools: python3 ../sync_fit.py)
// จัดเส้นปิดให้เป็นเบซิเยร์เรียบแบบ Illustrator Simplify: หามุมคมแล้วคงไว้ · ช่วงระหว่างมุมฟิตด้วยเบซิเยร์ (Schneider) ตามค่าคลาดเคลื่อน tol · เส้นตรงยังตรง
// pts = [[x,y],...] เส้นปิด (ไม่ซ้ำจุดแรก) · tol หน่วยเดียวกับ pts · win = จำนวนจุดที่ใช้วัดมุม · คืน [{a:[x,y], l:[x,y], r:[x,y], c:true/false}]
function stFitClosed(pts, tol, cornerDeg, win) {
    var n = pts.length, i, k;
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
    function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
    function mul(a, s) { return [a[0] * s, a[1] * s]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
    function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
    function nrm(a) { var l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; }
    function P(j) { return pts[((j % n) + n) % n]; }
    function bez(b, t) { var u = 1 - t; return [u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0], u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]; }
    function bez1(b, t) { var u = 1 - t; return [3 * u * u * (b[1][0] - b[0][0]) + 6 * u * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]), 3 * u * u * (b[1][1] - b[0][1]) + 6 * u * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1])]; }
    function bez2(b, t) { var u = 1 - t; return [6 * u * (b[2][0] - 2 * b[1][0] + b[0][0]) + 6 * t * (b[3][0] - 2 * b[2][0] + b[1][0]), 6 * u * (b[2][1] - 2 * b[1][1] + b[0][1]) + 6 * t * (b[3][1] - 2 * b[2][1] + b[1][1])]; }
    function chord(d) { var u = [0], j; for (j = 1; j < d.length; j++) u.push(u[j - 1] + len(sub(d[j], d[j - 1]))); var T = u[u.length - 1] || 1; for (j = 0; j < u.length; j++) u[j] /= T; return u; }
    function gen(d, u, t1, t2) {
        var m = d.length, A = [], j, C = [[0, 0], [0, 0]], X = [0, 0], p0 = d[0], p3 = d[m - 1];
        for (j = 0; j < m; j++) { var t = u[j], s = 1 - t, b1 = 3 * t * s * s, b2 = 3 * t * t * s; A.push([mul(t1, b1), mul(t2, b2)]); }
        for (j = 0; j < m; j++) {
            C[0][0] += dot(A[j][0], A[j][0]); C[0][1] += dot(A[j][0], A[j][1]); C[1][1] += dot(A[j][1], A[j][1]);
            var tt = u[j], ss = 1 - tt, base = add(mul(p0, ss * ss * ss + 3 * tt * ss * ss), mul(p3, 3 * tt * tt * ss + tt * tt * tt));
            var tmp = sub(d[j], base); X[0] += dot(A[j][0], tmp); X[1] += dot(A[j][1], tmp);
        }
        C[1][0] = C[0][1];
        var det = C[0][0] * C[1][1] - C[1][0] * C[0][1], a1, a2, seg = len(sub(p3, p0));
        if (Math.abs(det) > 1e-12) { a1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det; a2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det; } else { a1 = a2 = 0; }
        var eps = 1e-6 * seg;
        if (a1 < eps || a2 < eps) { a1 = a2 = seg / 3; }
        return [p0, add(p0, mul(t1, a1)), add(p3, mul(t2, a2)), p3];
    }
    function reparam(d, u, b) {
        var j, r = [];
        for (j = 0; j < d.length; j++) {
            var q = bez(b, u[j]), q1 = bez1(b, u[j]), q2 = bez2(b, u[j]), df = sub(q, d[j]), num = dot(df, q1), den = dot(q1, q1) + dot(df, q2);
            r.push(Math.abs(den) > 1e-12 ? u[j] - num / den : u[j]);
        }
        return r;
    }
    function maxErr(d, u, b) {
        var worst = 0, at = Math.floor(d.length / 2), j;
        for (j = 1; j < d.length - 1; j++) { var q = sub(bez(b, u[j]), d[j]), e = dot(q, q); if (e >= worst) { worst = e; at = j; } }
        return [worst, at];
    }
    function fit(d, t1, t2, err, out) {
        var m = d.length;
        if (m === 2) { var dist = len(sub(d[1], d[0])) / 3; out.push([d[0], add(d[0], mul(t1, dist)), add(d[1], mul(t2, dist)), d[1]]); return; }
        // ช่วงที่เกือบตรงทั้งช่วง (ทุกจุดห่างเส้นคอร์ดไม่เกิน tol) → เส้นตรงจริง ไม่ให้เป็นคลื่นตามสัญญาณรบกวน
        var cd = sub(d[m - 1], d[0]), cl = len(cd), mx = 0, jj;
        if (cl > 3 * err) {
            for (jj = 1; jj < m - 1; jj++) { var dv = Math.abs(cd[0] * (d[jj][1] - d[0][1]) - cd[1] * (d[jj][0] - d[0][0])) / cl; if (dv > mx) mx = dv; }
            if (mx < err * 0.9) { out.push([d[0], add(d[0], mul(cd, 1 / 3)), add(d[m - 1], mul(cd, -1 / 3)), d[m - 1]]); return; }
        }
        var u = chord(d), b = gen(d, u, t1, t2), me = maxErr(d, u, b), it;
        if (me[0] < err * err) { out.push(b); return; }
        if (me[0] < err * err * 16) {
            for (it = 0; it < 6; it++) { u = reparam(d, u, b); b = gen(d, u, t1, t2); me = maxErr(d, u, b); if (me[0] < err * err) { out.push(b); return; } }
        }
        var sp = me[1], tc = nrm(sub(d[sp - 1], d[sp + 1]));
        if (sp < 1) sp = 1; if (sp > m - 2) sp = m - 2;
        tc = nrm(sub(d[sp - 1], d[sp + 1]));
        fit(d.slice(0, sp + 1), t1, tc, err, out);
        fit(d.slice(sp), mul(tc, -1), t2, err, out);
    }
    if (n < 4) return null;
    // 1) หามุมคม
    var ang = [], isC = [], w = Math.max(2, win | 0);
    for (i = 0; i < n; i++) {
        var v1 = sub(P(i), P(i - w)), v2 = sub(P(i + w), P(i)), l1 = len(v1), l2 = len(v2), a = 0;
        if (l1 > 1e-12 && l2 > 1e-12) { var cs = dot(v1, v2) / (l1 * l2); a = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI; }
        // มุมคมจริงต้องหักออกจากเส้นคอร์ดมากกว่า tol (ไม่งั้นเป็นแค่สัญญาณรบกวนจากการ trace)
        var ch = sub(P(i + w), P(i - w)), cl2 = len(ch);
        if (cl2 > 1e-12 && Math.abs(ch[0] * (P(i)[1] - P(i - w)[1]) - ch[1] * (P(i)[0] - P(i - w)[0])) / cl2 <= tol) a = 0;
        ang.push(a);
    }
    var corners = [];
    for (i = 0; i < n; i++) {
        var top = ang[i] > cornerDeg;
        for (k = -w; k <= w && top; k++) { var ak = ang[((i + k) % n + n) % n]; if (ak > ang[i] || (ak === ang[i] && k < 0)) top = false; }
        if (top) corners.push(i);
    }
    // 2) จุดตัดแบ่งเส้น
    var splits = [], sharp = [];
    if (corners.length) { splits = corners; for (i = 0; i < corners.length; i++) sharp.push(true); }
    else {
        var far = 1, fd = -1;
        for (i = 1; i < n; i++) { var dd = dot(sub(pts[i], pts[0]), sub(pts[i], pts[0])); if (dd > fd) { fd = dd; far = i; } }
        splits = [0, far]; sharp = [false, false];
    }
    // 3) ฟิตแต่ละช่วง
    var segs = [], segIsCorner = [];
    for (i = 0; i < splits.length; i++) {
        var s = splits[i], e = splits[(i + 1) % splits.length]; if (e <= s) e += n;
        var d = [], j2;
        for (j2 = s; j2 <= e; j2++) d.push(P(j2));
        var t1, t2, m2 = d.length;
        if (m2 < 2) continue;
        t1 = sharp[i] ? nrm(sub(d[Math.min(2, m2 - 1)], d[0])) : nrm(sub(P(s + 1), P(s - 1)));
        t2 = sharp[(i + 1) % splits.length] ? nrm(sub(d[Math.max(m2 - 3, 0)], d[m2 - 1])) : mul(nrm(sub(P(e + 1), P(e - 1))), -1);
        var out = [];
        fit(d, t1, t2, tol, out);
        for (k = 0; k < out.length; k++) { segs.push(out[k]); segIsCorner.push(k === 0 ? sharp[i] : false); }
    }
    var N = segs.length, res = [];
    for (i = 0; i < N; i++) {
        var cur = segs[i], prev = segs[(i - 1 + N) % N];
        res.push({ a: cur[0], r: cur[1], l: prev[2], c: segIsCorner[i] });
    }
    return res;
}
// ===FIT-END===
