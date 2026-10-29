package uz.palantir.telefon;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Sozlash oynasi: kompyuter manzili va kalit, uch ruxsat (asosiy «Telefon» ilovasi, mikrofon va qo'ng'iroq, maxsus imkoniyatlar)
 * va ulanishni tekshirish. Asosiy «Telefon» ilovasi bo'lgani uchun raqam terish oynasi ham shu yerda (DIAL)
 */
public class MainActivity extends Activity {
    private static final int REQ_PERMS = 1, REQ_ROLE = 2;
    private static final String[] PERMS = {
            Manifest.permission.RECORD_AUDIO, Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.ANSWER_PHONE_CALLS, Manifest.permission.POST_NOTIFICATIONS};

    private Prefs prefs;
    private EditText host, port, key, dial;
    private CheckBox enabled;
    private TextView state;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // Qo'ng'iroq paytida oyna qulf ekrani ustida ham ko'rinadi (mikrofon shart) va ekran o'chmaydi
        setShowWhenLocked(true);
        setTurnScreenOn(true);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = new Prefs(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        box.setPadding(pad, pad, pad, pad);

        box.addView(title("Palantir telefon"));
        box.addView(text("Kompyuter manzili (Wi-Fi, masalan 192.168.1.153)"));
        host = field(prefs.host(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        box.addView(host);
        box.addView(text("Port"));
        port = field(String.valueOf(prefs.port()), InputType.TYPE_CLASS_NUMBER);
        box.addView(port);
        box.addView(text("Kalit"));
        key = field(prefs.key(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        box.addView(key);
        enabled = new CheckBox(this);
        enabled.setText("AI qo'ng'iroqlarni o'zi ko'tarsin");
        enabled.setChecked(prefs.enabled());
        box.addView(enabled);
        box.addView(button("Saqlash va ulanishni tekshirish", v -> saveAndTest()));

        box.addView(title("Ruxsatlar"));
        box.addView(button("1. Asosiy «Telefon» ilovasi qilish", v -> askRole()));
        box.addView(button("2. Mikrofon va qo'ng'iroq ruxsati", v -> requestPermissions(PERMS, REQ_PERMS)));
        box.addView(button("3. Maxsus imkoniyatlar → Palantir telefon → yoqish",
                v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))));

        box.addView(title("Qo'ng'iroq qilish"));
        dial = field(numberFrom(getIntent()), InputType.TYPE_CLASS_PHONE);
        box.addView(dial);
        box.addView(button("Qo'ng'iroq", v -> call()));

        state = text("");
        box.addView(title("Holat"));
        box.addView(state);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
        refresh();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String n = numberFrom(intent);
        if (!n.isEmpty()) dial.setText(n);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        RoleManager rm = getSystemService(RoleManager.class);
        boolean role = rm.isRoleHeld(RoleManager.ROLE_DIALER);
        boolean perms = true;
        for (String p : PERMS) perms &= checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
        String access = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean acc = access != null && access.contains(getPackageName());
        state.setText((role ? "✓" : "✗") + " Asosiy telefon ilovasi\n" + (perms ? "✓" : "✗") + " Ruxsatlar\n"
                + (acc ? "✓" : "✗") + " Maxsus imkoniyatlar\n\n" + CallService.lastStatus);
        main.removeCallbacksAndMessages(null);
        main.postDelayed(this::refresh, 2000);
    }

    private void askRole() {
        RoleManager rm = getSystemService(RoleManager.class);
        startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQ_ROLE);
    }

    private void saveAndTest() {
        int p;
        try { p = Integer.parseInt(port.getText().toString().trim()); } catch (NumberFormatException e) { p = Prefs.DEFAULT_PORT; }
        prefs.save(host.getText().toString(), p, key.getText().toString(), enabled.isChecked());
        final String h = prefs.host();
        final int pp = prefs.port();
        new Thread(() -> {
            String msg;
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(h, pp), 3000);
                msg = "Kompyuterga ulandi ✓";
            } catch (IOException e) {
                msg = "Ulanmadi: " + e.getMessage();
            }
            String m = msg;
            main.post(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
        }).start();
    }

    private void call() {
        String n = dial.getText().toString().trim();
        if (n.isEmpty()) return;
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(PERMS, REQ_PERMS);
            return;
        }
        getSystemService(TelecomManager.class).placeCall(Uri.fromParts("tel", n, null), new Bundle());
    }

    private static String numberFrom(Intent i) {
        Uri d = i == null ? null : i.getData();
        return d != null && "tel".equals(d.getScheme()) ? d.getSchemeSpecificPart() : "";
    }

    private TextView title(String s) {
        TextView t = text(s);
        t.setTextSize(20);
        t.setPadding(0, dp(18), 0, dp(6));
        return t;
    }

    private TextView text(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(15);
        return t;
    }

    private EditText field(String value, int type) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setInputType(type);
        e.setSingleLine(true);
        return e;
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
