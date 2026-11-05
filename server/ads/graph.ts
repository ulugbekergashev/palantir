/**
 * Meta Graph (Marketing API v26.0) mijozi. Token hech qachon jurnalga yozilmaydi. Yozuvchi so'rovlar (POST/DELETE) avtomatik
 * qayta yuborilmaydi — ikki marta kampaniya yaratilmasin; o'quvchi (GET) vaqtinchalik xatoda bir marta qayta urinadi.
 * META_GRAPH_BASE — faqat sinov uchun (soxta server)
 */
export const GRAPH_VERSION = 'v26.0';
const TIMEOUT_MS = 30_000;
/** Vaqtinchalik xatolar (Meta hujjati: 1, 2 — xizmat; 4, 17, 341, 613, 80004 — so'rovlar ko'p) */
const TRANSIENT = new Set([1, 2, 4, 17, 341, 613, 80004]);

export class AdsError extends Error {
  constructor(message: string, readonly code: number | null = null, readonly transient = false) { super(message); }
}

const base = () => `${(process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '')}/${GRAPH_VERSION}`;
/** Video yuklash — Meta hujjati bo'yicha alohida manzil (sinovda — o'sha soxta server) */
const videoBase = () => `${(process.env.META_GRAPH_BASE || 'https://graph-video.facebook.com').replace(/\/$/, '')}/${GRAPH_VERSION}`;
const UPLOAD_TIMEOUT_MS = 180_000;

interface GraphErrorBody { error?: { message?: string; code?: number; error_user_msg?: string; error_user_title?: string } }

function form(params: Record<string, unknown>, token: string): URLSearchParams {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) f.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  f.set('access_token', token);
  return f;
}

async function once<T>(token: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown>): Promise<T> {
  const f = form(params, token);
  const url = `${base()}/${path.replace(/^\//, '')}`;
  let res: Response;
  try {
    res = method === 'GET'
      ? await fetch(`${url}?${f}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      : await fetch(url, { method, body: f, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new AdsError(`Meta bilan aloqa yo'q: ${(e as Error).message}`, null, true);
  }
  const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    const code = typeof e.code === 'number' ? e.code : null;
    // Egasiga tushunarli matn — Meta'ning foydalanuvchi uchun xabari bo'lsa, o'sha
    const text = e.error_user_msg ? `${e.error_user_title ? `${e.error_user_title}: ` : ''}${e.error_user_msg}` : e.message ?? `HTTP ${res.status}`;
    throw new AdsError(code === 190 ? `Meta tokeni ishlamayapti (muddati tugagan yoki bekor qilingan) — Targetolog → Ulash'da yangisini kiriting` : text, code, code !== null && TRANSIENT.has(code));
  }
  return body;
}

export async function graph<T>(token: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return await once<T>(token, method, path, params);
  } catch (e) {
    if (method === 'GET' && e instanceof AdsError && e.transient) {
      await new Promise(r => setTimeout(r, 1500));
      return once<T>(token, method, path, params);
    }
    throw e;
  }
}

/** Faylni yuklash (reklama videosi: act_X/advideos, «source» maydoni). Qayta yuborilmaydi — ikki nusxa yuklanmasin */
export async function graphUpload<T>(token: string, path: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}): Promise<T> {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set('access_token', token);
  f.set('source', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  let res: Response;
  try {
    res = await fetch(`${videoBase()}/${path.replace(/^\//, '')}`, { method: 'POST', body: f, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw new AdsError(`Meta'ga video yuklanmadi: ${(e as Error).message}`, null, true);
  }
  const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    throw new AdsError(e.error_user_msg ?? e.message ?? `HTTP ${res.status}`, typeof e.code === 'number' ? e.code : null);
  }
  return body;
}
