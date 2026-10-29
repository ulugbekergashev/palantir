/**
 * Telefon (MicroSIP) — klinika kompyuteridagi softfon Palantir'ga ulanadi:
 *
 *   MicroSIP hodisasi → qo'ng'iroqlar jurnali (journal.ts) → qo'ng'iroq tugadi:
 *     · mijoz kartasi — telefon bo'yicha (bitta odam: Instagram, bot va qo'ng'iroq birga);
 *     · kiruvchi, ko'tarilmagan → «Qo'ng'iroq qilish» so'rovi qabulxonaga (yana qo'ng'iroq qilsa — o'sha so'rovga);
 *     · chiquvchi, ko'tarmadi, ochiq so'rovi bor → «ko'tarmadi» urinishi o'zi yoziladi;
 *     · gaplashildi → yozuv fayli topiladi → matn va tahlil (analysis.ts) → mijoz kartasi, so'rov, egasiga qisqa xabar.
 *   «📞 Kompyuterdan» (so'rov kartasi, panel) → MicroSIP raqamni teradi; keyingi qo'ng'iroq shu so'rovga bog'lanadi.
 *
 * MicroSIP Palantir server ishlayotgan kompyuterda bo'lishi kerak (hodisa va yozuvlar fayl orqali keladi).
 */
import fs from 'node:fs';
import path from 'node:path';
import { phoneKey, prettyPhone } from '../../src/lib/phone';
import { businesses, leads, type BusinessRow } from '../db';
import { normPhone } from '../crm/logic';
import { env, voiceEnabled } from '../env';
import { notifyOwner } from '../inbox/core';
import { leadForPhone } from '../people';
import { addResult, noAnswer, nudgeRequest, openRequest, setDialer } from '../requests/index';
import { requests } from '../requests/store';
import { SilenceError } from '../stt';
import { analyseCall } from './analysis';
import { ensureHookExe } from './hook';
import { ANSWER_REOPEN_MS, LOCAL_STATION, RERING_AFTER_MISS_MS, decideCall, routeStation, staleState, type CallEvent } from './journal';
import {
  activeDirs, connectMicrosip, defaultEnv, dialNumber, disconnectMicrosip, getStatus, markAccountWorking, readSpool, readState, refreshHookFiles,
  windowsSystem, writeState, type MicrosipEnv, type MicrosipEvent, type MicrosipStatus, type MicrosipSystem, type SpoolReader,
} from './microsip';
import { AUDIO_EXT, MIME, findRecording, moveRecording, pickRecording } from './recordings';
import { STATION_RECORDINGS_DIR, queueDial, stationRecordings, stations, type Station } from './stations';
import { RECORDINGS_DIR, phoneCalls, type PhoneCallRow } from './store';
import { CALL_OUTCOME, CALL_OUTCOME_ICON, type CallOutcomeKey } from '../../src/lib/requests';

export { RECORDINGS_DIR };

const STATE_DIR = path.join(env.dataDir, 'microsip');
/** MicroSIP yozuv faylini suhbat tugagach yopadi — shuncha kutib qidiriladi, topilmasa yana bir marta */
const RECORDING_WAITS_MS = [2_500, 10_000];
const SWEEP_MS = 30_000;
/** «Kompyuterdan qo'ng'iroq» bosilgandan keyin shu vaqt ichida terilgan raqam — o'sha so'rovniki */
const DIAL_LINK_MS = 2 * 60_000;
/** Bundan qisqa suhbat tahlil qilinmaydi (ulanmadi, avtojavob) */
const MIN_REVIEW_SEC = 8;
const MIN_PHONE_DIGITS = 7;

/**
 * Faqat sinov uchun (MICROSIP_FAKE_LOG): jarayonlar ishga tushirilmaydi — ekranda MicroSIP oynasi ochilmaydi, «terilgan» raqamlar
 * shu faylga yoziladi. Papka ruxsatlari, ini, yordamchi va hodisalar — haqiqiy
 */
const fakeSystem = (log: string): MicrosipSystem => ({
  isRunning: async () => false, requestExit: () => {}, registryExeCandidates: async () => [], runningExePath: async () => null,
  start: (_exe, args = []) => { fs.appendFileSync(log, `${args.join(' ')}\n`); },
  secureDir: dir => windowsSystem.secureDir(dir),
});
const sys: MicrosipSystem = process.env.MICROSIP_FAKE_LOG ? fakeSystem(process.env.MICROSIP_FAKE_LOG) : windowsSystem;
let menv: MicrosipEnv = defaultEnv(STATE_DIR, path.join(STATE_DIR, 'palantir-call.exe'));

/** MicroSIP qaysi biznesniki (bitta kompyuter — bitta klinika) */
const ownerBiz = (): BusinessRow | undefined => {
  const id = readState(menv).businessId;
  const biz = id ? businesses.byId(id) : undefined;
  return biz?.active ? biz : undefined;
};

// «📞 Kompyuterdan» tugmasi: shu kompyuterda MicroSIP ulangan yoki qabulxonadagi boshqa kompyuterlardan biri aloqada
setDialer(bizId => (ownerBiz()?.id === bizId && !!activeDirs(menv)) || stations.list(bizId).some(st => st.online));

// ─── Hodisalar ───────────────────────────────────────────────────────────────

let reader: SpoolReader | null = null;
let sweeper: NodeJS.Timeout | null = null;
/** Bitta hodisa tugamaguncha keyingisi kutadi: ikki hodisa bitta yozuvni baravar o'zgartirmasin */
let chain: Promise<unknown> = Promise.resolve();
const inOrder = (work: () => Promise<unknown>) => { chain = chain.then(work, work).catch(e => console.error('[telefon]', (e as Error).message)); return chain; };
const dialIntents = new Map<string, { requestId: string; at: number }>();

export function startPhone(): void {
  stopPhone();
  const dirs = activeDirs(menv);
  const biz = ownerBiz();
  if (!dirs || !biz) return;
  refreshHookFiles(menv);
  reader = readSpool(dirs.spool, e => { void inOrder(() => onEvent(biz.id, e)); });
  // Server to'xtab qolgan paytda tahlil navbatida qolganlari
  for (const c of phoneCalls.pending()) void review(c.businessId, c.id);
}

const DAY_MS = 86_400_000, RETENTION_CHECK_MS = 6 * 3_600_000;

/** Muddati o'tgan yozuvlar (RECORDINGS_KEEP_DAYS) o'chiriladi, qo'ng'iroqning matni va tahlili qoladi. Qaytaradi — nechta o'chdi */
export function pruneRecordings(now = Date.now()): number {
  if (!(env.recordingsKeepDays > 0)) return 0;
  const cutoff = now - env.recordingsKeepDays * DAY_MS;
  let names: string[];
  try { names = fs.readdirSync(RECORDINGS_DIR); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!AUDIO_EXT.test(name)) continue;
    const file = path.join(RECORDINGS_DIR, name);
    try {
      if (fs.statSync(file).mtimeMs >= cutoff) continue;
      fs.unlinkSync(file);
    } catch { continue; }
    phoneCalls.forgetRecording(name);
    removed++;
  }
  return removed;
}

/** MicroSIP ulanmagan bo'lsa ham ishlaydi: yozuvlar papkasida eski fayllar qolgan bo'lishi mumkin */
export function startRecordingRetention(): () => void {
  const run = () => {
    const removed = pruneRecordings();
    if (removed) console.log(`[telefon] muddati o'tgan ${removed} ta yozuv o'chirildi (${env.recordingsKeepDays} kun)`);
  };
  run();
  const timer = setInterval(run, RETENTION_CHECK_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export function stopPhone(): void {
  reader?.stop();
  reader = null;
}

/** «Tugadi» kelmay qolgan yozuvlarni yopish — shu kompyuterda ham, boshqa kompyuterlardan kelgan qo'ng'iroqlarda ham */
export function startCallSweeper(): () => void {
  if (!sweeper) {
    sweeper = setInterval(() => { void inOrder(sweep); }, SWEEP_MS);
    sweeper.unref();
  }
  return () => { if (sweeper) clearInterval(sweeper); sweeper = null; };
}

const EVENT_MAP: Record<MicrosipEvent['event'], CallEvent> = { incoming: 'incoming', answer: 'answer', start: 'start', end: 'end', outgoing: 'outgoing' };

/** station — qaysi kompyuterdan (LOCAL_STATION — shu kompyuterdagi MicroSIP, aks holda stations.ts dagi id) */
export async function onEvent(bizId: string, e: MicrosipEvent, station: string = LOCAL_STATION): Promise<void> {
  const key = phoneKey(e.number) ?? (e.number ? e.number.toLowerCase() : null);
  if (!key) return;
  const at = Date.parse(e.at);
  if (station === LOCAL_STATION && (e.event === 'incoming' || e.event === 'answer' || e.event === 'start')) markAccountWorking(menv);
  const open = phoneCalls.openFor(bizId, key, station) ?? null;
  // Bir nechta kompyuterda jiringlagan qo'ng'iroq: boshqasida jiringlash to'xtagani «ko'tarilmadi» emas (journal.ts: routeStation)
  const route = routeStation(EVENT_MAP[e.event], station, open);
  if (route.kind === 'ignore') return;
  if (route.kind === 'ringing') {
    phoneCalls.setRinging(bizId, open!.id, route.ringing);
    return;
  }
  const recentIn = !open && (e.event === 'incoming' || e.event === 'answer') ? phoneCalls.recentIn(bizId, key, at, e.event === 'answer' ? ANSWER_REOPEN_MS : RERING_AFTER_MISS_MS) ?? null : null;
  const action = decideCall(EVENT_MAP[e.event], at, open, recentIn);
  if (action.kind === 'ignore') return;
  if (action.kind === 'create') {
    const ringing = action.state === 'ringing';
    const c = phoneCalls.create(bizId, { phone: e.number, direction: action.direction, state: action.state, at, answered: action.answered, station: ringing ? null : station, ringing: ringing ? [station] : [] });
    // «Kompyuterdan qo'ng'iroq» bosilgan edi — bu qo'ng'iroq o'sha so'rovniki
    const intent = dialIntents.get(key);
    if (action.direction === 'out' && intent && at - intent.at < DIAL_LINK_MS) { phoneCalls.setRequest(bizId, c.id, intent.requestId); dialIntents.delete(key); }
    return;
  }
  // Ko'tarildi — qo'ng'iroq shu kompyuterniki; qayta jiringladi — hali hech kimniki
  if (action.answered) phoneCalls.setStation(bizId, action.id, station, []);
  else if (action.state === 'ringing') phoneCalls.setRinging(bizId, action.id, [station]);
  const c = phoneCalls.setState(bizId, action.id, action.state, at, action);
  if (action.ended) await finished(bizId, c);
}

/** «Tugadi» kelmay qolgan yozuvlar (MicroSIP yopilib qolgan) yopiladi */
async function sweep(): Promise<void> {
  const now = Date.now();
  for (const biz of businesses.all()) {
    for (const c of phoneCalls.allOpen(biz.id)) {
      const state = staleState(c, now);
      if (state) await finished(biz.id, phoneCalls.setState(biz.id, c.id, state, now, { ended: true }));
    }
  }
}

// ─── Qo'ng'iroq tugadi ───────────────────────────────────────────────────────

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const hhmm = (t: number) => new Date(t).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit', hour12: false });
const BY = "MicroSIP (qo'ng'iroq)";

async function finished(bizId: string, c: PhoneCallRow): Promise<void> {
  const biz = businesses.byId(bizId);
  if (!biz) return;
  const digits = c.phone.replace(/\D/g, '');
  // Ichki raqam (101), «anonymous» — mijoz kartasi ochilmaydi
  if (digits.length < MIN_PHONE_DIGITS) return;
  const lead = leadForPhone(biz, normPhone(c.phone) || c.phone, { name: null, source: "Qo'ng'iroq" });
  phoneCalls.setLead(bizId, c.id, lead.id, lead.name);
  const open = requests.openFor(bizId, lead.id).find(r => r.kind === 'callback');
  const linked = c.requestId ? requests.get(bizId, c.requestId) : open;
  if (linked && !c.requestId) phoneCalls.setRequest(bizId, c.id, linked.id);

  if (c.state === 'missed') {
    if (open) {
      await nudgeRequest(biz, open.id, "📞 <b>Yana qo'ng'iroq qildi</b>", `Yana qo'ng'iroq qildi (${hhmm(c.startedAt)}), ko'tarilmadi`, BY);
    } else {
      const { request } = await openRequest(biz, lead.id, {
        kind: 'callback', phone: c.phone, summary: "O'tkazib yuborilgan qo'ng'iroq — qayta qo'ng'iroq qiling", whenText: `qo'ng'iroq qilgan: ${hhmm(c.startedAt)}`, source: 'call',
      });
      phoneCalls.setRequest(bizId, c.id, request.id);
    }
    return;
  }
  if (c.state === 'no_answer') {
    if (linked?.status === 'open') await noAnswer(biz, linked.id, BY).catch(() => {});
    return;
  }
  if (c.state !== 'ended') return;
  const sec = c.answeredAt && c.endedAt ? Math.round((c.endedAt - c.answeredAt) / 1000) : 0;
  if (linked?.status === 'open') await addResult(biz, linked.id, `📞 ${c.direction === 'out' ? "Qo'ng'iroq qilindi" : "Mijoz qo'ng'iroq qildi"} (${hhmm(c.startedAt)}, ${mmss(sec)})`, BY).catch(() => {});
  if (c.answeredAt && c.endedAt) void attachRecording(biz, c, sec);
}

async function attachRecording(biz: BusinessRow, c: PhoneCallRow, sec: number): Promise<void> {
  // Boshqa kompyuterda gaplashilgan: yozuvni o'sha kompyuter keyin yuboradi (stationRecording) — shu yerda hozircha bo'lsa olinadi
  if (c.station && c.station !== LOCAL_STATION) {
    if (!matchStationRecording(biz, c)) console.log(`[telefon] ${c.id}: yozuv «${stations.get(biz.id, c.station)?.name ?? c.station}» kompyuteridan kutilmoqda`);
    return;
  }
  const dirs = activeDirs(menv);
  if (!dirs) return;
  for (const wait of RECORDING_WAITS_MS) {
    await new Promise(r => setTimeout(r, wait));
    const found = findRecording(dirs.records, { answeredAt: c.answeredAt!, endedAt: c.endedAt! }, phoneKey(c.phone));
    if (!found) continue;
    phoneCalls.setRecording(biz.id, c.id, moveRecording(found, RECORDINGS_DIR, c.id));
    await reviewIfLong(biz, c.id, sec);
    return;
  }
  console.warn(`[telefon] ${c.id}: suhbat yozuvi topilmadi (MicroSIP'da yozib olish o'chiqmi?)`);
}

const reviewIfLong = async (biz: BusinessRow, callId: string, sec: number) => {
  if (sec >= MIN_REVIEW_SEC && voiceEnabled() && env.aiEnabled) await review(biz.id, callId);
  else phoneCalls.setReview(biz.id, callId, 'none');
};

/** Kompyuter yuborgan yozuvlar orasidan shu qo'ng'iroqnikini topadi va biriktiradi. Topildimi */
function matchStationRecording(biz: BusinessRow, c: PhoneCallRow): boolean {
  if (!c.station || !c.answeredAt || !c.endedAt) return false;
  const hit = pickRecording(stationRecordings(c.station), { answeredAt: c.answeredAt, endedAt: c.endedAt }, phoneKey(c.phone));
  if (!hit) return false;
  const file = path.join(STATION_RECORDINGS_DIR, c.station, hit.name);
  phoneCalls.setRecording(biz.id, c.id, moveRecording({ file, ext: path.extname(hit.name).slice(1).toLowerCase(), size: hit.size }, RECORDINGS_DIR, c.id));
  void reviewIfLong(biz, c.id, Math.round((c.endedAt - c.answeredAt) / 1000));
  return true;
}

/** Kompyuter soati shuncha farq qilsa — hodisa kelgan payt olinadi (soati noto'g'ri kompyuter suhbat davomiyligini buzmasin) */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Boshqa kompyuterdan (stansiya) kelgan hodisa — shu kompyuterdagilar bilan bitta navbatda */
export function stationEvent(station: Station, e: { event: MicrosipEvent['event']; number: string; at: string }): Promise<unknown> {
  const now = Date.now(), at = Date.parse(e.at);
  const when = Number.isFinite(at) && Math.abs(at - now) < MAX_CLOCK_SKEW_MS ? at : now;
  const number = e.number.replace(/[^0-9A-Za-z+*#@._-]/g, '').slice(0, 64);
  return inOrder(() => onEvent(station.businessId, { event: e.event, number, at: new Date(when).toISOString() }, station.id));
}

/** Kompyuterdan yozuv keldi: shu kompyuterda yaqinda tugagan, yozuvi yo'q qo'ng'iroqlarga biriktiriladi */
export function stationRecording(station: Station): void {
  const biz = businesses.byId(station.businessId);
  if (!biz) return;
  for (const c of phoneCalls.awaitingRecording(biz.id, station.id, Date.now() - 6 * 3_600_000)) matchStationRecording(biz, c);
}

// ─── Tahlil ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const OUTCOME_LABEL = Object.fromEntries((Object.keys(CALL_OUTCOME) as CallOutcomeKey[]).map(k => [k, k === 'other' ? '•' : `${CALL_OUTCOME_ICON[k]} ${CALL_OUTCOME[k]}`])) as Record<CallOutcomeKey, string>;

/** Yozuv → matn → tahlil → mijoz kartasi, so'rov, egasiga xabar. Xato bo'lsa — «failed» (panelda ko'rinadi) */
export async function review(bizId: string, callId: string): Promise<void> {
  const biz = businesses.byId(bizId);
  const c = phoneCalls.get(bizId, callId);
  if (!biz || !c?.recording) return;
  const file = path.join(RECORDINGS_DIR, c.recording);
  const sec = c.answeredAt && c.endedAt ? Math.round((c.endedAt - c.answeredAt) / 1000) : 0;
  let found;
  try {
    found = await analyseCall(biz, fs.readFileSync(file), MIME[path.extname(file).slice(1)] ?? 'audio/wav', { direction: c.direction, startedAt: c.startedAt, durationSec: sec, phone: c.phone });
  } catch (e) {
    phoneCalls.setReview(bizId, callId, 'failed');
    if (!(e instanceof SilenceError)) console.error(`[telefon] ${callId} tahlil qilinmadi:`, (e as Error).message);
    return;
  }
  const { analysis: a, request } = found;
  phoneCalls.setReview(bizId, callId, 'done', a);
  const lead = c.leadId ? leads.get(bizId, c.leadId) : undefined;
  if (lead) {
    leads.update(bizId, lead.id, {
      ...(a.customerName && !lead.name ? { name: a.customerName } : {}),
      ...(a.wants ? { note: a.wants.slice(0, 200) } : {}),
      ...(a.outcome === 'booked' && lead.stage === 'new' ? { stage: 'contacted' as const } : {}),
    });
  }
  const linked = c.requestId ? requests.get(bizId, c.requestId) : undefined;
  if (linked?.status === 'open') await addResult(biz, linked.id, a.summary, BY).catch(() => {});
  // Qo'ng'iroqdan keyin ham xodim qilishi kerak bo'lgan ish — so'rov (mavjud bo'lsa — yangilanadi)
  if (request && lead) await openRequest(biz, lead.id, { kind: request.kind, phone: c.phone, summary: request.summary, dueAt: request.dueAt, source: 'call', quote: a.wants });
  const who = lead?.name || a.customerName || prettyPhone(c.phone);
  await notifyOwner(biz, [
    `📞 <b>${c.direction === 'in' ? 'Kiruvchi' : 'Chiquvchi'} qo'ng'iroq</b> · ${mmss(sec)} — ${esc(who)}`,
    esc(a.summary),
    a.agreed ? `${OUTCOME_LABEL[a.outcome]}: ${esc(a.agreed)}` : OUTCOME_LABEL[a.outcome] !== '•' ? OUTCOME_LABEL[a.outcome] : '',
    a.nextStep ? `➡️ ${esc(a.nextStep)}` : '',
    a.score ? `🗣 Xodim: ${a.score}/10${a.staffNote ? ` — ${esc(a.staffNote)}` : ''}` : '',
    '<i>Yozuv va matn: panel → Qo\'ng\'iroqlar</i>',
  ].filter(Boolean).join('\n')).catch(() => null);
}

// ─── Panel va kartadan boshqarish ────────────────────────────────────────────

export interface PhoneStatus extends MicrosipStatus { available: boolean; mine: boolean; otherBusiness: boolean }

/** Shu biznes ulagan MicroSIP ishlamay qolgan bo'lsa — sababi (kanallar nazorati uchun; ulanmagan bo'lsa — null) */
export function phoneProblem(bizId: string): string | null {
  const st = readState(menv);
  if (st.businessId !== bizId || !st.connectedAt) return null;
  if (!activeDirs(menv)) return "MicroSIP yordamchisi topilmadi — qo'ng'iroqlar Palantir'ga kelmayapti. Panel → Qo'ng'iroqlar → «Ulash»ni qayta bosing";
  if (st.noAccount) return "MicroSIP'da operator hisobi (SIP login) yo'q — qo'ng'iroq ketmaydi";
  return null;
}

export async function phoneStatus(biz: BusinessRow): Promise<PhoneStatus> {
  if (process.platform !== 'win32') return { available: false, mine: false, otherBusiness: false, exePath: null, connected: false, noAccount: false, recording: false, recordFormat: null };
  const s = await getStatus(menv, sys);
  const owner = readState(menv).businessId;
  return { ...s, available: true, mine: s.connected && owner === biz.id, otherBusiness: s.connected && !!owner && owner !== biz.id };
}

const CONNECT_ERRORS: Record<string, string> = {
  not_found: "MicroSIP topilmadi — o'rnating (microsip.org) yoki manzilini MICROSIP_EXE bilan ko'rsating",
  ini_missing: "MicroSIP sozlama fayli (MicroSIP.ini) topilmadi — MicroSIP'ni bir marta ochib, yoping",
  hooks_taken: "MicroSIP boshqa dasturga ulangan (masalan DentaCRM). «Baribir ulash» bilan Palantir'ga o'tkazing",
  exit_failed: "MicroSIP yopilmadi — qo'ng'iroq tugaganini tekshirib, qayta urining",
  helper_missing: "MicroSIP yordamchisi yig'ilmadi",
};

export async function connectPhone(biz: BusinessRow, overwrite = false): Promise<PhoneStatus> {
  if (process.platform !== 'win32') throw new Error("MicroSIP faqat Windows'da ishlaydi");
  const other = readState(menv).businessId;
  if (other && other !== biz.id && activeDirs(menv)) throw new Error('Bu kompyuterdagi MicroSIP boshqa biznesga ulangan');
  menv = { ...menv, hookSourceExe: await ensureHookExe(STATE_DIR) };
  const r = await connectMicrosip(menv, sys, { overwrite });
  if (!r.ok) throw new Error(r.reason === 'error' ? `MicroSIP ulanmadi: ${r.message ?? ''}` : CONNECT_ERRORS[r.reason] ?? 'MicroSIP ulanmadi');
  writeState(menv, { ...readState(menv), businessId: biz.id });
  startPhone();
  return phoneStatus(biz);
}

export async function disconnectPhone(biz: BusinessRow): Promise<PhoneStatus> {
  if (readState(menv).businessId !== biz.id) return phoneStatus(biz);
  const r = await disconnectMicrosip(menv, sys);
  if (!r.ok) throw new Error(r.reason === 'exit_failed' ? CONNECT_ERRORS.exit_failed : `MicroSIP uzilmadi: ${r.message ?? ''}`);
  stopPhone();
  return phoneStatus(biz);
}

/**
 * Raqamni MicroSIP'da teradi. requestId — so'rov kartasidan bosilgan: keyingi qo'ng'iroq shu so'rovga bog'lanadi.
 * Qaysi kompyuterda: ko'rsatilgani (panel), bosgan xodimning kompyuteri (Telegram), shu kompyuter, aloqadagi yagona boshqa kompyuter
 */
export async function dialFor(biz: BusinessRow, phone: string, requestId?: string, where: { stationId?: string; staffId?: string } = {}): Promise<{ noAccount: boolean; station: string | null }> {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 3) throw new Error("Raqam noto'g'ri");
  const remember = () => { const key = phoneKey(phone); if (key && requestId) dialIntents.set(key, { requestId, at: Date.now() }); };
  const all = stations.list(biz.id);
  const chosen = where.stationId ? all.find(st => st.id === where.stationId) : where.staffId ? all.find(st => st.staffId === where.staffId && st.online) : undefined;
  if (where.stationId && !chosen) throw new Error('Bunday kompyuter yo\'q');
  const local = ownerBiz()?.id === biz.id && !!activeDirs(menv);
  const target = chosen ?? (local ? null : all.filter(st => st.online).length === 1 ? all.find(st => st.online) : undefined);
  if (target) {
    if (!target.online) throw new Error(`«${target.name}» kompyuteri aloqada emas — u yoqilganmi?`);
    queueDial(target.id, digits);
    remember();
    return { noAccount: false, station: target.name };
  }
  if (!local) throw new Error(all.some(st => st.online) ? "Qaysi kompyuterdan qo'ng'iroq qilish? Panelda kompyuterni tanlang" : "MicroSIP ulanmagan — panel → Sozlamalar → Telefon");
  const r = await dialNumber(menv, sys, phone);
  if (!r.ok) throw new Error(r.reason === 'bad_number' ? "Raqam noto'g'ri" : CONNECT_ERRORS.not_found);
  remember();
  return { noAccount: !!r.noAccount, station: null };
}
