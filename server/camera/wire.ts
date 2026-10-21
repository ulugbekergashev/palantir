/** Server va kamera dvigateli (alohida jarayon) o'rtasidagi xabarlar. Bu faylda boshqa hech narsa import qilinmaydi: dvigatel bazani ochmasin */
export interface EngineCamera { id: string; url: string }
export type Box = { x: number; y: number; w: number; h: number };
/** Kadr izi (kamera yopildi/burildi tekshiruvi): o'rtacha yorug'lik va kontrast (0..255), 32×18 kulrang kichik rasm */
export interface Look { mean: number; std: number; thumb: number[] }
/** noRedirects — ffmpeg HTTP yo'naltirishni o'chira oladi (eski nashrda bu parametr yo'q) */
export type ToEngine = { type: 'cameras'; list: EngineCamera[]; ffmpeg: string; testInput: string[] | null; noRedirects: boolean };
export type FromEngine =
  | { type: 'seen'; id: string; people: Box[]; look?: Look }
  | { type: 'state'; id: string; state: 'connecting' | 'ok' | 'error'; message: string | null }
  | { type: 'fatal'; message: string };

/** Dvigatel jarayoni shu o'zgaruvchi bilan ishga tushiriladi (fayl shunchaki import qilinganda ishlab ketmasin) */
export const ENGINE_FLAG = 'PALANTIR_CAMERA_ENGINE';

/**
 * Kamera manzilining turi: rtsp — oqim (IP kamera, videoregistrator); mjpeg — HTTP oqim (telefon «IP Webcam», arzon kameralar);
 * still — faqat surat beradigan HTTP manzil (…/snapshot.jpg, …/shot.jpg): ffmpeg uni har kadrda qayta so'raydi
 */
export type SourceKind = 'rtsp' | 'mjpeg' | 'still';
export const sourceKind = (url: string): SourceKind => {
  if (/^rtsps?:/i.test(url)) return 'rtsp';
  const path = url.replace(/^[a-z]+:\/\/[^/]*/i, '').split('?')[0];
  return /\.(jpe?g|png)$/i.test(path) || /(snapshot|shot|still|capture|picture|image)/i.test(path) ? 'still' : 'mjpeg';
};
/** HTTP manzilda ffmpeg faqat tarmoq protokollari bilan ishlaydi (yo'naltirish orqali ham fayl o'qimasin) */
const HTTP_ONLY = ['-protocol_whitelist', 'http,https,tcp,tls,crypto'];
/**
 * ffmpeg kirish argumentlari. everySec — doimiy oqimda kadrlar orasi (surat manzili shu oraliqda so'raladi);
 * berilmasa — bitta kadr uchun (snapshot). noRedirects — HTTP yo'naltirish ishlamaydi (boshqa manzilga o'tkazib yuborib bo'lmaydi);
 * kind — manzil turi taxmini noto'g'ri chiqqanda (dvigatel boshqasini sinaydi)
 */
export function ffmpegInput(url: string, everySec?: number, o: { noRedirects?: boolean; kind?: SourceKind } = {}): string[] {
  const kind = o.kind ?? sourceKind(url);
  if (kind === 'rtsp') return ['-rtsp_transport', 'tcp', '-i', url];
  const http = [...HTTP_ONLY, ...(o.noRedirects ? ['-max_redirects', '0'] : [])];
  if (kind === 'mjpeg') return [...http, '-use_wallclock_as_timestamps', '1', '-i', url];
  // image2 protokol parametrini (-max_redirects) qabul qilmaydi. Bu yo'l faqat dvigatelda — u odamlar sanog'ini chiqaradi, rasmni emas;
  // tashqariga chiqadigan har kadr (panel, AI, Telegram) bitta-kadrli yo'ldan, yo'naltirish o'chiq holda olinadi
  return everySec ? [...HTTP_ONLY, '-f', 'image2', '-loop', '1', '-framerate', String(1 / everySec), '-re', '-i', url] : [...http, '-i', url];
}

/** Manzildagi login va parol jurnalga ham, panelga ham chiqmaydi */
export const maskUrl = (text: string): string => text
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1***@')
  // HTTP kameralarda login-parol ko'pincha so'rov satrida: ?user=admin&pwd=…
  .replace(/([?&;](?:user(?:name)?|usr|login|pwd|pass(?:word)?|token|key|auth)=)[^&\s'"]*/gi, '$1***');
