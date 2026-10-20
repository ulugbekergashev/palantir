/**
 * Cerebro Hub'ga holat: ishga tushganda va keyin HEARTBEAT_MS (5 daqiqa) da — versiya, baza nashri, qachondan beri ishlayapti,
 * diskdagi joy va kanallardagi ochiq muammolar. Hub kompyuter o'chib qolganini shu va /api/pull dan biladi va sotuvchiga aytadi
 * (o'chgan kompyuter o'zi ayta olmaydi). Mijozlar, xabarlar va ismlar yuborilmaydi. Hub kodi kiritilmagan bo'lsa — hech narsa.
 */
import { readFileSync } from 'node:fs';
import { businesses } from './db';
import { freeMb } from './disk';
import { env } from './env';
import { onKeyChange } from './keys';
import { SCHEMA_VERSION } from './migrate';
import { openProblems } from './monitor';

export const APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const startedAt = new Date().toISOString();

export function heartbeatStatus() {
  const active = businesses.all().filter(b => b.active);
  return {
    version: APP_VERSION,
    schema: SCHEMA_VERSION,
    startedAt,
    diskFreeMb: freeMb(env.dataDir),
    businesses: active.length,
    problems: active.flatMap(b => openProblems(b.id).map(p => ({ business: b.profile.name, label: p.label, problem: p.problem, since: p.since }))),
  };
}

async function beat(): Promise<void> {
  const hub = env.hub;
  if (!hub) return;
  try {
    const r = await fetch(`${hub.url}/api/heartbeat`, {
      method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(heartbeatStatus()), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error(`[hub] holat qabul qilinmadi: ${r.status}`);
  } catch {
    // Internet yo'q — /api/pull ham ko'rinmaydi, hub buni o'zi sezadi; keyingi safar yana
  }
}

export function startHeartbeat(): () => void {
  void beat();
  // Hub kodi ulash ustasida endi kiritildi — hub klinikani darhol ko'rsin
  onKeyChange(name => { if (name === 'CEREBRO_HUB') void beat(); });
  const timer = setInterval(() => { void beat(); }, env.heartbeatMs);
  timer.unref();
  return () => clearInterval(timer);
}
