/**
 * Palantir Hub'ga holat: ishga tushganda va keyin HEARTBEAT_MS (5 daqiqa) da — versiya, baza nashri, qachondan beri ishlayapti,
 * diskdagi joy va kanallardagi ochiq muammolar. Hub kompyuter o'chib qolganini shu va /api/pull dan biladi va sotuvchiga aytadi
 * (o'chgan kompyuter o'zi ayta olmaydi). Mijozlar, xabarlar va ismlar yuborilmaydi. Hub kodi kiritilmagan bo'lsa — hech narsa.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { industryOf } from '../src/data/industries';
import { crmConnected } from './crm/index';
import { businesses, connections } from './db';
import { freeMb } from './disk';
import { lastOffsite } from './offsite';
import { licenseStatus } from './license';
import { accessRejected, accessView, licensedModules, noteAccess, tickAccess } from './hubAccess';
import { hiredCrew } from './crew';
import { MODULES, type Module } from '../hub/licenseKey';
import { env } from './env';
import { onKeyChange } from './keys';
import { SCHEMA_VERSION } from './migrate';
import { readInstallState, remoteInstallKnown } from './voice/phoneInstall';
import { openProblems } from './monitor';
import { APP_VERSION } from './version';
import { inSetup } from './profile';

const startedAt = new Date().toISOString();

function phoneInstallStatus() {
  const s = readInstallState();
  return { remote: remoteInstallKnown(), phase: s?.phase ?? null, step: s?.step ?? null, note: s?.note ?? null, at: s?.at ?? null };
}

function lastUpdate(): unknown {
  try { return JSON.parse(readFileSync(join(env.dataDir, 'yangilash', 'holat.json'), 'utf8')); } catch { return null; }
}

export function heartbeatStatus() {
  const active = businesses.all().filter(b => b.active);
  return {
    version: APP_VERSION,
    schema: SCHEMA_VERSION,
    startedAt,
    diskFreeMb: freeMb(env.dataDir),
    businesses: active.length,
    // Sotuvchi /admin ro'yxatida kompyuter nomi yonida ko'radi (ulash ustasida yozilgan biznes nomlari)
    label: active.map(b => b.profile.name).join(', ').slice(0, 80),
    // Biznes turi (klinika, o'quv markazi, xizmat, ishlab chiqarish, savdo) — sotuvchining boshqaruv markazidagi filtr
    kinds: [...new Set(active.map(b => industryOf(b.profile.industry, crmConnected(b.id)).kind))],
    industries: active.map(b => b.profile.industry).filter(Boolean),
    problems: active.flatMap(b => openProblems(b.id).map(p => ({ business: b.profile.name, label: p.label, problem: p.problem, since: p.since }))),
    // Yangilovchining oxirgi natijasi (scripts/update.mjs): «qaytarildi» yoki «sinov» — sotuvchi bilsin
    lastUpdate: lastUpdate(),
    // Shifrlangan tashqi nusxa (offsite.ts): oxirgisi qachon va yetdimi
    lastOffsite: lastOffsite(),
    // Litsenziya (license.ts): sotuvchi Hub ro'yxatida ko'radi va bir bosishda beradi
    // Kompyuter kodi — Hub ishlash holatini shu kodga imzolab qaytaradi (hubAccess.ts)
    license: (({ activated, daysLeft, machineId }) => ({ activated, daysLeft, machineId }))(licenseStatus()),
    // Egasiga hali topshirilmagan (profile.ts): sotuvchi «sozlanmoqda» deb ko'radi, panelga so'ramasdan kiradi
    setup: inSetup(),
    // Amaldagi ishlash holati: sotuvchi buyrug'i yetib borganini va aloqasiz kunlarni ko'radi
    // rejected — Hub javobidagi imzo tekshiruvdan o'tmadi (kalit mos emas): sotuvchi 30 kun tugashidan oldin ko'rsin
    access: { ...(({ state, reason, offlineDays }) => ({ state, reason, offlineDays }))(accessView()), rejected: accessRejected() },
    // Tarif: qaysi modul ishlatilyapti (sotuvchi taklif qilsin yoki o'chirishdan oldin ko'rsin) va qaysilariga ruxsat yetib kelgan
    // (null — sotuvchi tanlamagan, hammasi ruxsat)
    uses: usedModules(active),
    modules: licensedModules(),
    // Telefon xizmati: jamoa Hub'dan o'rnata oladimi (PalantirTelefon vazifasi bor) va oxirgi o'rnatish qayerda (voice/phoneInstall.ts)
    phoneInstall: phoneInstallStatus(),
  };
}

/** Egasi jamoaga olgan AI xodimlar va telefon liniyasi ulangan bo'lsa — «telefon» */
function usedModules(active: ReturnType<typeof businesses.all>): Module[] {
  const used = new Set<string>(active.flatMap(b => hiredCrew(b)));
  if (active.some(b => connections.get(b.id, 'sip_line')?.account?.host)) used.add('telefon');
  return MODULES.filter(m => used.has(m));
}

/** Hub javobi: imzoli ishlash holati (hubAccess.ts) — bo'lmasa yoki buzuq bo'lsa e'tiborsiz */
async function readReply(r: Response): Promise<void> {
  try {
    const j = await r.json() as { access?: unknown };
    if (j && typeof j === 'object') noteAccess(j.access);
  } catch { /* eski Hub — bo'sh yoki boshqa javob */ }
}

async function beat(): Promise<void> {
  // Aloqasiz vaqt yig'iladi (Hub yo'q yoki javob bermasa ham) — hubAccess.ts
  tickAccess();
  const hub = env.hub;
  if (!hub) return;
  try {
    const r = await fetch(`${hub.url}/api/heartbeat`, {
      method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(heartbeatStatus()), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error(`[hub] holat qabul qilinmadi: ${r.status}`);
    else await readReply(r);
  } catch {
    // Internet yo'q — /api/pull ham ko'rinmaydi, hub buni o'zi sezadi; keyingi safar yana
  }
}

export function startHeartbeat(): () => void {
  void beat();
  // Hub kodi ulash ustasida endi kiritildi — hub klinikani darhol ko'rsin
  onKeyChange(name => { if (name === 'PALANTIR_HUB') void beat(); });
  const timer = setInterval(() => { void beat(); }, env.heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}
