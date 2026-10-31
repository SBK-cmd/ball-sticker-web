// Sign Tools for CorelDRAW — ตัวกลางระหว่างหน้าแผง (JS) กับเครื่อง: ไฟล์ / ข้อมูลเครื่อง / เน็ต / TCP เครื่องตัด / สั่งงาน Corel
// ไฟล์นี้อยู่ใน %APPDATA%\SignTools\Corel\app → อัปเดตจากในแผงได้โดยไม่ต้องติดตั้งใหม่
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace SignTools
{
    public class Host
    {
        internal static readonly JavaScriptSerializer J = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 200 };
        Action<string> post;
        string appDir, addonDir;
        internal CorelOps ops;
        readonly Dictionary<string, Sock> socks = new Dictionary<string, Sock>();

        public void Init(object app, Action<string> post, string appDir, string addonDir)
        {
            this.post = post; this.appDir = appDir; this.addonDir = addonDir;
            ops = new CorelOps(app, appDir);
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
        }

        void Post(Dictionary<string, object> o) { try { post(J.Serialize(o)); } catch { } }
        static Dictionary<string, object> D(params object[] kv) { var d = new Dictionary<string, object>(); for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1]; return d; }
        static string S(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : ""; }
        static int I(Dictionary<string, object> m, string k, int d) { object v; if (m.TryGetValue(k, out v) && v != null) try { return Convert.ToInt32(v); } catch { } return d; }

        // ---------- เรียกแบบรอผล (จาก hostObjects.sync) ----------
        public string Call(string json)
        {
            try
            {
                var m = J.Deserialize<Dictionary<string, object>>(json);
                var t = S(m, "t");
                object v = t == "fs" ? Fs(m) : t == "sys" ? Sys(m) : null;
                return J.Serialize(D("v", v));
            }
            catch (FileNotFoundException ex) { return J.Serialize(D("err", ex.Message, "code", "ENOENT")); }
            catch (DirectoryNotFoundException ex) { return J.Serialize(D("err", ex.Message, "code", "ENOENT")); }
            catch (Exception ex) { return J.Serialize(D("err", ex.Message, "code", "EIO")); }
        }

        object Fs(Dictionary<string, object> m)
        {
            var p = S(m, "p");
            switch (S(m, "op"))
            {
                case "exists": return File.Exists(p) || Directory.Exists(p);
                case "mkdir": Directory.CreateDirectory(p); return null;
                case "rmdir": Directory.Delete(p, false); return null;
                case "unlink": if (!File.Exists(p)) throw new FileNotFoundException("ENOENT: " + p); File.Delete(p); return null;
                case "readdir": return Directory.GetFileSystemEntries(p).Select(Path.GetFileName).ToArray();
                case "stat":
                    if (Directory.Exists(p)) return D("dir", true, "size", 0, "mtime", 0);
                    if (!File.Exists(p)) throw new FileNotFoundException("ENOENT: " + p);
                    var fi = new FileInfo(p);
                    return D("dir", false, "size", fi.Length, "mtime", (long)(fi.LastWriteTimeUtc - new DateTime(1970, 1, 1)).TotalMilliseconds);
                case "rename": if (File.Exists(S(m, "q"))) File.Delete(S(m, "q")); File.Move(p, S(m, "q")); return null;
                case "read": if (!File.Exists(p)) throw new FileNotFoundException("ENOENT: " + p); return Convert.ToBase64String(File.ReadAllBytes(p));
                case "write": File.WriteAllBytes(p, Convert.FromBase64String(S(m, "b"))); return null;
                case "append": using (var f = new FileStream(p, FileMode.Append)) { var b = Convert.FromBase64String(S(m, "b")); f.Write(b, 0, b.Length); } return null;
            }
            throw new Exception("fs op?");
        }

        object Sys(Dictionary<string, object> m)
        {
            switch (S(m, "op"))
            {
                case "info":
                    var env = new Dictionary<string, object>();
                    foreach (var k in new[] { "APPDATA", "LOCALAPPDATA", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "USERNAME", "COMPUTERNAME", "HOMEDRIVE", "HOMEPATH" })
                        env[k] = Environment.GetEnvironmentVariable(k) ?? "";
                    env["HOME"] = env["USERPROFILE"];
                    return D("appDir", appDir, "addonDir", addonDir, "appData", Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                        "home", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "temp", Path.GetTempPath(),
                        "hostname", Environment.MachineName, "user", Environment.UserName, "env", env, "corel", ops.CorelVersion(), "x64", Environment.Is64BitProcess);
                case "machineGuid":
                    using (var k = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64).OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                        return k == null ? "" : Convert.ToString(k.GetValue("MachineGuid"));
                case "hash":
                    var a = S(m, "alg").ToLowerInvariant();
                    HashAlgorithm h = a == "sha1" ? (HashAlgorithm)SHA1.Create() : a == "md5" ? (HashAlgorithm)MD5.Create() : a == "sha512" ? (HashAlgorithm)SHA512.Create() : SHA256.Create();
                    using (h) return string.Concat(h.ComputeHash(Convert.FromBase64String(S(m, "b"))).Select(x => x.ToString("x2")));
                case "open": Process.Start(new ProcessStartInfo(S(m, "url")) { UseShellExecute = true }); return null;
                case "nics":
                    var o = new Dictionary<string, object>();
                    foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                    {
                        if (ni.OperationalStatus != OperationalStatus.Up) continue;
                        var list = new List<object>();
                        foreach (var u in ni.GetIPProperties().UnicastAddresses)
                        {
                            if (u.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                            string mask = "255.255.255.0"; try { if (u.IPv4Mask != null) mask = u.IPv4Mask.ToString(); } catch { }
                            list.Add(D("address", u.Address.ToString(), "netmask", mask, "family", "IPv4", "internal", ni.NetworkInterfaceType == NetworkInterfaceType.Loopback));
                        }
                        if (list.Count > 0) o[ni.Name] = list;
                    }
                    return o;
            }
            throw new Exception("sys op?");
        }

        // ---------- ข้อความจากหน้าเว็บ (งานที่ใช้เวลา) ----------
        public void OnMessage(string json)
        {
            Dictionary<string, object> m;
            try { m = J.Deserialize<Dictionary<string, object>>(json); } catch { return; }
            var t = S(m, "t"); var id = m.ContainsKey("id") ? m["id"] : 0;
            if (t == "eval")
            {
                string r;
                try { r = ops.Eval(S(m, "s")); }
                catch (Exception ex) { r = J.Serialize(D("error", (ex.InnerException ?? ex).Message)); }
                Post(D("id", id, "r", r));
            }
            else if (t == "http") Task.Run(() => Http(m, id));
            else if (t == "tcp") Tcp(m);
        }

        void Http(Dictionary<string, object> m, object id)
        {
            try
            {
                var rq = (HttpWebRequest)WebRequest.Create(S(m, "url"));
                rq.Method = S(m, "method") == "" ? "GET" : S(m, "method");
                rq.Timeout = rq.ReadWriteTimeout = Math.Max(3000, I(m, "timeout", 15000));
                rq.AllowAutoRedirect = true; rq.MaximumAutomaticRedirections = 5;
                rq.UserAgent = "SignTools-Corel";
                object ho; if (m.TryGetValue("headers", out ho) && ho is Dictionary<string, object>)
                    foreach (var kv in (Dictionary<string, object>)ho)
                    {
                        if (string.Equals(kv.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)) rq.ContentType = Convert.ToString(kv.Value);
                        else if (string.Equals(kv.Key, "Content-Length", StringComparison.OrdinalIgnoreCase)) { }
                        else try { rq.Headers[kv.Key] = Convert.ToString(kv.Value); } catch { }
                    }
                var b = S(m, "b");
                if (b != "") { var bytes = Convert.FromBase64String(b); rq.ContentLength = bytes.Length; using (var s = rq.GetRequestStream()) s.Write(bytes, 0, bytes.Length); }
                HttpWebResponse rs;
                try { rs = (HttpWebResponse)rq.GetResponse(); }
                catch (WebException we) when (we.Response is HttpWebResponse) { rs = (HttpWebResponse)we.Response; }
                using (rs)
                using (var st = rs.GetResponseStream())
                using (var ms = new MemoryStream())
                {
                    st.CopyTo(ms);
                    Post(D("id", id, "status", (int)rs.StatusCode, "headers", D("content-type", rs.ContentType ?? ""), "b", Convert.ToBase64String(ms.ToArray())));
                }
            }
            catch (WebException we)
            {
                var code = we.Status == WebExceptionStatus.Timeout ? "ETIMEDOUT" : we.Status == WebExceptionStatus.NameResolutionFailure ? "ENOTFOUND" : "ECONNRESET";
                Post(D("id", id, "err", we.Message, "code", code));
            }
            catch (Exception ex) { Post(D("id", id, "err", ex.Message, "code", "ECONNRESET")); }
        }

        // ---------- TCP ไปเครื่องตัด ----------
        class Sock
        {
            public string id; public TcpClient c; public NetworkStream ns;
            public Task chain = Task.FromResult(0); public bool closed; public readonly object lk = new object();
        }
        void Ev(Sock s, string ev, params object[] kv)
        {
            var d = D(kv); d["sock"] = s.id; d["ev"] = ev; Post(d);
        }
        void Close(Sock s)
        {
            lock (s.lk) { if (s.closed) return; s.closed = true; }
            try { s.c.Close(); } catch { }
            lock (socks) socks.Remove(s.id);
            Ev(s, "close");
        }
        static string ErrCode(Exception ex)
        {
            var se = ex as SocketException ?? ex.InnerException as SocketException;
            if (se == null) return ex is TimeoutException ? "ETIMEDOUT" : "ECONNRESET";
            switch (se.SocketErrorCode)
            {
                case SocketError.ConnectionRefused: return "ECONNREFUSED";
                case SocketError.TimedOut: return "ETIMEDOUT";
                case SocketError.HostUnreachable: case SocketError.NetworkUnreachable: return "EHOSTUNREACH";
                default: return "ECONNRESET";
            }
        }
        void Tcp(Dictionary<string, object> m)
        {
            var id = S(m, "sock"); Sock s;
            switch (S(m, "op"))
            {
                case "connect":
                    s = new Sock { id = id, c = new TcpClient() };
                    s.c.NoDelay = true;
                    lock (socks) socks[id] = s;
                    var host = S(m, "host"); var port = I(m, "port", 9100); var to = Math.Max(500, I(m, "timeout", 8000));
                    s.chain = Task.Run(async () =>
                    {
                        try
                        {
                            var ct = s.c.ConnectAsync(host, port);
                            if (await Task.WhenAny(ct, Task.Delay(to)) != ct) throw new TimeoutException("หมดเวลา");
                            await ct;
                            s.ns = s.c.GetStream();
                            Ev(s, "connect");
                            var _ = Task.Run(() => ReadLoop(s));
                        }
                        catch (Exception ex) { Ev(s, "error", "err", ex.Message, "code", ErrCode(ex)); Close(s); }
                    });
                    break;
                case "write":
                    lock (socks) socks.TryGetValue(id, out s);
                    if (s == null) return;
                    var data = Convert.FromBase64String(S(m, "b")); var n = I(m, "n", 0);
                    lock (s.lk) s.chain = s.chain.ContinueWith(async _ =>
                    {
                        if (s.closed || s.ns == null) return;
                        try { await s.ns.WriteAsync(data, 0, data.Length); Ev(s, "drain", "n", n); }
                        catch (Exception ex) { Ev(s, "error", "err", ex.Message, "code", ErrCode(ex)); Close(s); }
                    }).Unwrap();
                    break;
                case "end":
                    lock (socks) socks.TryGetValue(id, out s);
                    if (s == null) return;
                    lock (s.lk) s.chain = s.chain.ContinueWith(async _ =>
                    {
                        try { if (s.ns != null) await s.ns.FlushAsync(); s.c.Client.Shutdown(SocketShutdown.Send); } catch { }
                        await Task.Delay(1500);      // เครื่องตัดมักไม่ปิดฝั่งตัวเอง → ปิดเองหลังส่งครบ
                        Close(s);
                    }).Unwrap();
                    break;
                case "destroy":
                    lock (socks) socks.TryGetValue(id, out s);
                    if (s != null) Close(s);
                    break;
            }
        }
        async Task ReadLoop(Sock s)
        {
            var buf = new byte[8192];
            try
            {
                while (!s.closed)
                {
                    int r = await s.ns.ReadAsync(buf, 0, buf.Length);
                    if (r <= 0) { Ev(s, "end"); break; }
                    Ev(s, "data", "b", Convert.ToBase64String(buf, 0, r));
                }
            }
            catch { }
            Close(s);
        }
    }
}
