// เส้นตัดตามรูปจากภาพ (PNG ที่ Corel ส่งออก): หาเนื้องาน → ปิดรูด้านใน → ระยะห่างแบบยุคลิด (EDT)
// → เส้นระดับที่ระยะ = ระยะขยาย (marching squares, ละเอียดกว่าพิกเซล) → เกลาให้เรียบ → เส้นโค้ง Bézier
// ไม่พึ่ง Trace/Contour ของ Corel → ผลเหมือนกันทุกเวอร์ชัน
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;

namespace SignTools
{
    public static class Contour
    {
        // คืนเส้นปิดรอบนอก หน่วย = พิกเซลของภาพ (x ขวา, y ลง) · offPx > 0 ขยายออก · < 0 หดเข้า
        public static List<List<double[]>> FromImage(Bitmap bmp, double offPx, out string info)
        {
            int W0 = bmp.Width, H0 = bmp.Height;
            var a = new byte[W0 * H0]; bool anyClear = false;
            var r = new Rectangle(0, 0, W0, H0);
            var bd = bmp.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                var row = new byte[W0 * 4];
                for (int y = 0; y < H0; y++)
                {
                    System.Runtime.InteropServices.Marshal.Copy(bd.Scan0 + y * bd.Stride, row, 0, W0 * 4);
                    for (int x = 0; x < W0; x++)
                    {
                        byte B = row[x * 4], G = row[x * 4 + 1], R = row[x * 4 + 2], A = row[x * 4 + 3];
                        if (A < 250) anyClear = true;
                        a[y * W0 + x] = (byte)(A >= 100 ? (R >= 250 && G >= 250 && B >= 250 ? 2 : 1) : 0);   // 0 ใส · 1 เนื้อ · 2 ขาวทึบ
                    }
                }
            }
            finally { bmp.UnlockBits(bd); }
            // ภาพมีพื้นใส → ขาวก็นับเป็นเนื้องาน · ภาพทึบทั้งแผ่น (พื้นขาว) → ตัดขาวออก
            int pad = (int)Math.Ceiling(Math.Abs(offPx)) + 3, W = W0 + 2 * pad, H = H0 + 2 * pad;
            var m = new bool[W * H]; int nIn = 0;
            for (int y = 0; y < H0; y++)
                for (int x = 0; x < W0; x++)
                {
                    var v = a[y * W0 + x];
                    bool on = anyClear ? v != 0 : v == 1;
                    if (on) { m[(y + pad) * W + x + pad] = true; nIn++; }
                }
            info = W0 + "x" + H0 + (anyClear ? " alpha" : " white-bg") + " fg=" + nIn;
            if (nIn == 0) throw new Exception("ไม่พบเนื้องานในภาพ");
            return FromMask(m, W, H, pad, offPx);
        }
        public static List<List<double[]>> FromMask(bool[] m, int W, int H, int pad, double offPx)
        {
            FillHoles(m, W, H);
            // ระยะห่าง: นอกงาน = ระยะถึงเนื้องาน · ในงาน = ระยะถึงขอบ (ติดลบ)
            var dOut = Edt(m, W, H, true); var dIn = Edt(m, W, H, false);
            var f = new double[W * H];
            for (int i = 0; i < f.Length; i++) f[i] = m[i] ? -(Math.Sqrt(dIn[i]) - 0.5) : Math.Sqrt(dOut[i]) - 0.5;
            var loops = March(f, W, H, offPx);
            // คืนพิกัดเทียบภาพเดิม (ตัด pad) · เก็บเฉพาะวงนอก (ไม่อยู่ในวงอื่น) ที่ไม่เล็กจิ๋ว
            var outl = new List<List<double[]>>();
            foreach (var L in loops) { foreach (var p in L) { p[0] -= pad; p[1] -= pad; } }
            var areas = loops.Select(L => Math.Abs(Area(L))).ToList();
            for (int i = 0; i < loops.Count; i++)
            {
                if (areas[i] < 4) continue;
                bool inner = false;
                for (int j = 0; j < loops.Count && !inner; j++) if (j != i && areas[j] > areas[i] && Inside(loops[j], loops[i][0])) inner = true;
                if (!inner) outl.Add(loops[i]);
            }
            return outl;
        }

        static void FillHoles(bool[] m, int W, int H)
        {   // พื้นหลังที่ต่อถึงขอบภาพ = ข้างนอก · ที่เหลือ (รูในตัวงาน) → เติมเป็นเนื้องาน
            var outside = new bool[W * H]; var st = new Stack<int>();
            for (int x = 0; x < W; x++) { st.Push(x); st.Push((H - 1) * W + x); }
            for (int y = 0; y < H; y++) { st.Push(y * W); st.Push(y * W + W - 1); }
            while (st.Count > 0)
            {
                int i = st.Pop(); if (i < 0 || i >= m.Length || outside[i] || m[i]) continue;
                outside[i] = true; int x = i % W, y = i / W;
                if (x > 0) st.Push(i - 1); if (x < W - 1) st.Push(i + 1); if (y > 0) st.Push(i - W); if (y < H - 1) st.Push(i + W);
            }
            for (int i = 0; i < m.Length; i++) if (!outside[i]) m[i] = true;
        }

        // ระยะยุคลิดกำลังสอง (Felzenszwalb) ถึงพิกเซลที่ m == target
        static double[] Edt(bool[] m, int W, int H, bool target)
        {
            const double INF = 1e20;
            var g = new double[W * H];
            for (int i = 0; i < g.Length; i++) g[i] = m[i] == target ? 0 : INF;
            var f = new double[Math.Max(W, H)]; var d = new double[Math.Max(W, H)];
            var v = new int[Math.Max(W, H)]; var z = new double[Math.Max(W, H) + 1];
            for (int x = 0; x < W; x++) { for (int y = 0; y < H; y++) f[y] = g[y * W + x]; Dt1(f, H, d, v, z); for (int y = 0; y < H; y++) g[y * W + x] = d[y]; }
            for (int y = 0; y < H; y++) { for (int x = 0; x < W; x++) f[x] = g[y * W + x]; Dt1(f, W, d, v, z); for (int x = 0; x < W; x++) g[y * W + x] = d[x]; }
            return g;
        }
        static void Dt1(double[] f, int n, double[] d, int[] v, double[] z)
        {
            int k = 0; v[0] = 0; z[0] = double.NegativeInfinity; z[1] = double.PositiveInfinity;
            for (int q = 1; q < n; q++)
            {
                double s = ((f[q] + (double)q * q) - (f[v[k]] + (double)v[k] * v[k])) / (2.0 * q - 2.0 * v[k]);
                while (s <= z[k]) { k--; s = ((f[q] + (double)q * q) - (f[v[k]] + (double)v[k] * v[k])) / (2.0 * q - 2.0 * v[k]); }
                k++; v[k] = q; z[k] = s; z[k + 1] = double.PositiveInfinity;
            }
            k = 0;
            for (int q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (double)(q - v[k]) * (q - v[k]) + f[v[k]]; }
        }

        // marching squares: เส้นที่ f = iso (ข้างใน = f < iso) → รวมเป็นวงปิด
        static List<List<double[]>> March(double[] f, int W, int H, double iso)
        {
            var next = new Dictionary<long, long>(); var pts = new Dictionary<long, double[]>();
            Func<int, int, int, long> key = (x, y, e) => ((long)y * (W + 1) + x) * 2 + e;   // e: 0 = ขอบนอน (x,y)-(x+1,y) · 1 = ขอบตั้ง (x,y)-(x,y+1)
            Func<int, int, int, double[]> pt = (x, y, e) =>
            {
                double a = f[y * W + x], b = e == 0 ? f[y * W + x + 1] : f[(y + 1) * W + x];
                double t = Math.Abs(b - a) < 1e-12 ? 0.5 : (iso - a) / (b - a); t = Math.Max(0, Math.Min(1, t));
                return e == 0 ? new[] { x + t, (double)y } : new[] { (double)x, y + t };
            };
            for (int y = 0; y < H - 1; y++)
                for (int x = 0; x < W - 1; x++)
                {
                    bool tl = f[y * W + x] < iso, tr = f[y * W + x + 1] < iso, br = f[(y + 1) * W + x + 1] < iso, bl = f[(y + 1) * W + x] < iso;
                    int c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
                    if (c == 0 || c == 15) continue;
                    long T = key(x, y, 0), B = key(x, y + 1, 0), Lf = key(x, y, 1), Rt = key(x + 1, y, 1);
                    // ทิศทาง: เดินให้ข้างในอยู่ทางขวาเสมอ (ทุกวงทิศเดียวกัน)
                    Action<long, long> seg = (p, q) => { next[p] = q; };
                    switch (c)
                    {
                        case 1: seg(Lf, B); break;
                        case 2: seg(B, Rt); break;
                        case 3: seg(Lf, Rt); break;
                        case 4: seg(Rt, T); break;
                        case 5: seg(Lf, T); seg(Rt, B); break;
                        case 6: seg(B, T); break;
                        case 7: seg(Lf, T); break;
                        case 8: seg(T, Lf); break;
                        case 9: seg(T, B); break;
                        case 10: seg(T, Rt); seg(B, Lf); break;
                        case 11: seg(T, Rt); break;
                        case 12: seg(Rt, Lf); break;
                        case 13: seg(Rt, B); break;
                        case 14: seg(B, Lf); break;
                    }
                }
            Func<long, double[]> P = k => { double[] p; if (!pts.TryGetValue(k, out p)) { long e = k % 2, cell = k / 2; int x = (int)(cell % (W + 1)), y = (int)(cell / (W + 1)); p = pt(x, y, (int)e); pts[k] = p; } return p; };
            var loops = new List<List<double[]>>(); var used = new HashSet<long>();
            foreach (var s in next.Keys.ToList())
            {
                if (used.Contains(s)) continue;
                var L = new List<double[]>(); long k = s; int guard = 0;
                while (!used.Contains(k) && next.ContainsKey(k) && guard++ < 10000000) { used.Add(k); var p = P(k); L.Add(new[] { p[0], p[1] }); k = next[k]; }
                if (L.Count >= 3 && k == s) loops.Add(L);
            }
            return loops;
        }

        public static double Area(List<double[]> L)
        {
            double s = 0; for (int i = 0, j = L.Count - 1; i < L.Count; j = i++) s += (L[j][0] * L[i][1] - L[i][0] * L[j][1]); return s / 2;
        }
        static bool Inside(List<double[]> L, double[] p)
        {
            bool c = false;
            for (int i = 0, j = L.Count - 1; i < L.Count; j = i++)
                if (((L[i][1] > p[1]) != (L[j][1] > p[1])) && (p[0] < (L[j][0] - L[i][0]) * (p[1] - L[i][1]) / (L[j][1] - L[i][1]) + L[i][0])) c = !c;
            return c;
        }

        // เกลาเส้น: ตัดจุดเกิน (Douglas-Peucker แบบวงปิด) → เฉลี่ย 1-2-1 → จุดคุมแบบ Catmull-Rom
        // คืน [x, y, inX, inY, outX, outY] ต่อจุด
        public static List<double[]> Smooth(List<double[]> L, double tolPx)
        {
            var pts = L;
            for (int pass = 0; pass < 2; pass++)
            {
                var o = new List<double[]>(pts.Count);
                for (int i = 0; i < pts.Count; i++)
                {
                    var a = pts[(i - 1 + pts.Count) % pts.Count]; var b = pts[i]; var c = pts[(i + 1) % pts.Count];
                    o.Add(new[] { (a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4 });
                }
                pts = o;
            }
            pts = Dp(pts, tolPx);
            var outp = new List<double[]>();
            int n = pts.Count;
            for (int i = 0; i < n; i++)
            {
                var p0 = pts[(i - 1 + n) % n]; var p1 = pts[i]; var p2 = pts[(i + 1) % n];
                double ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
                double la = Math.Sqrt(ax * ax + ay * ay), lb = Math.Sqrt(bx * bx + by * by);
                double cos = la > 1e-9 && lb > 1e-9 ? (ax * bx + ay * by) / (la * lb) : 1;
                if (cos < 0.77) { outp.Add(new[] { p1[0], p1[1], p1[0], p1[1], p1[0], p1[1] }); continue; }   // หักมุมเกิน ~40° = มุมแหลม ไม่ทำโค้ง
                double tx = p2[0] - p0[0], ty = p2[1] - p0[1], tl = Math.Sqrt(tx * tx + ty * ty);
                if (tl < 1e-9) { outp.Add(new[] { p1[0], p1[1], p1[0], p1[1], p1[0], p1[1] }); continue; }
                tx /= tl; ty /= tl;
                double hi = la / 3, ho = lb / 3;
                outp.Add(new[] { p1[0], p1[1], p1[0] - tx * hi, p1[1] - ty * hi, p1[0] + tx * ho, p1[1] + ty * ho });
            }
            return outp;
        }
        static List<double[]> Dp(List<double[]> pts, double tol)
        {
            if (pts.Count < 8) return pts;
            // แบ่งวงที่จุดไกลสุดสองจุด แล้วทำ DP แต่ละครึ่ง
            int a = 0, b = 0; double best = -1;
            for (int i = 0; i < pts.Count; i++) { double d = Sq(pts[i], pts[0]); if (d > best) { best = d; b = i; } }
            var keep = new bool[pts.Count]; keep[a] = keep[b] = true;
            DpRec(pts, a, b, tol * tol, keep); DpRec(pts, b, pts.Count, tol * tol, keep);
            var o = new List<double[]>(); for (int i = 0; i < pts.Count; i++) if (keep[i]) o.Add(pts[i]);
            return o.Count >= 4 ? o : pts;
        }
        static void DpRec(List<double[]> P, int i0, int i1, double tol2, bool[] keep)
        {
            if (i1 - i0 < 2) return;
            var A = P[i0]; var B = P[i1 % P.Count]; int idx = -1; double best = tol2;
            for (int i = i0 + 1; i < i1; i++) { double d = SegD2(P[i], A, B); if (d > best) { best = d; idx = i; } }
            if (idx < 0) return;
            keep[idx] = true; DpRec(P, i0, idx, tol2, keep); DpRec(P, idx, i1, tol2, keep);
        }
        static double Sq(double[] a, double[] b) { double dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; }
        static double SegD2(double[] p, double[] a, double[] b)
        {
            double vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
            double t = L2 < 1e-12 ? 0 : Math.Max(0, Math.Min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
            double x = a[0] + t * vx - p[0], y = a[1] + t * vy - p[1]; return x * x + y * y;
        }
    }
}
