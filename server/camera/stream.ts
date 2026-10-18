/**
 * IP kameralar (RTSP): manzilni tekshirish, bitta kadr olish (zonalarni chizish uchun) va kamera dvigatelini boshqarish.
 * Dvigatel — alohida jarayon (engine.ts): kamida bitta IP kamera bo'lganda ishga tushadi, to'xtab qolsa qayta yoqiladi.
 * Kadr olish uchun kompyuterda ffmpeg bo'lishi kerak (FFMPEG_PATH yoki PATH); bo'lmasa IP kameralar o'chiq, veb-kamera ishlayveradi.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { CameraFeed } from '../../src/types';
import { cameras } from '../db';
import { env } from '../env';
import { open } from '../secret';
import { ENGINE_FLAG, maskUrl, type Box, type FromEngine, type ToEngine } from './wire';

const MAX_URL = 300;
const SNAPSHOT_TIMEOUT_MS = 20_000, SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024, SNAPSHOT_WIDTH = 960;
const RESTART_MIN_MS = 5_000, RESTART_MAX_MS = 60_000;

let ffmpegOk: boolean | null = null;
/** ffmpeg bormi (bir marta tekshiriladi) */
export function ffmpegAvailable(): boolean {
  ffmpegOk ??= spawnSync(env.ffmpeg, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 }).status === 0;
  return ffmpegOk;
}

const testInput = (): string[] | null => {
  if (!env.cameraTestInput) return null;
  const v: unknown = JSON.parse(env.cameraTestInput);
  return Array.isArray(v) && v.every(x => typeof x === 'string') ? v : null;
};

/**
 * Egasi kiritgan kamera manzili. Faqat rtsp:// yoki rtsps:// — ffmpeg boshqa "manzil" bilan kompyuterdagi faylni ham o'qiy oladi.
 * Qaytaradi: tozalangan manzil va ko'rsatish uchun host (parolsiz)
 */
export function parseStream(input: string): { url: string; host: string } {
  const text = input.trim();
  if (!text || text.length > MAX_URL || /[\s\p{Cc}]/u.test(text)) throw new Error("Kamera manzili noto'g'ri");
  let u: URL;
  try { u = new URL(text); } catch { throw new Error("Kamera manzili noto'g'ri. Namuna: rtsp://admin:parol@192.168.1.64:554/Streaming/Channels/102"); }
  if (u.protocol !== 'rtsp:' && u.protocol !== 'rtsps:') throw new Error('Manzil rtsp:// bilan boshlanishi kerak');
  if (!u.hostname) throw new Error("Manzilda kamera IP'si yo'q");
  return { url: u.href, host: u.port ? `${u.hostname}:${u.port}` : u.hostname };
}

const inputArgs = (url: string): string[] => testInput() ?? ['-rtsp_transport', 'tcp', '-i', url];

/** Kameradan bitta kadr (JPEG): zonalarni uning ustida chizish va ulanishni tekshirish uchun */
export function snapshot(url: string, timeoutMs = SNAPSHOT_TIMEOUT_MS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(env.ffmpeg, ['-nostdin', '-loglevel', 'error', ...inputArgs(url), '-an', '-frames:v', '1', '-vf', `scale=${SNAPSHOT_WIDTH}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0, problem = '';
    const timer = setTimeout(() => { problem = 'kamera javob bermadi'; proc.kill(); }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => { size += c.length; if (size <= SNAPSHOT_MAX_BYTES) chunks.push(c); else proc.kill(); });
    proc.stderr.on('data', (c: Buffer) => { problem ||= maskUrl(String(c)).trim().split(/\r?\n/).at(-1)?.slice(0, 200) ?? ''; });
    proc.on('error', e => { clearTimeout(timer); reject(new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? "Bu kompyuterda ffmpeg yo'q — IP kamera uchun o'rnating" : e.message)); });
    proc.on('exit', () => {
      clearTimeout(timer);
      const image = Buffer.concat(chunks);
      // JPEG boshi: FF D8
      if (size <= SNAPSHOT_MAX_BYTES && image.length > 100 && image[0] === 0xff && image[1] === 0xd8) resolve(image);
      else reject(new Error(`Kameradan kadr olib bo'lmadi${problem ? `: ${problem}` : ''}. Manzil, login-parol va kamera yoqilganini tekshiring`));
    });
  });
}

// ─── Dvigatel ────────────────────────────────────────────────────────────────

type OnSeen = (businessId: string, cameraId: string, people: Box[]) => void;
let engine: ChildProcess | null = null;
let onSeen: OnSeen | null = null;
let halted = false;
let wait = RESTART_MIN_MS;
let restart: NodeJS.Timeout | null = null;
const owners = new Map<string, string>();
const feeds = new Map<string, CameraFeed>();

/** Kameraning hozirgi holati (panel uchun). IP kamera bo'lmasa — null */
export function feedOf(cameraId: string, isIp: boolean): CameraFeed | null {
  if (!isIp) return null;
  if (!ffmpegAvailable()) return { state: 'error', message: "Bu kompyuterda ffmpeg yo'q — IP kameralar ishlamaydi" };
  return feeds.get(cameraId) ?? { state: 'connecting', message: null };
}

function list(): ToEngine {
  owners.clear();
  const cams = cameras.streams().flatMap(c => {
    try {
      owners.set(c.id, c.businessId);
      return [{ id: c.id, url: open(c.stream) }];
    } catch {
      // Maxfiy kalit almashgan: manzilni ochib bo'lmaydi — egasi qayta kiritadi
      feeds.set(c.id, { state: 'error', message: 'Kamera manzilini qayta kiriting' });
      return [];
    }
  });
  return { type: 'cameras', list: cams, ffmpeg: env.ffmpeg, testInput: testInput() };
}

function launch(): void {
  restart = null;
  if (halted || engine) return;
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'server/camera/engine.ts'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, [ENGINE_FLAG]: '1' }, windowsHide: true });
  engine = child;
  child.on('message', (m: FromEngine) => {
    if (m.type === 'seen') {
      const businessId = owners.get(m.id);
      if (businessId) onSeen?.(businessId, m.id, m.people);
      wait = RESTART_MIN_MS;
    } else if (m.type === 'state') {
      feeds.set(m.id, { state: m.state, message: m.message });
      if (m.state === 'error') console.error(`[kamera] ${m.id}: ${m.message ?? 'xato'}`);
    } else {
      console.error('[kamera] dvigatel:', m.message);
    }
  });
  const ended = (why: string) => {
    if (engine !== child) return;
    engine = null;
    for (const id of owners.keys()) feeds.set(id, { state: 'error', message: 'Kamera dvigateli qayta ishga tushmoqda' });
    if (halted || !owners.size) return;
    console.error(`[kamera] dvigatel to'xtadi (${why}) — ${Math.round(wait / 1000)} soniyadan keyin qayta yoqiladi`);
    restart = setTimeout(launch, wait);
    wait = Math.min(wait * 2, RESTART_MAX_MS);
  };
  child.on('error', e => ended(e.message));
  child.on('exit', code => ended(`kod ${code ?? '?'}`));
  child.send(list());
}

/** Kameralar ro'yxati o'zgardi (qo'shildi, manzili almashdi, o'chirildi): dvigatelga yangi ro'yxat; kerak bo'lsa ishga tushadi yoki to'xtaydi */
export function syncEngine(): void {
  if (halted || !onSeen) return;
  const message = list();
  for (const id of feeds.keys()) if (!owners.has(id)) feeds.delete(id);
  if (!message.list.length) {
    engine?.kill();
    return;
  }
  if (!ffmpegAvailable()) return;
  if (engine) engine.send(message);
  else if (!restart) launch();
}

/** Server ishga tushganda bir marta. seen — har kadr natijasi (seanslar routes.ts da sanaladi) */
export function startCameraEngine(seen: OnSeen): void {
  onSeen = seen;
  syncEngine();
}

export function stopCameraEngine(): void {
  halted = true;
  if (restart) clearTimeout(restart);
  engine?.kill();
  engine = null;
}
