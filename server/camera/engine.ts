/**
 * Kamera dvigateli — alohida jarayon (server/camera/stream.ts ishga tushiradi): IP kameralardan kadr oladi va odamlarni topadi.
 *   ffmpeg (har kameraga bittadan) RTSP oqimini kichik xom kadrlarga aylantiradi — har ikki soniyada bitta;
 *   odam topuvchi model (COCO-SSD, WebAssembly'da) har kadrdagi odamlarning joyini beradi;
 *   natija asosiy serverga yuboriladi: seanslar o'sha yerda sanaladi (brauzer kamerasi bilan bir xil yo'l).
 * Kadrlar hech qayerga saqlanmaydi va kompyuterdan chiqmaydi. Alohida jarayon — og'ir hisob serverni (bot, panel) to'xtatib qo'ymasin.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { ENGINE_FLAG, ffmpegInput, maskUrl, type Box, type EngineCamera, type FromEngine, type Look, type ToEngine } from './wire';

/** Model uchun kadr o'lchami (nisbat buzilsa ham zonalar to'g'ri tushadi: joylar kadr ulushida) va kadrlar orasi */
const WIDTH = 480, HEIGHT = 270, FRAME_BYTES = WIDTH * HEIGHT * 3, FRAME_EVERY_SEC = 2;
const MIN_SCORE = 0.5, MAX_PEOPLE = 20;
/** Kadr izi uchun kichik rasm o'lchami (kamera yopildi/burildi tekshiruvi) */
const THUMB_W = 32, THUMB_H = 18;
/** Shuncha vaqt kadr kelmasa — ffmpeg osilib qolgan: qayta ishga tushiriladi */
const SILENCE_MS = 30_000;
const RESTART_MIN_MS = 5_000, RESTART_MAX_MS = 60_000;
const IDLE_MS = 200;

const send = (m: FromEngine) => { try { process.send?.(m); } catch { /* server yopilgan */ } };

interface Feed { cam: EngineCamera; proc: ChildProcess | null; pending: Buffer; latest: Buffer | null; lastFrameAt: number; wait: number; timer: NodeJS.Timeout | null; state: string }
const feeds = new Map<string, Feed>();
let ffmpeg = 'ffmpeg';
let testInput: string[] | null = null;

function setState(f: Feed, state: 'connecting' | 'ok' | 'error', message: string | null = null): void {
  const key = `${state}|${message ?? ''}`;
  if (f.state === key) return;
  f.state = key;
  send({ type: 'state', id: f.cam.id, state, message });
}

function start(f: Feed): void {
  f.timer = null;
  if (feeds.get(f.cam.id) !== f) return;
  const input = testInput ?? ffmpegInput(f.cam.url, FRAME_EVERY_SEC);
  const proc = spawn(ffmpeg, ['-nostdin', '-loglevel', 'error', ...input, '-an', '-vf', `fps=1/${FRAME_EVERY_SEC},scale=${WIDTH}:${HEIGHT}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  f.proc = proc;
  f.pending = Buffer.alloc(0);
  f.lastFrameAt = Date.now();
  setState(f, 'connecting');
  let problem = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    f.pending = f.pending.length ? Buffer.concat([f.pending, chunk]) : chunk;
    if (f.pending.length < FRAME_BYTES) return;
    // Faqat eng yangi to'liq kadr qoladi: model ulgurmasa eski kadrlar tashlab ketiladi
    const whole = Math.floor(f.pending.length / FRAME_BYTES);
    f.latest = Buffer.from(f.pending.subarray((whole - 1) * FRAME_BYTES, whole * FRAME_BYTES));
    f.pending = Buffer.from(f.pending.subarray(whole * FRAME_BYTES));
    f.lastFrameAt = Date.now();
    f.wait = RESTART_MIN_MS;
    setState(f, 'ok');
  });
  proc.stderr.on('data', (chunk: Buffer) => { problem = maskUrl(String(chunk)).trim().split(/\r?\n/).at(-1)?.slice(0, 200) ?? problem; });
  const ended = (why: string) => {
    if (f.proc !== proc) return;
    f.proc = null;
    if (feeds.get(f.cam.id) !== f) return;
    setState(f, 'error', problem || why);
    f.timer = setTimeout(() => start(f), f.wait);
    f.wait = Math.min(f.wait * 2, RESTART_MAX_MS);
  };
  proc.on('error', e => ended((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'ffmpeg topilmadi' : e.message));
  proc.on('exit', code => ended(`oqim uzildi (ffmpeg kodi ${code ?? '?'})`));
}

function stop(f: Feed): void {
  if (f.timer) clearTimeout(f.timer);
  const proc = f.proc;
  f.proc = null;
  proc?.kill();
}

/** Yangi ro'yxat: yo'q bo'lganlar to'xtaydi, yangilari va manzili o'zgarganlari ishga tushadi */
function sync(list: EngineCamera[]): void {
  for (const [id, f] of feeds) {
    const next = list.find(c => c.id === id);
    if (next?.url === f.cam.url) continue;
    feeds.delete(id);
    stop(f);
  }
  for (const cam of list) {
    if (feeds.has(cam.id)) continue;
    const f: Feed = { cam, proc: null, pending: Buffer.alloc(0), latest: null, lastFrameAt: Date.now(), wait: RESTART_MIN_MS, timer: null, state: '' };
    feeds.set(cam.id, f);
    start(f);
  }
}

type Detect = (frame: Buffer) => Promise<Box[]>;

async function loadDetector(): Promise<Detect> {
  // Kutubxona Node'da ishlayotganini ko'rib uzun maslahat chiqaradi — jurnalga kerak emas
  const warn = console.warn;
  console.warn = () => {};
  const [tf, wasm, cocoSsd] = await Promise.all([import('@tensorflow/tfjs'), import('@tensorflow/tfjs-backend-wasm'), import('@tensorflow-models/coco-ssd')]).finally(() => { console.warn = warn; });
  wasm.setWasmPaths(`${join(dirname(createRequire(import.meta.url).resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist')}/`);
  await tf.setBackend('wasm');
  await tf.ready();
  const dir = ['public', 'dist'].map(d => resolve(d, 'models/ssdlite_mobilenet_v2')).find(d => existsSync(join(d, 'model.json')));
  if (!dir) throw new Error('odam topuvchi model topilmadi — npm run camera:model');
  const manifest = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')) as { modelTopology: object; format?: string; weightsManifest: { paths: string[]; weights: [] }[] };
  const weights = Buffer.concat(manifest.weightsManifest.flatMap(g => g.paths).map(p => readFileSync(join(dir, p))));
  // Model fayllardan o'qiladi (kutubxona odatda URL kutadi — bu yerda server hali ishlamayotgan bo'lishi mumkin)
  const files = { load: async () => ({ modelTopology: manifest.modelTopology, format: manifest.format, weightSpecs: manifest.weightsManifest.flatMap(g => g.weights), weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }) };
  const model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: files as unknown as string });
  const unit = (n: number) => Math.min(1, Math.max(0, n));
  return async frame => {
    const image = tf.tensor3d(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength), [HEIGHT, WIDTH, 3], 'int32');
    try {
      const found = await model.detect(image, MAX_PEOPLE, MIN_SCORE);
      return found.filter(o => o.class === 'person').map(o => {
        const x = unit(o.bbox[0] / WIDTH), y = unit(o.bbox[1] / HEIGHT);
        return { x, y, w: Math.min(1 - x, o.bbox[2] / WIDTH), h: Math.min(1 - y, o.bbox[3] / HEIGHT) };
      }).filter(b => b.w > 0 && b.h > 0);
    } finally {
      image.dispose();
    }
  };
}

/** Kadr izi: yorug'lik, kontrast va 32×18 kulrang rasm (har ikkinchi nuqta — tez). Kadrning o'zi yuborilmaydi */
function lookOf(frame: Buffer): Look {
  const cells = new Float64Array(THUMB_W * THUMB_H), counts = new Uint32Array(THUMB_W * THUMB_H);
  let sum = 0, squares = 0, n = 0;
  for (let y = 0; y < HEIGHT; y += 2) {
    for (let x = 0; x < WIDTH; x += 2) {
      const i = (y * WIDTH + x) * 3;
      const l = 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
      sum += l; squares += l * l; n++;
      const c = Math.floor((y * THUMB_H) / HEIGHT) * THUMB_W + Math.floor((x * THUMB_W) / WIDTH);
      cells[c] += l; counts[c]++;
    }
  }
  const mean = sum / n;
  return { mean: Math.round(mean), std: Math.round(Math.sqrt(Math.max(0, squares / n - mean * mean)) * 10) / 10, thumb: Array.from(cells, (v, i) => Math.round(v / (counts[i] || 1))) };
}

async function main(): Promise<void> {
  // Server yopilsa (yoki majburan o'chirilsa) dvigatel va uning ffmpeg jarayonlari ham yopiladi
  const quit = () => { for (const f of feeds.values()) stop(f); process.exit(0); };
  process.on('disconnect', quit);
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
  process.on('message', (m: ToEngine) => {
    if (m?.type !== 'cameras') return;
    ffmpeg = m.ffmpeg;
    testInput = m.testInput;
    sync(m.list);
  });
  const detect = await loadDetector();
  setInterval(() => {
    for (const f of feeds.values()) if (f.proc && Date.now() - f.lastFrameAt > SILENCE_MS) { setState(f, 'error', 'kadr kelmayapti'); f.proc.kill(); }
  }, 5_000);
  for (;;) {
    let worked = false;
    for (const f of [...feeds.values()]) {
      const frame = f.latest;
      if (!frame) continue;
      f.latest = null;
      worked = true;
      send({ type: 'seen', id: f.cam.id, look: lookOf(frame), people: await detect(frame) });
    }
    if (!worked) await new Promise(r => setTimeout(r, IDLE_MS));
  }
}

// Faqat dvigatel jarayoni sifatida ishga tushganda (stream.ts shu belgini qo'yadi)
if (process.env[ENGINE_FLAG] === '1') {
  main().catch(e => {
    send({ type: 'fatal', message: (e as Error).message });
    process.exit(1);
  });
}
