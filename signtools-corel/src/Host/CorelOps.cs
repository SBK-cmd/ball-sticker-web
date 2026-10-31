// Sign Tools for CorelDRAW — คำสั่งที่ทำงานกับเอกสาร Corel (เทียบกับ jsx/host.jsx ของ Illustrator)
// ใช้ COM แบบ late-bound (dynamic) → ไม่ผูกกับเวอร์ชัน Corel (X7 … 2024+)
// หน่วย: ตั้งเอกสารเป็นมิลลิเมตรระหว่างทำงาน แล้วคืนค่าเดิม · แกน Y ชี้ขึ้น (เหมือน Illustrator ที่แผงใช้)
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace SignTools
{
    public class CorelOps
    {
        const int cdrMillimeter = 3;
        const int cdrTextShape = 6, cdrBitmapShape = 5, cdrGroupShape = 7, cdrGuidelineShape = 9;
        readonly dynamic app;
        readonly string appDir;
        static readonly CultureInfo IC = CultureInfo.InvariantCulture;

        public CorelOps(object app, string appDir) { this.app = app; this.appDir = appDir; }

        public string CorelVersion()
        {
            try { return Convert.ToString(app.VersionMajor) + "." + Convert.ToString(app.VersionMinor); } catch { return ""; }
        }

        // 'st_cutRead()' / 'st_xxx({...})' → เรียกเมธอดชื่อเดียวกันในคลาสนี้
        public string Eval(string script)
        {
            var m = Regex.Match(script.Trim(), @"^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*;?$");
            if (!m.Success) return Err("คำสั่งนี้ใช้ใน CorelDRAW ไม่ได้");
            var name = m.Groups[1].Value; var argText = m.Groups[2].Value.Trim();
            var mi = GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (mi == null || mi.ReturnType != typeof(string) || mi.DeclaringType != GetType())
                return Err("ฟังก์ชันนี้ยังไม่รองรับใน CorelDRAW (กำลังทำ)");
            object arg = argText == "" ? null : Host.J.DeserializeObject(argText);
            var ps = mi.GetParameters();
            try { return (string)mi.Invoke(this, ps.Length == 0 ? new object[0] : new[] { arg }); }
            catch (TargetInvocationException ex) { return Err((ex.InnerException ?? ex).Message); }
        }

        // ---------- ตัวช่วย ----------
        static string Q(string s)
        {
            var b = new StringBuilder("\"");
            foreach (var c in s ?? "")
            {
                if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
                else if (c < 32 || c > 126) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c);
            }
            return b.Append('"').ToString();
        }
        static string Err(string m) { return "{\"error\":" + Q(m) + "}"; }
        static string N(double v) { return (Math.Round(v * 1000) / 1000).ToString(IC); }
        dynamic Doc()
        {
            dynamic d = null;
            try { if ((int)app.Documents.Count > 0) d = app.ActiveDocument; } catch { }
            if (d == null) throw new Exception("ยังไม่ได้เปิดไฟล์ใน CorelDRAW");
            return d;
        }
        // ทำงานในหน่วย มม. แล้วคืนหน่วยเดิม
        T InMM<T>(object docObj, Func<T> f)
        {
            dynamic doc = docObj;
            int old = -1;
            try { old = (int)doc.Unit; doc.Unit = cdrMillimeter; } catch { }
            try { return f(); }
            finally { try { if (old >= 0) doc.Unit = old; } catch { } }
        }
        static int Count(dynamic coll) { try { return (int)coll.Count; } catch { return 0; } }

        static readonly Regex KissRx = new Regex(@"kiss|cut\s*contour|contour\s*cut|^cut|เส้นตัด|ไดคัท|ตัด", RegexOptions.IgnoreCase);
        static readonly Regex DieRx = new Regex(@"die|thru|through|ตัดขาด", RegexOptions.IgnoreCase);
        static string OutlineName(object so)
        {
            dynamic s = so;
            try { if ((int)s.Outline.Type == 0) return null; } catch { }
            try { return Convert.ToString(s.Outline.Color.Name); } catch { return ""; }
        }
        static string LayerName(object so) { dynamic s = so; try { return Convert.ToString(s.Layer.Name); } catch { return ""; } }
        // ชนิดเส้น: ชื่อสีเส้น (สปอต CutContour / DieCut) ก่อน แล้วค่อยดูชื่อเลเยอร์
        static string KindOf(object s)
        {
            var c = OutlineName(s) ?? ""; var l = LayerName(s);
            if (DieRx.IsMatch(c)) return "die";
            if (KissRx.IsMatch(c)) return "kiss";
            if (DieRx.IsMatch(l)) return "die";
            return "kiss";
        }
        static bool IsCut(object s)
        {
            var c = OutlineName(s); var l = LayerName(s);
            if (c != null && (KissRx.IsMatch(c) || DieRx.IsMatch(c))) return true;
            return Regex.IsMatch(l, @"kiss|die|cut\s*contour|^cut|thru|ตัด", RegexOptions.IgnoreCase) && !Regex.IsMatch(l, @"^reg_|ตัวอย่าง", RegexOptions.IgnoreCase);
        }

        // เส้นโค้งของรูปทรง → [{c, k, p:[ax,ay,lx,ly,rx,ry,...]}] ทีละ subpath (หน่วยตามเอกสาร = มม.)
        static int CurveOut(object shapeObj, string kind, List<string> outp)
        {
            dynamic shape = shapeObj; int npts = 0;
            dynamic crv;
            try { crv = shape.DisplayCurve; } catch { crv = null; }
            if (crv == null) { try { crv = shape.Curve; } catch { return 0; } }
            int nsp = Count(crv.SubPaths);
            for (int i = 1; i <= nsp; i++)
            {
                dynamic sp = crv.SubPaths[i];
                bool closed = false; try { closed = (bool)sp.Closed; } catch { }
                int ns = Count(sp.Segments);
                if (ns < 1) continue;
                var A = new List<double[]>();     // [ax, ay, lx, ly, rx, ry]
                for (int k = 1; k <= ns; k++)
                {
                    dynamic sg = sp.Segments[k];
                    double sx = (double)sg.StartNode.PositionX, sy = (double)sg.StartNode.PositionY;
                    double ex = (double)sg.EndNode.PositionX, ey = (double)sg.EndNode.PositionY;
                    double c1x = sx, c1y = sy, c2x = ex, c2y = ey;
                    bool curve = false; try { curve = (int)sg.Type == 1; } catch { }
                    if (curve)
                    {
                        try { c1x = (double)sg.StartingControlPointX; c1y = (double)sg.StartingControlPointY; c2x = (double)sg.EndingControlPointX; c2y = (double)sg.EndingControlPointY; }
                        catch { c1x = sx; c1y = sy; c2x = ex; c2y = ey; }
                    }
                    if (k == 1) A.Add(new[] { sx, sy, sx, sy, c1x, c1y });
                    else { A[A.Count - 1][4] = c1x; A[A.Count - 1][5] = c1y; }
                    A.Add(new[] { ex, ey, c2x, c2y, ex, ey });
                }
                if (closed && A.Count > 1)
                {   // จุดสุดท้ายซ้ำกับจุดแรก → รวมเป็นจุดเดียว (มือจับเข้าของจุดแรก = มือจับเข้าของจุดสุดท้าย)
                    var last = A[A.Count - 1]; A[0][2] = last[2]; A[0][3] = last[3]; A.RemoveAt(A.Count - 1);
                }
                if (A.Count < 2) continue;
                npts += A.Count;
                outp.Add("{\"c\":" + (closed ? 1 : 0) + ",\"k\":\"" + kind + "\",\"p\":[" + string.Join(",", A.Select(a => string.Join(",", a.Select(N)))) + "]}");
            }
            return npts;
        }
        // ลงไปในกลุ่ม (group / power clip ไม่นับ)
        static void Walk(object shapeObj, Action<object> f, Action<object> other)
        {
            dynamic shape = shapeObj;
            int t = -1; try { t = (int)shape.Type; } catch { }
            if (t == cdrGuidelineShape) return;
            int nn = 0; if (t == cdrGroupShape || t == 10 || t == 11 || t == 13 || t == 15 || t == 16) { try { nn = Count(shape.Shapes); } catch { } }
            if (nn > 0) { for (int i = 1; i <= nn; i++) Walk((object)shape.Shapes[i], f, other); return; }
            if (t == cdrTextShape || t == cdrBitmapShape) { other(shape); return; }
            f(shape);
        }
        static IEnumerable<object> PageLayers(object pageObj)
        {
            dynamic page = pageObj;
            int n = Count(page.Layers);
            for (int i = 1; i <= n; i++)
            {
                dynamic L = page.Layers[i];
                bool skip = false;
                try { if (!(bool)L.Visible) skip = true; } catch { }
                try { if ((bool)L.IsSpecialLayer) skip = true; } catch { }
                if (!skip) yield return (object)L;
            }
        }
        static double[] Box(object so) { dynamic s = so; return new[] { (double)s.LeftX, (double)s.BottomY, (double)s.RightX, (double)s.TopY }; }
        static double[] PageBox(object docObj, object pageObj)
        {
            dynamic page = pageObj;
            try { return new[] { (double)page.LeftX, (double)page.BottomY, (double)page.RightX, (double)page.TopY }; }
            catch { }
            double w = (double)page.SizeWidth, h = (double)page.SizeHeight;
            return new[] { 0.0, 0.0, w, h };
        }

        // ================= คำสั่งที่แผงเรียก =================
        public string st_info()
        {
            try
            {
                if ((int)app.Documents.Count == 0) return "{\"artboards\":0}";
                dynamic d = app.ActiveDocument;
                return "{\"artboards\":" + (int)d.Pages.Count + ",\"active\":" + ((int)d.ActivePage.Index - 1) + "}";
            }
            catch (Exception e) { return Err(e.Message); }
        }
        public string st_lastCrash() { return "{\"none\":true}"; }

        public string st_docInfo()
        {
            dynamic doc = Doc();
            return InMM((object)doc, (Func<string>)(() =>
            {
                string path = ""; try { path = Convert.ToString(doc.FullFileName); } catch { }
                var abs = new List<string>(); int n = (int)doc.Pages.Count;
                for (int i = 1; i <= n; i++)
                {
                    dynamic p = doc.Pages[i]; string nm = ""; try { nm = Convert.ToString(p.Name); } catch { }
                    abs.Add("{\"i\":" + (i - 1) + ",\"name\":" + Q(nm == "" ? "หน้า " + i : nm) + ",\"w\":" + N((double)p.SizeWidth) + ",\"h\":" + N((double)p.SizeHeight) + "}");
                }
                string name = ""; try { name = Convert.ToString(doc.FileName); } catch { } if (name == "") try { name = Convert.ToString(doc.Title); } catch { }
                return "{\"name\":" + Q(name) + ",\"path\":" + Q(path) + ",\"active\":" + ((int)doc.ActivePage.Index - 1) + ",\"artboards\":[" + string.Join(",", abs) + "]}";
            }));
        }

        // มาร์ค (เลเยอร์ reg_1 แบบเดียวกับที่ Sign Tools / Cutting Master 5 สร้าง)
        string CutMarks(object page, double[] pb)
        {
            try
            {
                foreach (dynamic L in PageLayers(page))
                {
                    var m = Regex.Match(Convert.ToString(L.Name), @"^reg_1 (\d+) ");
                    if (!m.Success) continue;
                    int code = int.Parse(m.Groups[1].Value), n = 0; double[] U = null;
                    int ns = Count(L.Shapes);
                    for (int i = 1; i <= ns; i++)
                    {
                        var b = Box((object)L.Shapes[i]); double cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
                        if (cx < pb[0] || cx > pb[2] || cy < pb[1] || cy > pb[3]) continue;
                        n++;
                        if (U == null) U = b; else U = new[] { Math.Min(U[0], b[0]), Math.Min(U[1], b[1]), Math.Max(U[2], b[2]), Math.Max(U[3], b[3]) };
                    }
                    if (n < 4) return null;
                    double len = 15, ox = U[0] + len, oy = U[1] + len, rx = U[2] - len, ty = U[3] - len;
                    return "{\"style\":" + code + ",\"seg\":" + (code == 7 ? "true" : "false") + ",\"stepMM\":250,\"n\":" + n + ",\"ox\":" + N(ox) + ",\"oy\":" + N(oy) + ",\"dx\":" + N(ty - oy) + ",\"dy\":" + N(rx - ox) + ",\"lenMM\":" + N(len) + "}";
                }
            }
            catch { }
            return null;
        }

        public string st_cutRead()
        {
            dynamic doc = Doc();
            return InMM((object)doc, (Func<string>)(() =>
            {
                var outp = new List<string>(); int npts = 0, text = 0, other = 0; string src;
                dynamic sel = null; int nsel = 0;
                try { sel = app.ActiveSelectionRange; nsel = Count(sel); } catch { }
                object page = doc.ActivePage; var pb = PageBox((object)doc, page);
                if (nsel > 0)
                {
                    src = "sel";
                    for (int i = 1; i <= nsel; i++)
                    {
                        Walk((object)sel[i], s => { npts += CurveOut(s, KindOf(s), outp); }, so => { dynamic s = so; int t = -1; try { t = (int)s.Type; } catch { } if (t == cdrTextShape) text++; else other++; });
                    }
                }
                else
                {
                    src = "cut";
                    foreach (dynamic L in PageLayers(page))
                    {
                        string ln = ""; try { ln = Convert.ToString(L.Name); } catch { }
                        if (ln.StartsWith("reg_")) continue;
                        int ns = Count(L.Shapes);
                        for (int i = 1; i <= ns; i++)
                            Walk((object)L.Shapes[i], s =>
                            {
                                if (!IsCut(s)) return;
                                try { var b = Box(s); double cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; if (cx < pb[0] || cx > pb[2] || cy < pb[1] || cy > pb[3]) return; } catch { }
                                npts += CurveOut(s, KindOf(s), outp);
                            }, s => { });
                    }
                }
                var mk = CutMarks(page, pb);
                return "{\"src\":\"" + src + "\",\"text\":" + text + ",\"other\":" + other + ",\"n\":" + outp.Count + ",\"pts\":" + npts + ",\"paths\":[" + string.Join(",", outp) + "]" + (mk != null ? ",\"marks\":" + mk : "") + "}";
            }));
        }
    }
}
