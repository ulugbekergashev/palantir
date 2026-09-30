/**
 * To'liq oqim sinovi — haqiqiy token va pulsiz:
 *   soxta Telegram, soxta Claude (asbob chaqiradi, tarixni tekshiradi), soxta ovoz xizmati;
 *   server — alohida jarayon, vaqtinchalik bazada.
 * Ishga tushirish: npm test
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Business } from '../src/types';
import { iso, stamp } from '../src/lib/week';
import {
  CHANNEL, CUSTOMER, OWNER, VOICE_BYTES, addedToChannel, ai, aiServer, listen, press, say, sendVoice, sent, shareContact, sleep, stt, sttServer,
  tgServer, waitFor, type Sent,
} from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};

const tgPort = await listen(tgServer);
const aiPort = await listen(aiServer);
const sttPort = await listen(sttServer);
const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-e2e-'));
const PORT = 3290;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', TICK_MS: '700',
    GEMINI_API_KEY: 'g-test', GROQ_API_KEY: 'q-test', GEMINI_STT_URL: `http://127.0.0.1:${sttPort}/gemini`, GROQ_STT_URL: `http://127.0.0.1:${sttPort}/groq`,
    MORNING_HOUR: String(new Date().getHours()), WEB_SEARCH: '1', SESSION_SECRET: 'e2e-secret',
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
