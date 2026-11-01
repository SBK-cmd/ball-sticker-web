// อ่านค่าคงที่ (enum เช่น cdrPNG, cdrSelection) จาก type library ของ Corel ที่เปิดอยู่จริง
// → ไม่ต้องเดาตัวเลข และใช้ได้ทุกเวอร์ชัน
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using TYPEKIND = System.Runtime.InteropServices.ComTypes.TYPEKIND;
using TYPEATTR = System.Runtime.InteropServices.ComTypes.TYPEATTR;
using VARDESC = System.Runtime.InteropServices.ComTypes.VARDESC;
using VARKIND = System.Runtime.InteropServices.ComTypes.VARKIND;
using System.Runtime.InteropServices.ComTypes;

namespace SignTools
{
    [ComImport, Guid("00020400-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDispatchTI
    {
        [PreserveSig] int GetTypeInfoCount(out int pctinfo);
        [PreserveSig] int GetTypeInfo(int iTInfo, int lcid, out ITypeInfo ppTInfo);
    }

    static class CorelConst
    {
        static Dictionary<string, int> map;
        public static string LoadError = "";

        public static int Get(object app, string name, int fallback)
        {
            if (map == null) Load(app);
            int v; return map.TryGetValue(name.ToLowerInvariant(), out v) ? v : fallback;
        }
        public static bool Has(object app, string name) { if (map == null) Load(app); return map.ContainsKey(name.ToLowerInvariant()); }
        public static int Count { get { return map == null ? 0 : map.Count; } }

        static void Load(object app)
        {
            map = new Dictionary<string, int>();
            try
            {
                var d = (IDispatchTI)app;
                ITypeInfo ti;
                if (d.GetTypeInfo(0, 0, out ti) != 0 || ti == null) { LoadError = "no typeinfo"; return; }
                ITypeLib tl; int idx;
                ti.GetContainingTypeLib(out tl, out idx);
                int n = tl.GetTypeInfoCount();
                for (int i = 0; i < n; i++)
                {
                    TYPEKIND k; tl.GetTypeInfoType(i, out k);
                    if (k != TYPEKIND.TKIND_ENUM) continue;
                    ITypeInfo et; tl.GetTypeInfo(i, out et);
                    IntPtr pa; et.GetTypeAttr(out pa);
                    try
                    {
                        var ta = (TYPEATTR)Marshal.PtrToStructure(pa, typeof(TYPEATTR));
                        for (int j = 0; j < ta.cVars; j++)
                        {
                            IntPtr pv; et.GetVarDesc(j, out pv);
                            try
                            {
                                var vd = (VARDESC)Marshal.PtrToStructure(pv, typeof(VARDESC));
                                string[] names = new string[1]; int got;
                                et.GetNames(vd.memid, names, 1, out got);
                                if (got > 0 && vd.varkind == VARKIND.VAR_CONST)
                                {
                                    var val = Marshal.GetObjectForNativeVariant(vd.desc.lpvarValue);
                                    try { map[names[0].ToLowerInvariant()] = Convert.ToInt32(val); } catch { }
                                }
                            }
                            finally { et.ReleaseVarDesc(pv); }
                        }
                    }
                    finally { et.ReleaseTypeAttr(pa); }
                }
            }
            catch (Exception ex) { LoadError = ex.Message; }
        }
    }
}
