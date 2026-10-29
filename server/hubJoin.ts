/**
 * O'zi ulanish: Hub kodi yo'q bo'lsa — yangi o'rnatilgan Palantir sotuvchining Hub'iga (env.hubJoinUrl) o'zi ro'yxatdan o'tadi va
 * olingan kodni kalit sifatida saqlaydi (keys.ts — PALANTIR_HUB: shifrlanib bazada). Shundan keyin sotuvchi /admin da kompyuterni
 * «yangi» deb ko'radi, litsenziyani bir bosishda beradi va «Panelni ochish» bilan masofadan kiradi. Mijoz hech narsa kiritmaydi.
 * Bir marta: muvaffaqiyatdan keyin belgi qoladi — Hub kodi panelda ataylab o'chirilsa, qayta ulanmaydi. Internet yo'q — 10 daqiqadan keyin yana.
 */
import { hostname } from 'node:os';
import { settings } from './db';
import { env } from './env';
import { setKey } from './keys';
import { machineId } from './license';

const JOINED = 'hub.joined';
const RETRY_MS = 10 * 60_000;

const joinedBefore = () => settings.all().some(r => r.name === JOINED);

async function join(): Promise<'done' | 'retry' | 'stop'> {
  if (env.hub || joinedBefore()) return 'stop';
  let r: Response;
  try {
    r = await fetch(`${env.hubJoinUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: machineId(), name: hostname() }), signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return 'retry';
  }
  // Ulanish yopiq yoki kompyuter kodi rad etildi — qayta urinishning foydasi yo'q
  if (r.status === 403 || r.status === 400) {
    console.error(`[hub] o'zi ulanish rad etildi (${r.status}) — Hub kodini ulash ustasida kiriting`);
    return 'stop';
  }
  const j = await r.json().catch(() => ({})) as { code?: string };
  if (!r.ok || !j.code) return 'retry';
  const saved = await setKey('PALANTIR_HUB', j.code, true);
  if (!saved.ok) {
    console.error(`[hub] olingan Hub kodi saqlanmadi: ${saved.error}`);
    return 'retry';
  }
  settings.set(JOINED, new Date().toISOString());
  console.log(`[hub] Palantir Hub'ga ulandi: ${new URL(env.hubJoinUrl).host}`);
  return 'done';
}

export function startHubJoin(): () => void {
  if (!env.hubJoinUrl) return () => {};
  let timer: NodeJS.Timeout | null = null, stopped = false;
  const attempt = async () => {
    const result = await join().catch(() => 'retry' as const);
    if (result === 'retry' && !stopped) timer = setTimeout(() => { void attempt(); }, RETRY_MS);
  };
  void attempt();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
