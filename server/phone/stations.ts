/**
 * Qabulxonadagi boshqa kompyuterlar (stansiyalar): har birida MicroSIP va kichik yordamchi (hook/PalantirCall.cs, «agent» rejimi).
 * Yordamchi qo'ng'iroq hodisalarini va suhbat yozuvlarini serverga yuboradi (klinika tarmog'i yoki Palantir Hub orqali),
 * paneldagi «📞 Kompyuterdan» buyrug'ini olib MicroSIP'da raqam teradi.
 *
 *   ulash   — egasi panelda kompyuter qo'shadi → bir martalik kod (30 daqiqa) → o'sha kompyuterda Stansiya.cmd kodni kalitga
 *             almashtiradi (/api/phone/station/pair); bazada kalitning faqat xeshi;
 *   kirish  — «Authorization: Station <kalit>»; olib tashlangan kompyuterning kaliti darhol ishlamaydi;
 *   buyruq  — xotirada (server qayta ishga tushsa yo'qoladi — eski buyruq bilan begona raqam terilmasin).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { newId, sql, type Row } from '../db';
import { env } from '../env';
import type { RecordingFile } from './recordings';

sql.exec(`CREATE TABLE IF NOT EXISTS phone_stations (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT, code_hash TEXT, code_until TEXT,
  staff_id TEXT, created_at TEXT NOT NULL, seen_at TEXT
)`);

/** Kompyuter shuncha vaqt ichida buyruq so'ragan bo'lsa — aloqada (yordamchi ~25 soniyada so'raydi) */
const ONLINE_MS = 60_000;
const CODE_MS = 30 * 60_000;
/** Bir martalik kod: adashtiradigan harflarsiz (0/O, 1/I) */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const STATION_RECORDINGS_DIR = path.join(env.dataDir, 'stansiya-yozuvlar');

export interface Station { id: string; businessId: string; name: string; staffId: string | null; createdAt: string; seenAt: string | null; paired: boolean; online: boolean }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const toStation = (r: Row): Station => {
  const seenAt = sql.str(r.seen_at);
  return {
    id: String(r.id), businessId: String(r.business_id), name: String(r.name), staffId: sql.str(r.staff_id), createdAt: String(r.created_at), seenAt,
    paired: !!r.token_hash, online: !!seenAt && Date.now() - Date.parse(seenAt) < ONLINE_MS,
  };
};

export const stations = {
  list: (businessId: string) => sql.many('SELECT * FROM phone_stations WHERE business_id = ? ORDER BY created_at', toStation, businessId),
  get: (businessId: string, id: string) => sql.one('SELECT * FROM phone_stations WHERE business_id = ? AND id = ?', toStation, businessId, id),
  /** Yangi kompyuter: bir martalik ulash kodi bilan (faqat shu javobda ko'rinadi) */
  create(businessId: string, name: string, staffId: string | null): { station: Station; code: string; until: string } {
    const id = newId(8), code = Array.from(randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const until = new Date(Date.now() + CODE_MS).toISOString();
    sql.run('INSERT INTO phone_stations (id, business_id, name, code_hash, code_until, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, businessId, name, sha(code), until, staffId, sql.nowIso());
    return { station: stations.get(businessId, id)!, code, until };
  },
  /** Ulash kodi → doimiy kalit (kod bir marta ishlaydi). Noto'g'ri yoki eskirgan — null */
  pair(code: string): { station: Station; token: string } | null {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = clean ? sql.one('SELECT * FROM phone_stations WHERE code_hash = ?', r => r, sha(clean)) : undefined;
    if (!row || !row.code_until || Date.parse(String(row.code_until)) < Date.now()) return null;
    const token = randomBytes(32).toString('base64url');
    sql.run('UPDATE phone_stations SET token_hash = ?, code_hash = NULL, code_until = NULL, seen_at = ? WHERE id = ?', sha(token), sql.nowIso(), String(row.id));
    return { station: stations.get(String(row.business_id), String(row.id))!, token };
  },
  /** «Station <kalit>» → kompyuter (ko'rindi deb belgilanadi) */
  byToken(header: string | undefined): Station | null {
    const token = /^Station\s+(\S+)$/i.exec(header ?? '')?.[1];
    const row = token ? sql.one('SELECT * FROM phone_stations WHERE token_hash = ?', toStation, sha(token)) : undefined;
    if (!row) return null;
    sql.run('UPDATE phone_stations SET seen_at = ? WHERE id = ?', sql.nowIso(), row.id);
    return { ...row, online: true };
  },
  setStaff: (businessId: string, id: string, staffId: string | null) => sql.run('UPDATE phone_stations SET staff_id = ? WHERE business_id = ? AND id = ?', staffId, businessId, id),
  remove(businessId: string, id: string): boolean {
    commands.delete(id);
    return Number(sql.run('DELETE FROM phone_stations WHERE business_id = ? AND id = ?', businessId, id).changes) > 0;
  },
};

// ─── Raqam terish buyruqlari ──────────────────────────────────────────────────

export interface DialCommand { id: string; number: string }
const commands = new Map<string, DialCommand[]>();
const waiting = new Map<string, Set<() => void>>();

export function queueDial(stationId: string, number: string): DialCommand {
  const c = { id: newId(10), number };
  commands.set(stationId, [...(commands.get(stationId) ?? []), c]);
  for (const wake of waiting.get(stationId) ?? []) wake();
  return c;
}

/** Kompyuterning navbatdagi buyruqlari; bo'lmasa wait ms gacha kutadi (yordamchi uzun so'rov bilan so'raydi) */
export async function takeCommands(stationId: string, wait: number, gone: Promise<void>): Promise<DialCommand[]> {
  const take = () => { const list = commands.get(stationId) ?? []; commands.delete(stationId); return list; };
  let list = take();
  if (list.length || wait <= 0) return list;
  await Promise.race([gone, new Promise<void>(done => {
    const set = waiting.get(stationId) ?? new Set();
    const wake = () => { clearTimeout(timer); set.delete(wake); done(); };
    const timer = setTimeout(wake, wait);
    set.add(wake);
    waiting.set(stationId, set);
  })]);
  list = take();
  return list;
}

// ─── Kompyuter yuborgan yozuvlar ──────────────────────────────────────────────

/** Fayl nomi: «<yaratilgan ms>-<oxirgi yozilgan ms>-<asl nomi>» — vaqtlar o'sha kompyuterdagi fayldan (bu yerga kelgan vaqt emas) */
const STORED = /^(\d{10,16})-(\d{10,16})-(.+)$/;

export function saveStationRecording(stationId: string, original: string, born: number, mtime: number, data: Buffer): string {
  const dir = path.join(STATION_RECORDINGS_DIR, stationId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(original).replace(/[^\w.-]+/g, '_').slice(-80);
  const name = `${Math.round(born)}-${Math.round(mtime)}-${safe}`;
  fs.writeFileSync(path.join(dir, name), data);
  return name;
}

/** Kompyuter papkasidagi yozuvlar — asl vaqtlari bilan (recordings.ts: pickRecording) */
export function stationRecordings(stationId: string): RecordingFile[] {
  const dir = path.join(STATION_RECORDINGS_DIR, stationId);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.flatMap(name => {
    const m = STORED.exec(name);
    if (!m) return [];
    try { return [{ name, born: Number(m[1]), mtime: Number(m[2]), size: fs.statSync(path.join(dir, name)).size }]; } catch { return []; }
  });
}
