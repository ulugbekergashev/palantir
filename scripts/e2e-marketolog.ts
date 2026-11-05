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
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jpegSize } from '../server/marketing/image';
import { handlesIn } from '../server/marketing/tools';
import { OWNER, ai, aiServer, igWeb, igWebServer, json, listen, press, readBody, say, sent, sleep, tgServer, waitFor, type Sent, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

console.log('\n# Javobdagi akkauntlar (sof)');
const found = handlesIn("Raqobatchilar: @dent_city, @Smile.Clinic. va yana @dent_city; yozing: info@clinic.uz, @a (juda qisqa)");
ok("@akkauntlar topiladi: takrorsiz, kichik harfda, oxiridagi nuqtasiz; email va bitta harf — yo'q", JSON.stringify(found) === JSON.stringify(['dent_city', 'smile.clinic']), JSON.stringify(found));

/** Sinov suratlari (ffmpeg chizadi): telefondagidek 3:4 va Meta AI kabi kvadrat */
const testPng = (size: string) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], { maxBuffer: 20e6 }).stdout as Buffer;
const TALL_PNG = testPng('900x1200'), SQUARE_PNG = testPng('1024x1024');

// ─── Soxta meta.ai ────────────────────────────────────────────────────────────
const meta = {
  loggedIn: false, sessionValid: true, attached: 0, wiped: 0,
  /** Javob shuncha kechikadi (navbat sinovi); fail — sayt xatosi (500) */
  delay: 0, fail: false,
  asked: [] as string[],
  /** Rasm so'rovlari (Meta AI chizadi) */
  images: [] as string[],
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
    case '/image':
      if (!meta.sessionValid) return json(res, { error: 'login' }, 401);
      meta.images.push(String(body.prompt));
      return json(res, { base64: SQUARE_PNG.toString('base64') });
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
    META_AI_FAKE_URL: `http://127.0.0.1:${metaPort}`, META_AI_DAILY_LIMIT: '8',
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
/** Yordamchi: berilgan asbobni bir marta chaqiradi, keyin bir gap */
const ownerCalls = (name: string, input: Record<string, unknown>) => {
  ai.owner = messages => {
    const r = lastResults(messages);
    if (r.length) { seenResults.push(...r.map(resultText)); return { content: [{ type: 'text', text: `Marketolog: ${resultText(r[0]).slice(0, 200)}` }], stop: 'end_turn' }; }
    return { content: [{ type: 'tool_use', id: `tu_${Date.now()}`, name, input }], stop: 'tool_use' };
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
  // Jamoa «+» bilan olinadi: Meta AI ulangani — Marketolog ishlatilyapti, o'zi jamoaga qo'shildi
  ok("Meta AI ulandi → Marketolog jamoada, bosh ekranda", day.members?.some((m: { member: string }) => m.member === 'marketolog'), JSON.stringify(day.members?.map((m: { member: string }) => m.member)));

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

  console.log('\n# Instagram postlari (Kontent-meyker): qoralama → tasdiq → Instagram');
  mark = sent.length;
  const caption = "Tabassumingiz — bizning g'ururimiz! 😊\nBirinchi konsultatsiya bepul.\nDirect'ga yozing.\n#stomatologiya #toshkent";
  const draft = await api('/api/posts', { token, body: { caption, image: `data:image/png;base64,${TALL_PNG.toString('base64')}` } });
  ok("panel: o'z suratidan qoralama — holati «tasdiq kutyapti»", draft.status === 200 && draft.json.post?.status === 'draft' && draft.json.post.source === 'photo', JSON.stringify(draft.json).slice(0, 160));
  const imgRes = await fetch(`${base}/api/posts/${draft.json.post?.id}/image`, { headers: { authorization: `Bearer ${token}` } });
  const size = jpegSize(Buffer.from(await imgRes.arrayBuffer()));
  ok("rasm Instagram o'lchamiga keltirildi: JPEG, 3:4 surat 4:5 gacha kesildi", imgRes.status === 200 && !!size && size.width / size.height >= 0.8 && size.width <= 1080, JSON.stringify(size));
  const cardOf = (m: number, id: string) => sent.slice(m).find(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER && JSON.stringify(s.params.reply_markup ?? '').includes(`gp|${id}`));
  ok("egasiga Telegram'da: rasm, matn va «Instagram'ga joylash» tugmasi — Kontent-meyker nomidan", await waitFor('karta', () => { const c = cardOf(mark, draft.json.post?.id); return c && textOf(c).includes('Birinchi konsultatsiya') && textOf(c).includes('Kontent-meyker') ? c : undefined; }));
  ok("hali hech narsa joylanmagan (egasi bosmaguncha)", !igWeb.uploads.length && !igWeb.posted.length);
  const tooMany = await api('/api/posts', { token, body: { caption: Array.from({ length: 31 }, (_, i) => `#teg${i}`).join(' '), image: `data:image/png;base64,${TALL_PNG.toString('base64')}` } });
  ok("31 ta heshteg — rad (Instagram chegarasi)", tooMany.status === 409 && /30 tadan/.test(tooMany.json.error), tooMany.json.error);
  const warned = await api('/api/posts', { token, body: { caption: "Og'riqsiz davolash, 100% kafolat!", image: `data:image/png;base64,${TALL_PNG.toString('base64')}` } });
  const list1 = (await api('/api/posts', { token })).json.posts as { id: string; warnings: string[] }[];
  ok("klinika: «kafolat», «og'riqsiz» — reklama filtri ogohlantiradi", list1.find(p => p.id === warned.json.post?.id)?.warnings.length, JSON.stringify(list1.find(p => p.id === warned.json.post?.id)?.warnings));
  const cancelled = await api(`/api/posts/${warned.json.post?.id}`, { method: 'DELETE', token });
  ok("qoralama bekor qilindi — ro'yxatdan chiqdi", cancelled.status === 200 && !cancelled.json.posts.some((p: { id: string }) => p.id === warned.json.post?.id));
  const written = await api('/api/posts/caption', { token, body: { topic: "implant bo'yicha bepul konsultatsiya" } });
  ok("«Kontent-meyker yozsin»: post matni tayyor (egasi tahrir qiladi)", written.status === 200 && String(written.json.caption ?? '').trim().length > 0, String(written.json.caption ?? written.json.error).slice(0, 80));
  mark = sent.length;
  const pub = await api(`/api/posts/${draft.json.post?.id}/publish`, { token, body: {} });
  const published = pub.json.posts?.find((p: { id: string }) => p.id === draft.json.post?.id);
  ok("«Instagram'ga joylash»: rasm yuklandi (o'lchami bilan), post matni bilan yaratildi, havolasi bor", pub.status === 200 && published?.status === 'published' && published.url === 'https://www.instagram.com/p/POST1/'
    && igWeb.uploads.length === 1 && Number(igWeb.uploads[0].params.upload_media_width) === size?.width && igWeb.posted[0]?.caption === caption, JSON.stringify(pub.json).slice(0, 200));
  const timeline = (await api('/api/team/day', { token })).json.timeline as { member: string; title: string }[] | undefined;
  ok("egasiga «joylandi»; «Bugun jamoa» lentasida — Kontent-meyker nomidan (Marketolog tadqiqotlariga aralashmaydi)", await waitFor('joylandi', () => toOwner(mark, "Instagram'ga joylandi"))
    && timeline?.some(e => e.member === 'kontent' && e.title.startsWith("Instagram'ga joylandi")) && !(await reports(token)).some(e => e.title.startsWith("Instagram'ga joylandi")), JSON.stringify(timeline?.slice(0, 3)));
  const again = await api(`/api/posts/${draft.json.post?.id}/publish`, { token, body: {} });
  ok("ikkinchi bosish — ikki marta joylanmaydi", again.status === 409 && igWeb.posted.length === 1, again.json.error);

  // Telegram kartasi o'sha matnga bog'langan: panelda matn o'zgarsa — eski tugma joylamaydi, yangi karta keladi
  const second = (await api('/api/posts', { token, body: { caption: 'Birinchi matn #toshkent', image: `data:image/png;base64,${TALL_PNG.toString('base64')}` } })).json.post;
  const oldCard = await waitFor('karta 2', () => cardOf(0, second.id));
  mark = sent.length;
  const edited = await api(`/api/posts/${second.id}`, { method: 'PATCH', token, body: { caption: 'Tuzatilgan matn #toshkent' } });
  ok("matn o'zgardi → Telegram'ga yangi karta (yangi matn bilan)", edited.status === 200 && await waitFor('yangi karta', () => { const c = cardOf(mark, second.id); return c && textOf(c).includes('Tuzatilgan') ? c : undefined; }));
  const oldData = JSON.stringify(oldCard?.params.reply_markup ?? '').match(/gp\|[a-z0-9]+\|[0-9a-f]+/)?.[0] ?? '';
  mark = sent.length;
  press(OWNER, oldData, Number(oldCard?.id ?? 0));
  ok("eski kartadagi «Joylash» — joylanmaydi, «matn o'zgargan» deyiladi", await waitFor('rad', () => toOwner(mark, "matni o'zgargan")) && igWeb.posted.length === 1, oldData);

  // Instagram post yaratish so'roviga javob bermadi: post chiqqan bo'lishi mumkin — «noma'lum», tasdiqsiz qayta joylanmaydi
  igWeb.configureFails = true;
  const unsure = await api(`/api/posts/${second.id}/publish`, { token, body: {} });
  igWeb.configureFails = false;
  const afterUnsure = (await api('/api/posts', { token })).json.posts.find((x: { id: string }) => x.id === second.id);
  ok("natija noma'lum — holati «unknown», «Instagram'da tekshiring»", unsure.status === 409 && afterUnsure?.status === 'unknown' && /tekshiring/.test(unsure.json.error), unsure.json.error);
  const noConfirm = await api(`/api/posts/${second.id}/publish`, { token, body: {} });
  ok("tasdiqsiz qayta joylanmaydi (ikki nusxa chiqmasin)", noConfirm.status === 409 && /noma'lum/.test(noConfirm.json.error), noConfirm.json.error);
  const confirmed = await api(`/api/posts/${second.id}/publish`, { token, body: { confirm: true } });
  ok("egasi tekshirib tasdiqladi — joylandi", confirmed.status === 200 && confirmed.json.posts.find((x: { id: string }) => x.id === second.id)?.status === 'published' && igWeb.posted.at(-1)?.caption === 'Tuzatilgan matn #toshkent');

  // Kontent-meyker o'zi tayyorlaydi (Yordamchi orqali): matnni yozadi, rasmni Meta AI chizadi (fonda) → Telegram kartasi → egasi bosadi
  mark = sent.length;
  ownerCalls('draft_post', { caption: "Yangi tishlar — yangi kayfiyat ✨\nImplant bo'yicha bepul maslahat.\n#implant #toshkent", image_description: "yorug' stomatologiya kabineti, shifokor bemorga tabassum bilan tushuntiryapti, oq va havorang" });
  await api('/api/chat', { token, body: { text: "Ertaga uchun implant haqida post tayyorla" } });
  ok("yordamchi: «Meta AI chizyapti, qoralama Telegram'ga keladi»", seenResults.at(-1)?.includes('"started":true'), seenResults.at(-1));
  const metaCard = await waitFor('Meta AI kartasi', () => sent.slice(mark).find(s => s.method === 'sendPhoto' && Number(s.params.chat_id) === OWNER && textOf(s).includes('rasm — Meta AI')));
  ok("Meta AI rasm chizdi (tavsif bilan, rasmda yozuvsiz) → qoralama kartasi Telegram'da", !!metaCard && meta.images.at(-1)?.includes("shifokor bemorga") && meta.images.at(-1)?.includes('без текста'));
  const gp = JSON.stringify(metaCard?.params.reply_markup ?? '').match(/gp\|[a-z0-9]+\|[0-9a-f]+/)?.[0];
  press(OWNER, gp ?? 'gp|x', Number(metaCard?.id ?? 0));
  ok("egasi Telegram'da «Joylash»ni bosdi → Instagram'ga chiqdi", await until('joylandi', async () => igWeb.posted.length === 3 || undefined) && igWeb.posted[2].caption.includes('Implant'));

  console.log("\n# Natijalar (Marketolog o'lchaydi)");
  const res1 = await api('/api/results/refresh', { token, body: {} });
  const igItems = (res1.json.items ?? []).filter((i: { kind: string }) => i.kind === 'instagram') as { likes: number; comments: number; url: string }[];
  ok("«Yangilash»: joylangan Instagram postlari layk va izohlari bilan (egasining profil sahifasidan); kanal ulanmagan — aytiladi",
    res1.status === 200 && igItems.length === 3 && igItems.find(i => i.url.endsWith('/POST1/'))?.likes === 10 && igItems.find(i => i.url.endsWith('/POST3/'))?.comments === 2
    && res1.json.measured?.instagram === 3 && /ulanmagan/.test(String(res1.json.measured?.telegram)) && igWeb.paths.includes('GET /api/v1/users/web_profile_info/'), JSON.stringify(res1.json).slice(0, 300));
  const res2 = await api('/api/results/refresh', { token, body: {} });
  ok("yarim soat ichida qayta o'lchanmaydi (Instagram'ga ortiqcha so'rov ketmasin), ko'rish — bo'ladi", res2.status === 409 && (await api('/api/results', { token })).json.items?.length === 3, res2.json.error);

  console.log('\n# Jonli tekshiruv (server/live/check.ts)');
  type Lc = { key: string; level: string; detail: string };
  const byKey = (list: Lc[], key: string) => list.find(c => c.key === key);
  igWeb.users.add('mebel_uyi');
  const probesBefore = ai.liveProbes, askedBefore = meta.asked.length, postedBefore = igWeb.posted.length;
  mark = sent.length;
  const qc = (await api('/api/live-check', { token, body: {} })).json.checks as Lc[];
  ok('egasi panelda tekshirdi: bot egasiga yetadi, AI javob berdi, disk', byKey(qc, 'telegram_bot')?.level === 'ok' && byKey(qc, 'ai')?.level === 'ok' && ai.liveProbes === probesBefore + 1 && byKey(qc, 'disk')?.level === 'ok',
    JSON.stringify(qc.filter(c => ['telegram_bot', 'ai', 'disk'].includes(c.key))));
  ok("Instagram seansi tirik (o'z profili so'raldi), post joylashga tayyor — post joylanmadi",
    byKey(qc, 'instagram')?.level === 'ok' && byKey(qc, 'post')?.level === 'ok' && igWeb.posted.length === postedBefore && igWeb.paths.includes('GET /api/v1/users/web_profile_info/'),
    JSON.stringify([byKey(qc, 'instagram'), byKey(qc, 'post')]));
  ok("tezkor tekshiruvda Meta AI'ga savol berilmaydi; ulanmaganlar — «ulanmagan»",
    byKey(qc, 'meta_ai')?.level === 'ok' && meta.asked.length === askedBefore && byKey(qc, 'crm')?.level === 'off' && byKey(qc, 'hub')?.level === 'off', JSON.stringify([byKey(qc, 'meta_ai'), byKey(qc, 'crm')]));
  ok("egasiga xabar ketmadi — faqat ko'rinmas «yozmoqda…»",
    !sent.slice(mark).some(s => ['sendMessage', 'sendPhoto'].includes(s.method)) && sent.slice(mark).some(s => s.method === 'sendChatAction' && Number(s.params.chat_id) === OWNER));
  const aiAgain = (await api('/api/live-check', { token, body: { only: ['ai'] } })).json.checks as Lc[];
  ok("qayta bosilsa Claude'ga yana so'rov ketmaydi (bir daqiqa eslab qolinadi — kunlik chegara yeyilmaydi)", byKey(aiAgain, 'ai')?.level === 'ok' && ai.liveProbes === probesBefore + 1, String(ai.liveProbes - probesBefore));
  const dc = (await api('/api/live-check', { token, body: { deep: true, only: ['meta_ai'] } })).json.checks as Lc[];
  ok("chuqur tekshiruv: faqat tanlangan kanal, Meta AI'ga bitta savol berildi", dc.length === 1 && dc[0].key === 'meta_ai' && dc[0].level === 'ok' && meta.asked.length === askedBefore + 1, JSON.stringify(dc));
  const adminToken = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  const viaAdmin = await api('/api/admin/live-check', { token: adminToken, body: { only: ['telegram'] } });
  ok("o'rnatuvchi (npm run live) administrator kirishi bilan bizneslarni tekshiradi",
    viaAdmin.status === 200 && viaAdmin.json.businesses?.[0]?.name === 'Shifo Dent' && (viaAdmin.json.businesses[0].checks as Lc[]).every(c => c.key.startsWith('telegram')), JSON.stringify(viaAdmin.json).slice(0, 200));
  const wrong = await api('/api/live-check', { token, body: { only: ['nimadir'] } });
  const noAuth = await api('/api/admin/live-check', { token, body: {} });
  ok("noto'g'ri kanal — 400; egasining kirishi bilan admin yo'li yopiq", wrong.status === 400 && noAuth.status === 401, `${wrong.status} ${noAuth.status}`);

  console.log('\n# Chegaralar');
  meta.delay = 3000;
  const before = meta.asked.length;
  ownerAsks('Kontent g\'oyalari: 7 kunlik reja', 'kontent', 4);
  await api('/api/chat', { token, body: { text: "To'rtta narsani so'ra" } });
  ok("navbatda 3 tadan ko'p savol turmaydi — to'rtinchisiga «navbatda» deyiladi", seenResults.some(t => t.includes('navbatda')));
  // Jurnalda faqat tadqiqotlar (Instagram'ga joylash — Kontent-meyker yozuvi): 2 + 3 ta savol
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
  ok(`kunlik chegara: ${used.usedToday}/${used.dailyLimit} — oshgach meta.ai'ga bormaydi`, used.usedToday === 8 && await (async () => {
    const n = meta.asked.length;
    ownerAsks('Limitdan keyingi savol', 'boshqa');
    await api('/api/chat', { token, body: { text: "Yana so'ra" } });
    return meta.asked.length === n && seenResults.at(-1)?.includes('ertagacha');
  })(), JSON.stringify(used));
  const askedAtLimit = meta.asked.length;
  const atLimit = (await api('/api/live-check', { token, body: { deep: true, only: ['meta_ai'] } })).json.checks as Lc[];
  ok("chegara tugaganda chuqur tekshiruv savol bermaydi va kanalni «ishlamayapti» demaydi", atLimit[0]?.level === 'warn' && meta.asked.length === askedAtLimit, JSON.stringify(atLimit));

  console.log('\n# Jadval: Marketologga topshiriq');
  const created = await api('/api/orders', { token, body: { member: 'marketolog', text: "Har dushanba 10:00 da Instagram'dagi raqobatchilarimiz tahlilini yubor", spec: { kind: 'schedule', at: '10:00', days: [1] }, summary: "Har dushanba 10:00 da raqobatchilar tahlilini Telegram'ga yuboraman." } });
  ok('Marketologga jadvalli topshiriq saqlandi', created.status === 200 && created.json.order?.member === 'marketolog', JSON.stringify(created.json).slice(0, 200));
  let scheduledPrompt = '';
  ai.owner = messages => {
    const first = messages[0];
    scheduledPrompt = typeof first?.content === 'string' ? first.content : ((first?.content ?? []) as Block[]).map(b => b.text ?? '').join('');
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
  const noPainter = (await api('/api/posts', { token })).json.picture;
  ownerCalls('draft_post', { caption: 'Yangi post matni #toshkent', image_description: "yorug' kabinet, oq va havorang ranglar" });
  await api('/api/chat', { token, body: { text: 'Instagram uchun post tayyorla' } });
  const drew = await api('/api/posts/draw', { token, body: { caption: 'Yangi post matni #toshkent', description: "yorug' kabinet, oq va havorang ranglar" } });
  ok("Meta AI ham, Gemini kaliti ham yo'q — rasm chizadigan yo'q: asbob ham, panel ham ochiq aytadi (o'z surati bilan bo'ladi)",
    noPainter === null && seenResults.at(-1)?.includes("o'z suratini") && drew.status === 409 && /o'z suratingizni/.test(drew.json.error), `${noPainter} · ${drew.json.error}`);
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
