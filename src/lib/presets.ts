import type { Camera, CameraZone, OrderSpec } from '../types';

/** Kuzatuvchining tayyor qoidasi: bir bosishda yoqiladi (AI tushunishi shart emas — tuzilmasi tayyor) */
export interface Preset { key: string; title: string; hint: string; text: string; summary: string; spec: OrderSpec }

const firstZone = (cams: readonly Camera[], kind: CameraZone['kind']) =>
  cams.flatMap(cam => cam.zones.filter(z => z.kind === kind).map(zone => ({ cam, zone })))[0];

/**
 * Kameralarga mos tayyor qoidalar. cameraId berilsa — shu kamera uchun; zonalarga moslanadi: kassa zonasi bo'lmasa «kassa bo'sh»
 * taklif qilinmaydi, kutish joyi bo'lsa «ko'p odam» o'sha joyni sanaydi. Matn — egasining so'zi bo'lib saqlanadi (takror yoqilmaydi)
 */
export function cameraPresets(cams: readonly Camera[], cameraId?: string): Preset[] {
  const scope = cameraId ? cams.filter(c => c.id === cameraId) : cams;
  if (!scope.length) return [];
  const one = cameraId ? scope[0] : undefined;
  const where = one ? `«${one.name}»da` : 'kameralarda';
  const desk = firstZone(scope, 'desk'), waiting = firstZone(scope, 'waiting');
  const crowdCam = waiting?.cam ?? one;
  const crowdWhere = waiting ? `«${waiting.cam.name} · ${waiting.zone.name}»da` : where;
  const presets: Preset[] = [{
    key: 'night', title: "Kechasi odam ko'rinsa", hint: '21:00–07:00 · darhol',
    text: `Kechasi 21:00 dan 07:00 gacha ${where} odam ko'rinsa — darhol xabar ber`,
    summary: `Kechasi (21:00–07:00) ${where} odam ko'rinsa — darhol xabar beraman`,
    spec: { kind: 'watch', cameraId: one?.id ?? null, zoneId: null, condition: 'presence', people: 1, minutes: 0, from: '21:00', to: '07:00' },
  }];
  if (desk) presets.push({
    key: 'desk-empty', title: "Kassa bo'sh qolsa", hint: "ish vaqtida 10 daqiqa",
    text: `Ish vaqtida (09:00–19:00) «${desk.cam.name} · ${desk.zone.name}» 10 daqiqadan ko'p bo'sh qolsa ayt`,
    summary: `09:00–19:00 da «${desk.zone.name}» oldida 10 daqiqa hech kim bo'lmasa — xabar beraman`,
    spec: { kind: 'watch', cameraId: desk.cam.id, zoneId: desk.zone.id, condition: 'empty', people: 1, minutes: 10, from: '09:00', to: '19:00' },
  });
  presets.push({
    key: 'crowd', title: "Ko'p odam yig'ilsa", hint: "5 kishidan ko'p · 5 daqiqa",
    text: `${crowdWhere} 5 kishidan ko'p yig'ilib, 5 daqiqa tursa xabar ber`,
    summary: `${crowdWhere} 5 va undan ko'p kishi 5 daqiqa tursa — xabar beraman`,
    spec: { kind: 'watch', cameraId: crowdCam?.id ?? null, zoneId: waiting?.zone.id ?? null, condition: 'crowd', people: 5, minutes: 5, from: null, to: null },
  }, {
    key: 'tidy', title: 'Ertalab tartib', hint: "har kuni 09:00 · AI ko'zi",
    text: `Har kuni 9:00 da ${where} xona toza va tartibli ekanini tekshir`,
    summary: `Har kuni 09:00 da ${where} tartibni tekshiraman — tartibsizlik bo'lsa aytaman`,
    spec: { kind: 'look', cameraId: one?.id ?? null, at: '09:00', days: [], everyMin: 0, from: null, to: null, question: "Xona toza va tartibli mi? Axlat, tartibsizlik yoki joyida bo'lmagan narsa ko'rinsa — ayt." },
  }, {
    key: 'closing', title: 'Yopilgandan keyin', hint: "har kuni 21:00 · AI ko'zi",
    text: `Har kuni 21:00 da ${where} odam qolganmi yoki chiroq yoqiq qolganmi tekshir`,
    summary: `Har kuni 21:00 da ${where} qaraman: odam yoki yoqiq chiroq qolgan bo'lsa — aytaman`,
    spec: { kind: 'look', cameraId: one?.id ?? null, at: '21:00', days: [], everyMin: 0, from: null, to: null, question: "Ish tugagan: xonada odam bormi yoki chiroq, kompyuter, konditsioner yoqiq qolganmi? Shunday bo'lsa — ayt." },
  });
  return presets;
}
