/**
 * Matn → o'zbekcha ovozli xabar (VoiceLab, «Lola» kabi o'zbek ovozi). Telegram ovozli xabari OGG/Opus bo'lishi kerak:
 * VoiceLab WAV qaytaradi, ffmpeg bilan aylantiriladi. ffmpeg bo'lmasa — WAV audio fayl bo'lib boradi.
 * Telefon liniyasi kerak emas: «qo'ng'iroq qilib eslat»ning liniyasiz o'rnini bosadi (calls.ts sozlanmagan bo'lsa).
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { env } from './env';

const TIMEOUT_MS = 30_000, POLL_MS = 1_000, WAIT_MS = 45_000;
const MAX_CHARS = 600;

export const speechEnabled = (): boolean => !!env.voicelabKey;

const auth = () => ({ authorization: `Bearer ${env.voicelabKey}` });
let voiceId: string | null = env.voicelabVoice || null;

/** O'zbek ovozi: sozlamada berilmasa — ro'yxatdan «Lola» (bo'lmasa birinchisi), bir marta */
async function pickVoice(): Promise<string> {
  if (voiceId) return voiceId;
  const res = await fetch(`${env.voicelabUrl}/v1/voices?language=uz`, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ovozlar ro'yxati olinmadi (${res.status})`);
  const list = (await res.json() as { data?: { id: string; name: string }[] }).data ?? [];
  const found = list.find(v => /lola/i.test(v.name)) ?? list[0];
  if (!found) throw new Error("o'zbek ovozi topilmadi");
  voiceId = found.id;
  return voiceId;
}

/** VoiceLab: tez tayyor bo'lsa darhol WAV, aks holda navbat (202) — tayyor bo'lguncha kutiladi */
async function wav(text: string): Promise<Buffer> {
  const res = await fetch(`${env.voicelabUrl}/v1/tts`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ text: text.slice(0, MAX_CHARS), language: 'uz', voice_id: await pickVoice() }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 200) return Buffer.from(await res.arrayBuffer());
  if (res.status !== 202) throw new Error(`ovoz yaratilmadi (${res.status})`);
  const job = await res.json() as { id?: string; status_url?: string };
  const statusUrl = job.status_url ? new URL(job.status_url, env.voicelabUrl).href : `${env.voicelabUrl}/v1/tts/generations/${job.id}`;
  for (const end = Date.now() + WAIT_MS; Date.now() < end; ) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const s = await (await fetch(statusUrl, { headers: auth(), signal: AbortSignal.timeout(TIMEOUT_MS) })).json() as { status?: string; audio_url?: string };
    if (s.status === 'failed') throw new Error('ovoz yaratilmadi');
    // Imzolangan havola — kalitsiz yuklanadi
    if (s.status === 'completed' && s.audio_url) return Buffer.from(await (await fetch(s.audio_url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).arrayBuffer());
  }
  throw new Error('ovoz vaqtida tayyor bo\'lmadi');
}

/** Istalgan audio (WAV, AMR…) → OGG/Opus. ffmpeg yo'q yoki xato bo'lsa — null */
export function toOgg(input: Buffer): Promise<Buffer | null> {
  return new Promise(resolve => {
    const proc = spawn(env.ffmpeg, ['-nostdin', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const out: Buffer[] = [];
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', code => { clearTimeout(timer); const ogg = Buffer.concat(out); resolve(code === 0 && ogg.subarray(0, 4).toString() === 'OggS' ? ogg : null); });
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  });
}

/** Ovozli xabar tayyorlaydi: ogg — Telegram ovozli xabari sifatida; bo'lmasa wav — audio fayl sifatida */
export async function speak(text: string): Promise<{ ogg: Buffer } | { wav: Buffer }> {
  const audio = await wav(text);
  const ogg = await toOgg(audio);
  return ogg ? { ogg } : { wav: audio };
}
