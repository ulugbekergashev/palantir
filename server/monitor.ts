/**
 * Kanallar nazorati: har daqiqada har bir biznesning ulanishlari tekshiriladi — kompyuter diski, DentaCRM (bitta yengil so'rov bilan), rasmiy Instagram
 * va Cerebro Hub, MicroSIP, IP kameralar. Muammo GRACE dan uzoq davom etsa — egasiga bir marta xabar; tiklansa — «yana ishlayapti».
 * Bir lahzalik uzilish bezovta qilmaydi. Brauzerdagi Instagram va shaxsiy Telegram o'zlari xabar beradi — bu yerda takrorlanmaydi.
 */
import { iso } from '../src/lib/week';
import { businesses, cameras, connections, sql, type BusinessRow } from './db';
import { crmConnected, crmStatus, withCrm } from './crm/index';
import { diskProblem } from './disk';
import { env } from './env';
import { notifyOwner } from './inbox/core';
import { hubProblem } from './inbox/instagramApi';
import { phoneProblem } from './phone/index';

sql.exec(`CREATE TABLE IF NOT EXISTS channel_health (
  business_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, problem TEXT NOT NULL, since TEXT NOT NULL, notified_at TEXT,
  PRIMARY KEY (business_id, key)
)`);

const TICK_MS = Number(process.env.MONITOR_MS) || 60_000;
/** Muammo shuncha davom etsa — egasiga aytiladi */
const GRACE_MS = Number(process.env.MONITOR_GRACE_MS) || 5 * 60_000;
/** IP kameradan shuncha vaqt kadr kelmasa — uzilgan */
const CAMERA_SILENT_MS = 5 * 60_000;
const CRM_PROBE_MS = 8_000;

interface Check { key: string; label: string; problem: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Biznesning hozirgi holati (har kanal: muammo yoki null) */
async function checks(biz: BusinessRow, now: number, disk: string | null): Promise<Check[]> {
  const out: Check[] = [{ key: 'disk', label: 'Kompyuter diski', problem: disk }];
  if (crmConnected(biz.id)) {
    // Yengil so'rov: bugungi qabullar (kesh yo'q) — CRM javob bermasa yoki kirishni rad etsa, withCrm muammoni belgilaydi
    await Promise.race([withCrm(biz.id, crm => crm.appointments(iso(new Date(now)))).catch(() => null), new Promise(r => setTimeout(r, CRM_PROBE_MS).unref())]);
    out.push({ key: 'crm', label: 'DentaCRM', problem: crmStatus(biz.id).problem });
  }
  const ig = connections.get(biz.id, 'instagram_api');
  if (ig) out.push({ key: 'instagram_api', label: 'Instagram (rasmiy)', problem: hubProblem(now) ?? ig.meta.problem ?? null });
  out.push({ key: 'phone', label: 'Telefon (MicroSIP)', problem: phoneProblem(biz.id) });
  for (const cam of cameras.list(biz.id)) {
    if (!cam.ip) continue;
    const silent = !cam.lastSeenAt || now - Date.parse(cam.lastSeenAt) > CAMERA_SILENT_MS;
    out.push({ key: `camera:${cam.id}`, label: `Kamera «${cam.name}»`, problem: silent ? `kadr kelmayapti (${cam.ip}) — tok, tarmoq yoki kamera manzilini tekshiring` : null });
  }
  return out;
}

interface State { key: string; label: string; problem: string; since: string; notifiedAt: string | null }
const stateOf = (bizId: string) => sql.many('SELECT * FROM channel_health WHERE business_id = ?',
  (r): State => ({ key: String(r.key), label: String(r.label), problem: String(r.problem), since: String(r.since), notifiedAt: sql.str(r.notified_at) }), bizId);

export async function monitorOnce(now = Date.now()): Promise<void> {
  // Bitta kompyuter — bitta disk: har tekshiruvda bir marta o'lchanadi, har biznes egasiga o'z kanallari qatorida aytiladi
  const disk = diskProblem(env.dataDir, env.diskMinFreeMb);
  for (const biz of businesses.all()) {
    if (!biz.active || !biz.ownerChatId) continue;
    const prev = new Map(stateOf(biz.id).map(s => [s.key, s]));
    for (const c of await checks(biz, now, disk)) {
      const was = prev.get(c.key);
      prev.delete(c.key);
      if (!c.problem) {
        if (!was) continue;
        sql.run('DELETE FROM channel_health WHERE business_id = ? AND key = ?', biz.id, c.key);
        if (was.notifiedAt) await notifyOwner(biz, `✅ <b>${esc(c.label)}</b> yana ishlayapti.`).catch(() => null);
        continue;
      }
      if (!was) {
        sql.run('INSERT INTO channel_health (business_id, key, label, problem, since) VALUES (?, ?, ?, ?, ?)', biz.id, c.key, c.label, c.problem, new Date(now).toISOString());
        continue;
      }
      if (!was.notifiedAt && now - Date.parse(was.since) >= GRACE_MS) {
        const sent = await notifyOwner(biz, `⚠️ <b>${esc(c.label)}</b>: ${esc(c.problem)}\n<i>Panel → Ulanishlar. Tiklanganda yana aytaman.</i>`).catch(() => null);
        if (sent !== null) sql.run('UPDATE channel_health SET notified_at = ?, problem = ? WHERE business_id = ? AND key = ?', new Date(now).toISOString(), c.problem, biz.id, c.key);
      }
    }
    // Endi tekshirilmaydigan kanallar (uzilgan, kamera o'chirilgan) — holati tashlanadi
    for (const gone of prev.values()) sql.run('DELETE FROM channel_health WHERE business_id = ? AND key = ?', biz.id, gone.key);
  }
}

/** Ochiq muammolar (panel uchun): qaysi kanal, nima, qachondan beri */
export const openProblems = (bizId: string) => stateOf(bizId).map(s => ({ key: s.key, label: s.label, problem: s.problem, since: s.since }));

export function startMonitor(): () => void {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    monitorOnce().catch(e => console.error('[nazorat]', (e as Error).message)).finally(() => { busy = false; });
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
