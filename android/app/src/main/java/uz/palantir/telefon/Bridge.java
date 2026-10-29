package uz.palantir.telefon;

import android.annotation.SuppressLint;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Bitta qo'ng'iroq: telefon ↔ kompyuterdagi AI (tgvoice/sip_live.py, Asterisk AudioSocket bilan bir xil oqim).
 * Android ilovaga qo'ng'iroq ovozini to'g'ridan-to'g'ri bermaydi, shuning uchun ovoz karnay orqali yuradi: mijoz ovozi karnaydan
 * chiqadi va mikrofon uni eshitadi; AI ovozi karnaydan chiqadi va telefonning o'zi uni mijozga uzatadi. AI ovozining aks-sadosini
 * kompyuter balandligidan ajratadi (sip_live.echo_gate) — mijoz AI'ni bo'la oladi.
 */
final class Bridge extends Thread {
    private static final String TAG = "PalantirBridge";
    private static final int RATE = 8000;
    private static final int FRAME_BYTES = 320;           // 20 ms, 8 kHz, 16-bit
    private static final int HANGUP = 0x00, CALL_ID = 0x01, AUDIO = 0x10, ERROR = 0xFF;
    private static final int MODE_CUSTOMER = 2;
    private static final long ECHO_TAIL_MS = 350;         // jurnal: AI gapi tugagach ham shuncha vaqt «AI gapiryapti»
    private static final int AI_VOICE_PEAK = 300;         // shundan past bo'lak — jimlik (AI gapirmayapti)
    private static final int CONNECT_TIMEOUT_MS = 4000;

    interface Listener {
        void onStatus(String text);
        /** Kompyuter qo'ng'iroqni tugatdi (AI xayrlashdi yoki xato) — go'shak qo'yiladi */
        void onEnded();
    }

    private final Prefs prefs;
    private final String caller;
    private final Listener listener;
    private volatile boolean running = true;
    private volatile long muteUntil = 0;
    /** AI'ning navbatdagi ovozi qachon tugaydi (karnayda) */
    private long voiceEnd = 0;
    private Socket socket;
    private final java.io.File dumpFile;

    Bridge(Prefs prefs, String caller, Listener listener, java.io.File dumpFile) {
        super("palantir-bridge");
        this.dumpFile = dumpFile;
        this.prefs = prefs;
        this.caller = caller == null ? "" : caller;
        this.listener = listener;
    }

    void finish() {
        running = false;
        try { if (socket != null) socket.close(); } catch (IOException ignored) { }
    }

    @Override
    public void run() {
        AudioRecord rec = null;
        AudioTrack track = null;
        try {
            socket = new Socket();
            socket.connect(new InetSocketAddress(prefs.host(), prefs.port()), CONNECT_TIMEOUT_MS);
            socket.setTcpNoDelay(true);
            DataOutputStream out = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream()));
            DataInputStream in = new DataInputStream(socket.getInputStream());
            out.write(("PALANTIR " + prefs.key() + "\n").getBytes(StandardCharsets.UTF_8));
            send(out, CALL_ID, callId(caller));
            out.flush();

            rec = openRecorder();
            track = openTrack();
            rec.startRecording();
            track.play();
            listener.onStatus("AI gaplashyapti: " + caller);

            final AudioTrack player = track;
            Thread reader = new Thread(() -> readLoop(in, player), "palantir-read");
            reader.start();

            byte[] pcm = new byte[FRAME_BYTES];
            int peak = 0, frames = 0;
            // Sinov: mikrofon eshitgan ovoz faylga (oxirgi qo'ng'iroq) — adb pull bilan olinadi, sifatni tekshirish uchun
            java.io.FileOutputStream dump = dumpFile == null ? null : new java.io.FileOutputStream(dumpFile);
            while (running) {
                int n = rec.read(pcm, 0, FRAME_BYTES);
                if (n <= 0) continue;
                if (dump != null) dump.write(pcm, 0, n);
                // Har 2 soniyada mikrofonning eng baland nuqtasi va AI gapiryaptimi — jurnal uchun
                peak = Math.max(peak, peak(pcm, n));
                if (++frames % 100 == 0) {
                    Log.i(TAG, "mikrofon: " + peak + (SystemClock.elapsedRealtime() < muteUntil ? " (AI gapiryapti)" : ""));
                    peak = 0;
                }
                // Mikrofon o'chirilmaydi — mijoz AI'ni bo'la olsin. Karnaydan qaytgan AI ovozi past (TECNO'da ≤600), mijoz ovozi
                // baland (2000+): kompyuter (sip_live.echo_gate, chegara 1500) AI gapirayotganda past ovozni o'tkazmaydi, baland
                // ovoz o'tadi va Gemini AI'ni to'xtatadi
                send(out, AUDIO, pcm);
                out.flush();
            }
        } catch (IOException e) {
            if (running) {
                Log.w(TAG, "ulanish: " + e.getMessage());
                listener.onStatus("Kompyuterga ulanib bo'lmadi: " + e.getMessage());
            }
        } finally {
            running = false;
            if (rec != null) { try { rec.stop(); } catch (IllegalStateException ignored) { } rec.release(); }
            if (track != null) { try { track.stop(); } catch (IllegalStateException ignored) { } track.release(); }
            try { if (socket != null) socket.close(); } catch (IOException ignored) { }
            listener.onEnded();
        }
    }

    /** Kompyuter → AI ovozi karnayga; HANGUP — AI qo'ng'iroqni tugatdi */
    private void readLoop(DataInputStream in, AudioTrack track) {
        try {
            while (running) {
                int kind = in.readUnsignedByte();
                int size = in.readUnsignedShort();
                byte[] data = new byte[size];
                in.readFully(data);
                if (kind == AUDIO) {
                    // Kompyuter AI jim turganda ham har 20 ms da bo'sh bo'lak yuboradi (oqim uzilmasin) — mikrofon faqat haqiqiy AI
                    // ovozida jim qilinadi, aks holda u butun qo'ng'iroq bo'yi o'chiq qolib, AI mijozni eshitmaydi.
                    // Navbatdagi ovoz qachon tugashini hisoblaymiz: 8 kHz × 2 bayt = 16 bayt/ms
                    // Zaxira (ECHO_TAIL_MS) faqat bir marta — gap tugagan joyga; har bo'lakka qo'shilsa jimlik daqiqalarga cho'ziladi
                    if (peak(data, size) > AI_VOICE_PEAK) {
                        long now = SystemClock.elapsedRealtime();
                        voiceEnd = Math.max(voiceEnd, now) + size / 16;
                        muteUntil = voiceEnd + ECHO_TAIL_MS;
                    }
                    track.write(data, 0, size);
                } else if (kind == HANGUP || kind == ERROR) {
                    break;
                }
            }
        } catch (IOException e) {
            Log.i(TAG, "o'qish tugadi: " + e.getMessage());
        }
        finish();
    }

    /**
     * Mikrofon: karnaydan eshitiladigan ovoz (VOICE_RECOGNITION — shovqin bostirishsiz, karnaydagi mijoz ovozini o'chirib yubormaydi).
     * TECNO Spark 10'da sinaldi: qo'ng'iroq paytida oddiy MIC'ni Android butunlay to'sadi (0), VOICE_RECOGNITION esa ovoz beradi
     */
    @SuppressLint("MissingPermission")
    private AudioRecord openRecorder() throws IOException {
        int min = Math.max(AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), FRAME_BYTES * 4);
        int[] sources = {MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC};
        for (int source : sources) {
            try {
                AudioRecord r = new AudioRecord(source, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min);
                if (r.getState() == AudioRecord.STATE_INITIALIZED) {
                    Log.i(TAG, "mikrofon manbasi: " + source);
                    return r;
                }
                r.release();
            } catch (RuntimeException e) {
                Log.i(TAG, "manba " + source + " ochilmadi: " + e.getMessage());
            }
        }
        throw new IOException("mikrofon ochilmadi (ruxsat berilganmi?)");
    }

    private static AudioTrack openTrack() {
        int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        return new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                .setAudioFormat(new AudioFormat.Builder()
                        .setSampleRate(RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build())
                .setBufferSizeInBytes(Math.max(min, FRAME_BYTES * 8))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
    }

    private static int peak(byte[] pcm, int n) {
        int max = 0;
        for (int i = 0; i + 1 < n; i += 2) max = Math.max(max, Math.abs((short) ((pcm[i] & 0xff) | (pcm[i + 1] << 8))));
        return max;
    }

    private static void send(DataOutputStream out, int kind, byte[] data) throws IOException {
        out.writeByte(kind);
        out.writeShort(data.length);
        out.write(data);
    }

    /**
     * sip_live.parse_call_id bilan bir xil: 1-raqam — kim (2 — mijoz), 2 raqam — telefon raqami uzunligi, 13 raqam — raqamning o'zi
     * (oldi nol bilan); qolgan 16 belgi — tasodifiy (qo'ng'iroq id'si). Hammasi 16 bayt
     */
    static byte[] callId(String number) {
        String digits = number.replaceAll("\\D", "");
        if (digits.length() > 13) digits = digits.substring(digits.length() - 13);
        StringBuilder hex = new StringBuilder();
        hex.append(MODE_CUSTOMER).append(String.format("%02d", digits.length()));
        for (int i = digits.length(); i < 13; i++) hex.append('0');
        hex.append(digits);
        byte[] rnd = new byte[8];
        new SecureRandom().nextBytes(rnd);
        for (byte b : rnd) hex.append(String.format("%02x", b));
        byte[] id = new byte[16];
        for (int i = 0; i < 16; i++) id[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return id;
    }
}
