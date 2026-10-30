/**
 * Post rasmi Instagram qabul qiladigan ko'rinishga: JPEG, eni 1080 gacha, tomonlar nisbati 4:5 (tik) dan 1.91:1 (yotiq) gacha —
 * telefondagi 3:4 surat yoki Meta AI chizgan PNG ham. ffmpeg bilan (IP kameralar uchun ham shu ffmpeg — FFMPEG_PATH).
 */
import { spawn } from 'node:child_process';
import { env } from '../env';

const MAX_INPUT = 15 * 1_048_576;
const TIMEOUT_MS = 60_000;
/** Instagram nisbat chegaralari (eni / bo'yi: 0.8 … 1.91) — biroz ichkarida: o'lcham juft songa yaxlitlanganda chegaradan chiqmasin */
const TALLEST = 0.805, WIDEST = 1.9;

export class ImageError extends Error {}

/** JPEG o'lchami (SOF belgisidan) */
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** Istalgan rasm → Instagram uchun JPEG (o'rtasidan kesiladi, chetlari emas) */
export function toPostJpeg(input: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  if (!input.length) return Promise.reject(new ImageError("Rasm bo'sh"));
  if (input.length > MAX_INPUT) return Promise.reject(new ImageError('Rasm juda katta (15 MB dan ko\'p)'));
  const crop = `crop='if(gt(iw/ih,${WIDEST}),ih*${WIDEST},iw)':'if(lt(iw/ih,${TALLEST}),iw/${TALLEST},ih)'`;
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', `${crop},scale='min(1080,iw)':-2,format=yuvj420p`, '-q:v', '3', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'];
  return new Promise((resolve, reject) => {
    const p = spawn(env.ffmpeg, args, { windowsHide: true });
    const out: Buffer[] = [], err: Buffer[] = [];
    const timer = setTimeout(() => { p.kill(); reject(new ImageError('Rasmni tayyorlash juda uzoq ketdi')); }, TIMEOUT_MS);
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => err.push(d));
    p.on('error', e => { clearTimeout(timer); reject(new ImageError(`ffmpeg topilmadi (${e.message}) — rasmni tayyorlash uchun ffmpeg kerak (FFMPEG_PATH)`)); });
    p.on('close', code => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(out), size = jpegSize(jpeg);
      if (code !== 0 || !size) return reject(new ImageError(`Rasm o'qilmadi — boshqa rasm tanlang${err.length ? ` (${Buffer.concat(err).toString().split('\n')[0].slice(0, 120)})` : ''}`));
      resolve({ jpeg, ...size });
    });
    p.stdin.on('error', () => { /* ffmpeg erta yopilsa — xato close'da */ });
    p.stdin.end(input);
  });
}
