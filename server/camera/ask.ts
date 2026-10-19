/**
 * Egasi kameraga qaraydi — Telegram'da /kamera va yordamchining look_camera asbobi: hozirgi kadr, odam topuvchi sanagan odamlar
 * va savol bo'lsa — kadrga qarab AI javobi. Kadr AI'ga faqat savol berilganda yuboriladi (pulli); savolsiz — rasm va sanoq.
 * Brauzer kamerasida (IP manzil yo'q) rasm olib bo'lmaydi — faqat sanoq.
 */
import type { Camera, CameraShot } from '../../src/types';
import { AiLimitError } from '../claude';
import { cameras, type BusinessRow } from '../db';
import { askFrame } from '../orders/look';
import { frameState } from '../orders/watch';
import { cameraFrame } from './routes';

/** Bir so'rovda shuncha kameragacha (har biri — kadr va AI so'rovi) */
export const MAX_LOOK_CAMERAS = 4;
/** Odam topuvchining sanog'i shundan eski bo'lsa — aytilmaydi (kamera to'xtagan) */
const FRESH_MS = 60_000;
const TG_CAPTION = 1000;

export interface CameraLook { camera: Camera; image: Buffer | null; shot: Omit<CameraShot, 'eventId'> }

const norm = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, ' ').trim();

/** Qaysi kamera: id yoki nomi (qismi ham bo'ladi); berilmasa — hammasi. Topilmasa — bo'sh ro'yxat */
export function pickCameras(bizId: string, which?: string | null): Camera[] {
  const all = cameras.list(bizId);
  const q = norm(which ?? '');
  if (!q) return all;
  const exact = all.filter(c => c.id === which || norm(c.name) === q);
  return exact.length ? exact : all.filter(c => norm(c.name).includes(q) || q.includes(norm(c.name)));
}

/**
 * /kamera dan keyingi matn: kamera nomi (yoki uning qismi) — o'sha kamera rasmi, savolsiz; kamera tilga olingan savol — o'sha kameraga;
 * boshqa savol — hamma kameraga
 */
export function lookRequest(bizId: string, text: string | null): { list: Camera[]; question: string | null } {
  const all = cameras.list(bizId);
  const q = norm(text ?? '');
  if (!q) return { list: all, question: null };
  const named = pickCameras(bizId, q);
  if (named.length && named.every(c => norm(c.name).includes(q))) return { list: named, question: null };
  return { list: named.length ? named : all, question: q };
}

/** Hozir kadrda nechta odam (odam topuvchi, oxirgi daqiqa ichida); bilinmasa — null */
export function peopleNow(cameraId: string, now = Date.now()): number | null {
  const f = frameState(cameraId);
  return f && now - f.at < FRESH_MS ? f.people.length : null;
}

/** Kameralarga qarash: har biri uchun kadr (bo'lsa), sanoq va savolga javob. AI chegarasi tugasa — rasm baribir boradi */
export async function lookAt(biz: BusinessRow, list: Camera[], question: string | null): Promise<CameraLook[]> {
  const out: CameraLook[] = [];
  for (const cam of list.slice(0, MAX_LOOK_CAMERAS)) {
    const image = cam.ip ? await cameraFrame(biz.id, cam.id) : null;
    let answer: string | null = null, problem: string | null = null;
    if (!cam.ip) problem = "Bu kamera kompyuter brauzerida ishlaydi — rasmni faqat IP kameradan olib bo'ladi";
    else if (!image) problem = 'Kadr olinmadi — kamera javob bermayapti (tok, tarmoq yoki login-parolni tekshiring)';
    else if (question) {
      try {
        answer = await askFrame(biz.id, cam, question, image);
      } catch (e) {
        problem = e instanceof AiLimitError ? "Bugungi AI ko'zi chegarasi tugadi — rasmning o'zini yubordim" : "Kadrga AI javob bera olmadi — rasmning o'zini yubordim";
        if (!(e instanceof AiLimitError)) console.error('[kamera] savolga javob berilmadi:', (e as Error).message);
      }
    }
    out.push({ camera: cam, image, shot: { cameraId: cam.id, cameraName: cam.name, people: peopleNow(cam.id), answer, problem, at: new Date().toISOString() } });
  }
  return out;
}

const hhmm = (at: string) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Rasm osti matni (Telegram, oddiy matn — HTML emas) */
export function shotCaption(s: Omit<CameraShot, 'eventId'>): string {
  const lines = [
    `📷 ${s.cameraName} · ${hhmm(s.at)}`,
    ...(s.people !== null ? [s.people ? `👥 Hozir ${s.people} kishi ko'rinyapti` : "👥 Hozir hech kim ko'rinmayapti"] : []),
    ...(s.answer ? [s.answer] : []),
    ...(s.problem ? [`⚠️ ${s.problem}`] : []),
  ];
  const text = lines.join('\n');
  return text.length > TG_CAPTION ? `${text.slice(0, TG_CAPTION - 1)}…` : text;
}
