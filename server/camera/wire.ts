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

/** Manzildagi login va parol jurnalga ham, panelga ham chiqmaydi */
export const maskUrl = (text: string): string => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1***@');
