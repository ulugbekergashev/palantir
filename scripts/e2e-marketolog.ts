/**
 * Marketolog sinovi — Palantir server + soxta meta.ai (brauzer o'rniga) + soxta Instagram (brauzer orqali) + soxta Claude:
 *   sof: javobdagi @akkauntlar (email emas, takrorsiz);
 *   ulash: «Meta AI'ga kirish» → oyna (egasi kiradi) → ulandi, egasiga Telegram'da; xodimlar ro'yxatida beshinchi — Marketolog;
 *   so'rash: yordamchi meta_ai asbobini chaqiradi → darhol «so'radim» (javob fonda, yordamchini ushlab turmaydi) → savol meta.ai'ga →
 *   javob Marketolog jurnaliga to'liq va egasining Telegram'iga; Meta AI aytgan akkauntlar egasining Instagram'i orqali tekshiriladi
 *   (yo'g'i — «yo'q», Instagram ulanmagan bo'lsa — «tekshirilmadi»); javob suhbatga (Claude'ga) qaytmaydi;
 *   chegaralar: navbatda 3 tadan ko'p savol yo'q; kunlik chegara; sayt xatosida hisob qaytadi va «qayta kiring» deyilmaydi;
 *   jadval: Marketologga topshiriq — «Sinab ko'rish» bilan hozir bajariladi, natija Telegram'ga;
 *   meta.ai «Войти»ni ko'rsatsa — to'xtaydi, egasiga aytadi, panelda «Qayta kirish»; uzish — profil o'chadi.
 * Ishga tushirish: npm run test:marketolog
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handlesIn } from '../server/marketing/tools';
import { OWNER, ai, aiServer, igWeb, igWebServer, json, listen, readBody, say, sent, sleep, tgServer, waitFor, type Sent, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

console.log('\n# Javobdagi akkauntlar (sof)');
const found = handlesIn("Raqobatchilar: @dent_city, @Smile.Clinic. va yana @dent_city; yozing: info@clinic.uz, @a (juda qisqa)");
ok("@akkauntlar topiladi: takrorsiz, kichik harfda, oxiridagi nuqtasiz; email va bitta harf — yo'q", JSON.stringify(found) === JSON.stringify(['dent_city', 'smile.clinic']), JSON.stringify(found));

// ─── Soxta meta.ai ────────────────────────────────────────────────────────────
const meta = {
  loggedIn: false, sessionValid: true, attached: 0, wiped: 0,
  /** Javob shuncha kechikadi (navbat sinovi); fail — sayt xatosi (500) */
  delay: 0, fail: false,
  asked: [] as string[],
  answer: (q: string) => `Toshkentdagi stomatologiyalar bo'yicha raqobatchilar:\n1. **@dent_city** — haftasiga 5 ta Reels, narxlarni ochiq yozadi.\n2. **@smile_clinic_uz** — oldin/keyin videolari.\n3. **@soxta_klinika** — aksiya postlari.\n\n(savol: ${q.replace(/@/g, '').slice(0, 40)})`,
};
const metaServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  switch (req.url) {
    case '/login': return json(res, { done: meta.loggedIn });
    case '/attach': meta.attached++; return meta.loggedIn && meta.sessionValid ? json(res, { ok: true }) : json(res, { error: 'login' }, 401);
    case '/detach': if (body.wipe) { meta.loggedIn = false; meta.wiped++; } return json(res, { ok: true });
    case '/ask':
      if (!meta.sessionValid) return json(res, { error: 'login' }, 401);
      if (meta.fail) return json(res, { error: "meta.ai sahifasi ochilmadi — keyinroq qayta urinib ko'ring" }, 500);
      meta.asked.push(String(body.prompt));
      if (meta.delay) await sleep(meta.delay);
      return json(res, { text: meta.answer(String(body.prompt)) });
    default: return json(res, { error: 'NOT_FOUND' }, 404);
  }
});

const tgPort = await listen(tgServer), aiPort = await listen(aiServer), metaPort = await listen(metaServer), igPort = await listen(igWebServer);
const work = fs.mkdtempSync(path.join(tmpdir(), 'palantir-mkt-'));
const PORT = 3286, base = `http://127.0.0.1:${PORT}`;
let log = '';
const proc: ChildProcess = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0',
    PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: path.join(work, 'data'), BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'mkt-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', REQUEST_HOURS: '0-24', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '', PALANTIR_HUB: '',
    META_AI_FAKE_URL: `http://127.0.0.1:${metaPort}`, META_AI_DAILY_LIMIT: '6',
    IG_VIA_BROWSER: '1', IG_FAKE_URL: `http://127.0.0.1:${igPort}`, IG_POLL_MS: '60000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stdout!.on('data', d => { log += d; });
proc.stderr!.on('data', d => { log += d; });

async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + p, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? s?.params.caption ?? '');
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && textOf(s).includes(needle));

type Block = Record<string, any>;
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
const lastResults = (messages: Msg[]) => { const last = messages.at(-1); return Array.isArray(last?.content) ? last.content.filter(b => b.type === 'tool_result') : []; };
const resultText = (r: Block | undefined) => (Array.isArray(r?.content) ? r.content.filter((c: Block) => c.type === 'text').map((c: Block) => c.text).join('\n') : String(r?.content ?? ''));
/** Asbob natijalari (har chaqiruv) — yordamchi nimani ko'rgani */
const seenResults: string[] = [];
/** Yordamchi: meta_ai'ni `times` marta chaqiradi (bir javobda), keyin bir gap aytadi */
const ownerAsks = (question: string, topic: string, times = 1) => {
  ai.owner = messages => {
    const r = lastResults(messages);
    if (r.length) { seenResults.push(...r.map(resultText)); return { content: [{ type: 'text', text: `Marketolog: ${resultText(r[0]).slice(0, 200)}` }], stop: 'end_turn' }; }
    return { content: Array.from({ length: times }, (_, i) => ({ type: 'tool_use', id: `tu_${Date.now()}_${i}`, name: 'meta_ai', input: { question, topic } })), stop: 'tool_use' };
  };
};
const status = async (token: string) => (await api('/api/me', { token })).json.status;
/** waitFor — sinxron tekshiruv uchun; bu — panelni so'rab kutadi */
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { const v = await fn(); if (v) return v; }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
type Ev = { title: string; body: string; level: string };
const reports = async (token: string) => (await api('/api/agents/marketolog/events', { token })).json.events as Ev[];
const reportCount = async (token: string, n: number) => until(`${n} ta hisobot`, async () => { const e = await reports(token); return e.length >= n ? e : undefined; });

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Shifo Dent', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'shifo', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi', () => toOwner(mark, 'Shifo Dent'));

  console.log('\n# Ulash');
  ok('panel: Meta AI bor (brauzer), hali ulanmagan', me.status.metaAi?.available === true && me.status.metaAi.connected === false, JSON.stringify(me.status.metaAi));
  ownerAsks('Toshkentdagi raqobatchilarimizni aytib ber', 'raqobatchilar');
  await api('/api/chat', { token, body: { text: 'Raqobatchilarni tahlil qil' } });
  ok("ulanmagan: yordamchi asbobni chaqirsa — «Ulash»ga yo'naltiradi, meta.ai'ga bormaydi", seenResults.at(-1)?.includes('Marketolog → Ulash') && !meta.asked.length, seenResults.at(-1));
  mark = sent.length;
  const started = await api('/api/meta-ai/login', { token, body: {} });
  ok("«Meta AI'ga kirish» — oyna ochildi, panel kutyapti", started.status === 200 && started.json.status.metaAi.waiting === true);
  meta.loggedIn = true;
  ok('egasi oynada kirdi → ulandi', await until('ulandi', async () => { const s = await status(token); return s.metaAi.connected && !s.metaAi.waiting ? s : undefined; }));
  ok("egasiga Telegram'da: «Meta AI ulandi»", await waitFor('xabar', () => toOwner(mark, 'Meta AI ulandi')));
  const day = (await api('/api/team/day', { token })).json;
  ok('bosh ekranda beshinchi xodim — Marketolog', day.members?.length === 5 && day.members.at(-1).member === 'marketolog', JSON.stringify(day.members?.map((m: { member: string }) => m.member)));

  console.log("\n# So'rash: fonda, jurnal va Telegram, akkauntlar tekshiruvi");
  mark = sent.length;
  ownerAsks("Toshkent, stomatologiya, Instagram: @shifo_dent. Raqobatchilarimiz kimlar va nima postlaydi? Ro'yxat qilib ber.", 'raqobatchilar');
  const t0 = Date.now();
  meta.delay = 1500;
  const r = await api('/api/chat', { token, body: { text: '(Marketolog haqida) Raqobatchilarni tahlil qil' } });
  ok("yordamchi darhol javob berdi (Meta AI javobini kutmadi) — «so'radim, javob Telegram'ga keladi»", r.status === 200 && Date.now() - t0 < 1500 && seenResults.at(-1)?.includes('"started":true'), `${Date.now() - t0} ms`);
  ok("Meta AI javobi suhbatga (Claude'ga) qaytmaydi", !seenResults.some(t => t.includes('@dent_city')));
  const ev1 = await reportCount(token, 1);
  meta.delay = 0;
  ok("savol meta.ai'ga to'liq ketdi (kontekst bilan), javob jurnalda", meta.asked.at(-1)?.includes('@shifo_dent') && ev1?.[0].title.startsWith('Raqobatchilar:') && ev1[0].body.includes('@smile_clinic_uz'));
  ok("Instagram ulanmagan — akkauntlar «tekshirilmadi» deb yozildi", ev1?.[0].body.includes('3 tasi tekshirilmadi'), ev1?.[0].body.slice(0, 160));
  ok("egasiga Telegram'da: Meta AI javobi va «xato bo'lishi mumkin»", await waitFor('telegram', () => { const m = toOwner(mark, 'Marketolog · Raqobatchilar'); return m && textOf(m).includes('@dent_city') && textOf(m).includes("xato bo'lishi mumkin") ? m : undefined; }));

  // Egasining Instagram'i (brauzer orqali) — Meta AI aytgan akkauntlar tekshiriladi
  igWeb.loggedIn = true;
  igWeb.users.add('dent_city');
  igWeb.users.add('smile_clinic_uz');
  await api('/api/instagram/login', { token, body: {} });
  ok('Instagram brauzer orqali ulandi', await until('instagram', async () => (await status(token)).instagram.account ?? undefined));
  mark = sent.length;
  ownerAsks('Raqobatchilarni yana bir bor tekshir', 'raqobatchilar');
  await api('/api/chat', { token, body: { text: 'Raqobatchilarni tekshir' } });
  const ev2 = await reportCount(token, 2);
  ok("akkauntlar Instagram'da tekshirildi: ikkitasi bor, Meta AI o'ylab topgani — «yo'q», hisobot boshida va diqqat belgisi bilan", ev2?.[0].body.startsWith("Akkauntlar: 2 tasi Instagram'da bor; Instagram'da yo'q (Meta AI xato aytgan): @soxta_klinika") && ev2[0].level === 'warn', ev2?.[0].body.slice(0, 160));
  ok("Instagram'da faqat profil so'raldi (Direct'ga hech narsa yozilmadi)", igWeb.paths.some(p => p.includes('/api/v1/users/web_profile_info/')) && !igWeb.typed.length);

  console.log('\n# Chegaralar');
  meta.delay = 3000;
  const before = meta.asked.length;
  ownerAsks('Kontent g\'oyalari: 7 kunlik reja', 'kontent', 4);
  await api('/api/chat', { token, body: { text: "To'rtta narsani so'ra" } });
  ok("navbatda 3 tadan ko'p savol turmaydi — to'rtinchisiga «navbatda» deyiladi", seenResults.some(t => t.includes('navbatda')));
  await reportCount(token, 5);
  meta.delay = 0;
  ok("uchta savol meta.ai'ga ketdi", meta.asked.length - before === 3, String(meta.asked.length - before));
  meta.fail = true;
  const usedBefore = (await status(token)).metaAi.usedToday;
  ownerAsks('Sayt ishlamay turganda savol', 'boshqa');
  await api('/api/chat', { token, body: { text: "So'ra" } });
  const failed = await reportCount(token, 6);
  const afterFail = (await status(token)).metaAi;
  meta.fail = false;
  ok("sayt xatosi: hisobotda «bajarilmadi», kunlik hisob qaytdi, «qayta kiring» deyilmadi", failed?.[0].title.startsWith('Bajarilmadi') && afterFail.usedToday === usedBefore && !afterFail.problem, JSON.stringify(afterFail));
  ownerAsks('Yana bitta savol: hashteglar', 'boshqa');
  await api('/api/chat', { token, body: { text: "Yana so'ra" } });
  await reportCount(token, 7);
  const used = (await status(token)).metaAi;
  ok(`kunlik chegara: ${used.usedToday}/${used.dailyLimit} — oshgach meta.ai'ga bormaydi`, used.usedToday === 6 && await (async () => {
    const n = meta.asked.length;
    ownerAsks('Limitdan keyingi savol', 'boshqa');
    await api('/api/chat', { token, body: { text: "Yana so'ra" } });
    return meta.asked.length === n && seenResults.at(-1)?.includes('ertagacha');
  })(), JSON.stringify(used));

  console.log('\n# Jadval: Marketologga topshiriq');
  const created = await api('/api/orders', { token, body: { member: 'marketolog', text: "Har dushanba 10:00 da Instagram'dagi raqobatchilarimiz tahlilini yubor", spec: { kind: 'schedule', at: '10:00', days: [1] }, summary: "Har dushanba 10:00 da raqobatchilar tahlilini Telegram'ga yuboraman." } });
  ok('Marketologga jadvalli topshiriq saqlandi', created.status === 200 && created.json.order?.member === 'marketolog', JSON.stringify(created.json).slice(0, 200));
  let scheduledPrompt = '';
  ai.owner = messages => {
    const first = messages[0];
    scheduledPrompt = typeof first?.content === 'string' ? first.content : (first?.content as Block[]).map(b => b.text ?? '').join('');
    return { content: [{ type: 'text', text: "Jadval bo'yicha: Meta AI chegarasi tugagan, ertaga yuboraman." }], stop: 'end_turn' };
  };
  mark = sent.length;
  const evBefore = (await reports(token)).length;
  const ran = await api(`/api/orders/${created.json.order.id}/run`, { token, body: {} });
  ok("«Sinab ko'rish»: Marketolog nomidan bajarildi, natija Telegram'ga, jurnalda ikkinchi yozuv yo'q", ran.status === 200 && scheduledPrompt.includes('Marketolog uchun') && await waitFor('telegram', () => toOwner(mark, 'Jadval bo'))
    && (await reports(token)).length === evBefore, scheduledPrompt.slice(0, 120));

  console.log("\n# meta.ai qayta kirishni so'radi");
  await api('/api/meta-ai', { method: 'DELETE', token });
  meta.loggedIn = true;
  await api('/api/meta-ai/login', { token, body: {} });
  await until('qayta ulandi', async () => { const s = await status(token); return s.metaAi.connected && !s.metaAi.waiting ? s : undefined; });
  meta.sessionValid = false;
  mark = sent.length;
  ownerAsks('Akkauntimizni tahlil qil', 'akkaunt');
  await api('/api/chat', { token, body: { text: 'Akkauntni tahlil qil' } });
  const s = await until('qayta kirish', async () => { const x = (await status(token)).metaAi; return x.relogin ? x : undefined; });
  ok("to'xtadi: panelda «qayta kirish» va sababi, egasiga Telegram'da", /qayta kirish/i.test(s?.problem ?? '') && await waitFor('ogohlantirish', () => toOwner(mark, 'Marketolog Meta AI')), JSON.stringify(s));
  const n = meta.asked.length;
  ownerAsks('Yana bir savol: kontent rejasi', 'boshqa');
  await api('/api/chat', { token, body: { text: "Yana so'ra" } });
  ok("muammo turganda meta.ai'ga bormaydi, yordamchi «Ulash»ga yo'naltiradi", meta.asked.length === n && seenResults.at(-1)?.includes('Ulash'), seenResults.at(-1));

  console.log('\n# Uzish');
  const wipedBefore = meta.wiped;
  const off = await api('/api/meta-ai', { method: 'DELETE', token });
  ok("uzildi: panelda ulanmagan, brauzer profili o'chirildi", off.json.status.metaAi.connected === false && meta.wiped === wipedBefore + 1);
  ok("serverda kutilmagan xato yo'q", !/\[asbob\]|\[marketolog\]|Ichki xato|TypeError|ReferenceError/.test(log), log.split('\n').filter(l => /\[asbob\]|\[marketolog\]|TypeError|ReferenceError/.test(l)).slice(0, 3).join(' | '));
} catch (e) {
  ok(`kutilmagan xato: ${(e as Error).stack}`, false);
} finally {
  ai.owner = null;
  await stopProcess(proc);
  for (const srv of [tgServer, aiServer, metaServer, igWebServer]) srv.close();
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter(x => !x).length;
console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi (${results.length} tadan)` : `\n✓ hammasi o'tdi (${results.length})`);
if (failed) console.log(log.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
