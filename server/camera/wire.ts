/** Server va kamera dvigateli (alohida jarayon) o'rtasidagi xabarlar. Bu faylda boshqa hech narsa import qilinmaydi: dvigatel bazani ochmasin */
export interface EngineCamera { id: string; url: string }
export type Box = { x: number; y: number; w: number; h: number };
/** Kadr izi (kamera yopildi/burildi tekshiruvi): o'rtacha yorug'lik va kontrast (0..255), 32×18 kulrang kichik rasm */
export interface Look { mean: number; std: number; thumb: number[] }
export type ToEngine = { type: 'cameras'; list: EngineCamera[]; ffmpeg: string; testInput: string[] | null };
export type FromEngine =
  | { type: 'seen'; id: string; people: Box[]; look?: Look }
  | { type: 'state'; id: string; state: 'connecting' | 'ok' | 'error'; message: string | null }
  | { type: 'fatal'; message: string };

/** Dvigatel jarayoni shu o'zgaruvchi bilan ishga tushiriladi (fayl shunchaki import qilinganda ishlab ketmasin) */
export const ENGINE_FLAG = 'CEREBRO_CAMERA_ENGINE';

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
 * berilmasa — bitta kadr uchun (snapshot)
 */
export function ffmpegInput(url: string, everySec?: number): string[] {
  const kind = sourceKind(url);
  if (kind === 'rtsp') return ['-rtsp_transport', 'tcp', '-i', url];
  if (kind === 'mjpeg') return [...HTTP_ONLY, '-use_wallclock_as_timestamps', '1', '-i', url];
  return everySec ? [...HTTP_ONLY, '-f', 'image2', '-loop', '1', '-framerate', String(1 / everySec), '-re', '-i', url] : [...HTTP_ONLY, '-i', url];
}

/** Manzildagi login va parol jurnalga ham, panelga ham chiqmaydi */
export const maskUrl = (text: string): string => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1***@');
