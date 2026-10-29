package uz.palantir.telefon;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Kompyuterdan USB orqali sozlash (o'rnatuvchi qo'lda kalit yozmasin):
 *   adb shell am broadcast -n uz.palantir.telefon/.SetupReceiver --es host 192.168.1.153 --ei port 9095 --es key KALIT
 * Faqat DUMP ruxsati borlar yubora oladi (adb, tizim) — boshqa ilova qo'ng'iroqlarni o'z serveriga burib yubora olmaydi
 */
public class SetupReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Prefs prefs = new Prefs(ctx);
        String host = intent.hasExtra("host") ? intent.getStringExtra("host") : prefs.host();
        String key = intent.hasExtra("key") ? intent.getStringExtra("key") : prefs.key();
        int port = intent.getIntExtra("port", prefs.port());
        prefs.save(host == null ? "" : host, port, key == null ? "" : key, intent.getBooleanExtra("enabled", prefs.enabled()));
        Log.i("PalantirSetup", "sozlandi: " + prefs.host() + ":" + prefs.port() + ", kalit " + (prefs.key().isEmpty() ? "yo'q" : "bor"));
        setResultCode(1);
    }
}
