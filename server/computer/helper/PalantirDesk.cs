// Palantir kompyuter yordamchisi (Windows): ekran rasmi, sichqoncha va klaviatura. server/computer/desktop.ts yig'adi (csc.exe) va ishga tushiradi.
// Protokol: stdin'dan bitta qator — bitta JSON buyruq, stdout'ga bitta qator — JSON javob ({"ok":true,...} yoki {"ok":false,"error":"..."}).
// Koordinatalar — ekranning haqiqiy piksellari (DPI hisobga olinadi). Faqat asosiy ekran.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class PalantirDesk
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short VkKeyScan(char c);

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint KEYUP = 0x2, UNICODE = 0x4, EXTENDED = 0x1;
    const uint WHEEL = 0x800, HWHEEL = 0x1000;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
    {
        { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "esc", 0x1B }, { "escape", 0x1B }, { "backspace", 0x08 }, { "delete", 0x2E }, { "del", 0x2E },
        { "space", 0x20 }, { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 }, { "arrowup", 0x26 }, { "arrowdown", 0x28 }, { "arrowleft", 0x25 }, { "arrowright", 0x27 },
        { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "page_up", 0x21 }, { "pagedown", 0x22 }, { "page_down", 0x22 }, { "insert", 0x2D },
        { "ctrl", 0x11 }, { "control", 0x11 }, { "alt", 0x12 }, { "shift", 0x10 }, { "super", 0x5B }, { "win", 0x5B }, { "cmd", 0x5B }, { "meta", 0x5B },
        { "capslock", 0x14 }, { "printscreen", 0x2C },
    };
    static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x26, 0x28, 0x25, 0x27, 0x24, 0x23, 0x21, 0x22, 0x2D, 0x2E, 0x5B };

    static int Main()
    {
        SetProcessDPIAware();
        Console.OutputEncoding = new UTF8Encoding(false);
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = input.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            string reply;
            try { reply = Json.Serialize(Run(Json.Deserialize<Dictionary<string, object>>(line))); }
            catch (Exception e) { reply = Json.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", e.Message } }); }
            Console.Out.WriteLine(reply);
            Console.Out.Flush();
        }
        return 0;
    }

    static int Int(Dictionary<string, object> c, string k, int def = 0) { object v; return c.TryGetValue(k, out v) && v != null ? Convert.ToInt32(v) : def; }
    static string Str(Dictionary<string, object> c, string k) { object v; return c.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : ""; }

    static Dictionary<string, object> Ok() { return new Dictionary<string, object> { { "ok", true } }; }

    static Dictionary<string, object> Run(Dictionary<string, object> c)
    {
        string cmd = Str(c, "cmd");
        int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
        switch (cmd)
        {
            case "size": { var r = Ok(); r["w"] = w; r["h"] = h; return r; }
            case "capture": { var r = Ok(); r["png"] = Capture(Int(c, "x"), Int(c, "y"), Int(c, "cw", w), Int(c, "ch", h), Int(c, "outW", w), Int(c, "outH", h)); return r; }
            case "cursor": { POINT p; GetCursorPos(out p); var r = Ok(); r["x"] = p.X; r["y"] = p.Y; return r; }
            case "move": SetCursorPos(Int(c, "x"), Int(c, "y")); return Ok();
            case "click":
            {
                SetCursorPos(Int(c, "x"), Int(c, "y"));
                Thread.Sleep(30);
                var mods = Mods(Str(c, "mods"));
                Press(mods, true);
                string button = Str(c, "button");
                uint down = button == "right" ? 0x8u : button == "middle" ? 0x20u : 0x2u;
                for (int i = 0; i < Math.Max(1, Int(c, "count", 1)); i++) { Mouse(down, 0); Mouse(down * 2, 0); Thread.Sleep(40); }
                Press(mods, false);
                return Ok();
            }
            case "down": Mouse(0x2, 0); return Ok();
            case "up": Mouse(0x4, 0); return Ok();
            case "scroll":
            {
                SetCursorPos(Int(c, "x"), Int(c, "y"));
                var mods = Mods(Str(c, "mods"));
                Press(mods, true);
                int dx = Int(c, "dx"), dy = Int(c, "dy");
                if (dy != 0) Mouse(WHEEL, -dy * 120);
                if (dx != 0) Mouse(HWHEEL, dx * 120);
                Press(mods, false);
                return Ok();
            }
            case "type":
                foreach (char ch in Str(c, "text"))
                {
                    if (ch == '\n') { Key(0x0D, true); Key(0x0D, false); continue; }
                    Unicode(ch, true); Unicode(ch, false);
                    Thread.Sleep(5);
                }
                return Ok();
            case "key":
            {
                int repeat = Math.Max(1, Int(c, "repeat", 1));
                for (int i = 0; i < repeat; i++) foreach (string combo in Str(c, "combo").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)) Combo(combo, 0);
                return Ok();
            }
            case "hold": Combo(Str(c, "combo"), Int(c, "ms")); return Ok();
            default: throw new Exception("noma'lum buyruq: " + cmd);
        }
    }

    static string Capture(int x, int y, int cw, int ch, int outW, int outH)
    {
        using (var shot = new Bitmap(cw, ch, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(shot)) g.CopyFromScreen(x, y, 0, 0, new Size(cw, ch), CopyPixelOperation.SourceCopy);
            using (var scaled = new Bitmap(outW, outH, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(scaled))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.DrawImage(shot, 0, 0, outW, outH);
                }
                using (var ms = new MemoryStream()) { scaled.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
            }
        }
    }

    static void Mouse(uint flags, int data)
    {
        var i = new INPUT { type = INPUT_MOUSE };
        i.u.mi = new MOUSEINPUT { dwFlags = flags, mouseData = unchecked((uint)data) };
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Key(ushort vk, bool down)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = (down ? 0 : KEYUP) | (Extended.Contains(vk) ? EXTENDED : 0) };
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Unicode(char ch, bool down)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = UNICODE | (down ? 0 : KEYUP) };
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }

    static List<ushort> Mods(string mods)
    {
        var list = new List<ushort>();
        foreach (string m in mods.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries)) { ushort vk; if (Keys.TryGetValue(m.Trim(), out vk)) list.Add(vk); }
        return list;
    }

    static void Press(List<ushort> keys, bool down)
    {
        if (down) foreach (ushort k in keys) Key(k, true);
        else for (int i = keys.Count - 1; i >= 0; i--) Key(keys[i], false);
    }

    static ushort Vk(string name)
    {
        ushort vk;
        if (Keys.TryGetValue(name, out vk)) return vk;
        if (name.Length > 1 && (name[0] == 'f' || name[0] == 'F')) { int n; if (int.TryParse(name.Substring(1), out n) && n >= 1 && n <= 24) return (ushort)(0x6F + n); }
        if (name.Length == 1) { short s = VkKeyScan(name[0]); if (s != -1) return (ushort)(s & 0xff); }
        throw new Exception("noma'lum tugma: " + name);
    }

    static void Combo(string combo, int holdMs)
    {
        var keys = new List<ushort>();
        foreach (string part in combo.Split('+')) if (part.Trim().Length > 0) keys.Add(Vk(part.Trim()));
        // Bitta harf katta yozilgan bo'lsa (masalan «A») — Shift bilan
        if (keys.Count == 1 && combo.Length == 1 && char.IsUpper(combo[0])) keys.Insert(0, 0x10);
        Press(keys, true);
        Thread.Sleep(holdMs > 0 ? Math.Min(holdMs, 300000) : 30);
        Press(keys, false);
    }
}
