/**
 * Topshiriqlar va xodimlar jurnali — baza. Topshiriq: egasi AI xodimga o'z so'zi bilan bergan doimiy ish (turlari — src/types.ts OrderSpec).
 * Jurnal: xodim nima ko'rdi va nima qildi (kamera hodisasi, jadval bo'yicha bajarilgan ish, uning natijasi).
 * Kamera hodisasining kadri (dalil) DATA_DIR/kadrlar/ da KEEP_DAYS kun turadi, keyin o'chiriladi.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentEvent, AgentOrder, OrderMember, OrderSpec } from '../../src/types';
import { newId, sql, type Row } from '../db';

sql.exec(`
CREATE TABLE IF NOT EXISTS agent_orders (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, member TEXT NOT NULL, text TEXT NOT NULL, spec TEXT NOT NULL, summary TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_run_at TEXT, last_result TEXT, hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, member TEXT NOT NULL, order_id TEXT, level TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', camera_id TEXT, image TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_member ON agent_events (business_id, member, at);
`);

/** Bitta xodimga shuncha topshiriq; jurnal sahifasi */
export const MAX_ORDERS = 30;
export const EVENTS_PAGE = 60;
const MAX_RESULT = 4000;
/** Doimiy ko'rsatmalar har mijoz javobiga qo'shiladi — jami shundan oshmaydi */
const MAX_STANDING_CHARS = 3000;
/** Kamera hodisasi kadri shuncha kun saqlanadi */
const KEEP_DAYS = 14;
const FRAMES = resolve(process.env.DATA_DIR || 'data', 'kadrlar');

const toOrder = (r: Row): AgentOrder => ({
  id: String(r.id), member: String(r.member) as OrderMember, text: String(r.text), spec: JSON.parse(String(r.spec)) as OrderSpec, summary: String(r.summary),
  active: !!r.active, createdAt: String(r.created_at), lastRunAt: sql.str(r.last_run_at), lastResult: sql.str(r.last_result), hits: Number(r.hits),
});
const toEvent = (r: Row): AgentEvent => ({
  id: String(r.id), member: String(r.member) as OrderMember, orderId: sql.str(r.order_id), level: String(r.level) as AgentEvent['level'], title: String(r.title),
  body: String(r.body), cameraId: sql.str(r.camera_id), hasImage: !!r.image, at: String(r.at),
});

export const orders = {
  list: (bizId: string, member?: OrderMember) => member
    ? sql.many('SELECT * FROM agent_orders WHERE business_id = ? AND member = ? ORDER BY created_at', toOrder, bizId, member)
    : sql.many('SELECT * FROM agent_orders WHERE business_id = ? ORDER BY created_at', toOrder, bizId),
  /** Hamma bizneslarning yoqilgan topshiriqlari (jadval va kamera uchun) */
  active: () => sql.many('SELECT * FROM agent_orders WHERE active = 1', r => ({ ...toOrder(r), businessId: String(r.business_id) })),
  get: (bizId: string, id: string) => sql.one('SELECT * FROM agent_orders WHERE business_id = ? AND id = ?', toOrder, bizId, id) ?? null,
  count: (bizId: string, member: OrderMember) => sql.one('SELECT COUNT(*) n FROM agent_orders WHERE business_id = ? AND member = ?', r => Number(r.n), bizId, member) ?? 0,
  create(bizId: string, member: OrderMember, text: string, spec: OrderSpec, summary: string): AgentOrder {
    const id = newId(10);
    sql.run('INSERT INTO agent_orders (id, business_id, member, text, spec, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, bizId, member, text, JSON.stringify(spec), summary, sql.nowIso());
    return orders.get(bizId, id)!;
  },
  setActive: (bizId: string, id: string, active: boolean) => sql.run('UPDATE agent_orders SET active = ? WHERE business_id = ? AND id = ?', active ? 1 : 0, bizId, id).changes > 0,
  remove: (bizId: string, id: string) => sql.run('DELETE FROM agent_orders WHERE business_id = ? AND id = ?', bizId, id).changes > 0,
  /** Ishladi: vaqti, natijasi (qisqa) va soni */
  ran: (id: string, result: string) =>
    sql.run('UPDATE agent_orders SET last_run_at = ?, last_result = ?, hits = hits + 1 WHERE id = ?', sql.nowIso(), result.slice(0, MAX_RESULT), id),
  /** Bajarilmadi: sababi yoziladi, lekin «bajarildi» deb belgilanmaydi (vaqti o'tib ketmagan bo'lsa — qayta uriniladi) */
  failed: (id: string, reason: string) => sql.run('UPDATE agent_orders SET last_result = ? WHERE id = ?', `Bajarilmadi: ${reason}`.slice(0, MAX_RESULT), id),
  /** Kamera o'chirildi: unga bog'langan topshiriqlar o'chiriladi (jim ishlamay yotmasin) */
  dropCamera: (bizId: string, cameraId: string) =>
    sql.run("UPDATE agent_orders SET active = 0 WHERE business_id = ? AND json_extract(spec, '$.cameraId') = ?", bizId, cameraId),
  /** Egasining doimiy ko'rsatmalari — shu xodimning ko'rsatmasiga qo'shiladi (har mijoz javobiga ham — jami MAX_STANDING_CHARS gacha) */
  standing: (bizId: string, member: OrderMember): string[] =>
    orders.list(bizId, member).filter(o => o.active && o.spec.kind === 'standing').map(o => o.text)
      .filter((_, i, all) => all.slice(0, i + 1).join('').length <= MAX_STANDING_CHARS),
};

export const events = {
  add(bizId: string, e: Omit<AgentEvent, 'id' | 'at' | 'hasImage'>, image?: Buffer | null): AgentEvent {
    const id = newId(12);
    let file: string | null = null;
    if (image?.length) {
      try { mkdirSync(FRAMES, { recursive: true }); writeFileSync(join(FRAMES, `${id}.jpg`), image); file = `${id}.jpg`; } catch (err) { console.error('[jurnal] kadr saqlanmadi:', (err as Error).message); }
    }
    sql.run('INSERT INTO agent_events (id, business_id, member, order_id, level, title, body, camera_id, image, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, bizId, e.member, e.orderId, e.level, e.title.slice(0, 200), e.body.slice(0, MAX_RESULT), e.cameraId, file, sql.nowIso());
    return sql.one('SELECT * FROM agent_events WHERE id = ?', toEvent, id)!;
  },
  list: (bizId: string, member: OrderMember, opts: { cameraId?: string; before?: string } = {}) =>
    sql.many(`SELECT * FROM agent_events WHERE business_id = ? AND member = ?${opts.cameraId ? ' AND camera_id = ?' : ''}${opts.before ? ' AND at < ?' : ''} ORDER BY at DESC LIMIT ?`,
      toEvent, bizId, member, ...(opts.cameraId ? [opts.cameraId] : []), ...(opts.before ? [opts.before] : []), EVENTS_PAGE),
  /** Hodisa kadri (yo'q yoki o'chgan bo'lsa — null) */
  image(bizId: string, id: string): Buffer | null {
    const file = sql.one('SELECT image FROM agent_events WHERE business_id = ? AND id = ?', r => sql.str(r.image), bizId, id);
    if (!file || !/^[A-Za-z0-9_-]+\.jpg$/.test(file)) return null;
    const path = join(FRAMES, file);
    return existsSync(path) ? readFileSync(path) : null;
  },
  /** Eski kadrlar o'chiriladi (yozuvning o'zi qoladi) */
  prune(now = Date.now()): void {
    if (!existsSync(FRAMES)) return;
    const old = now - KEEP_DAYS * 86_400_000;
    for (const f of readdirSync(FRAMES)) {
      const path = join(FRAMES, f);
      try {
        if (statSync(path).mtimeMs >= old) continue;
        rmSync(path);
        // Jurnalda «kadr bor» deb qolmasin
        sql.run('UPDATE agent_events SET image = NULL WHERE image = ?', f);
      } catch { /* band — keyingi safar */ }
    }
  },
};
