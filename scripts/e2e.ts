/**
 * To'liq oqim sinovi — haqiqiy token va pulsiz:
 *   soxta Telegram, soxta Claude (asbob chaqiradi, tarixni tekshiradi), soxta ovoz xizmati;
 *   server — alohida jarayon, vaqtinchalik bazada.
 * Ishga tushirish: npm test
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Business } from '../src/types';
import { iso, stamp } from '../src/lib/week';
import {
  CHANNEL, CUSTOMER, IG_ACCOUNT, OWNER, TG_SESSION, VOICE_BYTES, addedToChannel, ai, aiServer, ig, igServer, listen, press, say, sendVoice, sent,
  shareContact, sleep, stt, sttServer, tgServer, tgUser, tgUserServer, waitFor, type Sent,
} from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};

const tgPort = await listen(tgServer);
const aiPort = await listen(aiServer);
const sttPort = await listen(sttServer);
const tgUserPort = await listen(tgUserServer);
const igPort = await listen(igServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-e2e-'));
const PORT = 3290;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
    GEMINI_API_KEY: 'g-test', GROQ_API_KEY: 'q-test', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, GROQ_STT_URL: `http://127.0.0.1:${sttPort}/groq`,
    MORNING_HOUR: String(new Date().getHours()), WEB_SEARCH: '1', SESSION_SECRET: 'e2e-secret',
    INBOX_DEBOUNCE_MS: '300', MINUTE_MS: '1500', TG_USER_FAKE_URL: `http://127.0.0.1:${tgUserPort}`,
    IG_APP_ID: 'ig-app', IG_APP_SECRET: 'ig-secret', IG_WEBHOOK_VERIFY_TOKEN: 'verify-me', PUBLIC_URL: 'https://cerebro.test',
    IG_GRAPH_URL: `http://127.0.0.1:${igPort}`, IG_TOKEN_URL: `http://127.0.0.1:${igPort}/oauth/access_token`, IG_OAUTH_URL: 'https://www.instagram.com/oauth/authorize', IG_POLL_MS: '700',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const base = `http://127.0.0.1:${PORT}`;
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
/** mark dan keyin chatga ketgan xabar (matni yoki izohi bo'yicha) */
const after = (mark: number, chat: number, pred: (s: Sent) => boolean) => sent.slice(mark).find(s => Number(s.params.chat_id) === chat && pred(s));
const textOf = (s: Sent) => String(s.params.text ?? s.params.caption ?? '');
const has = (needle: string) => (s: Sent) => textOf(s).includes(needle);
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali ishga tushmadi */ } await sleep(250); }

  console.log('\n# Admin va kirish');
  ok("admin: noto'g'ri parol — 401", (await api('/api/admin/login', { body: { password: 'xato' } })).status === 401);
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  ok('admin: kirdi', !!admin);
  const created = await api('/api/admin/businesses', { token: admin, body: { name: 'Mebel Uyi', industry: "mebel do'koni", login: 'Mebel', password: 'secret12' } });
  ok('admin: biznes yaratildi', created.status === 200, created.json.id);
  ok('admin: band login — 409', (await api('/api/admin/businesses', { token: admin, body: { name: 'X', login: 'mebel', password: 'secret12' } })).status === 409);
  await api('/api/admin/businesses', { token: admin, body: { name: 'Boshqa', login: 'boshqa', password: 'secret34' } });
  const list = (await api('/api/admin/businesses', { token: admin })).json.businesses;
  ok("admin: ro'yxatda 2 ta biznes", list?.length === 2);

  ok('kabinet: tokensiz — 401', (await api('/api/me')).status === 401);
  ok("kabinet: noto'g'ri parol — 401", (await api('/api/login', { body: { login: 'mebel', password: 'x' } })).status === 401);
  const token = (await api('/api/login', { body: { login: 'mebel', password: 'secret12' } })).json.token;
  const otherToken = (await api('/api/login', { body: { login: 'boshqa', password: 'secret34' } })).json.token;
  ok('kabinet: ikkala biznes kirdi', !!token && !!otherToken);

  console.log('\n# Profil');
  const profile: Business = {
    name: 'Mebel Uyi', ownerName: 'Aziz', industry: "mebel do'koni", description: 'Uy va ofis mebeli, buyurtma asosida',
    phone: '+998 90 000 00 00', address: "Toshkent, Chilonzor", hours: 'Du–Sh 9:00–19:00', contentLang: 'uz', morningBrief: true,
    brand: { primary: '#1D4ED8', accent: '#F59E0B' },
    offerings: [{ id: 'o1', name: 'Stol', price: 1_500_000 }, { id: 'o2', name: 'Shkaf', price: 0 }],
    team: [{ id: 'm1', name: 'Jasur Aliyev', role: 'Sotuvchi', years: 5 }],
  };
  const badProfile = await api('/api/business', { method: 'PUT', token, body: { ...profile, brand: { primary: 'red', accent: '#000000' } } });
  ok("profil: noto'g'ri rang — 400", badProfile.status === 400, badProfile.json.details?.[0]);
  ok('profil: saqlandi', (await api('/api/business', { method: 'PUT', token, body: profile })).status === 200);
  const me = (await api('/api/me', { token })).json;
  ok('holat: bot, AI, ovoz yoqilgan; egasi hali ulanmagan', me.status.bot === 'cerebro_test_bot' && me.status.ai && me.status.voice && !me.status.ownerLinked);
  const bizId = created.json.id as string;
  ok('holat: mijozlar havolasi', me.status.generalLink === `https://t.me/cerebro_test_bot?start=l-${bizId}`);

  console.log('\n# Vazifalar (panel)');
  const today = iso(new Date());
  ok("vazifa: noto'g'ri muddat — 400", (await api('/api/tasks', { token, body: { title: 'X', dueAt: 'ertaga' } })).status === 400);
  const todayTask = (await api('/api/tasks', { token, body: { title: 'Hisobotni topshirish', dueAt: `${today}T23:59` } })).json.task;
  ok("vazifa: qo'shildi", todayTask?.dueAt === `${today}T23:59`);

  console.log('\n# Telegram: egasi ulanadi, ertalabki xulosa');
  let mark = sent.length;
  const code = String(me.status.linkUrl).split('start=o-')[1];
  say(OWNER, `/start o-${code}`);
  ok('ulandi: salom xabari', await waitFor('ulanish', () => after(mark, OWNER, has('Ulandi'))));
  ok('panelda: egasi ulangan', (await api('/api/me', { token })).json.status.ownerLinked);
  const brief = await waitFor('xulosa', () => after(mark, OWNER, has('Xayrli tong')));
  ok('ertalabki xulosa: bugungi vazifa bilan', brief && textOf(brief).includes('Hisobotni topshirish'));

  console.log('\n# Yordamchi: eslatma');
  mark = sent.length;
  say(OWNER, 'Ertaga soat 10 da bankka borishni eslat');
  ok('javob keldi', await waitFor('javob', () => after(mark, OWNER, has('Bajarildi'))));
  const tomorrow = iso(new Date(Date.now() + 86_400_000));
  const tasksNow = (await api('/api/tasks?status=open', { token })).json.tasks as { title: string; dueAt: string }[];
  ok('vazifa yaratildi: ertaga 10:00', tasksNow.some(t => t.title === 'Bankka borish' && t.dueAt === `${tomorrow}T10:00`));
  const req1 = ai.requests.find(r => JSON.stringify(r.messages).includes('bankka'))!;
  ok("Claude'ga: biznes profili tizim ko'rsatmasida", req1?.system.includes('Mebel Uyi') && req1.system.includes("mebel do'koni") && req1.system.includes('Stol: 1500000'));
  ok("Claude'ga: joriy vaqt xabar boshida", /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}, \w+ · Telegram\]/.test(String(req1?.messages.at(-1)?.content)));
  ok("Claude'ga: asboblar, internet qidiruvi, zaxira model, adaptive fikrlash",
    req1?.tools.some(t => t.name === 'create_task') && req1.tools.some(t => t.type === 'web_search_20260209')
    && req1.beta.includes('server-side-fallback-2026-07-01') && (req1.thinking as { type: string })?.type === 'adaptive');

  console.log('\n# Eslatma vaqti keldi');
  mark = sent.length;
  const dueNow = stamp(new Date(Date.now() - 60_000));
  const rt = (await api('/api/tasks', { token, body: { title: "Yetkazib beruvchiga qo'ng'iroq", dueAt: dueNow } })).json.task;
  const reminder = await waitFor('eslatma', () => after(mark, OWNER, has("Yetkazib beruvchiga qo'ng'iroq")));
  ok('eslatma keldi: tugmalar bilan', buttons(reminder).some(b => b.callback_data === `td|${rt.id}`) && buttons(reminder).some(b => b.callback_data === `ts|${rt.id}`));
  mark = sent.length;
  press(OWNER, `ts|${rt.id}`, reminder!.id!, textOf(reminder!));
  await waitFor('keyinroq', () => after(mark, OWNER, s => s.method === 'editMessageText'));
  const snoozed = ((await api('/api/tasks?status=open', { token })).json.tasks as { id: string; dueAt: string }[]).find(t => t.id === rt.id);
  ok('«1 soatdan keyin»: muddat surildi', !!snoozed && snoozed.dueAt > stamp(new Date(Date.now() + 50 * 60_000)));
  mark = sent.length;
  press(OWNER, `td|${rt.id}`, reminder!.id!, textOf(reminder!));
  await waitFor('bajarildi', () => after(mark, OWNER, s => s.method === 'editMessageText' && textOf(s).includes('Bajarildi')));
  ok('«Bajarildi»: holat done', ((await api('/api/tasks?status=done', { token })).json.tasks as { id: string }[]).some(t => t.id === rt.id));

  console.log("\n# Yordamchi: mijoz qo'shish");
  mark = sent.length;
  say(OWNER, "Yangi mijoz qo'sh: Aziz Karimov, +998 90 123 45 67, 2 ta stol so'radi");
  await waitFor('javob', () => after(mark, OWNER, has('Bajarildi')));
  let leads = (await api('/api/leads', { token })).json.leads as { id: string; name: string; phone: string; reachable: boolean; stage: string }[];
  ok('mijoz saqlandi', leads.some(l => l.name === 'Aziz Karimov' && l.phone === '+998901234567' && !l.reachable));

  console.log('\n# Mijoz havola orqali keladi');
  mark = sent.length;
  say(CUSTOMER, `/start l-${bizId}`);
  const greet = await waitFor('mijozga salom', () => after(mark, CUSTOMER, has('Mebel Uyi')));
  ok('mijozga: raqam so\'raldi', JSON.stringify(greet?.params.reply_markup ?? '').includes('request_contact'));
  shareContact(CUSTOMER, '998911112233');
  const newLead = await waitFor('egasiga yangi mijoz', () => after(mark, OWNER, has('Yangi mijoz')));
  ok('egasiga: yangi mijoz raqami bilan', newLead && textOf(newLead).includes('+998911112233'));
  mark = sent.length;
  say(CUSTOMER, 'Stol narxi qancha?');
  const question = await waitFor('savol egasiga', () => after(mark, OWNER, has('Stol narxi qancha?')));
  ok('mijoz savoli egasiga yetdi', !!question);
  ok('mijozga: «yetkazildi» javobi', await waitFor('yetkazildi', () => after(mark, CUSTOMER, has('yetkazildi'))));
  mark = sent.length;
  say(OWNER, "1 500 000 so'm, yetkazib berish bepul", question!.id);
  ok('egasining javobi mijozga ketdi', await waitFor('javob mijozga', () => after(mark, CUSTOMER, has("1 500 000 so'm"))));
  await waitFor('tasdiq', () => after(mark, OWNER, has('yuborildi')));
  leads = (await api('/api/leads', { token })).json.leads;
  ok("mijoz holati: «bog'lanildi»", leads.some(l => l.phone === '+998911112233' && l.reachable && l.stage === 'contacted'));

  mark = sent.length;
  say(OWNER, 'Bu sekin ish');
  await sleep(300);
  const t0 = Date.now();
  say(CUSTOMER, 'Yetkazib berasizmi?');
  const fast = await waitFor('AI kutayotganda mijoz', () => after(mark, OWNER, has('Yetkazib berasizmi?')));
  const waited = Date.now() - t0;
  ok("AI o'ylayotganda ham bot boshqa xabarlarni kutdirmaydi", fast && waited < 2000 && !after(mark, OWNER, has('Tushundim')), `${waited} ms`);
  await waitFor('sekin javob', () => after(mark, OWNER, has('Tushundim')));

  console.log('\n# Yordamchi: mijozlarga xabar (tasdiq bilan)');
  mark = sent.length;
  say(OWNER, 'Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla');
  const draft = await waitFor('qoralama', () => after(mark, OWNER, has('Mijozlarga xabar')));
  const sendBtn = buttons(draft).find(b => b.callback_data?.startsWith('fs|'));
  ok('qoralama: «Yuborish (1)» tugmasi', sendBtn?.text.includes('(1)'));
  ok("qoralama: qo'ng'iroq qilinadiganlar ro'yxati", draft && textOf(draft).includes('Aziz Karimov'));
  ok('tasdiqsiz hech narsa ketmadi', !after(mark, CUSTOMER, has('rahmat')));
  mark = sent.length;
  press(OWNER, sendBtn!.callback_data!, draft!.id!);
  ok('«Yuborish»: mijozga yetdi', await waitFor('xabar mijozga', () => after(mark, CUSTOMER, has('tanlaganingiz uchun rahmat'))));
  await waitFor('holat', () => after(mark, OWNER, s => s.method === 'editMessageText' && textOf(s).includes('Yuborildi: 1')));
  const fu = (await api('/api/followups', { token })).json.followups[0];
  ok('holat: yuborildi (1 ta)', fu?.status === 'sent' && fu.sentCount === 1);
  mark = sent.length;
  press(OWNER, sendBtn!.callback_data!, draft!.id!);
  const again = await waitFor('qayta bosish', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery'));
  ok('ikkinchi bosish: qayta yuborilmaydi', String(again?.params.text).includes('Allaqachon') && !after(mark, CUSTOMER, () => true));

  console.log('\n# Yordamchi: hujjat');
  mark = sent.length;
  say(OWNER, 'Aliyevga tijorat taklifi tayyorla');
  const docMsg = await waitFor('hujjat', () => after(mark, OWNER, s => s.method === 'sendDocument'));
  ok('Telegram: .docx fayl keldi', docMsg?.file?.subarray(0, 2).toString() === 'PK' && textOf(docMsg).includes('Tijorat taklifi'));
  const docs = (await api('/api/documents', { token })).json.documents;
  const dl = await fetch(`${base}/api/documents/${docs?.[0]?.id}/docx`, { headers: { authorization: `Bearer ${token}` } });
  const docBuf = Buffer.from(await dl.arrayBuffer());
  ok('panel: Word fayl yuklanadi', dl.status === 200 && dl.headers.get('content-type')?.includes('wordprocessingml') && docBuf.includes('word/document.xml'));
  ok('boshqa biznes: hujjatni ololmaydi', (await fetch(`${base}/api/documents/${docs?.[0]?.id}/docx`, { headers: { authorization: `Bearer ${otherToken}` } })).status === 404);

  console.log('\n# Yordamchi: post (reklama filtri bilan)');
  mark = sent.length;
  say(OWNER, 'Dam olish kunlari aksiyasi haqida post qil');
  const photo = await waitFor('post rasmi', () => after(mark, OWNER, s => s.method === 'sendPhoto'));
  ok('Telegram: PNG rasm keldi', photo?.file?.subarray(1, 4).toString() === 'PNG' && textOf(photo).includes('Dam olish kunlari'));
  ok('kanal ulanmagan: faqat «O\'chirish» tugmasi', buttons(photo).length === 1 && buttons(photo)[0].callback_data?.startsWith('pd|'));
  const rejected = ai.requests.some(r => JSON.stringify(r.messages.at(-1)).includes('is_error') && JSON.stringify(r.messages.at(-1)).includes('eng yaxshi'));
  ok("«eng yaxshi» filtrdan o'tmadi — Claude qayta yozdi", rejected);
  const postsNow = (await api('/api/posts', { token })).json.posts;
  ok('panel: post qoralamasi', postsNow?.length === 1 && postsNow[0].status === 'draft' && postsNow[0].item.design.uz.badge === '-15%');

  console.log('\n# Kanal');
  ok("noto'g'ri kanal — 400", (await api('/api/channel', { token, body: { channel: '@nope' } })).status === 400);
  const ch = await api('/api/channel', { token, body: { channel: '@test_channel' } });
  ok('kanal ulandi', ch.json.status?.channel?.title === 'Test kanal');
  mark = sent.length;
  const pub = await api(`/api/posts/${postsNow[0].id}/publish`, { token, body: {} });
  const inChannel = after(mark, CHANNEL, s => s.method === 'sendPhoto');
  ok('post kanalga joylandi', pub.status === 200 && pub.json.post.status === 'published' && !!inChannel);
  ok('post ostida mijozlar havolasi (qaysi postdan kelgani bilan)', textOf(inChannel!).includes(`start=l-${bizId}-${postsNow[0].id}`));
  ok('qayta joylash — 409', (await api(`/api/posts/${postsNow[0].id}/publish`, { token, body: {} })).status === 409);
  mark = sent.length;
  addedToChannel(OWNER);
  ok('bot kanalga admin qilinsa — o\'zi ulanadi', await waitFor('kanal ulandi', () => after(mark, OWNER, has('Ikkinchi kanal'))));

  console.log('\n# Ovozli xabar');
  mark = sent.length;
  const geminiBefore = stt.gemini;
  sendVoice(OWNER);
  const voiceReply = await waitFor('ovozga javob', () => after(mark, OWNER, has('🎙')));
  ok('ovoz → Gemini → matn → yordamchi', stt.gemini === geminiBefore + 1 && stt.lastAudio.equals(VOICE_BYTES) && stt.lastMime === 'audio/ogg');
  ok('javobda eshitilgani va xulosa', voiceReply && textOf(voiceReply).includes('Bugun nima qilishim kerak?') && textOf(voiceReply).includes('Bugun:'));
  stt.geminiFails = true;
  mark = sent.length;
  const groqBefore = stt.groq;
  sendVoice(OWNER);
  ok("Gemini ishlamasa — Groq'ga o'tadi", await waitFor('zaxira', () => after(mark, OWNER, has('🎙'))) && stt.groq === groqBefore + 1);
  stt.geminiFails = false;

  console.log('\n# Shaxsiy Telegram: kirish');
  let st = (await api('/api/me', { token })).json.status;
  ok('holat: shaxsiy Telegram mavjud, hali ulanmagan', st.telegramUser.available && !st.telegramUser.account);
  ok("noto'g'ri raqam — 400", (await api('/api/telegram-user/start', { token, body: { phone: '12' } })).status === 400);
  ok('kod yuborildi', (await api('/api/telegram-user/start', { token, body: { phone: '+998 90 111 22 33' } })).status === 200 && tgUser.codes.includes('+998901112233'));
  const badCode = await api('/api/telegram-user/code', { token, body: { code: '99999' } });
  ok("noto'g'ri kod — tushunarli xato", badCode.status === 400 && badCode.json.error === "Kod noto'g'ri");
  ok('ikki bosqichli parol so\'raladi', (await api('/api/telegram-user/code', { token, body: { code: '22222' } })).json.password === true);
  ok("noto'g'ri parol — tushunarli xato", (await api('/api/telegram-user/password', { token, body: { password: 'xato' } })).json.error === "Parol noto'g'ri");
  const logged = await api('/api/telegram-user/password', { token, body: { password: 'parol123' } });
  ok('ulandi', logged.json.account === 'Aziz Egasi · @aziz_owner');
  ok('holatda akkaunt', (await api('/api/me', { token })).json.status.telegramUser.account === 'Aziz Egasi · @aziz_owner');

  console.log('\n# Shaxsiy Telegram: mijozlarga javob (tasdiq bilan)');
  const leadsNow = async () => (await api('/api/leads', { token })).json.leads as { id: string; name: string; channel: string; reachable: boolean; phone: string | null }[];
  mark = sent.length;
  tgUser.incoming(TG_SESSION, '7777', 'Salom, kechqurun uchrashamizmi?', { name: 'Akam', isContact: true });
  await sleep(1200);
  ok("kontaktdagi odam (tanish) — tegilmaydi", !after(mark, OWNER, has('Akam')) && !(await leadsNow()).some(l => l.name === 'Akam'));
  tgUser.incoming(TG_SESSION, '6001', 'Stol narxi qancha?', { name: 'Bobur', username: 'bobur_t' });
  const tgCard = await waitFor('Telegram karta', () => after(mark, OWNER, has('Bobur')));
  ok('egasiga karta: mijoz gapi va javob taklifi', tgCard && textOf(tgCard).includes('· Telegram') && textOf(tgCard).includes('Javob taklifi') && textOf(tgCard).includes("1 500 000 so'm"));
  ok('mijozlar ro\'yxatida: Telegram, yozsa bo\'ladi', (await leadsNow()).some(l => l.name === 'Bobur' && l.channel === 'telegram' && l.reachable));
  ok('tasdiqsiz hech narsa ketmadi', !tgUser.sent.some(m => m.to.userId === '6001'));
  const approveBtn = buttons(tgCard).find(b => b.callback_data?.startsWith('ra|'));
  mark = sent.length;
  press(OWNER, approveBtn!.callback_data!, tgCard!.id!);
  ok("«Yuborish»: egasining Telegrami orqali ketdi", await waitFor('yuborildi', () => tgUser.sent.find(m => m.to.userId === '6001' && m.text.includes("1 500 000 so'm"))));
  await waitFor('karta yangilandi', () => after(mark, OWNER, s => s.method === 'editMessageText' && textOf(s).includes('Yuborildi')));
  const bobur = (await leadsNow()).find(l => l.name === 'Bobur')!;
  await sleep(600);
  let thread = (await api(`/api/inbox/${bobur.id}`, { token })).json.messages as { direction: string; by: string; text: string }[];
  ok("yozishmada: mijoz gapi va Cerebro javobi (qaytib kelgan nusxa egasiniki deb yozilmadi)",
    thread.length === 2 && thread[1].by === 'cerebro' && !thread.some(m => m.by === 'owner'));

  mark = sent.length;
  tgUser.incoming(TG_SESSION, '6001', 'Chegirma bormi?');
  const discount = await waitFor('chegirma kartasi', () => after(mark, OWNER, has('Chegirma bormi?')));
  ok("bilmagan narsasi — egasidan so'raydi", discount && textOf(discount).includes('berasizmi'));
  mark = sent.length;
  tgUser.ownerTyped(TG_SESSION, '6001', '5% chegirma qilamiz');
  ok("egasi o'zi yozsa — taklif bekor", await waitFor('bekor', () => after(mark, OWNER, s => s.method === 'editMessageText' && textOf(s).includes("O'zingiz javob berdingiz"))));
  mark = sent.length;
  press(OWNER, buttons(discount).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, discount!.id!);
  const stale = await waitFor('eskirgan', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery'));
  ok('eskirgan taklifni yuborib bo\'lmaydi', String(stale?.params.text).includes('eskirgan') && !tgUser.sent.some(m => m.text.includes('Aniqlab')));
  thread = (await api(`/api/inbox/${bobur.id}`, { token })).json.messages;
  ok("egasining o'z javobi yozishmada", thread.some(m => m.by === 'owner' && m.text === '5% chegirma qilamiz'));

  console.log("\n# Shaxsiy Telegram: o'zi javob beradi");
  ok("rejim: noto'g'ri qiymat — 400", (await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'tez', contacts: false, delayMin: 1 } })).status === 400);
  ok('rejim: «o\'zi javob bersin», 1 daqiqa kutib', (await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'auto', contacts: false, delayMin: 1 } })).json.business?.autoReply?.mode === 'auto');
  mark = sent.length;
  const tAuto = Date.now();
  tgUser.incoming(TG_SESSION, '6002', 'Ish vaqtingiz qanday?', { name: 'Sardor' });
  await sleep(900);
  ok('kutish vaqtida — hali yubormaydi (egasiga imkon)', !tgUser.sent.some(m => m.to.userId === '6002'));
  const auto = await waitFor('avto javob', () => tgUser.sent.find(m => m.to.userId === '6002'));
  ok("egasi yozmadi — Cerebro o'zi javob berdi", auto?.text.includes('10:00') && Date.now() - tAuto >= 1500, `${Date.now() - tAuto} ms`);
  ok('egasiga: «javob berdim»', await waitFor('xabar', () => after(mark, OWNER, s => textOf(s).includes('🤖') && textOf(s).includes('Sardor'))));
  tgUser.incoming(TG_SESSION, '6003', 'Ish vaqtingiz?', { name: 'Kamola' });
  await sleep(700);
  tgUser.ownerTyped(TG_SESSION, '6003', 'Hozir aytaman');
  await sleep(2500);
  ok("egasi kutish vaqtida o'zi yozsa — Cerebro yozmaydi", !tgUser.sent.some(m => m.to.userId === '6003'));
  mark = sent.length;
  tgUser.incoming(TG_SESSION, '6004', 'Chegirma bormi?', { name: 'Jamshid' });
  ok("o'zi rejimida ham bilmagan narsasini egasidan so'raydi", await waitFor('karta', () => after(mark, OWNER, s => has('Jamshid')(s) && buttons(s).length === 2)));
  await sleep(2000);
  ok('...va o\'zicha yubormaydi', !tgUser.sent.some(m => m.to.userId === '6004'));
  mark = sent.length;
  tgUser.incoming(TG_SESSION, '6005', 'Eng arzon stol qaysi?', { name: 'Rustam' });
  const flagged = await waitFor('filtr', () => after(mark, OWNER, has('Rustam')));
  ok("reklama filtriga tushgan javob — o'zi yubormaydi, egasiga", flagged && textOf(flagged).includes('filtr') && !tgUser.sent.some(m => m.to.userId === '6005'));

  console.log('\n# Shaxsiy Telegram: egasining topshirig\'i va panel');
  const fu2 = await api('/api/chat', { token, body: { text: 'Oxirgi hafta yozgan mijozlarga rahmat xabarini tayyorla' } });
  const out2 = fu2.json.entries?.[1]?.artifacts?.find((a: { type: string }) => a.type === 'outbound')?.outbound;
  ok("xabar: Telegram'dagi va qo'lda qo'shilgan (telefoni bor) mijozlarga ham yetadi", out2 && out2.reachable >= 5, `${out2?.reachable} ta`);
  const sendRes = await api(`/api/followups/${out2.id}/send`, { token, body: {} });
  ok('yuborildi: har biri o\'z kanali orqali', sendRes.json.sent === out2.reachable && tgUser.sent.some(m => m.to.phone === '+998901234567' && m.text.includes('rahmat')),
    `${sendRes.json.sent} ta, ${sendRes.json.failed} xato`);
  const threads = (await api('/api/inbox', { token })).json.threads as { lead: { name: string; channel: string }; pending: number }[];
  ok("«Suhbatlar»: kanal bilan, kutayotgan javob belgisi", threads.some(t => t.lead.name === 'Bobur' && t.lead.channel === 'telegram') && threads.some(t => t.lead.name === 'Jamshid' && t.pending === 1));
  const manual = await api(`/api/inbox/${bobur.id}/send`, { token, body: { text: 'Panel orqali javob' } });
  ok('panel orqali yozish — egasining Telegrami orqali', manual.status === 200 && tgUser.sent.some(m => m.to.userId === '6001' && m.text === 'Panel orqali javob'));
  ok('boshqa biznes: yozishmani ko\'ra olmaydi', (await api(`/api/inbox/${bobur.id}`, { token: otherToken })).status === 404);

  console.log('\n# Instagram');
  st = (await api('/api/me', { token })).json.status;
  ok('holat: Instagram mavjud, hali ulanmagan', st.instagram.available && !st.instagram.account);
  const connect = (await api('/api/instagram/connect', { token })).json.url as string;
  const cu = new URL(connect);
  ok('«Instagram bilan kirish» havolasi (rasmiy, parolsiz)', cu.origin === 'https://www.instagram.com' && cu.searchParams.get('client_id') === 'ig-app'
    && cu.searchParams.get('redirect_uri') === 'https://cerebro.test/api/instagram/callback' && cu.searchParams.get('scope')!.includes('instagram_business_manage_messages'));
  const cb = (q: string) => fetch(`${base}/api/instagram/callback?${q}`, { redirect: 'manual' });
  ok("soxta «state» — ulanmaydi", (await cb('code=ig-code&state=xxx.yyy')).headers.get('location')?.includes('ig=error'));
  const okCb = await cb(`code=ig-code&state=${encodeURIComponent(cu.searchParams.get('state')!)}`);
  ok('ulandi va panelga qaytdi', okCb.status === 302 && okCb.headers.get('location') === 'https://cerebro.test/#/telegram?ig=ok', okCb.headers.get('location') ?? '');
  ok('holatda: @mebel_uyi, webhook obunasi', (await api('/api/me', { token })).json.status.instagram.account === '@mebel_uyi' && ig.subscribed === 1);
  ok('webhook tasdiqlash (Meta)', await (await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242`)).text() === '4242');
  ok("webhook: noto'g'ri token — 403", (await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status === 403);
  const hook = (payload: unknown, secret = 'ig-secret') => {
    const raw = JSON.stringify(payload);
    return fetch(`${base}/api/instagram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw });
  };
  const msgEvent = (sender: string, recipient: string, mid: string, text: string, echo = false) =>
    ({ object: 'instagram', entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: Date.now(), message: { mid, text, ...(echo ? { is_echo: true } : {}) } }] }] });
  ok("webhook: imzosiz/soxta imzo — 403", (await hook(msgEvent('igsid_1', IG_ACCOUNT, 'mx', 'hack'), 'wrong')).status === 403);
  mark = sent.length;
  ok('webhook: xabar qabul qilindi', (await hook(msgEvent('igsid_1', IG_ACCOUNT, 'mid_1', 'Stol narxi qancha?'))).status === 200);
  const igAuto = await waitFor('IG avto javob', () => ig.sent.find(m => m.recipient === 'igsid_1'));
  ok("Instagram'da o'zi javob berdi (Direct orqali)", igAuto?.text.includes("1 500 000 so'm") && igAuto.auth === 'Bearer long-tok');
  const dilnoza = (await leadsNow()).find(l => l.name === 'Dilnoza Karimova');
  ok('mijoz: ismi Instagram profilidan, kanal — Instagram', dilnoza?.channel === 'instagram' && dilnoza.reachable);
  await hook(msgEvent(IG_ACCOUNT, 'igsid_1', 'm_out_x', igAuto!.text, true));
  await hook(msgEvent(IG_ACCOUNT, 'igsid_1', 'mid_owner', "Qo'shimcha: yetkazib berish bepul", true));
  await hook(msgEvent('igsid_1', IG_ACCOUNT, 'mid_1', 'Stol narxi qancha?'));
  await sleep(800);
  thread = (await api(`/api/inbox/${dilnoza!.id}`, { token })).json.messages;
  ok("qaytib kelgan nusxa va takroriy webhook — ikki marta yozilmadi; egasining Instagram'dagi javobi yozildi",
    thread.filter(m => m.direction === 'in').length === 1 && thread.filter(m => m.by === 'cerebro').length === 1 && thread.some(m => m.by === 'owner' && m.text.startsWith("Qo'shimcha")),
    thread.map(m => `${m.by}:${m.text.slice(0, 12)}`).join(' | '));
  mark = sent.length;
  ig.addMessage('conv_2', 'igsid_2', 'Chegirma bormi?', 'ali_ig');
  const polled = await waitFor('tekshiruv', () => after(mark, OWNER, has('Chegirma bormi?')));
  ok('webhook bo\'lmasa ham: suhbatlarni tekshirib oladi', polled && textOf(polled).includes('· Instagram'));
  ok('Instagram mijozi ro\'yxatda', (await leadsNow()).some(l => l.channel === 'instagram' && l.name === 'Dilnoza Karimova'));
  ok('Instagram uzildi', (await api('/api/instagram', { method: 'DELETE', token })).json.status?.instagram?.account === null);
  ok('shaxsiy Telegram uzildi', (await api('/api/telegram-user', { method: 'DELETE', token })).json.status?.telegramUser?.account === null);
  await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'draft', contacts: false, delayMin: 2 } });

  console.log('\n# Panel: suhbat');
  const chat1 = await api('/api/chat', { token, body: { text: 'Salom' } });
  ok('panel: javob keldi', chat1.json.entries?.[1]?.text === 'Tushundim: salom' && chat1.json.entries[0].channel === 'web');
  const log = (await api('/api/chat', { token })).json.entries as { channel: string; artifacts: { type: string; post?: { status: string } }[] }[];
  ok("panel: Telegram'dagi suhbat ham ko'rinadi", log.some(e => e.channel === 'telegram') && log.some(e => e.artifacts.some(a => a.type === 'document')));
  ok('panel: post holati yangilangan (joylangan)', log.some(e => e.artifacts.some(a => a.type === 'post' && a.post?.status === 'published')));
  const wav = await fetch(`${base}/api/chat/voice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' }, body: new Uint8Array(4000) });
  const wavJson = await wav.json() as { entries: { text: string }[] };
  ok('panel mikrofoni: WAV → matn → javob', wav.status === 200 && wavJson.entries?.[0]?.text.startsWith('🎙') && stt.lastMime === 'audio/wav');
  await api('/api/chat', { token, body: { text: "Buni eslab qol: 500 mingdan yuqori buyurtmaga yetkazish bepul" } });
  ok('yordamchi eslab qoldi', ((await api('/api/notes', { token })).json.notes as { text: string }[]).some(n => n.text.includes('yetkazish bepul')));

  console.log('\n# Maxsus holatlar');
  const refused = await api('/api/chat', { token, body: { text: 'Buni rad et' } });
  ok("rad etsa: tushunarli javob", refused.json.entries?.[1]?.text.includes('bajara olmayman'));
  ok('rad etishdan keyin suhbat buzilmaydi', (await api('/api/chat', { token, body: { text: 'Salom yana' } })).json.entries?.[1]?.text === 'Tushundim: salom yana');
  const paused = await api('/api/chat', { token, body: { text: 'internetdan dollar kursini qidir' } });
  ok('internet qidiruvi to\'xtab davom etsa (pause_turn)', paused.json.entries?.[1]?.text.includes('Dollar kursi'));
  const broken = await api('/api/chat', { token, body: { text: 'buzuq suhbat' } });
  const lastReq = ai.requests.at(-1)!;
  ok("eski suhbat API'ga yoqmasa — yangi sessiya bilan qayta", broken.json.entries?.[1]?.text.startsWith('Tushundim') && lastReq.messages.length === 1 && lastReq.system.includes('<previous_session>'));
  mark = sent.length;
  say(OWNER, '/yangi');
  await waitFor('yangi suhbat', () => after(mark, OWNER, has('Yangi suhbat')));
  await api('/api/chat', { token, body: { text: 'Keyingi gap' } });
  ok('/yangi: suhbat yangidan boshlanadi', ai.requests.at(-1)!.messages.length === 1);
  await api('/api/chat', { token, body: { text: 'Yana bir gap' } });
  ok('sessiya ichida suhbat davom etadi', ai.requests.at(-1)!.messages.length === 3);
  await api('/api/business', { method: 'PUT', token, body: { ...profile, hours: 'Har kuni 10:00–20:00' } });
  await api('/api/chat', { token, body: { text: 'Profil yangilandi' } });
  ok('profil o\'zgarsa — yordamchi yangisini biladi', ai.requests.at(-1)!.messages.length === 1 && ai.requests.at(-1)!.system.includes('Har kuni 10:00–20:00'));

  console.log('\n# Bizneslar bir-birini ko\'rmaydi');
  ok('boshqa biznes: vazifani o\'zgartira olmaydi', (await api(`/api/tasks/${todayTask.id}`, { method: 'PATCH', token: otherToken, body: { status: 'done' } })).status === 404);
  ok("boshqa biznes: mijozlar ro'yxati bo'sh", ((await api('/api/leads', { token: otherToken })).json.leads as unknown[]).length === 0);
  ok('boshqa biznes: postni joylay olmaydi', (await api(`/api/posts/${postsNow[0].id}/publish`, { token: otherToken, body: {} })).status === 409);
  ok("boshqa biznes: suhbati bo'sh", ((await api('/api/chat', { token: otherToken })).json.entries as unknown[]).length === 0);

  console.log('\n# Buyruqlar va begona foydalanuvchi');
  mark = sent.length;
  say(OWNER, '/vazifalar');
  const tl = await waitFor('vazifalar', () => after(mark, OWNER, has('Ochiq vazifalar')));
  ok("/vazifalar: ro'yxat va tugmalar", tl && textOf(tl).includes('Bankka borish') && buttons(tl).length >= 2);
  mark = sent.length;
  say(8008, 'Salom');
  ok('begona odam: tushuntirish oladi', await waitFor('begona', () => after(mark, 8008, has('Cerebro'))));

  console.log('\n# Suhbat tarixi butunligi');
  ok("Claude'ga har doim to'g'ri tarix ketdi (faqat oxiriga qo'shildi, asbob natijalari joyida)", ai.violations.length === 0, ai.violations.join('; '));
  ok('serverda kutilmagan xato yo\'q', !/\[(http|bot|ai|asbob)\]/.test(serverLog.replace(/\[ai\] (BadRequestError|Error): 400[^\n]*/g, '')), serverLog.split('\n').filter(l => /\[(http|bot|ai|asbob)\]/.test(l)).slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  server.kill();
  tgServer.close();
  aiServer.close();
  sttServer.close();
  tgUserServer.close();
  igServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl band */ }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
if (passed !== results.length) {
  console.log('\n--- server log ---\n' + serverLog.slice(-4000));
  process.exit(1);
}
process.exit(0);
