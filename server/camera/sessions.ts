/**
 * Kamera kadridagi odamlar → zonadagi seanslar. Sof mantiq: kadr qayerdan kelgani (brauzer, RTSP) va odamni kim topgani bu yerda bilinmaydi.
 * Zonaga kirish darhol sanalmaydi: odam enterMs davomida tursa — seans boshlanadi (o'tib ketgan odam seans emas);
 * leaveMs davomida ko'rinmasa — tugaydi (egilgan yoki bir zum to'silgan odam seansni uzmaydi).
 */

/** Kadrning ulushlarida berilgan to'rtburchak (0..1) */
export interface Box { x: number; y: number; w: number; h: number }
export interface Zone extends Box { id: string }
export interface Thresholds { enterMs: number; leaveMs: number }
/** since — zonada birinchi ko'ringan payt; lastSeen — oxirgi ko'ringan payt; open — seans boshlangan */
export interface ZoneState { since: number | null; lastSeen: number | null; open: boolean }
export interface ZoneEvent { type: 'start' | 'end'; zoneId: string; at: number }
export type States = Readonly<Record<string, ZoneState>>;

const EMPTY: ZoneState = { since: null, lastSeen: null, open: false };

/** Odam zonada: ramkasining markazi zona ichida */
export const inZone = (p: Box, z: Box): boolean => {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
};

/** Bitta kadr: yangi holat va shu kadrda boshlangan/tugagan seanslar. Seans boshi — odam birinchi ko'ringan payt, oxiri — oxirgi ko'ringan payt */
export function step(states: States, zones: Zone[], people: Box[], now: number, t: Thresholds): { states: States; events: ZoneEvent[] } {
  const events: ZoneEvent[] = [];
  const next: Record<string, ZoneState> = {};
  for (const z of zones) {
    // Avval uzilish tekshiriladi: kadrlar orasida uzoq tanaffus bo'lgan bo'lsa, eski holat yopiladi va odam yangidan sanaladi
    const s = settle(z.id, states[z.id] ?? EMPTY, now, t, events);
    if (!people.some(p => inZone(p, z))) { next[z.id] = s; continue; }
    const since = s.since ?? now;
    const open = s.open || now - since >= t.enterMs;
    if (open && !s.open) events.push({ type: 'start', zoneId: z.id, at: since });
    next[z.id] = { since, lastSeen: Math.max(now, s.lastSeen ?? now), open };
  }
  return { states: next, events };
}

function settle(zoneId: string, s: ZoneState, now: number, t: Thresholds, events: ZoneEvent[]): ZoneState {
  // Seans boshlanmagan bo'lsa qisqa kutiladi: ikki marta o'tib ketgan odam bitta uzun "o'tirish" bo'lib qolmasin
  const patience = s.open ? t.leaveMs : Math.min(t.leaveMs, t.enterMs / 2);
  if (s.lastSeen == null || now - s.lastSeen <= patience) return s;
  if (s.open) events.push({ type: 'end', zoneId, at: s.lastSeen });
  return EMPTY;
}

/** Kadr kelmay qolganda (kamera o'chdi, zona o'zgardi): ochiq seanslar oxirgi ko'rilgan paytda yopiladi */
export const flush = (states: States): ZoneEvent[] =>
  Object.entries(states).filter(([, s]) => s.open && s.lastSeen != null).map(([zoneId, s]) => ({ type: 'end' as const, zoneId, at: s.lastSeen! }));
