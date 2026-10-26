package uz.palantir.telefon;

import android.content.Context;
import android.content.SharedPreferences;

/** Sozlamalar: kompyuter manzili (Wi-Fi'dagi IP), port va kalit — kompyuterdagi .env dagi SIP_APP_KEY bilan bir xil */
final class Prefs {
    static final int DEFAULT_PORT = 9095;

    private final SharedPreferences sp;

    Prefs(Context ctx) {
        sp = ctx.getSharedPreferences("palantir", Context.MODE_PRIVATE);
    }

    String host() { return sp.getString("host", ""); }
    int port() { return sp.getInt("port", DEFAULT_PORT); }
    String key() { return sp.getString("key", ""); }
    /** O'chiq bo'lsa — qo'ng'iroqlar oddiy telefondagidek, AI ko'tarmaydi */
    boolean enabled() { return sp.getBoolean("enabled", true); }

    boolean ready() { return !host().isEmpty() && !key().isEmpty(); }

    void save(String host, int port, String key, boolean enabled) {
        sp.edit().putString("host", host.trim()).putInt("port", port).putString("key", key.trim()).putBoolean("enabled", enabled).apply();
    }
}
