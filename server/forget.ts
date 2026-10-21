/**
 * Mijoz ma'lumotini o'chirish — mijoz so'rasa (egasi panelda «Mijozni o'chirish») yoki Instagram akkaunti egasi Meta orqali
 * o'chirishni so'rasa (Hub → ig_delete). Karta va unga bog'liq hammasi: yozishmalar, javob takliflari, vazifalar, so'rovlar,
 * qo'ng'iroqlar va ularning audio yozuvi, egasi chatidagi «Reply» bog'lanishlari, tayyorlangan ommaviy xabardagi o'rni.
 * Qolmaydigan joylar ham bor: Telegram chatlaridagi eski kartalar (bot 48 soatdan eski xabarni o'chira olmaydi) va kunlik zaxiralar
 * (BACKUP_KEEP kundan keyin almashadi) — panel egasiga shuni aytadi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { leads, sql } from './db';
import { RECORDINGS_DIR } from './phone/store';
// Kartalar o'chganda so'rovlar ham — ularning jadvali shu yerda tayyor bo'lsin
import './requests/store';

/** Kartaga bog'liq yozuvlar turadigan jadvallar (people.ts: absorb bilan bir xil ro'yxat) */
const LEAD_TABLES = ['inbox', 'replies', 'tasks', 'requests', 'calls'] as const;

/** Mijoz kartasi va unga bog'liq hamma narsa. false — bunday karta yo'q */
export function forgetLead(bizId: string, leadId: string): boolean {
  if (!leads.get(bizId, leadId)) return false;
  const recordings = sql.many('SELECT recording FROM calls WHERE business_id = ? AND lead_id = ? AND recording IS NOT NULL', r => String(r.recording), bizId, leadId);
  sql.tx(() => {
    sql.run('DELETE FROM request_cards WHERE request_id IN (SELECT id FROM requests WHERE business_id = ? AND lead_id = ?)', bizId, leadId);
    for (const table of LEAD_TABLES) sql.run(`DELETE FROM ${table} WHERE business_id = ? AND lead_id = ?`, bizId, leadId);
    sql.run('DELETE FROM relays WHERE lead_id = ?', leadId);
    // Tayyorlangan ommaviy xabar ro'yxatidan: id'lar tasodifiy 10 belgi — qo'shtirnoq bilan almashtirish xavfsiz
    for (const pattern of [`,"${leadId}"`, `"${leadId}",`, `"${leadId}"`]) {
      sql.run(`UPDATE outbound SET lead_ids = REPLACE(lead_ids, ?, '') WHERE business_id = ? AND status = 'draft'`, pattern, bizId);
    }
    sql.run('DELETE FROM leads WHERE business_id = ? AND id = ?', bizId, leadId);
  });
  for (const name of recordings) fs.rmSync(path.join(RECORDINGS_DIR, path.basename(name)), { force: true });
  return true;
}

/**
 * Instagram orqali kelgan ma'lumot: Instagram yozishmalari; Instagram'da paydo bo'lgan va boshqa izi yo'q kartalar (Telegram'i,
 * qo'ng'irog'i, boshqa kanaldagi yozishmasi yo'q) — butunlay; boshqa kanaldan ham tanilgan kartada — faqat Instagram bog'lanishi.
 * Qaytadi: o'chirilgan xabar va karta soni
 */
export function forgetInstagram(bizId: string): { messages: number; leads: number } {
  const messages = sql.one("SELECT COUNT(*) n FROM inbox WHERE business_id = ? AND channel = 'instagram'", r => Number(r.n), bizId) ?? 0;
  const igOnly = sql.many(`SELECT id FROM leads l WHERE business_id = ? AND channel = 'instagram' AND ig_user_id IS NOT NULL AND tg_user_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.business_id = l.business_id AND c.lead_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM inbox m WHERE m.business_id = l.business_id AND m.lead_id = l.id AND m.channel != 'instagram')`, r => String(r.id), bizId);
  let removed = 0;
  for (const id of igOnly) if (forgetLead(bizId, id)) removed++;
  sql.tx(() => {
    sql.run("DELETE FROM inbox WHERE business_id = ? AND channel = 'instagram'", bizId);
    sql.run("DELETE FROM replies WHERE business_id = ? AND channel = 'instagram' AND status IN ('pending', 'scheduled')", bizId);
    // Qabulxona so'rovida mijozning Instagram'dagi gapi iqtibos bo'lib turadi
    sql.run("UPDATE requests SET quote = NULL WHERE business_id = ? AND source = 'instagram'", bizId);
    // Telegram'i yo'q kartadagi username — Instagram profilidan
    sql.run('UPDATE leads SET username = NULL WHERE business_id = ? AND ig_user_id IS NOT NULL AND tg_user_id IS NULL', bizId);
    sql.run('UPDATE leads SET ig_user_id = NULL, ig_thread = NULL WHERE business_id = ? AND ig_user_id IS NOT NULL', bizId);
  });
  return { messages, leads: removed };
}
