// Sign Tools for CorelDRAW — เรียงสติ๊กเกอร์ (เทียบ st_stkRead / st_stkPreview / st_stkPlace ของ Illustrator)
// หน่วยที่คุยกับแผง = มม. (คืน sf = 72/25.4 → แผงใช้ MM = 1) · พิกัด Corel: y ขึ้น · กล่อง Box() = [ซ้าย, ล่าง, ขวา, บน]
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;

namespace SignTools
{
    public partial class CorelOps
    {
        const string PV_LAYER = "ตัวอย่างเส้นตัด";

        int K(string name, int fb) { return CorelConst.Get((object)app, name, fb); }
        static double Dbl(object o, string k, double d)
        {
            var m = o as Dictionary<string, object>; object v;
            if (m == null || !m.TryGetValue(k, out v) || v == null) return d;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return d; }
        }
        static string Str(object o, string k) { var m = o as Dictionary<string, object>; object v; return m != null && m.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : ""; }
        static object Obj(object o, string k) { var m = o as Dictionary<string, object>; object v; return m != null && m.TryGetValue(k, out v) ? v : null; }
        static object[] Arr(object o) { if (o is object[]) return (object[])o; if (o is System.Collections.ArrayList) return ((System.Collections.ArrayList)o).ToArray(); return new object[0]; }
        static string Js(IEnumerable<string> a) { return "[" + string.Join(",", a.Select(Q)) + "]"; }
        static double[] Union(double[] a, double[] b) { if (a == null) return b == null ? null : (double[])b.Clone(); if (b == null) return a; return new[] { Math.Min(a[0], b[0]), Math.Min(a[1], b[1]), Math.Max(a[2], b[2]), Math.Max(a[3], b[3]) }; }
        static double Ov(double[] a, double[] b) { double w = Math.Min(a[2], b[2]) - Math.Max(a[0], b[0]), h = Math.Min(a[3], b[3]) - Math.Max(a[1], b[1]); return w > 0 && h > 0 ? w * h : 0; }

        // ---------- รูปแบบงานที่เลือก ----------
        class Design { public object art; public List<object> ext = new List<object>(); }
        static List<object> Leaves(object s) { var o = new List<object>(); Walk(s, x => o.Add(x), x => o.Add(x)); return o; }
        static bool NoFill(object so) { dynamic s = so; try { return (int)s.Fill.Type == 0; } catch { return false; } }
        static bool IsCutLeaf(object s) { return IsCut(s) && NoFill(s); }
        static bool CutOnly(object s) { var l = Leaves(s); return l.Count > 0 && l.All(IsCutLeaf); }
        static List<object> OwnCuts(object s) { return Leaves(s).Where(IsCutLeaf).ToList(); }
        static double[] ArtBox(object s)
        {   // ขอบงาน ไม่นับเส้นตัดในกลุ่ม
            double[] b = null;
            foreach (var x in Leaves(s)) if (!IsCutLeaf(x)) try { b = Union(b, Box(x)); } catch { }
            return b ?? Box(s);
        }
        static bool HasBitmap(object s) { foreach (var x in Leaves(s)) { dynamic d = x; try { if ((int)d.Type == cdrBitmapShape) return true; } catch { } } return false; }

        List<Design> Designs(out object selRange)
        {
            dynamic sel = null; int n = 0;
            try { sel = app.ActiveSelectionRange; n = Count(sel); } catch { }
            selRange = sel;
            if (n == 0) throw new Exception("เลือกสติ๊กเกอร์ก่อน (เลือกได้หลายตัว แต่ละตัวควรเป็น 1 กลุ่ม)");
            var arts = new List<Design>(); var cuts = new List<object>();
            for (int i = 1; i <= n; i++) { object s = sel[i]; if (CutOnly(s)) cuts.Add(s); else arts.Add(new Design { art = s }); }
            if (arts.Count == 0) throw new Exception("เลือกมีแต่เส้นตัด — เลือกตัวงานด้วย");
            foreach (var c in cuts)
            {
                var cb = Box(c); Design best = null; double bo = 0;
                foreach (var d in arts) { var ov = Ov(cb, Box(d.art)); if (ov > bo) { bo = ov; best = d; } }
                if (best != null) best.ext.Add(c);
            }
            return arts;
        }

        public string st_stkRead()
        {
            dynamic doc = Doc();
            return InMM((object)doc, (Func<string>)(() =>
            {
                object sr; var ds = Designs(out sr);
                if (ds.Count > 30) return Err("เลือกได้ไม่เกิน 30 ลายต่อครั้ง");
                var outp = new List<string>();
                for (int i = 0; i < ds.Count; i++)
                {
                    dynamic a = ds[i].art; var own = OwnCuts(ds[i].art); own.AddRange(ds[i].ext);
                    double[] cb = null; foreach (var c in own) cb = Union(cb, Box(c));
                    var vb = ArtBox(ds[i].art);
                    string nm = ""; try { nm = Convert.ToString(a.Name); } catch { }
                    if (string.IsNullOrEmpty(nm)) nm = "ลายที่ " + (i + 1);
                    outp.Add("{\"i\":" + i + ",\"name\":" + Q(nm) + ",\"vb\":" + B4(vb) + ",\"cut\":" + (cb != null ? B4(cb) : "null") +
                        ",\"raster\":" + (HasBitmap(ds[i].art) ? "true" : "false") + ",\"ownCuts\":" + own.Count + "}");
                }
                return "{\"sf\":" + N(72 / 25.4) + ",\"unit\":\"mm\",\"items\":[" + string.Join(",", outp) + "]}";
            }));
        }
        static string B4(double[] b) { return "[" + N(b[0]) + "," + N(b[3]) + "," + N(b[2]) + "," + N(b[1]) + "]"; }   // แบบ Illustrator [ซ้าย, บน, ขวา, ล่าง]

        // ---------- เส้นตัด ----------
        void StyleCut(object so, bool die)
        {
            dynamic s = so;
            foreach (var x in Leaves(so))
            {
                dynamic l = x;
                try { l.Fill.ApplyNoFill(); } catch { }
                try { l.Outline.Width = 0.25; } catch { }
                try { if (die) l.Outline.Color.CMYKAssign(100, 0, 100, 0); else l.Outline.Color.CMYKAssign(0, 100, 0, 0); } catch { }
                try { l.OverprintOutline = true; } catch { }
                try { l.Name = die ? "DieCut" : "CutContour"; } catch { }
            }
        }
        object MoveTo(object so, double[] target)
        {   // จัดให้กล่องของรูปตรงกับ target [L,B,R,T] (มุมซ้ายล่าง)
            dynamic s = so; var b = Box(so); s.Move(target[0] - b[0], target[1] - b[1]); return so;
        }
        object ShapeCut(object layerObj, double[] b, string type, double off, double rad, bool die)
        {
            dynamic layer = layerObj;
            double L = b[0] - off, Bt = b[1] - off, W = (b[2] - b[0]) + 2 * off, H = (b[3] - b[1]) + 2 * off;
            dynamic s;
            if (type == "circle")
            {
                double d = Math.Max(W, H), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
                s = layer.CreateEllipse2(cx, cy, d / 2, d / 2);
            }
            else if (type == "ellipse") s = layer.CreateEllipse2((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, W / 2, H / 2);
            else
            {
                double r = Math.Max(0, Math.Min(rad, Math.Min(W, H) / 2));
                s = layer.CreateRectangle2(L, Bt, W, H, r, r, r, r);
                MoveTo((object)s, new[] { L, Bt });
            }
            StyleCut((object)s, die);
            return s;
        }

        // ไดคัทตามรูป: ส่งออกงานเป็น PNG (พื้นใส) → หาเส้นรอบนอกด้วยระยะยุคลิด → เส้นโค้งใน Corel
        // offs = ระยะขยาย (มม.) ที่ต้องการ เช่น [kiss] หรือ [kiss, kiss+die] · คืนรูปทรงตามลำดับ
        List<object> ContourCuts(object docObj, object layerObj, object art, double[] offs, bool[] dies, List<string> warn)
        {
            dynamic doc = docObj, layer = layerObj;
            dynamic dup = ((dynamic)art).Duplicate(0, 0);
            string tmp = Path.Combine(Path.GetTempPath(), "st_contour_" + Guid.NewGuid().ToString("N") + ".png");
            try
            {
                foreach (var c in OwnCuts((object)dup)) { try { ((dynamic)c).Delete(); } catch { } }
                var bb = Box((object)dup);
                double wmm = bb[2] - bb[0], hmm = bb[3] - bb[1], longIn = Math.Max(wmm, hmm) / 25.4;
                int res = (int)Math.Max(36, Math.Min(200, 2000 / Math.Max(longIn, 0.1)));
                dup.CreateSelection();
                dynamic ef = doc.ExportBitmap(tmp, K("cdrPNG", 802), K("cdrSelection", 1), K("cdrRGBColorImage", 4), 0, 0, res, res,
                    K("cdrNormalAntiAliasing", 1), false, true, false, false, K("cdrCompressionNone", 0));
                if (ef != null) try { ef.Finish(); } catch { }
                if (!File.Exists(tmp)) throw new Exception("ส่งออกภาพเพื่อหาขอบไม่สำเร็จ");
                var outShapes = new List<object>();
                using (var bmp = new Bitmap(tmp))
                {
                    double sx = wmm / bmp.Width, sy = hmm / bmp.Height, pxmm = (sx + sy) / 2;
                    for (int k = 0; k < offs.Length; k++)
                    {
                        string info;
                        var loops = Contour.FromImage(bmp, offs[k] / pxmm, out info);
                        if (loops.Count == 0) throw new Exception("หาขอบไม่เจอ (" + info + ")");
                        dynamic crv = doc.CreateCurve();
                        foreach (var lp in loops)
                        {
                            var P = Contour.Smooth(lp, 0.6);
                            Func<double, double> X = px => bb[0] + px * sx; Func<double, double> Y = py => bb[3] - py * sy;
                            dynamic sp = crv.CreateSubPath(X(P[0][0]), Y(P[0][1]));
                            for (int i = 1; i <= P.Count; i++)
                            {
                                var a = P[i - 1]; var b = P[i % P.Count];
                                try { sp.AppendCurveSegment2(X(b[0]), Y(b[1]), X(a[4]), Y(a[5]), X(b[2]), Y(b[3])); }
                                catch { sp.AppendLineSegment(X(b[0]), Y(b[1])); }
                            }
                            try { sp.Closed = true; } catch { }
                        }
                        dynamic s = layer.CreateCurve(crv);
                        StyleCut((object)s, dies[k]);
                        outShapes.Add(s);
                    }
                }
                return outShapes;
            }
            finally
            {
                try { dup.Delete(); } catch { }
                try { File.Delete(tmp); } catch { }
            }
        }

        // เตรียมเส้นตัดของ 1 ลาย (kiss + die) บนเลเยอร์ dest · o = ตัวเลือกจากแผง
        void MakeCuts(object docObj, object destObj, Design d, object o, List<string> warn, int idx, out object cut, out object die)
        {
            dynamic doc = docObj, dest = destObj;
            string type = Str(o, "cutType"); double off = Dbl(o, "offsetMM", 2), rad = Dbl(o, "radiusMM", 0);
            object dieO = Obj(o, "die"); bool hasDie = dieO != null;
            string dShape = hasDie ? Str(dieO, "shape") : ""; double dOff = hasDie ? Dbl(dieO, "offMM", 3) : 0, dRad = hasDie ? Dbl(dieO, "radMM", 5) : 0;
            cut = null; die = null;
            var vb = ArtBox(d.art);
            if (type == "own")
            {
                var own = OwnCuts(d.art); own.AddRange(d.ext);
                if (own.Count == 0) warn.Add((idx + 1) + ": ไม่พบเส้นตัดที่วาดเอง (เลเยอร์/สีชื่อ Cut) → ใช้สี่เหลี่ยมมุมมนแทน");
                else
                {
                    dynamic sr = app.CreateShapeRange();
                    foreach (var c in own) { dynamic x = ((dynamic)c).Duplicate(0, 0); x.MoveToLayer(dest); sr.Add(x); }
                    cut = Count(sr) > 1 ? sr.Group() : sr[1];
                    StyleCut(cut, false);
                }
            }
            else if (type == "contour")
            {
                try
                {
                    bool same = hasDie && dShape == "same";
                    List<object> r = ContourCuts((object)doc, (object)dest, d.art, same ? new[] { off, off + dOff } : new[] { off }, same ? new[] { false, true } : new[] { false }, warn);
                    cut = r[0]; if (same) die = r[1];
                }
                catch (Exception ex) { warn.Add((idx + 1) + ": ทำไดคัทตามรูปไม่ได้ (" + ex.Message + ") → ใช้สี่เหลี่ยมมุมมนแทน"); cut = null; die = null; }
            }
            if (cut == null)
                cut = ShapeCut((object)dest, vb, type == "own" || type == "contour" ? "rect" : type, off, type == "own" || type == "contour" ? Math.Max(rad, 2) : rad, false);
            if (hasDie && die == null)
            {
                if (dShape == "rect" || type == "own" || type == "contour") die = ShapeCut((object)dest, Box(cut), "rect", dOff, dRad, true);
                else die = ShapeCut((object)dest, vb, type, off + dOff, rad + dOff, true);   // วงกลม/วงรี/สี่เหลี่ยม → วาดใหม่ให้ใหญ่ขึ้น
            }
        }

        static dynamic FindLayer(dynamic page, string name)
        {
            int n = Count(page.Layers);
            for (int i = 1; i <= n; i++) { dynamic L = page.Layers[i]; try { if ((string)L.Name == name) return L; } catch { } }
            return null;
        }
        static dynamic EnsureLayer(dynamic page, string name, bool print)
        {
            dynamic L = FindLayer(page, name);
            if (L == null) L = page.CreateLayer(name);
            try { L.Visible = true; L.Editable = true; L.Printable = print; } catch { }
            return L;
        }
        T Batch<T>(object docObj, string title, Func<T> f)
        {
            dynamic doc = docObj;
            try { doc.BeginCommandGroup(title); } catch { }
            try { app.Optimization = true; } catch { }
            try { return f(); }
            finally
            {
                try { app.Optimization = false; } catch { }
                try { doc.EndCommandGroup(); } catch { }
                try { app.Refresh(); } catch { }
                try { app.ActiveWindow.Refresh(); } catch { }
            }
        }

        // ---------- ตัวอย่างเส้นตัดบนงาน ----------
        public string st_stkPreviewClear()
        {
            dynamic doc = Doc();
            dynamic L = FindLayer(doc.ActivePage, PV_LAYER);
            if (L == null) return "{\"ok\":true,\"msg\":" + Q("ไม่มีตัวอย่างค้างอยู่") + "}";
            try { L.Editable = true; } catch { }
            L.Delete();
            return "{\"ok\":true,\"msg\":" + Q("ลบตัวอย่างเส้นตัดแล้ว") + "}";
        }
        public string st_stkPreview(object o)
        {
            dynamic doc = Doc();
            return InMM((object)doc, (Func<string>)(() => Batch<string>((object)doc, "Sign Tools: ตัวอย่างเส้นตัด", (Func<string>)(() =>
            {
                object sr; var ds = Designs(out sr);
                var warn = new List<string>(); var sizes = new List<string>();
                dynamic old = FindLayer(doc.ActivePage, PV_LAYER); if (old != null) { try { old.Editable = true; } catch { } old.Delete(); }
                dynamic PV = EnsureLayer(doc.ActivePage, PV_LAYER, false);
                for (int i = 0; i < ds.Count; i++)
                {
                    object cut, die; MakeCuts((object)doc, (object)PV, ds[i], o, warn, i, out cut, out die);
                    if (die != null && Str(Obj(o, "die"), "only") == "True") { try { ((dynamic)cut).Delete(); } catch { } }
                    var cb = Box(die ?? cut); sizes.Add(N(Math.Round((cb[2] - cb[0]) * 10) / 10) + "×" + N(Math.Round((cb[3] - cb[1]) * 10) / 10));
                }
                if (Obj(o, "credit") != null) warn.Add("เครดิตร้านยังไม่รองรับใน CorelDRAW");
                try { ((dynamic)sr).CreateSelection(); } catch { }
                return "{\"ok\":true,\"msg\":" + Q("สร้างตัวอย่างเส้นตัด " + ds.Count + " ลาย · ขนาดตัด " + string.Join(", ", sizes) + " มม.") + ",\"warn\":" + Js(warn) + "}";
            }))));
        }

        // ---------- สร้างแผ่นงาน ----------
        static readonly double CM5_M = 3, CM5_T = 1, CM5_L = 15, CM5_STEP = 250;
        static string[] Cm5Names(bool seg)
        {
            return new[] { "margin 0.000000 0.000000 0.000000 0.000000", "color 0 0 0 255 0 0 0 0 255 17.007874", "reg_2 0.00 0.00 0.00 0.00 25.00 25.00 25.00 25.00",
                "reg_1 " + (seg ? 7 : 1) + " 1 3.00 1.00 15.00 250.00 1 2 0 1 0.00" };
        }
        dynamic Poly(dynamic doc, dynamic layer, double[][] pts)
        {
            dynamic crv = doc.CreateCurve(); dynamic sp = crv.CreateSubPath(pts[0][0], pts[0][1]);
            for (int i = 1; i < pts.Length; i++) sp.AppendLineSegment(pts[i][0], pts[i][1]);
            sp.AppendLineSegment(pts[0][0], pts[0][1]);
            try { sp.Closed = true; } catch { }
            dynamic s = layer.CreateCurve(crv);
            try { s.Fill.UniformColor.CMYKAssign(0, 0, 0, 100); } catch { try { s.Fill.ApplyUniformFill(app.CreateCMYKColor(0, 0, 0, 100)); } catch { } }
            try { s.Outline.SetNoOutline(); } catch { try { s.Outline.Width = 0; } catch { } }
            try { s.OverprintFill = true; } catch { }
            return s;
        }
        // ตัว L มาร์ค CM5 ที่จุดกลาง (cx,cy) แขนชี้ออก sx (−1 ซ้าย/+1 ขวา) sy (−1 ล่าง/+1 บน)
        void Cm5L(dynamic doc, dynamic layer, double cx, double cy, int sx, int sy)
        {
            double l = CM5_L, h = CM5_T / 2;
            var loc = new[] { new[] { -l, h }, new[] { h, h }, new[] { h, -l }, new[] { -h, -l }, new[] { -h, -h }, new[] { -l, -h } };
            Poly(doc, layer, loc.Select(q => new[] { cx - sx * q[0], cy - sy * q[1] }).ToArray());
        }

        public string st_stkPlace(object o)
        {
            dynamic doc = Doc();
            return InMM((object)doc, (Func<string>)(() => Batch<string>((object)doc, "Sign Tools: สร้างแผ่นงาน", (Func<string>)(() =>
            {
                var warn = new List<string>(); string step = "เริ่ม";
                dynamic stage = null; var newPages = new List<object>(); int made = 0;
                try
                {
                    object sr; var ds = Designs(out sr);
                    if (ds.Count != (int)Dbl(o, "count", -1)) return Err("รายการที่เลือกเปลี่ยนไป — กด \"อ่านสติ๊กเกอร์\" ใหม่อีกครั้ง");
                    if (Obj(o, "credit") != null) warn.Add("เครดิตร้านยังไม่รองรับใน CorelDRAW — ข้ามไปก่อน");
                    dynamic page0 = doc.ActivePage;
                    dynamic oldPv = FindLayer(page0, PV_LAYER); if (oldPv != null) { try { oldPv.Editable = true; } catch { } oldPv.Delete(); }
                    stage = page0.CreateLayer("ST_staging");
                    // 1) ชิ้นต้นแบบ: งาน + เส้นตัด
                    var units = new List<object[]>();
                    for (int i = 0; i < ds.Count; i++)
                    {
                        step = "เตรียมลายที่ " + (i + 1);
                        dynamic art = ((dynamic)ds[i].art).Duplicate(0, 0); art.MoveToLayer(stage);
                        foreach (var c in OwnCuts((object)art)) { try { ((dynamic)c).Delete(); } catch { } }   // เส้นตัดในกลุ่มไม่ใช่งานพิมพ์
                        object cut, die; MakeCuts((object)doc, (object)stage, ds[i], o, warn, i, out cut, out die);
                        units.Add(new object[] { art, cut, die });
                    }
                    bool hasDie = Obj(o, "die") != null;
                    var sheets = Arr(Obj(o, "sheets")); var sheetHs = Arr(Obj(o, "sheetHs")); var sheetHs2 = Arr(Obj(o, "sheetHs2")); var notes = Arr(Obj(o, "notes"));
                    double SW = Dbl(o, "sheetW", 210), SH0 = Dbl(o, "sheetH", 297);
                    object cm5 = Obj(o, "cm5"), marks = Obj(o, "marks");
                    bool cm5Seg = false;
                    if (cm5 != null) { double mx = 0; foreach (var h in sheetHs2) mx = Math.Max(mx, Convert.ToDouble(h, CultureInfo.InvariantCulture)); cm5Seg = mx > Dbl(cm5, "thrMM", 500); }
                    var segN = new List<int>();
                    // 2) หน้าใหม่ต่อแผ่น
                    for (int s = 0; s < sheets.Length; s++)
                    {
                        double SH = s < sheetHs.Length && sheetHs[s] != null ? Convert.ToDouble(sheetHs[s], CultureInfo.InvariantCulture) : SH0;
                        step = "สร้างหน้าแผ่นที่ " + (s + 1);
                        dynamic pg;
                        try { pg = doc.AddPagesEx(1, SW, SH); } catch { pg = doc.AddPages(1); try { pg.SetSize(SW, SH); } catch { } }
                        newPages.Add(pg);
                        try { pg.Name = "Sheet " + (s + 1); } catch { }
                        try { pg.Activate(); } catch { }
                        dynamic printL = EnsureLayer(pg, "Print", true);
                        dynamic dieL = hasDie ? EnsureLayer(pg, "DieCut", false) : null;
                        dynamic cutL = EnsureLayer(pg, "Kiss Cut", false);
                        var pb = PageBox((object)doc, (object)pg); double PL = pb[0], PT = pb[3];
                        double[] sb = null;
                        var list = Arr(sheets[s]);
                        for (int k = 0; k < list.Length; k++)
                        {
                            step = "วางดวงที่ " + (k + 1) + " แผ่นที่ " + (s + 1);
                            var pl = list[k]; int di = (int)Dbl(pl, "d", 0);
                            if (di < 0 || di >= units.Count) throw new Exception("ข้อมูลลายไม่ตรง — กดอ่านสติ๊กเกอร์ใหม่");
                            var u = units[di];
                            dynamic a2 = ((dynamic)u[0]).Duplicate(0, 0), c2 = ((dynamic)u[1]).Duplicate(0, 0), d2 = u[2] != null ? ((dynamic)u[2]).Duplicate(0, 0) : null;
                            a2.MoveToLayer(printL); c2.MoveToLayer(cutL); if (d2 != null) d2.MoveToLayer(dieL);
                            var parts = new List<object> { a2, c2 }; if (d2 != null) parts.Add(d2);
                            if (Dbl(pl, "r", 0) != 0 || Str(pl, "r") == "True")
                            {
                                var rb = Box(d2 != null ? (object)d2 : (object)c2); double cx = (rb[0] + rb[2]) / 2, cy = (rb[1] + rb[3]) / 2;
                                foreach (dynamic p in parts) p.RotateEx(90, cx, cy);
                            }
                            var cb = Box(d2 != null ? (object)d2 : (object)c2);
                            double dx = (PL + Dbl(pl, "x", 0)) - cb[0], dy = (PT - Dbl(pl, "y", 0)) - cb[3];
                            foreach (dynamic p in parts) { p.Move(dx, dy); sb = Union(sb, Box((object)p)); }
                            if (d2 != null && Str(Obj(o, "die"), "only") == "True") { try { c2.Delete(); } catch { } }   // Die Cut อย่างเดียว
                            made++;
                        }
                        if (s < notes.Length && notes[s] != null)
                        {
                            try
                            {
                                dynamic sl = EnsureLayer(pg, "Slug", true);
                                dynamic t = sl.CreateArtisticText(PL + Dbl(notes[s], "x", 0), PT - Dbl(notes[s], "y", 0), Str(notes[s], "text"));
                                try { t.Text.Story.Size = 9; } catch { }
                                try { t.Name = "ST จำนวน"; } catch { }
                            }
                            catch (Exception ex) { warn.Add("ข้อความจำนวน: " + ex.Message); }
                        }
                        if (marks != null)
                        {   // มาร์คมุม L 4 มุม (แบบ ARMS)
                            step = "ใส่มาร์คแผ่นที่ " + (s + 1);
                            dynamic mL = EnsureLayer(pg, "Marks", true);
                            double ins = Dbl(marks, "insetMM", 10), len = Dbl(marks, "lenMM", 10), w = Dbl(marks, "wMM", 0.5);
                            double x0 = PL + ins, x1 = PL + SW - ins, y0 = PT - ins, y1 = PT - SH + ins;
                            foreach (var c in new[] { new[] { x0, y0, 1, -1 }, new[] { x1, y0, -1, -1 }, new[] { x0, y1, 1, 1 }, new[] { x1, y1, -1, 1 } })
                            {
                                double cx = c[0], cy = c[1], ddx = c[2], ddy = c[3];
                                Poly(doc, mL, new[] { new[] { cx, cy }, new[] { cx + ddx * len, cy }, new[] { cx + ddx * len, cy + ddy * w }, new[] { cx + ddx * w, cy + ddy * w }, new[] { cx + ddx * w, cy + ddy * len }, new[] { cx, cy + ddy * len } });
                            }
                        }
                        if (cm5 != null && sb != null)
                        {
                            step = "ใส่มาร์ค CM5 แผ่นที่ " + (s + 1);
                            var names = Cm5Names(cm5Seg); dynamic reg1 = null;
                            for (int q = names.Length - 1; q >= 0; q--) { dynamic L = EnsureLayer(pg, names[q], true); if (q == 3) reg1 = L; }
                            double xL = sb[0] - CM5_M, xR = sb[2] + CM5_M, yB = sb[1] - CM5_M, yT = sb[3] + CM5_M;
                            var cuts = new List<double> { yB };
                            if (cm5Seg) { int nSeg = Math.Max(1, (int)Math.Round((yT - yB) / CM5_STEP, MidpointRounding.AwayFromZero)); for (int q = 1; q < nSeg; q++) cuts.Add(yB + q * CM5_STEP); }
                            cuts.Add(yT);
                            for (int q = 0; q + 1 < cuts.Count; q++)
                            {
                                double a = cuts[q], c = cuts[q + 1];
                                Cm5L(doc, reg1, xL, a, -1, -1); Cm5L(doc, reg1, xR, a, 1, -1); Cm5L(doc, reg1, xL, c, -1, 1); Cm5L(doc, reg1, xR, c, 1, 1);
                            }
                            segN.Add(cuts.Count - 1);
                            // ขนาดหน้า = มาร์ค + แขน 15 มม. ทุกด้าน แล้วเลื่อนงานให้ตรงหน้า
                            double nw = (xR + CM5_L) - (xL - CM5_L), nh = (yT + CM5_L) - (yB - CM5_L);
                            pg.SetSize(nw, nh);
                            var pb2 = PageBox((object)doc, (object)pg);
                            double mdx = pb2[0] - (xL - CM5_L), mdy = pb2[1] - (yB - CM5_L);
                            if (Math.Abs(mdx) > 1e-6 || Math.Abs(mdy) > 1e-6) { dynamic all = pg.Shapes.All(); all.Move(mdx, mdy); }
                            for (int q = 0; q < names.Length; q++) { dynamic L = FindLayer(pg, names[q]); try { L.Editable = false; } catch { } }
                        }
                    }
                    step = "เก็บกวาด";
                    try { stage.Delete(); } catch { } stage = null;
                    try { ((dynamic)newPages[0]).Activate(); } catch { }
                    try { doc.ClearSelection(); } catch { }
                    if (cm5 != null) warn.Add("มาร์ค CM5: " + (cm5Seg ? "Segment Area Type1 ทุก 25 ซม. (" + string.Join(", ", segN) + " ช่วง)" : "4 Points Type1"));
                    var p0 = PageBox((object)doc, newPages[0]);
                    return "{\"ok\":true,\"msg\":" + Q("สร้าง " + sheets.Length + " แผ่น (หน้าใหม่) · รวม " + made + " ดวง · แผ่น " + Math.Round((p0[2] - p0[0]) / 10, 1).ToString(IC) + "×" + Math.Round((p0[3] - p0[1]) / 10, 1).ToString(IC) + " ซม.") + ",\"warn\":" + Js(warn) + "}";
                }
                catch (Exception ex)
                {
                    try { if (stage != null) stage.Delete(); } catch { }
                    for (int r = newPages.Count - 1; r >= 0; r--) try { ((dynamic)newPages[r]).Delete(); } catch { }
                    return Err("ขั้น \"" + step + "\": " + ex.Message);
                }
            }))));
        }
    }
}
