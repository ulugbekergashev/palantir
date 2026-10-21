using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

[assembly: AssemblyTitle("Palantir MicroSIP hook")]
[assembly: AssemblyProduct("Palantir")]
[assembly: AssemblyDescription("MicroSIP qo'ng'iroq hodisasini Palantir'ga uzatadi")]
[assembly: AssemblyVersion("1.1.0.0")]

// MicroSIP qo'ng'iroq hodisasini Palantir'ga uzatadigan kichik yordamchi (DentaCRM'dagi jonli sinalgan yordamchining nusxasi).
//
// 1. Hodisa (asosiy ish): MicroSIP hodisada (microsip.ini: cmdIncomingCall, cmdCallAnswer, cmdCallStart, cmdCallEnd, cmdOutgoingCall)
//    ko'rsatilgan FAYLNI ochadi va raqamni parametr qilib beradi. Sozlamada faqat fayl yo'li bo'ladi, shuning uchun hodisa turi shu
//    dastur nusxasining NOMIDAN olinadi: ms-incoming.exe, ms-answer.exe, ms-start.exe, ms-end.exe, ms-outgoing.exe.
//    Hodisa shu papkadagi «spool» ichiga kichik fayl bo'lib yoziladi. Tarmoq yo'q — MicroSIP kutib qolmaydi.
//    Nega .cmd emas: raqam (SIP «user» qismi) tashqaridan keladi va unda «&» bo'lishi mumkin — .cmd uni buyruq qilib bajarardi.
//
// 2. Qabulxonadagi boshqa kompyuter («stansiya», server/phone/stations.ts) — shu dastur buyruqlar bilan:
//      pair <server> <kod>   — paneldagi bir martalik kod → kalit (palantir-stansiya.ini, shu papkada)
//      setup [--overwrite]   — MicroSIP'ni topadi, yopadi, ini'ga yordamchi va yozib olishni yozadi, qayta ochadi, avtoyuklash
//      agent [--once]        — fonda: spool hodisalari va tugagan yozuvlar serverga, paneldagi «📞 Kompyuterdan» buyrug'i — MicroSIP'ga
//      remove                — ini avvalgi holiga, avtoyuklash o'chadi
//    ini qoidalari server/phone/microsip.ts dagi bilan bir xil (ini — MicroSIP yopiq paytda, o'z joyida, nusxasi bilan).
//
// Server kompyuterida Palantir uni o'zi yig'adi (server/phone/hook.ts), stansiyada — install/stansiya.ps1. Til — C# 5 (Windows'dagi csc).
internal static class PalantirCall
{
    private const int MaxNumberLength = 64;
    private const string ConfigName = "palantir-stansiya.ini";
    private const string BackupSuffix = ".palantir-backup";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "PalantirStansiya";
    private static readonly string[] HookKeys = { "cmdIncomingCall", "cmdCallAnswer", "cmdCallStart", "cmdCallEnd", "cmdOutgoingCall" };
    private static readonly string[] HookFiles = { "ms-incoming.exe", "ms-answer.exe", "ms-start.exe", "ms-end.exe", "ms-outgoing.exe" };
    private static readonly string[] RecordKeys = { "autoRecording", "recordingPath", "recordingFormat" };
    private static readonly string[] RegistryKeys = {
        @"Software\MicroSIP", @"Software\WOW6432Node\MicroSIP",
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\MicroSIP", @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\MicroSIP",
    };

    [STAThread]
    private static int Main(string[] args)
    {
        string exePath = Assembly.GetExecutingAssembly().Location;
        string dir = Path.GetDirectoryName(exePath);
        string name = Path.GetFileNameWithoutExtension(exePath).ToLowerInvariant();
        if (name.StartsWith("ms-")) return Hook(dir, name.Substring(3), args);
        string command = args.Length > 0 ? args[0].ToLowerInvariant() : "";
        try
        {
            switch (command)
            {
                case "pair": return Pair(dir, args);
                case "setup": return Setup(dir, exePath, Has(args, "--overwrite"));
                case "agent": return Agent(dir, Has(args, "--once"));
                case "remove": return Remove(dir);
                case "patch-ini": return PatchIniFile(args);
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            Log(dir, "xato: " + e.Message);
            return 1;
        }
        return Hook(dir, name, args);
    }

    private static bool Has(string[] args, string flag)
    {
        foreach (string a in args) if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // ─── 1. Hodisa ────────────────────────────────────────────────────────────────

    private static int Hook(string dir, string eventName, string[] args)
    {
        try
        {
            string number = Clean(string.Join("", args));
            string spool = Path.Combine(dir, "spool");
            Directory.CreateDirectory(spool);
            DateTime now = DateTime.UtcNow;
            string id = now.ToString("yyyyMMddHHmmssfff") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            string tmp = Path.Combine(spool, id + ".tmp");
            // Avval .tmp, keyin nomini o'zgartirish: o'quvchi yarim yozilgan faylni ko'rmaydi
            File.WriteAllText(tmp, eventName + "\n" + number + "\n" + now.ToString("o") + "\n", new UTF8Encoding(false));
            File.Move(tmp, Path.Combine(spool, id + ".evt"));
        }
        catch
        {
            // MicroSIP ishiga xalaqit bermaslik uchun xato jim o'tadi
        }
        return 0;
    }

    /// Raqamda faqat xavfsiz belgilar qoladi («anonymous» kabi so'zlar ham o'tadi)
    private static string Clean(string raw)
    {
        var sb = new StringBuilder();
        foreach (char c in raw ?? "")
        {
            bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || c == '+' || c == '*' || c == '#' || c == '.' || c == '_' || c == '-';
            if (ok) sb.Append(c);
            if (sb.Length >= MaxNumberLength) break;
        }
        return sb.ToString();
    }

    // ─── Sozlama fayli (kalit=qiymat) ───────────────────────────────────────────

    private static Dictionary<string, string> ReadConfig(string dir)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string file = Path.Combine(dir, ConfigName);
        if (!File.Exists(file)) return map;
        foreach (string line in File.ReadAllLines(file, Encoding.UTF8))
        {
            int eq = line.IndexOf('=');
            if (eq > 0) map[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
        }
        return map;
    }

    private static void WriteConfig(string dir, Dictionary<string, string> map)
    {
        var sb = new StringBuilder();
        foreach (var kv in map) sb.Append(kv.Key).Append('=').Append(kv.Value).Append("\r\n");
        File.WriteAllText(Path.Combine(dir, ConfigName), sb.ToString(), new UTF8Encoding(false));
    }

    private static string Need(Dictionary<string, string> cfg, string key)
    {
        string v;
        if (!cfg.TryGetValue(key, out v) || v == "") throw new Exception("Avval ulang: palantir-call.exe pair <server> <kod> (" + key + " yo'q)");
        return v;
    }

    // ─── HTTP ────────────────────────────────────────────────────────────────

    private static string Http(string method, string url, string token, byte[] body, string contentType, int timeoutMs, out int status)
    {
        // Windows 7/8 dagi .NET Framework sukut bo'yicha eski TLS bilan ulanadi — hub HTTPS uchun TLS 1.2
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = method;
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        req.UserAgent = "Palantir-stansiya";
        if (token != null) req.Headers["Authorization"] = "Station " + token;
        if (body != null)
        {
            req.ContentType = contentType;
            req.ContentLength = body.Length;
            using (Stream s = req.GetRequestStream()) s.Write(body, 0, body.Length);
        }
        HttpWebResponse res;
        try { res = (HttpWebResponse)req.GetResponse(); }
        catch (WebException e)
        {
            res = e.Response as HttpWebResponse;
            if (res == null) throw;
        }
        using (res)
        using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
        {
            status = (int)res.StatusCode;
            return reader.ReadToEnd();
        }
    }

    private static string JsonString(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s ?? "")
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    private static string JsonField(string json, string key)
    {
        Match m = Regex.Match(json ?? "", "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
    }

    private static string ServerUrl(Dictionary<string, string> cfg) { return Need(cfg, "server").TrimEnd('/'); }

    // ─── 2a. Ulash ───────────────────────────────────────────────────────────

    private static int Pair(string dir, string[] args)
    {
        if (args.Length < 3) throw new Exception("Ishlatish: palantir-call.exe pair <server manzili> <kod>");
        string server = args[1].TrimEnd('/');
        if (!Regex.IsMatch(server, "^https?://")) throw new Exception("Server manzili http:// yoki https:// bilan boshlansin");
        int status;
        string body = Http("POST", server + "/api/phone/station/pair", null, Encoding.UTF8.GetBytes("{\"code\":" + JsonString(args[2]) + "}"), "application/json", 20000, out status);
        string token = JsonField(body, "token");
        if (status != 200 || token == null) throw new Exception("Ulanmadi (" + status + "): " + (JsonField(body, "error") ?? body));
        var cfg = ReadConfig(dir);
        cfg["server"] = server;
        cfg["token"] = token;
        WriteConfig(dir, cfg);
        Say(dir, "Ulandi: " + (JsonField(body, "name") ?? "kompyuter"));
        return 0;
    }

    // ─── 2b. MicroSIP'ni sozlash ─────────────────────────────────────────────────

    private static string FindMicrosip(Dictionary<string, string> cfg)
    {
        var candidates = new List<string>();
        string saved;
        if (cfg.TryGetValue("microsip", out saved) && saved != "") candidates.Add(saved);
        foreach (string root in new[] { Environment.GetEnvironmentVariable("LOCALAPPDATA"), Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles") })
            if (!string.IsNullOrEmpty(root)) candidates.Add(Path.Combine(Path.Combine(root, "MicroSIP"), "microsip.exe"));
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            foreach (string key in RegistryKeys)
                using (RegistryKey k = hive.OpenSubKey(key))
                {
                    if (k == null) continue;
                    foreach (string valueName in k.GetValueNames())
                    {
                        string v = Convert.ToString(k.GetValue(valueName)).Trim().Trim('"');
                        v = Regex.Replace(Regex.Replace(v, "\",.*$", ""), ",\\d+$", "");
                        if (!Regex.IsMatch(v, "^[A-Za-z]:\\\\")) continue;
                        candidates.Add(Regex.IsMatch(v, "\\.[A-Za-z0-9]{2,4}$") ? Path.Combine(Path.GetDirectoryName(v), "microsip.exe") : Path.Combine(v, "microsip.exe"));
                    }
                }
        foreach (Process p in Process.GetProcessesByName("microsip"))
            try { candidates.Add(p.MainModule.FileName); } catch { /* boshqa foydalanuvchiniki */ }
        foreach (string c in candidates) if (c.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(c)) return c;
        throw new Exception("MicroSIP topilmadi — o'rnating (microsip.org)");
    }

    /// ini MicroSIP bilan bir papkada bo'lsa — ko'chma nusxa; aks holda %APPDATA%\MicroSIP\MicroSIP.ini
    private static string IniPathFor(string exe)
    {
        string baseName = Path.GetFileNameWithoutExtension(exe);
        string portable = Path.Combine(Path.GetDirectoryName(exe), baseName + ".ini");
        return File.Exists(portable) ? portable : Path.Combine(Path.Combine(Environment.GetEnvironmentVariable("APPDATA") ?? "", baseName), baseName + ".ini");
    }

    private static bool Running(string exe)
    {
        foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(exe))) { p.Dispose(); return true; }
        return false;
    }

    /// MicroSIP sozlamani yopilayotganda qayta yozadi — ini faqat u yopiq paytda o'zgartiriladi. Suhbatni uzmaslik uchun majburan yopilmaydi
    private static bool StopMicrosip(string exe)
    {
        if (!Running(exe)) return false;
        Start(exe, "/exit");
        for (int i = 0; i < 40; i++)
        {
            Thread.Sleep(250);
            if (!Running(exe)) return true;
        }
        throw new Exception("MicroSIP yopilmadi — qo'ng'iroq tugaganini tekshirib, qayta urining");
    }

    private static void Start(string exe, string arguments)
    {
        // Ish papkasi — MicroSIP papkasi: ko'chma nusxa ini'ni joriy papkadan qidiradi
        var psi = new ProcessStartInfo(exe, arguments) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) };
        Process.Start(psi).Dispose();
    }

    private static int Setup(string dir, string exePath, bool overwrite)
    {
        var cfg = ReadConfig(dir);
        ServerUrl(cfg);
        Need(cfg, "token");
        // MicroSIP 3.22 yo'lida bo'sh joy bo'lgan yordamchini ishga tushirmaydi
        if (!Regex.IsMatch(dir, "^[\\x21-\\x7E]+$")) throw new Exception("Yordamchi papkasi yo'lida bo'sh joy yoki lotincha bo'lmagan harf bor: " + dir);
        string exe = FindMicrosip(cfg);
        string ini = IniPathFor(exe);
        if (!File.Exists(ini)) throw new Exception("MicroSIP sozlama fayli topilmadi — MicroSIP'ni bir marta ochib, yoping: " + ini);
        Directory.CreateDirectory(Path.Combine(dir, "spool"));
        Directory.CreateDirectory(Path.Combine(dir, "rec"));
        byte[] self = File.ReadAllBytes(exePath);
        foreach (string f in HookFiles) File.WriteAllBytes(Path.Combine(dir, f), self);

        bool wasRunning = StopMicrosip(exe);
        try
        {
            Encoding enc;
            string text = ReadIni(ini, out enc);
            var current = ReadSettings(text, HookKeys);
            var foreign = new List<string>();
            for (int i = 0; i < HookKeys.Length; i++)
                if (current[HookKeys[i]] != "" && !Ours(current[HookKeys[i]], dir)) foreign.Add(HookKeys[i] + "=" + current[HookKeys[i]]);
            if (foreign.Count > 0 && !overwrite) throw new Exception("MicroSIP boshqa dasturga ulangan (" + string.Join("; ", foreign.ToArray()) + "). Palantir'ga o'tkazish: setup --overwrite");
            // Avvalgi qiymatlar (o'zimizniki emas) — «remove» qaytaradi
            var before = ReadSettings(text, RecordKeys);
            foreach (string k in HookKeys) if (!cfg.ContainsKey("prev." + k)) cfg["prev." + k] = Ours(current[k], dir) ? "" : current[k];
            foreach (string k in RecordKeys) if (!cfg.ContainsKey("prev." + k) && !Ours(before["recordingPath"], dir)) cfg["prev." + k] = before[k];
            if (!File.Exists(ini + BackupSuffix)) File.Copy(ini, ini + BackupSuffix);
            bool mp3 = File.Exists(Path.Combine(Path.GetDirectoryName(exe), "lame_enc.dll"));
            var values = new Dictionary<string, string>();
            for (int i = 0; i < HookKeys.Length; i++) values[HookKeys[i]] = Path.Combine(dir, HookFiles[i]);
            values["autoRecording"] = "1";
            values["recordingPath"] = Path.Combine(dir, "rec");
            values["recordingFormat"] = mp3 ? "mp3" : "";
            // O'z joyida yoziladi: «yoniga yozib almashtirish»da antivirus yangi faylni ushlab turadi va MicroSIP qotib qoladi
            WriteIni(ini, PatchSettings(text, values), enc);
            if (ReadSettings(ReadIni(ini, out enc), new[] { "cmdCallEnd" })["cmdCallEnd"] != values["cmdCallEnd"]) throw new Exception("ini'ga yozilgan sozlama o'qilmadi");
            cfg["microsip"] = exe;
            WriteConfig(dir, cfg);
        }
        finally
        {
            if (wasRunning) Start(exe, "");
        }
        if (!wasRunning) Start(exe, "");
        using (RegistryKey run = Registry.CurrentUser.CreateSubKey(RunKey)) run.SetValue(RunName, "\"" + exePath + "\" agent");
        if (!AgentRunning()) new Process { StartInfo = new ProcessStartInfo(exePath, "agent") { UseShellExecute = false, CreateNoWindow = true } }.Start();
        Say(dir, "Tayyor: MicroSIP Palantir'ga ulandi, yordamchi fonda ishlayapti");
        return 0;
    }

    private static bool Ours(string value, string dir)
    {
        return value != "" && value.StartsWith(dir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
    }

    private static int Remove(string dir)
    {
        var cfg = ReadConfig(dir);
        using (RegistryKey run = Registry.CurrentUser.OpenSubKey(RunKey, true)) if (run != null) run.DeleteValue(RunName, false);
        foreach (Process p in Process.GetProcessesByName("palantir-call"))
            if (p.Id != Process.GetCurrentProcess().Id) try { p.Kill(); } catch { /* allaqachon chiqqan */ }
        string exe;
        if (!cfg.TryGetValue("microsip", out exe) || !File.Exists(exe)) { Say(dir, "MicroSIP topilmadi — faqat avtoyuklash o'chirildi"); return 0; }
        string ini = IniPathFor(exe);
        bool wasRunning = StopMicrosip(exe);
        try
        {
            Encoding enc;
            string text = ReadIni(ini, out enc);
            var current = ReadSettings(text, new[] { "recordingPath" });
            var values = new Dictionary<string, string>();
            foreach (string k in HookKeys) { string v; values[k] = cfg.TryGetValue("prev." + k, out v) ? v : ""; }
            if (Ours(current["recordingPath"], dir))
                foreach (string k in RecordKeys) { string v; values[k] = cfg.TryGetValue("prev." + k, out v) ? v : (k == "autoRecording" ? "0" : ""); }
            WriteIni(ini, PatchSettings(text, values), enc);
        }
        finally
        {
            if (wasRunning) Start(exe, "");
        }
        Say(dir, "MicroSIP avvalgi holiga qaytarildi");
        return 0;
    }

    // ─── ini (server/phone/microsip.ts bilan bir xil qoidalar) ──────────────────────

    /// Windows ini'ni faqat FF FE belgisi bo'lsa Unicode deb o'qiydi, aks holda — ANSI (biz yozadigan matn — faqat ASCII)
    private static string ReadIni(string file, out Encoding enc)
    {
        byte[] b = File.ReadAllBytes(file);
        if (b.Length >= 2 && b[0] == 0xFF && b[1] == 0xFE) { enc = Encoding.Unicode; return Encoding.Unicode.GetString(b, 2, b.Length - 2); }
        enc = Encoding.GetEncoding(28591);
        return enc.GetString(b);
    }

    private static void WriteIni(string file, string text, Encoding enc)
    {
        byte[] body = enc.GetBytes(text);
        byte[] bom = enc == Encoding.Unicode ? new byte[] { 0xFF, 0xFE } : new byte[0];
        using (var fs = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.Read))
        {
            fs.Write(bom, 0, bom.Length);
            fs.Write(body, 0, body.Length);
        }
    }

    private static string SectionName(string line)
    {
        Match m = Regex.Match(line, "^\\s*\\[([^\\]]*)\\]\\s*$");
        return m.Success ? m.Groups[1].Value.Trim().ToLowerInvariant() : null;
    }

    private static string KeyOf(string line)
    {
        Match m = Regex.Match(line, "^\\s*([^=;\\[\\s][^=]*?)\\s*=");
        return m.Success ? m.Groups[1].Value.ToLowerInvariant() : null;
    }

    /// MicroSIP 3.22 qiymatlarni qo'shtirnoq ichida yozadi, eskilari — qo'shtirnoqsiz
    private static string Unquote(string value)
    {
        string v = value.Trim();
        return v.Length >= 2 && (v[0] == '"' || v[0] == '\'') && v[v.Length - 1] == v[0] ? v.Substring(1, v.Length - 2) : v;
    }

    /// [Settings] bo'limidagi qiymatlar (yo'q bo'lsa — bo'sh). Kalit takrorlansa birinchisi
    private static Dictionary<string, string> ReadSettings(string text, string[] keys)
    {
        var outMap = new Dictionary<string, string>();
        foreach (string k in keys) outMap[k] = "";
        var seen = new HashSet<string>();
        bool inSettings = false;
        foreach (string line in Regex.Split(text, "\r?\n"))
        {
            string section = SectionName(line);
            if (section != null) { inSettings = section == "settings"; continue; }
            if (!inSettings) continue;
            string key = KeyOf(line);
            foreach (string k in keys)
                if (k.ToLowerInvariant() == key && seen.Add(k)) outMap[k] = Unquote(line.Substring(line.IndexOf('=') + 1));
        }
        return outMap;
    }

    /// [Settings] bo'limida berilgan kalitlarni almashtiradi (yo'q bo'lsa — bo'limdagi oxirgi bo'sh bo'lmagan satrdan keyin qo'shadi)
    private static string PatchSettings(string text, Dictionary<string, string> values)
    {
        string eol = text.Contains("\r\n") ? "\r\n" : "\n";
        var pending = new List<KeyValuePair<string, string>>(values);
        var outLines = new List<string>();
        bool inSettings = false, sawSettings = false;
        int insertAt = -1;
        Action flushMissing = delegate
        {
            if (insertAt < 0 || pending.Count == 0) return;
            var lines = new List<string>();
            foreach (var p in pending) lines.Add(p.Key + "=\"" + p.Value + "\"");
            outLines.InsertRange(insertAt, lines);
            pending.Clear();
        };
        foreach (string line in Regex.Split(text, "\r?\n"))
        {
            string section = SectionName(line);
            if (section != null)
            {
                if (inSettings) flushMissing();
                inSettings = section == "settings";
                if (inSettings) sawSettings = true;
                outLines.Add(line);
                if (inSettings) insertAt = outLines.Count;
                continue;
            }
            if (inSettings)
            {
                string key = KeyOf(line) ?? "";
                int hit = pending.FindIndex(p => p.Key.ToLowerInvariant() == key);
                if (hit >= 0)
                {
                    outLines.Add(pending[hit].Key + "=\"" + pending[hit].Value + "\"");
                    pending.RemoveAt(hit);
                    insertAt = outLines.Count;
                    continue;
                }
                outLines.Add(line);
                if (line.Trim() != "") insertAt = outLines.Count;
                continue;
            }
            outLines.Add(line);
        }
        if (inSettings) flushMissing();
        if (!sawSettings && pending.Count > 0)
        {
            while (outLines.Count > 0 && outLines[outLines.Count - 1].Trim() == "") outLines.RemoveAt(outLines.Count - 1);
            outLines.Add("[Settings]");
            foreach (var p in pending) outLines.Add(p.Key + "=\"" + p.Value + "\"");
            outLines.Add("");
        }
        return string.Join(eol, outLines.ToArray());
    }

    /// Faqat sinov uchun (e2e-phone): ini'ni o'zgartiradi — natija microsip.ts dagi bilan solishtiriladi
    private static int PatchIniFile(string[] args)
    {
        if (args.Length < 2) throw new Exception("patch-ini <fayl> kalit=qiymat …");
        var values = new Dictionary<string, string>();
        for (int i = 2; i < args.Length; i++) { int eq = args[i].IndexOf('='); if (eq > 0) values[args[i].Substring(0, eq)] = args[i].Substring(eq + 1); }
        Encoding enc;
        string text = ReadIni(args[1], out enc);
        WriteIni(args[1], PatchSettings(text, values), enc);
        return 0;
    }

    // ─── 2c. Fondagi yordamchi ────────────────────────────────────────────────

    /// Server kalitni bekor qilgan (kompyuter paneldan olib tashlangan) — «Access denied» kabi fayl xatolaridan ajratish uchun
    private sealed class RevokedException : Exception { }

    /// Bir vaqtda bitta yordamchi. Oldingisi o'ldirilgan bo'lsa (remove) Windows «tashlab ketilgan» deydi — bu ham egallandi degani
    private static bool Acquire(Mutex m)
    {
        try { return m.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
    }

    private static bool AgentRunning()
    {
        using (var m = new Mutex(false, "Local\\PalantirStansiya"))
        {
            if (!Acquire(m)) return true;
            m.ReleaseMutex();
            return false;
        }
    }

    private static int Agent(string dir, bool once)
    {
        var cfg = ReadConfig(dir);
        string server = ServerUrl(cfg), token = Need(cfg, "token");
        using (var single = new Mutex(false, "Local\\PalantirStansiya"))
        {
            if (!once && !Acquire(single)) return 0;
            int failures = 0;
            while (true)
            {
                try
                {
                    SendEvents(dir, server, token);
                    SendRecordings(dir, server, token);
                    RunCommands(dir, cfg, server, token, once ? 0 : 20);
                    failures = 0;
                }
                catch (RevokedException)
                {
                    Log(dir, "kalit bekor qilingan — paneldan qayta ulang (pair)");
                    if (once) return 2;
                    Thread.Sleep(60000);
                }
                catch (Exception e)
                {
                    if (failures++ % 20 == 0) Log(dir, "server bilan aloqa yo'q: " + e.Message);
                    if (once) return 1;
                    Thread.Sleep(Math.Min(30000, 2000 * failures));
                }
                if (once) return 0;
            }
        }
    }

    private static void Check(int status, string body)
    {
        if (status == 401) throw new RevokedException();
        if (status != 200) throw new Exception("server " + status + ": " + (JsonField(body, "error") ?? ""));
    }

    /// spool dagi hodisalar (eskisi birinchi) bir so'rovda; server qabul qilgachgina o'chiriladi
    private static void SendEvents(string dir, string server, string token)
    {
        string spool = Path.Combine(dir, "spool");
        if (!Directory.Exists(spool)) return;
        string[] files = Directory.GetFiles(spool, "*.evt");
        Array.Sort(files, StringComparer.Ordinal);
        if (files.Length == 0) return;
        var sent = new List<string>();
        var json = new StringBuilder("{\"events\":[");
        foreach (string f in files)
        {
            if (sent.Count >= 100) break;
            string[] lines = File.ReadAllText(f, Encoding.UTF8).Split('\n');
            sent.Add(f);
            // Buzilgan yoki 14 kundan eski hodisa — tashlanadi
            if (lines.Length < 3 || Array.IndexOf(new[] { "incoming", "answer", "start", "end", "outgoing" }, lines[0].Trim()) < 0) continue;
            DateTime at;
            if (!DateTime.TryParse(lines[2].Trim(), null, System.Globalization.DateTimeStyles.RoundtripKind, out at) || DateTime.UtcNow - at.ToUniversalTime() > TimeSpan.FromDays(14)) continue;
            if (json[json.Length - 1] == '}') json.Append(',');
            json.Append("{\"event\":").Append(JsonString(lines[0].Trim())).Append(",\"number\":").Append(JsonString(Clean(lines[1].Trim())))
                .Append(",\"at\":").Append(JsonString(at.ToUniversalTime().ToString("o"))).Append('}');
        }
        json.Append("]}");
        int status;
        string body = Http("POST", server + "/api/phone/station/events", token, Encoding.UTF8.GetBytes(json.ToString()), "application/json", 20000, out status);
        Check(status, body);
        foreach (string f in sent) File.Delete(f);
    }

    /// MicroSIP yozib bo'lgan fayllar (8 soniyadan beri o'zgarmagan) — asl vaqtlari bilan; server qabul qilgach o'chiriladi
    private static void SendRecordings(string dir, string server, string token)
    {
        string rec = Path.Combine(dir, "rec");
        if (!Directory.Exists(rec)) return;
        foreach (string f in Directory.GetFiles(rec))
        {
            if (!Regex.IsMatch(f, "\\.(wav|mp3|ogg|opus)$", RegexOptions.IgnoreCase)) continue;
            var info = new FileInfo(f);
            if (DateTime.UtcNow - info.LastWriteTimeUtc < TimeSpan.FromSeconds(8)) continue;
            byte[] data;
            try { data = File.ReadAllBytes(f); } catch (IOException) { continue; }
            long born = (long)(info.CreationTimeUtc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            long mtime = (long)(info.LastWriteTimeUtc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            string url = server + "/api/phone/station/recording?name=" + Uri.EscapeDataString(info.Name) + "&born=" + born + "&mtime=" + mtime;
            int status;
            string body = Http("POST", url, token, data, "application/octet-stream", 120000, out status);
            if (status == 413 || status == 400)
            {
                // Juda katta (hub orqali — 15 MB gacha) yoki yaroqsiz: qayta-qayta yuborilmasin
                string aside = Path.Combine(rec, "yuborilmadi");
                Directory.CreateDirectory(aside);
                File.Move(f, Path.Combine(aside, info.Name));
                Log(dir, "yozuv yuborilmadi (" + status + "): " + info.Name);
                continue;
            }
            Check(status, body);
            File.Delete(f);
        }
    }

    /// Paneldagi «📞 Kompyuterdan» — MicroSIP shu raqamni teradi
    private static void RunCommands(string dir, Dictionary<string, string> cfg, string server, string token, int waitSec)
    {
        int status;
        string body = Http("GET", server + "/api/phone/station/commands?wait=" + waitSec, token, null, null, (waitSec + 15) * 1000, out status);
        Check(status, body);
        foreach (Match m in Regex.Matches(body, "\"number\"\\s*:\\s*\"([^\"]*)\""))
        {
            string number = Regex.Replace(m.Groups[1].Value, "[^0-9+*#]", "");
            if (number.Length < 2 || number.Length > 20) continue;
            string fake = Environment.GetEnvironmentVariable("PALANTIR_FAKE_DIAL_LOG");
            if (!string.IsNullOrEmpty(fake)) { File.AppendAllText(fake, number + "\n"); continue; }
            string exe;
            if (!cfg.TryGetValue("microsip", out exe) || !File.Exists(exe)) { Log(dir, "MicroSIP topilmadi — raqam terilmadi"); continue; }
            Start(exe, number);
        }
    }

    /// Oynasiz dastur (winexe): o'rnatgich natijani jurnaldan o'qiydi
    private static void Say(string dir, string message)
    {
        Console.WriteLine(message);
        Log(dir, message);
    }

    private static void Log(string dir, string message)
    {
        try
        {
            string file = Path.Combine(dir, "stansiya.log");
            if (File.Exists(file) && new FileInfo(file).Length > 1000000) File.Delete(file);
            File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n", new UTF8Encoding(false));
        }
        catch
        {
            // Jurnal yozilmasa ham ish to'xtamaydi
        }
    }
}
