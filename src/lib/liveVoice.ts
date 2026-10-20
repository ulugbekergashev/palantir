/**
 * Panel ovozi: egasi Palantir bilan jonli gaplashadi (AI bosh ekran). Brauzer ↔ tgvoice/web_live.py ↔ Gemini Live —
 * telefondagi yordamchining o'zi (vazifalar, Palantir, Obsidian). Mikrofon 16 kHz PCM bo'lib ketadi, AI ovozi 24 kHz PCM bo'lib keladi
 * va navbat bilan chalinadi; odam gapni bo'lsa, server «interrupt» yuboradi — chalinayotgan ovoz darhol to'xtaydi.
 * Aks-sadoni brauzerning o'zi tozalaydi (echoCancellation).
 */

export type Who = 'Siz' | 'Palantir' | 'Amal';
export type VoiceEvent =
  | { type: 'ready' }
  /** «Quloq» rejimi: server chaqiriqni kutyapti (mikrofon shu kompyuterda tinglanadi) */
  | { type: 'listening' }
  /** «Palantir» yoki «Jarvis» deyildi — shu ulanishda suhbat boshlanadi */
  | { type: 'wake'; word: string }
  | { type: 'partial' | 'line'; who: Who; text: string }
  | { type: 'tool'; name: string; state: 'start' | 'done'; args: Record<string, unknown>; result?: Record<string, unknown> }
  | { type: 'interrupt' }
  /** fatal — qayta urinish foydasiz (masalan, «quloq» modeli o'rnatilmagan) */
  | { type: 'error'; text: string; fatal?: boolean }
  | { type: 'closed' };

export interface VoiceSession {
  stop(): void;
  /** Ovoz balandligi 0..1: odamniki va AI'niki (sfera shunga qarab «nafas oladi») */
  levels(): { mic: number; ai: number };
}

/** tgvoice/web_live.py SIP_WEB_PORT */
const PORT = 9093;
const IN_RATE = 16_000, OUT_RATE = 24_000;
/** Serverga 40 ms dan yuboriladi */
const SEND_SAMPLES = IN_RATE / 25;

const WORKLET = `class PalantirMic extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('cerebro-mic', PalantirMic);`;

/** kind: owner — egasining yordamchisi; customer — qabulxonani mijoz bo'lib sinash; wake — «quloq»: chaqiriqni kutadi (tgvoice/web_live.py) */
export async function startVoice(token: string, on: (e: VoiceEvent) => void, kind: 'owner' | 'customer' | 'wake' = 'owner'): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const micCtx = new AudioContext({ sampleRate: IN_RATE });
  const outCtx = new AudioContext({ sampleRate: OUT_RATE });
  // Sahifa o'zi ochgan (bosilmagan) ovoz konteksti to'xtab turadi — birinchi bosish yoki tugmada uyg'onadi
  const wakeUp = () => { void micCtx.resume().catch(() => {}); void outCtx.resume().catch(() => {}); };
  wakeUp();
  window.addEventListener('pointerdown', wakeUp);
  window.addEventListener('keydown', wakeUp);
  const release = () => {
    window.removeEventListener('pointerdown', wakeUp);
    window.removeEventListener('keydown', wakeUp);
    stream.getTracks().forEach(t => t.stop());
    void micCtx.close().catch(() => {});
    void outCtx.close().catch(() => {});
  };
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await micCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  } catch (e) {
    release();
    throw e;
  }
  const mic = new AudioWorkletNode(micCtx, 'cerebro-mic');
  // Ishlov beruvchi grafga ulangan bo'lishi kerak, lekin o'z ovozingiz karnayga chiqmasin — jim tugun orqali
  const mute = micCtx.createGain();
  mute.gain.value = 0;
  micCtx.createMediaStreamSource(stream).connect(mic).connect(mute).connect(micCtx.destination);

  const out = outCtx.createGain();
  const analyser = outCtx.createAnalyser();
  analyser.fftSize = 512;
  out.connect(outCtx.destination);
  out.connect(analyser);

  const ws = new WebSocket(`ws://${location.hostname}:${PORT}/`);
  ws.binaryType = 'arraybuffer';
  let ready = false, closed = false, micLevel = 0, next = 0;
  let playing: AudioBufferSourceNode[] = [];
  let pending = new Int16Array(0);

  const silenceAi = () => {
    playing.forEach(s => { try { s.stop(); } catch { /* allaqachon tugagan */ } });
    playing = [];
    next = 0;
  };

  ws.onopen = () => ws.send(JSON.stringify({ token, mode: kind }));
  mic.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const f = e.data;
    let sum = 0;
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      pcm[i] = s * 0x7fff;
      sum += s * s;
    }
    micLevel = Math.sqrt(sum / f.length);
    if (!ready || ws.readyState !== WebSocket.OPEN) return;
    const joined = new Int16Array(pending.length + pcm.length);
    joined.set(pending);
    joined.set(pcm, pending.length);
    if (joined.length < SEND_SAMPLES) { pending = joined; return; }
    ws.send(joined.buffer);
    pending = new Int16Array(0);
  };
  ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
    if (typeof e.data === 'string') {
      let msg: VoiceEvent;
      try { msg = JSON.parse(e.data) as VoiceEvent; } catch { return; }
      if (msg.type === 'ready' || msg.type === 'listening') ready = true;
      if (msg.type === 'interrupt') silenceAi();
      on(msg);
      return;
    }
    const pcm = new Int16Array(e.data);
    if (!pcm.length) return;
    const buf = outCtx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    const at = Math.max(outCtx.currentTime + 0.04, next);
    src.start(at);
    next = at + buf.duration;
    playing.push(src);
    src.onended = () => { playing = playing.filter(p => p !== src); };
  };
  ws.onclose = () => {
    if (closed) return;
    closed = true;
    silenceAi();
    release();
    on({ type: 'closed' });
  };

  const wave = new Uint8Array(analyser.fftSize);
  return {
    stop: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      ws.close();
    },
    levels: () => {
      if (closed) return { mic: 0, ai: 0 };
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) { const x = (v - 128) / 128; sum += x * x; }
      return { mic: Math.min(1, micLevel * 4), ai: Math.min(1, Math.sqrt(sum / wave.length) * 4) };
    },
  };
}
