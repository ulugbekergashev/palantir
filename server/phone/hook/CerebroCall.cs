using System;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Palantir MicroSIP hook")]
[assembly: AssemblyProduct("Palantir")]
[assembly: AssemblyDescription("MicroSIP qo'ng'iroq hodisasini Palantir'ga uzatadi")]
[assembly: AssemblyVersion("1.0.0.0")]

// MicroSIP qo'ng'iroq hodisasini Palantir'ga uzatadigan kichik yordamchi (DentaCRM'dagi jonli sinalgan yordamchining nusxasi).
//
// MicroSIP hodisada (microsip.ini: cmdIncomingCall, cmdCallAnswer, cmdCallStart, cmdCallEnd, cmdOutgoingCall) ko'rsatilgan
// FAYLNI ochadi va raqamni parametr qilib beradi. Sozlamada faqat fayl yo'li bo'ladi, shuning uchun hodisa turi shu dastur
// nusxasining NOMIDAN olinadi: ms-incoming.exe, ms-answer.exe, ms-start.exe, ms-end.exe, ms-outgoing.exe.
//
// Nega .cmd emas: qo'ng'iroq qiluvchi raqami (SIP «user» qismi) tashqaridan keladi va unda «&» kabi belgilar bo'lishi mumkin —
// .cmd fayl cmd.exe orqali ishga tushadi va bunday raqam buyruq bo'lib bajarilib ketardi. Bu yerda raqam hech qanday qobiqdan o'tmaydi.
//
// Hodisa shu papkadagi «spool» ichiga kichik fayl bo'lib yoziladi; uni Palantir (server/phone/microsip.ts) o'qib oladi.
// Tarmoq, port yoki kalit yo'q. Yig'ish: server/phone/hook.ts (Windows'ning o'zidagi csc.exe bilan)
internal static class CerebroCall
{
    private const int MaxNumberLength = 64;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            string dir = Path.GetDirectoryName(exePath);
            string name = Path.GetFileNameWithoutExtension(exePath).ToLowerInvariant();
            string eventName = name.StartsWith("ms-") ? name.Substring(3) : name;
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
}
