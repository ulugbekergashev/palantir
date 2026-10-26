package uz.palantir.telefon;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.telecom.Call;
import android.telecom.CallAudioState;
import android.telecom.InCallService;
import android.telecom.VideoProfile;
import android.util.Log;

/**
 * Asosiy «Telefon» ilovasi sifatida Android har qo'ng'iroqni shu xizmatga beradi: kiruvchini o'zi ko'taradi, karnayni yoqadi va
 * ovozni kompyuterdagi AI'ga ulaydi (Bridge). AI qo'ng'iroqni tugatsa — go'shak qo'yiladi.
 */
public class CallService extends InCallService {
    private static final String TAG = "PalantirCall";
    private static final long ANSWER_DELAY_MS = 1500;     // mijoz bir marta jiringlashni eshitsin
    private static final String CHANNEL = "call";
    private static final int NOTIFICATION_ID = 1;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Bridge bridge;
    private Call current;

    static volatile String lastStatus = "Kutilmoqda";

    @Override
    public void onCallAdded(Call call) {
        Prefs prefs = new Prefs(this);
        if (!prefs.enabled() || !prefs.ready()) {
            status("AI o'chiq yoki sozlanmagan — qo'ng'iroq oddiy");
            return;
        }
        if (current != null) {
            status("Band: ikkinchi qo'ng'iroq ko'tarilmadi");
            return;
        }
        current = call;
        call.registerCallback(callback);
        if (call.getState() == Call.STATE_RINGING) {
            status("Kiruvchi qo'ng'iroq: " + number(call));
            main.postDelayed(() -> {
                if (call.getState() == Call.STATE_RINGING) call.answer(VideoProfile.STATE_AUDIO_ONLY);
            }, ANSWER_DELAY_MS);
        } else if (call.getState() == Call.STATE_ACTIVE) {
            start(call);
        }
    }

    @Override
    public void onCallRemoved(Call call) {
        if (call == current) {
            call.unregisterCallback(callback);
            stop();
        }
    }

    private final Call.Callback callback = new Call.Callback() {
        @Override
        public void onStateChanged(Call call, int state) {
            if (state == Call.STATE_ACTIVE) start(call);
            else if (state == Call.STATE_DISCONNECTED) stop();
        }
    };

    private void start(Call call) {
        if (bridge != null) return;
        // Ovoz karnay orqali yuradi (Bridge izohi), shuning uchun karnay to'liq balandlikda
        setAudioRoute(CallAudioState.ROUTE_SPEAKER);
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);
        am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL), 0);
        foreground();
        bridge = new Bridge(new Prefs(this), number(call), new Bridge.Listener() {
            @Override public void onStatus(String text) { status(text); }
            @Override public void onEnded() {
                main.post(() -> {
                    if (current != null && current.getState() != Call.STATE_DISCONNECTED) current.disconnect();
                });
            }
        });
        bridge.start();
    }

    private void stop() {
        if (bridge != null) {
            bridge.finish();
            bridge = null;
        }
        current = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        status("Kutilmoqda");
    }

    /** Qo'ng'iroq paytida mikrofon ishlashi uchun xizmat oldingi planda */
    private void foreground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Qo'ng'iroq", NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("Palantir: AI qo'ng'iroqda")
                .setOngoing(true)
                .build();
        try {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } catch (RuntimeException e) {
            Log.w(TAG, "oldingi plan: " + e.getMessage());
        }
    }

    private static String number(Call call) {
        Uri handle = call.getDetails().getHandle();
        return handle == null ? "" : handle.getSchemeSpecificPart();
    }

    private void status(String text) {
        lastStatus = text;
        Log.i(TAG, text);
    }
}
