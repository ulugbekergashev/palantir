/**
 * Palantir jamoasi Hub'da — har kishining o'z hisobi va jurnali (hub/server.ts, 12-band).
 *
 *   Rollar: asoschi (founder) — hammasi: jamoa hisoblari, litsenziya, tasdiqlash, o'chirish, zaxiralar, jurnal;
 *           o'rnatuvchi (installer) — klinikalar ro'yxati, «Yangi klinika», «Sozlash» / «Panelni ochish», diagnostika.
 *   HUB_ADMIN_KEY — asosiy kalit: birinchi asoschini ochish va favqulodda kirish uchun (u ham asoschi, jurnalda «Asosiy kalit»).
 *   Kirish: login va parol → 12 soatlik kalit (Hub siri bilan imzolangan). Parol almashsa yoki hisob o'chirilsa — eski kalitlar
 *   darhol bekor (ver). Har muhim amal jurnalga yoziladi: kim, qachon, qaysi klinika — klinika egasiga ham kim kirgani aytiladi.
 */
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type HubRole = 'founder' | 'installer';
export interface Member { id: string; login: string; name: string; role: HubRole }
export interface MemberView extends Member { active: boolean; createdAt: string; seenAt: string | null }
export interface AuditRow { at: string; actor: string; action: string; clinicId: string | null; detail: string | null }

const SESSION_MS = 12 * 3_600_000;
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 10;
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Jurnal shuncha yozuvgacha saqlanadi (eskilari o'chadi) */
const AUDIT_KEEP = 20_000;
/** Parolni taxmin qilishdan: 15 daqiqada 8 xato — manzil bo'yicha ham, login bo'yicha ham */
const WINDOW_MS = 15 * 60_000, MAX_FAILURES = 8;
const MASTER: Member = { id: 'kalit', login: 'kalit', name: 'Asosiy kalit', role: 'founder' };

const hash = (password: string) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; };
const verify = (password: string, stored: string) => {
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const a = scryptSync(password, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export const newPassword = (len = 14) => Array.from({ length: len }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');

export class TeamError extends Error {
  code: number;
  constructor(message: string, code = 400) { super(message); this.code = code; }
}

type Row = { id: string; login: string; name: string; role: string; pass_hash: string; ver: number; active: number; created_at: string; seen_at: string | null };
const toMember = (r: Row): Member => ({ id: r.id, login: r.login, name: r.name, role: r.role === 'founder' ? 'founder' : 'installer' });
const toView = (r: Row): MemberView => ({ ...toMember(r), active: r.active === 1, createdAt: r.created_at, seenAt: r.seen_at });

export function createTeam(db: DatabaseSync, secret: string, adminKey: () => string) {
  db.exec(`CREATE TABLE IF NOT EXISTS team (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  pass_hash TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, seen_at TEXT);
CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
  action TEXT NOT NULL, clinic_id TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS audit_clinic ON audit (clinic_id, seq);`);
  const key = createHmac('sha256', secret).update('palantir-hub-team').digest();
  const sign = (body: string) => createHmac('sha256', key).update(body).digest('base64url');
  const row = (id: string) => db.prepare('SELECT * FROM team WHERE id = ?').get(id) as Row | undefined;
  const failures = new Map<string, { n: number; until: number }>();
  const blocked = (k: string) => { const f = failures.get(k); return !!f && f.n >= MAX_FAILURES && f.until > Date.now(); };
  const failed = (k: string) => {
    const now = Date.now();
    if (failures.size > 5000) for (const [x, v] of failures) if (v.until < now) failures.delete(x);
    const f = failures.get(k);
    failures.set(k, { n: !f || f.until < now ? 1 : f.n + 1, until: now + WINDOW_MS });
  };
  const issue = (r: Row) => {
    const body = Buffer.from(JSON.stringify({ i: r.id, v: r.ver, e: Date.now() + SESSION_MS })).toString('base64url');
    return `hs1.${body}.${sign(body)}`;
  };
  const cleanLogin = (login: unknown) => {
    const l = String(login ?? '').trim().toLowerCase();
    if (!LOGIN_RE.test(l)) throw new TeamError("Login: 3–32 ta lotin harfi, raqam, nuqta yoki chiziqcha");
    return l;
  };
  const cleanName = (name: unknown) => {
    const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    if (!n) throw new TeamError('Ismini yozing');
    return n;
  };
  const role = (r: unknown): HubRole => (r === 'founder' ? 'founder' : 'installer');
  const dummy = hash(randomBytes(12).toString('hex'));

  const team = {
    /** Kalit kimniki: asosiy kalit yoki amaldagi shaxsiy kirish. Bo'lmasa — null */
    who(bearer: string): Member | null {
      const master = adminKey();
      if (master && bearer && same(bearer, master)) return MASTER;
      const [tag, body, sig] = bearer.split('.');
      if (tag !== 'hs1' || !body || !sig || !same(sig, sign(body))) return null;
      let t: { i?: string; v?: number; e?: number };
      try { t = JSON.parse(Buffer.from(body, 'base64url').toString()) as typeof t; } catch { return null; }
      if (!t.i || !t.e || t.e < Date.now()) return null;
      const r = row(t.i);
      return r && r.active === 1 && r.ver === t.v ? toMember(r) : null;
    },
    /** Login va parol bilan kirish. ip — urinishlarni sanash uchun */
    login(login: unknown, password: unknown, ip: string): { token: string; member: Member } {
      const l = String(login ?? '').trim().toLowerCase().slice(0, 40);
      if (blocked(`ip:${ip}`) || blocked(`l:${l}`)) throw new TeamError("Ko'p urinish — 15 daqiqadan keyin", 429);
      const r = db.prepare('SELECT * FROM team WHERE login = ?').get(l) as Row | undefined;
      // Login yo'q bo'lsa ham xesh hisoblanadi — javob vaqtidan login borligi bilinmasin
      if (!r || r.active !== 1 || typeof password !== 'string' || !verify(password, r ? r.pass_hash : dummy)) {
        failed(`ip:${ip}`);
        failed(`l:${l}`);
        throw new TeamError("Login yoki parol noto'g'ri", 401);
      }
      failures.delete(`l:${l}`);
      db.prepare('UPDATE team SET seen_at = ? WHERE id = ?').run(new Date().toISOString(), r.id);
      team.log(toMember(r), 'kirish');
      return { token: issue(r), member: toMember(r) };
    },
    list: (): MemberView[] => (db.prepare('SELECT * FROM team ORDER BY created_at').all() as Row[]).map(toView),
    /** Yangi hisob: parol bir marta qaytadi (hubda faqat xeshi) */
    add(by: Member, input: { login?: unknown; name?: unknown; role?: unknown }): { member: MemberView; password: string } {
      const login = cleanLogin(input.login), name = cleanName(input.name);
      if (db.prepare('SELECT 1 FROM team WHERE login = ?').get(login) || login === MASTER.login) throw new TeamError('Bu login band', 409);
      const id = randomBytes(5).toString('hex'), password = newPassword();
      db.prepare('INSERT INTO team (id, login, name, role, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, login, name, role(input.role), hash(password), new Date().toISOString());
      team.log(by, 'jamoa.qoshildi', null, `${name} (${login}, ${role(input.role) === 'founder' ? 'asoschi' : "o'rnatuvchi"})`);
      return { member: toView(row(id)!), password };
    },
    /** Yangi parol (eski kirishlar bekor) — unutgan xodim uchun asoschi beradi */
    reset(by: Member, id: string): { password: string } {
      const r = row(id);
      if (!r) throw new TeamError("Bunday hisob yo'q", 404);
      const password = newPassword();
      db.prepare('UPDATE team SET pass_hash = ?, ver = ver + 1 WHERE id = ?').run(hash(password), id);
      team.log(by, 'jamoa.parol', null, `${r.name} (${r.login})`);
      return { password };
    },
    /** Hisobni yopish yoki qayta ochish: yopilsa — ochiq kirishlari darhol bekor. O'zini yopib bo'lmaydi */
    setActive(by: Member, id: string, active: boolean): MemberView {
      const r = row(id);
      if (!r) throw new TeamError("Bunday hisob yo'q", 404);
      if (by.id === id) throw new TeamError("O'z hisobingizni yopib bo'lmaydi");
      if (!active && r.role === 'founder' && Number((db.prepare("SELECT COUNT(*) AS n FROM team WHERE role = 'founder' AND active = 1 AND id <> ?").get(id) as { n: number }).n) === 0 && !adminKey()) {
        throw new TeamError("Oxirgi asoschi — uni yopsangiz Hub'ga hech kim kira olmaydi");
      }
      db.prepare('UPDATE team SET active = ?, ver = ver + 1 WHERE id = ?').run(active ? 1 : 0, id);
      team.log(by, active ? 'jamoa.ochildi' : 'jamoa.yopildi', null, `${r.name} (${r.login})`);
      return toView(row(id)!);
    },
    /** O'z parolini almashtirish: hamma qurilmadagi kirishlar bekor, shu qurilmaga yangi kalit */
    changePassword(by: Member, current: unknown, next: unknown): { token: string } {
      const r = row(by.id);
      if (!r) throw new TeamError("Asosiy kalit paroli yo'q — u Hub sozlamasida (HUB_ADMIN_KEY)");
      if (blocked(`p:${by.id}`)) throw new TeamError("Ko'p urinish — 15 daqiqadan keyin", 429);
      if (typeof current !== 'string' || !verify(current, r.pass_hash)) { failed(`p:${by.id}`); throw new TeamError("Joriy parol noto'g'ri", 403); }
      if (typeof next !== 'string' || next.length < MIN_PASSWORD || next.length > 200) throw new TeamError(`Yangi parol kamida ${MIN_PASSWORD} belgi`);
      db.prepare('UPDATE team SET pass_hash = ?, ver = ver + 1 WHERE id = ?').run(hash(next), by.id);
      team.log(by, 'parol.almashdi');
      return { token: issue(row(by.id)!) };
    },
    log(by: Member, action: string, clinicId: string | null = null, detail: string | null = null): void {
      db.prepare('INSERT INTO audit (at, actor, actor_name, action, clinic_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), by.id, by.name, action, clinicId, detail ? detail.slice(0, 300) : null);
      db.prepare('DELETE FROM audit WHERE seq <= (SELECT MAX(seq) FROM audit) - ?').run(AUDIT_KEEP);
    },
    recent(limit: number, clinicId?: string): AuditRow[] {
      const rows = (clinicId
        ? db.prepare('SELECT * FROM audit WHERE clinic_id = ? ORDER BY seq DESC LIMIT ?').all(clinicId, limit)
        : db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit)) as { at: string; actor_name: string; action: string; clinic_id: string | null; detail: string | null }[];
      return rows.map(r => ({ at: r.at, actor: r.actor_name, action: r.action, clinicId: r.clinic_id, detail: r.detail }));
    },
  };
  return team;
}
export type Team = ReturnType<typeof createTeam>;
