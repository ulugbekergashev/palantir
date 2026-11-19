/**
 * «Qo'shiq qo'y / videoni och» — darhol, so'rovsiz (Jarvis kabi): YouTube'da qidiradi, birinchi videoni egasining odatiy brauzerida ochadi.
 * Brauzerni boshqarish (computer_task), Chrome'ga ulanish va «Allow?» kerak emas — oddiy havola ochiladi, egasi ko'radi va eshitadi.
 * Avval bu ish yashirin brauzerda qilinardi: qo'shiq hech kimga eshitilmasdi (2026-11-19).
 */
import { spawn } from 'node:child_process';
import { installedBrowser } from '../browserPath';

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/** Qidiruv sahifasidagi har video: «videoRenderer» ichida id, keyin nomi */
const VIDEO_RE = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,3000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;

export interface FoundVideo { id: string; title: string; url: string }

const unescape = (s: string): string => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };

/** YouTube qidiruv sahifasidan videolar (reklama va pleylistlar emas — faqat videoRenderer) */
export function parseSearch(html: string): FoundVideo[] {
  const seen = new Set<string>();
  const out: FoundVideo[] = [];
  for (const m of html.matchAll(VIDEO_RE)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title: unescape(m[2]), url: `https://www.youtube.com/watch?v=${m[1]}` });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export async function searchYoutube(query: string, fetcher: typeof fetch = fetch): Promise<FoundVideo[]> {
  const r = await fetcher(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=uz&gl=UZ`, {
    headers: { 'user-agent': UA, 'accept-language': 'uz,ru;q=0.8,en;q=0.5' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`YouTube javob bermadi (${r.status})`);
  return parseSearch(await r.text());
}

/** Havolani egasining brauzerida ochadi: ochiq Chrome bo'lsa — unda yangi vkladka; Chrome yo'q bo'lsa — Windows'ning odatiy brauzeri */
export function openForOwner(url: string, run: typeof spawn = spawn): void {
  if (!/^https:\/\//.test(url)) throw new Error('Faqat https havola ochiladi');
  const exe = installedBrowser();
  const child = exe
    ? run(exe, [url], { detached: true, stdio: 'ignore', windowsHide: false })
    : process.platform === 'win32'
      ? run('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
