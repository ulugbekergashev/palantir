/**
 * Ochiq Telegram kanalining postlari — t.me/s/<kanal> sahifasidan (login va bot kerak emas; faqat ochiq kanallar).
 * Post matni begona matn: yozuvchiga ma'lumot sifatida beriladi (writer.ts), ko'rsatma emas
 */
import { ContentError } from './store';

export interface SourcePost { id: number; url: string; date: string | null; text: string }

const HANDLE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const FETCH_MS = 15_000;
/** Bitta sahifadan olinadigan matnning chegarasi (juda uzun post yozuvchini to'ldirib yubormasin) */
const MAX_TEXT = 3000;

/** @nom, t.me/nom, https://t.me/s/nom/53 → nom; taklif havolasi (t.me/+…) va boshqa sayt — null */
export function normalizeHandle(input: string): string | null {
  const s = input.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([^/?#\s]+)/i.exec(s);
  const handle = m ? m[1] : s.replace(/^@/, '');
  return HANDLE.test(handle) ? handle : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const plain = (html: string): string =>
  decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Sahifadagi postlar (eskidan yangiga); matnsiz (faqat rasm/video) postlar tashlanadi */
export function parseChannelHtml(html: string, handle: string): SourcePost[] {
  const starts = [...html.matchAll(/data-post="([^"/]+)\/(\d+)"/g)];
  const out: SourcePost[] = [];
  starts.forEach((m, i) => {
    const block = html.slice(m.index, starts[i + 1]?.index ?? html.length);
    const body = /class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const text = body ? plain(body[1]).slice(0, MAX_TEXT) : '';
    if (!text) return;
    const date = /<time datetime="([^"]+)"/.exec(block)?.[1] ?? null;
    const channel = HANDLE.test(m[1]) ? m[1] : handle;
    out.push({ id: Number(m[2]), url: `https://t.me/${channel}/${m[2]}`, date, text });
  });
  return out;
}

/** Kanal nomi (sahifa sarlavhasi) */
const titleOf = (html: string): string | null => {
  const t = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  return t ? decode(t).slice(0, 120) : null;
};

/** «1.2K» → 1200, «3,4M» → 3400000, «845» → 845; o'qilmasa — null */
export function parseCount(s: string): number | null {
  const m = /^([\d.,]+)\s*([KkMm]?)$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] ? (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1));
}

/** Sahifadagi har postning ko'rishlar soni (xabar raqami → ko'rishlar); matnsiz (video, rasm) postlar ham */
export function parseViews(html: string): Map<number, number> {
  const starts = [...html.matchAll(/data-post="[^"/]+\/(\d+)"/g)];
  const out = new Map<number, number>();
  starts.forEach((m, i) => {
    const block = html.slice(m.index, starts[i + 1]?.index ?? html.length);
    const v = /class="tgme_widget_message_views"[^>]*>([^<]+)</.exec(block)?.[1];
    const n = v ? parseCount(decode(v)) : null;
    if (n !== null) out.set(Number(m[1]), n);
  });
  return out;
}

/** Egasining ochiq kanalidagi oxirgi postlarning ko'rishlari (Marketolog o'lchaydi) */
export async function fetchChannelViews(handle: string): Promise<Map<number, number>> {
  return parseViews(await page(handle));
}

async function page(handle: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://t.me/s/${handle}`, {
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'accept-language': 'ru,uz;q=0.9,en;q=0.8' },
    });
  } catch (e) {
    throw new ContentError(`@${handle} sahifasi ochilmadi (internetni tekshiring): ${(e as Error).message}`);
  }
  if (!res.ok) throw new ContentError(`@${handle} sahifasi ochilmadi (${res.status})`);
  const html = await res.text();
  // Yopiq yoki mavjud bo'lmagan kanal: t.me postlarsiz sahifa qaytaradi
  if (!html.includes('tgme_channel_info')) throw new ContentError(`@${handle} — ochiq kanal emas yoki topilmadi`);
  return html;
}

export async function fetchChannel(handle: string): Promise<{ title: string | null; posts: SourcePost[] }> {
  const html = await page(handle);
  return { title: titleOf(html), posts: parseChannelHtml(html, handle) };
}
