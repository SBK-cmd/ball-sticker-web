// Sign Tools for CorelDRAW — ตัวโหลด (อยู่ในโฟลเดอร์ Addons ของ Corel · แทบไม่ต้องเปลี่ยน)
// หน้าที่: สร้าง WebView2 ใน Docker, คัดลอกตัวโปรแกรม (app) ไปไว้ใน %APPDATA% ที่อัปเดตเองได้,
//          โหลด SignToolsHost.dll จากที่นั่น แล้วต่อสายระหว่างหน้าเว็บกับ C#
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace SignToolsCorel
{
    public class DockerUI : UserControl
    {
        readonly object app;
        object host;
        MethodInfo hCall, hMsg;
        WebView2 wv;
        static string addonDir;

        static DockerUI()
        {
            addonDir = Path.GetDirectoryName(typeof(DockerUI).Assembly.Location);
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                try
                {
                    var n = new AssemblyName(e.Name).Name;
                    foreach (var a in AppDomain.CurrentDomain.GetAssemblies()) if (a.GetName().Name == n) return a;
                    var f = Path.Combine(addonDir, n + ".dll");
                    if (File.Exists(f)) return Assembly.LoadFrom(f);
                }
                catch { }
                return null;
            };
        }

        public DockerUI() : this(null) { }
        public DockerUI(object app)
        {
            this.app = app;
            Background = new SolidColorBrush(Color.FromRgb(0x26, 0x26, 0x2b));
            Say("กำลังเปิด Sign Tools…");
            Loaded += (s, e) => { if (wv == null) Start(); };
        }

        void Say(string t)
        {
            Content = new TextBlock { Text = t, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(12), Foreground = Brushes.Gainsboro, FontSize = 13 };
        }

        static string Ver(string dir)
        {
            try
            {
                var m = Regex.Match(File.ReadAllText(Path.Combine(dir, "CSXS", "manifest.xml")), "ExtensionBundleVersion=\"(\\d+)\\.(\\d+)\\.(\\d+)\"");
                if (m.Success) return string.Format("{0:D5}.{1:D5}.{2:D5}", int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
            }
            catch { }
            return "";
        }
        static void CopyDir(string src, string dst)
        {
            Directory.CreateDirectory(dst);
            foreach (var f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(src)) CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
        }

        async void Start()
        {
            string step = "เตรียมไฟล์";
            try
            {
                var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                var root = Path.Combine(appData, "SignTools", "Corel");
                var userApp = Path.Combine(root, "app");
                var bundled = Path.Combine(addonDir, "app");
                // ใช้ตัวที่ใหม่กว่า: ติดตั้งใหม่ (bundled) หรืออัปเดตจากในแผง (userApp)
                if (Directory.Exists(bundled) && string.CompareOrdinal(Ver(bundled), Ver(userApp)) > 0) CopyDir(bundled, userApp);
                if (!File.Exists(Path.Combine(userApp, "index.html"))) throw new Exception("ไม่พบไฟล์โปรแกรม — ติดตั้งใหม่อีกครั้ง");

                step = "โหลด SignToolsHost";
                var asm = Assembly.Load(File.ReadAllBytes(Path.Combine(userApp, "SignToolsHost.dll")));
                var t = asm.GetType("SignTools.Host", true);
                host = Activator.CreateInstance(t);
                hCall = t.GetMethod("Call");
                hMsg = t.GetMethod("OnMessage");

                step = "เปิด WebView2";
                try { CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(addonDir, Environment.Is64BitProcess ? "x64" : "x86")); } catch { }
                string rt = null;
                try { rt = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
                if (string.IsNullOrEmpty(rt)) throw new Exception("เครื่องนี้ยังไม่มี Microsoft Edge WebView2 Runtime — ติดตั้งจาก https://go.microsoft.com/fwlink/p/?LinkId=2124703 แล้วเปิด CorelDRAW ใหม่");
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "WebView2"));
                wv = new WebView2();
                Content = wv;
                await wv.EnsureCoreWebView2Async(env);
                var core = wv.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.SetVirtualHostNameToFolderMapping("signtools.corel", userApp, CoreWebView2HostResourceAccessKind.Allow);

                Action<string> post = s => Dispatcher.BeginInvoke(new Action(() => { try { core.PostWebMessageAsJson(s); } catch { } }));
                t.GetMethod("Init").Invoke(host, new object[] { app, post, userApp, addonDir });
                core.AddHostObjectToScript("st", new Bridge(this));
                core.WebMessageReceived += (s, e) =>
                {
                    string j = null;
                    try { j = e.WebMessageAsJson; } catch { }
                    if (j != null) try { hMsg.Invoke(host, new object[] { j }); } catch (Exception ex) { Log(ex); }
                };
                core.NewWindowRequested += (s, e) => { e.Handled = true; try { System.Diagnostics.Process.Start(e.Uri); } catch { } };
                core.Navigate("https://signtools.corel/index.html");
            }
            catch (Exception ex)
            {
                var m = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
                Log(m);
                Say("Sign Tools เปิดไม่สำเร็จ (" + step + ")\n" + m.Message);
            }
        }

        internal string CallHost(string s)
        {
            try { return (string)hCall.Invoke(host, new object[] { s }); }
            catch (Exception ex) { var m = ex.InnerException ?? ex; return "{\"err\":" + Q(m.Message) + "}"; }
        }

        static string Q(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ") + "\""; }
        static void Log(Exception ex)
        {
            try
            {
                var d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SignTools", "Corel");
                Directory.CreateDirectory(d);
                File.AppendAllText(Path.Combine(d, "error.log"), DateTime.Now.ToString("s") + " " + ex + "\r\n");
            }
            catch { }
        }
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public class Bridge
    {
        readonly DockerUI d;
        public Bridge(DockerUI d) { this.d = d; }
        public string Call(string s) { return d.CallHost(s); }
    }
}
