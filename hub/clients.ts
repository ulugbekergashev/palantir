/**
 * Mijozlar (hub/server.ts, 14-band): boshqaruv markazi (/admin) uchun sotuvchining o'z yozuvlari va kunlik ko'rsatkichlar.
 *
 * Karta — klinika kompyuteri yubormaydigan narsalar: egasi kim, telefoni, shahri, biznes turi (holatdagi avtomatik turdan ustun),
 * tarif (oylik, so'm) va qachongacha to'langan, izoh. Faqat asoschi yozadi; o'rnatuvchi o'z klinikalarinikini ko'radi. Pul yozuvi —
 * faqat eslatma: hub hech kimdan pul olmaydi va hech qayerga yubormaydi.
 *
 * Ko'rsatkich — har soatda bitta qator (jami, aloqada, muammoli): «Umumiy» sahifasidagi 14 kunlik grafik. 30 kundan eskisi o'chadi.
 * Modul faqat baza bilan ishlaydi: scripts/check-hub-clients.ts uni xotiradagi baza bilan sinaydi.
 */
import type { DatabaseSync } from 'node:sqlite';
import { ACCESS_STATES, MODULES, isModule, type AccessState, type Module } from './licenseKey.ts';

/** Biznes turlari — src/data/industries.ts dagi IndustryKind bilan bir xil */
export const CLIENT_KINDS = ['clinic', 'education', 'services', 'manufacturing', 'retail'] as const;
export type ClientKind = typeof CLIENT_KINDS[number];

export interface ClientCard {
  /** null — klinika holatidagi tur ishlatiladi */
  kind: ClientKind | null;
  owner: string | null; phone: string | null; city: string | null;
  /** Oylik tarif, so'm */
  plan: number | null;
  /** YYYY-MM-DD */
  paidUntil: string | null;
  note: string | null;
  updatedAt: string; updatedBy: string | null;
}

/** Ishlash holati (to'lov nazorati, licenseKey.ts issueAccess): yozuv yo'q — active */
/**
 * modules — tarifdagi modullar (licenseKey.ts MODULES); null — hammasi. modulesSet — sotuvchi tanlaganmi (yo'q bo'lsa, shu kompyuterning
 * boshqa yozuvidagi tanlov olinadi — qayta o'rnatib tarifdan qochib bo'lmaydi)
 */
export interface ClientAccess {
  state: AccessState; message: string | null; updatedAt: string | null; updatedBy: string | null;
  modules: Module[] | null; modulesSet: boolean; modulesAt: string | null;
}
const ACTIVE: ClientAccess = { state: 'active', message: null, updatedAt: null, updatedBy: null, modules: null, modulesSet: false, modulesAt: null };
/** Bazadagi ko'rinish: NULL — tanlanmagan, '*' — hammasi (sotuvchi o'zi tanlagan), JSON massiv — ro'yxat */
const ALL_MODULES = '*';
const ACCESS_MESSAGE_MAX = 300;

export interface DayStat { day: string; total: number; online: number; problems: number }

export class CardError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

const NAME_MAX = 80;
const NOTE_MAX = 1000;
const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;
/** Tarif chegarasi: xato bilan qo'shilgan nollar (1 000 000 000+) qabul qilinmaydi */
const PLAN_MAX = 999_999_999;
const STATS_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

const clean = (v: unknown, max: number): string | null => {
  const s = (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
  return s || null;
};
const cleanNote = (v: unknown): string | null => {
  const s = (typeof v === 'string' ? v : '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_MAX);
  return s || null;
};

function validDay(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new CardError(400, "To'langan sana: YYYY-MM-DD");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new CardError(400, "To'langan sana noto'g'ri");
  return v;
}

function validPlan(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s_]/g, ''));
  if (!Number.isInteger(n) || n < 0 || n > PLAN_MAX) throw new CardError(400, "Tarif — butun son, so'mda");
  return n;
}

function validPhone(v: unknown): string | null {
  const s = clean(v, 24);
  if (s && !PHONE_RE.test(s)) throw new CardError(400, "Telefon raqami noto'g'ri");
  return s;
}

function validKind(v: unknown): ClientKind | null {
  if (v === null || v === undefined || v === '') return null;
  if (!CLIENT_KINDS.includes(v as ClientKind)) throw new CardError(400, "Biznes turi noto'g'ri");
  return v as ClientKind;
}

type CardDb = { clinic_id: string; kind: string | null; owner: string | null; phone: string | null; city: string | null; plan: number | null; paid_until: string | null; note: string | null; updated_at: string; updated_by: string | null };
const view = (r: CardDb): ClientCard => ({
  kind: CLIENT_KINDS.includes(r.kind as ClientKind) ? r.kind as ClientKind : null,
  owner: r.owner, phone: r.phone, city: r.city, plan: r.plan, paidUntil: r.paid_until, note: r.note, updatedAt: r.updated_at, updatedBy: r.updated_by,
});

type AccessDb = { state: string; message: string | null; updated_at: string; updated_by: string | null; modules: string | null; modules_at: string | null };
const ACCESS_COLS = 'state, message, updated_at, updated_by, modules, modules_at';
function parseModules(raw: string | null): Module[] | null {
  if (raw === null || raw === ALL_MODULES) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? MODULES.filter(m => list.includes(m)) : null;
  } catch { return null; }
}
const accessView = (r: AccessDb): ClientAccess => {
  const state = ACCESS_STATES.find(s => s === r.state) ?? 'active';
  return { state, message: state === 'active' ? null : r.message, updatedAt: r.updated_at, updatedBy: r.updated_by,
    modules: parseModules(r.modules), modulesSet: r.modules !== null, modulesAt: r.modules_at };
};

export function createClients(db: DatabaseSync, now: () => Date = () => new Date()) {
  db.exec(`CREATE TABLE IF NOT EXISTS client_cards (clinic_id TEXT PRIMARY KEY, kind TEXT, owner TEXT, phone TEXT, city TEXT, plan INTEGER,
  paid_until TEXT, note TEXT, updated_at TEXT NOT NULL, updated_by TEXT);
CREATE TABLE IF NOT EXISTS client_access (clinic_id TEXT PRIMARY KEY, state TEXT NOT NULL, message TEXT, updated_at TEXT NOT NULL, updated_by TEXT, machine_id TEXT);
CREATE TABLE IF NOT EXISTS client_stats (hour TEXT PRIMARY KEY, total INTEGER NOT NULL, online INTEGER NOT NULL, problems INTEGER NOT NULL);`);
  const accessCols = new Set((db.prepare('PRAGMA table_info(client_access)').all() as { name: string }[]).map(c => c.name));
  if (!accessCols.has('machine_id')) db.exec('ALTER TABLE client_access ADD COLUMN machine_id TEXT');
  if (!accessCols.has('modules')) db.exec('ALTER TABLE client_access ADD COLUMN modules TEXT');
  if (!accessCols.has('modules_at')) db.exec('ALTER TABLE client_access ADD COLUMN modules_at TEXT');

  return {
    cards(): Map<string, ClientCard> {
      const rows = db.prepare('SELECT * FROM client_cards').all() as CardDb[];
      return new Map(rows.map(r => [r.clinic_id, view(r)]));
    },

    card(clinicId: string): ClientCard | null {
      const r = db.prepare('SELECT * FROM client_cards WHERE clinic_id = ?').get(clinicId) as CardDb | undefined;
      return r ? view(r) : null;
    },

    /** Kartani to'liq almashtiradi (forma hamma maydonni yuboradi); xato maydon — CardError 400 */
    save(clinicId: string, input: unknown, by: string): ClientCard {
      const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const card = {
        kind: validKind(o.kind), owner: clean(o.owner, NAME_MAX), phone: validPhone(o.phone), city: clean(o.city, NAME_MAX),
        plan: validPlan(o.plan), paidUntil: validDay(o.paidUntil), note: cleanNote(o.note), updatedAt: now().toISOString(), updatedBy: by,
      };
      db.prepare(`INSERT INTO client_cards (clinic_id, kind, owner, phone, city, plan, paid_until, note, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clinic_id) DO UPDATE SET kind = excluded.kind, owner = excluded.owner, phone = excluded.phone, city = excluded.city, plan = excluded.plan,
        paid_until = excluded.paid_until, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(clinicId, card.kind, card.owner, card.phone, card.city, card.plan, card.paidUntil, card.note, card.updatedAt, card.updatedBy);
      return card;
    },

    /**
     * To'xtatilgan mijozning holati va cheklangan tarifi qoladi (kompyuter kodi bilan): o'sha kompyuter yangi yozuv ochib qayta ishlab
     * ketmasin yoki tarifdan qochmasin
     */
    remove(clinicId: string): void {
      db.prepare('DELETE FROM client_cards WHERE clinic_id = ?').run(clinicId);
      db.prepare(`DELETE FROM client_access WHERE clinic_id = ? AND (machine_id IS NULL OR (state <> 'blocked' AND COALESCE(modules, '${ALL_MODULES}') = '${ALL_MODULES}'))`).run(clinicId);
    },

    /**
     * Klinikaga beriladigan holat: o'z yozuvi; shu kompyuter kodi boshqa (masalan o'chirilgan yoki qayta ro'yxatdan o'tgan) yozuvda
     * to'xtatilgan bo'lsa — to'xtatilgan. Qayta o'rnatib, yangi yozuv olib bloklashdan qochib bo'lmaydi
     */
    grantFor(clinicId: string, machineId: string): ClientAccess {
      const own = this.access(clinicId);
      const other = (where: string, order: string) => {
        const r = db.prepare(`SELECT ${ACCESS_COLS} FROM client_access WHERE machine_id = ? AND clinic_id <> ? AND ${where} ORDER BY ${order} DESC LIMIT 1`)
          .get(machineId, clinicId) as AccessDb | undefined;
        return r ? accessView(r) : null;
      };
      const blocked = own.state === 'blocked' ? own : other("state = 'blocked'", 'updated_at') ?? own;
      // Tarif: o'z yozuvida tanlangan bo'lsa — o'shasi; yo'q bo'lsa — shu kompyuterning boshqa yozuvidagi oxirgi tanlov
      const plan = own.modulesSet ? own : other('modules IS NOT NULL', 'modules_at') ?? own;
      return { ...blocked, modules: plan.modules, modulesSet: plan.modulesSet, modulesAt: plan.modulesAt };
    },

    /** Heartbeat'dagi (yozuvga mos) kompyuter kodi — holat yozuvida eslab qolinadi */
    noteMachine(clinicId: string, machineId: string): void {
      db.prepare('UPDATE client_access SET machine_id = ? WHERE clinic_id = ? AND COALESCE(machine_id, \'\') <> ?').run(machineId, clinicId, machineId);
    },

    access(clinicId: string): ClientAccess {
      const r = db.prepare(`SELECT ${ACCESS_COLS} FROM client_access WHERE clinic_id = ?`).get(clinicId) as AccessDb | undefined;
      return r ? accessView(r) : ACTIVE;
    },

    accessAll(): Map<string, ClientAccess> {
      const rows = db.prepare(`SELECT clinic_id, ${ACCESS_COLS} FROM client_access`).all() as (AccessDb & { clinic_id: string })[];
      return new Map(rows.map(r => [r.clinic_id, accessView(r)]));
    },

    /** Holatni almashtiradi (sotuvchining matni — klinika panelida va egasining Telegram'ida ko'rinadi); noto'g'ri holat — CardError 400 */
    setAccess(clinicId: string, input: unknown, by: string, machineId: string | null = null): ClientAccess {
      const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const state = ACCESS_STATES.find(s => s === o.state);
      if (!state) throw new CardError(400, 'Holat: active, warn yoki blocked');
      const message = state === 'active' ? null : clean(o.message, ACCESS_MESSAGE_MAX);
      const at = now().toISOString();
      db.prepare(`INSERT INTO client_access (clinic_id, state, message, updated_at, updated_by, machine_id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(clinic_id) DO UPDATE SET state = excluded.state, message = excluded.message, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
        machine_id = COALESCE(excluded.machine_id, client_access.machine_id)`)
        .run(clinicId, state, message, at, by, machineId);
      // «Ochish» — shu kompyuterning boshqa (o'chirilgan yoki takror) yozuvlaridagi to'xtatish ham olib tashlanadi: sotuvchi uni ochdi
      if (state === 'active' && machineId) db.prepare("DELETE FROM client_access WHERE machine_id = ? AND clinic_id <> ? AND state = 'blocked'").run(machineId, clinicId);
      return this.access(clinicId);
    },

    /**
     * Tarif: qaysi modullar yoqiq. modules — ro'yxat (bo'sh bo'lsa — faqat asosiy xodimlar) yoki 'all' (hammasi). Noma'lum modul — CardError 400.
     * Holat (active/warn/blocked) o'zgarmaydi
     */
    setModules(clinicId: string, input: unknown, by: string, machineId: string | null = null): ClientAccess {
      const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      let stored: string;
      if (o.modules === 'all') stored = ALL_MODULES;
      else if (Array.isArray(o.modules) && o.modules.every(isModule)) stored = JSON.stringify(MODULES.filter(m => (o.modules as unknown[]).includes(m)));
      else throw new CardError(400, `Modullar: «all» yoki ro'yxat (${MODULES.join(', ')})`);
      const at = now().toISOString();
      db.prepare(`INSERT INTO client_access (clinic_id, state, message, updated_at, updated_by, machine_id, modules, modules_at) VALUES (?, 'active', NULL, ?, ?, ?, ?, ?)
        ON CONFLICT(clinic_id) DO UPDATE SET modules = excluded.modules, modules_at = excluded.modules_at, updated_by = excluded.updated_by,
        machine_id = COALESCE(excluded.machine_id, client_access.machine_id)`)
        .run(clinicId, at, by, machineId, stored, at);
      return this.access(clinicId);
    },

    /** Joriy soat ko'rsatkichi (har chaqiruvda soat qatori yangilanadi); 30 kundan eskisi o'chadi */
    snapshot(total: number, online: number, problems: number): void {
      const t = now();
      db.prepare(`INSERT INTO client_stats (hour, total, online, problems) VALUES (?, ?, ?, ?)
        ON CONFLICT(hour) DO UPDATE SET total = excluded.total, online = excluded.online, problems = excluded.problems`)
        .run(t.toISOString().slice(0, 13), total, online, problems);
      db.prepare('DELETE FROM client_stats WHERE hour < ?').run(new Date(t.getTime() - STATS_KEEP_DAYS * DAY_MS).toISOString().slice(0, 13));
    },

    /** Oxirgi `days` kun: kunlik o'rtacha (yaxlitlangan) jami va aloqada, eng ko'p muammoli; ma'lumot yo'q kun — tushib qoladi */
    history(days = 14): DayStat[] {
      const from = new Date(now().getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
      return (db.prepare(`SELECT substr(hour, 1, 10) AS day, ROUND(AVG(total)) AS total, ROUND(AVG(online)) AS online, MAX(problems) AS problems
        FROM client_stats WHERE hour >= ? GROUP BY day ORDER BY day`).all(from) as { day: string; total: number; online: number; problems: number }[])
        .map(r => ({ day: r.day, total: Number(r.total), online: Number(r.online), problems: Number(r.problems) }));
    },
  };
}
