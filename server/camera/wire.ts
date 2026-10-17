/** Server va kamera dvigateli (alohida jarayon) o'rtasidagi xabarlar. Bu faylda boshqa hech narsa import qilinmaydi: dvigatel bazani ochmasin */
export interface EngineCamera { id: string; url: string }
export type Box = { x: number; y: number; w: number; h: number };
export type ToEngine = { type: 'cameras'; list: EngineCamera[]; ffmpeg: string; testInput: string[] | null };
export type FromEngine =
  | { type: 'seen'; id: string; people: Box[] }
  | { type: 'state'; id: string; state: 'connecting' | 'ok' | 'error'; message: string | null }
  | { type: 'fatal'; message: string };

/** Dvigatel jarayoni shu o'zgaruvchi bilan ishga tushiriladi (fayl shunchaki import qilinganda ishlab ketmasin) */
export const ENGINE_FLAG = 'CEREBRO_CAMERA_ENGINE';

/** Manzildagi login va parol jurnalga ham, panelga ham chiqmaydi */
export const maskUrl = (text: string): string => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1***@');
