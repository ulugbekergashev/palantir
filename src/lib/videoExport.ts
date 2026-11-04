/**
 * Videoni mp4 qilib yig'ish (WebCodecs + Mediabunny). Kadrlar real vaqtni kutmasdan birma-bir chiziladi va kodlanadi:
 * kodlovchi band bo'lsa kutiladi — MediaRecorder'dagidek kadr tushib qolmaydi (u ko'rinmas brauzerda birinchi 6–10 soniyani
 * yo'qotardi), video har doim 30 kadr/s va ovoz bilan aniq mos, yig'ish odatda videodan tezroq.
 * Ovoz: diktor va plitka tovushlari OfflineAudioContext'da aralashtiriladi (48 kHz, AAC — Instagram/Telegram qabul qiladi).
 * Brauzer WebCodecs'ni bilmasa — canExport() false, panel eski real vaqt yozuviga qaytadi.
 */
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { H, LEAD, W, drawFrame, loadFonts, mixdown, type RenderSpec } from './videoRender';

const FPS = 30;
const RATE = 48_000;
const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 192_000;

export async function canExport(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return false;
  try {
    return (await canEncodeVideo('avc', { width: W, height: H, quality: new Quality({ bitrate: VIDEO_BITRATE }) }))
      && (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: RATE }));
  } catch {
    return false;
  }
}

export class ExportCancelled extends Error {}

/** spec + diktor ovozi → mp4. onProgress — 0…1; signal bekor qilsa ExportCancelled */
export async function exportMp4(spec: RenderSpec, audio: ArrayBuffer, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  await loadFonts();
  const mix = await mixdown(spec, audio, RATE);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Kanvas ochilmadi');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: VIDEO_BITRATE }), keyFrameInterval: 2 });
  const sound = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }) });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(sound);
  await output.start();
  // Ovoz kutilmaydi: ikkala yo'lak birga yozilsin (birini oxirigacha kutish muxer navbatini to'xtatib qo'yishi mumkin)
  const soundDone = sound.add(mix);
  try {
    const frames = Math.ceil(mix.duration * FPS);
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new ExportCancelled('Bekor qilindi');
      const at = i / FPS;
      // Birinchi LEAD soniya — muqova (ovoz shundan keyin boshlanadi), ko'rish rejimi bilan bir xil
      drawFrame(ctx, spec, Math.max(0, at - LEAD));
      await video.add(at, 1 / FPS);
      onProgress?.((i + 1) / frames);
    }
    await soundDone;
    await output.finalize();
  } catch (e) {
    // Ovoz yo'lagi ham to'xtaydi: uning promisi hech kim kutmagan xato bo'lib qolmasin
    soundDone.catch(() => undefined);
    await output.cancel().catch(() => undefined);
    throw e;
  }
  const buf = output.target.buffer;
  if (!buf) throw new Error("Video yig'ilmadi");
  return new Blob([buf], { type: 'video/mp4' });
}
