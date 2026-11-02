/**
 * Kunlik ish sinovi — haqiqiy kalitsiz:
 *   sof qoidalar: soha profili (klinika, o'quv markazi, xizmat, ishlab chiqarish, savdo), ertalabki reja (tartib, unutilgan mijozlar,
 *   tugmalar, dushanba yakuni, qaytarish), natijasi so'raladigan vazifalar;
 *   server: mijozning keyingi qadami (panel), ertalabki reja Telegram'da tugmalar bilan, «✍️» — yordamchi qayta yozish xabarini tayyorlaydi,
 *   uchrashuv vazifasi bajarildi → natija so'raladi → egasining gapi yordamchiga shu vazifa haqida ekani bilan boradi va mijoz yangilanadi.
 * Ishga tushirish: npm run test:work
 */
process.env.TZ = 'Asia/Tashkent';
// Bu sinov server modullarini o'zi import qiladi (outcome → db): haqiqiy bazaga tegmasin
import './isolate';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ALL_PACKS, EDUCATION_PACK, MANUFACTURING_PACK, SERVICES_PACK, industryOf } from '../src/data/industries';
import type { Lead, Task } from '../src/types';
import { stamp } from '../src/lib/week';
import { forgottenLeads, planText, type PlanInput } from '../server/plan';
import { wantsOutcome } from '../server/outcome';
import { CUSTOMER, OWNER, ai, aiServer, listen, press, say, sent, sleep, tgServer, waitFor, type Sent, stopProcess } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

console.log('\n# Soha profillari');
ok('klinika: stomatologiya, tibbiyot yoki DentaCRM ulangan', industryOf('stomatologiya').kind === 'clinic' && industryOf("go'zallik saloni", true).kind === 'clinic');
ok("o'quv markazi, kurslar, IELTS", industryOf("o'quv markazi").kind === 'education' && industryOf('IELTS kurslari').kind === 'education' && industryOf('Учебный центр').kind === 'education');
ok('xizmat: IT, agentlik, qurilish', industryOf('IT: klinikalar uchun AI yordamchi va DentaCRM').kind === 'services' && industryOf('reklama agentligi').kind === 'services' && industryOf('Ремонт квартир').kind === 'services');
ok('ishlab chiqarish: zavod, ulgurji', industryOf('mebel zavodi').kind === 'manufacturing' && industryOf('Оптовая торговля').kind === 'manufacturing');
ok("savdo — qolganlari («mebel do'koni», bo'sh)", industryOf("mebel do'koni").kind === 'retail' && industryOf('').kind === 'retail');
ok("har ro'yxatda id takrorlanmaydi", [EDUCATION_PACK, SERVICES_PACK, MANUFACTURING_PACK].every(p => new Set(p.map(q => q.id)).size === p.length) && ALL_PACKS.length > 40);
ok('mijozni atash sohaga mos', industryOf('stomatologiya').customer.many === 'bemorlar' && industryOf("o'quv markazi").customer.one === "o'quvchi");

console.log('\n# Ertalabki reja (sof)');
const now = new Date('2026-10-19T08:00:00'); // dushanba
const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const lead = (id: string, name: string, over: Partial<Lead> = {}): Lead => ({
  id, name, phone: null, username: null, reachable: true, channel: 'manual', lastInboundAt: null, stage: 'contacted', note: null, source: null,
  nextStep: null, nextAt: null, createdAt: iso(10), updatedAt: iso(10), ...over,
});
const task = (id: string, title: string, dueAt: string | null): Task => ({ id, title, notes: null, dueAt, callTo: null, spoken: false, status: 'open', remindedAt: null, createdAt: iso(3) });
const base: PlanInput = {
  now, ownerName: 'Aziz', profile: industryOf('IT xizmatlari'), tasks: [], leads: [], repliesPending: 0, outboundDrafts: 0, crmLines: [], holidays: [], week: null, recall: 0, autoPrep: false,
};
ok("aytadigan narsa yo'q — reja yuborilmaydi", planText(base) === null);
const leads = [
  lead('due1', 'Tabassum', { nextStep: 'taklif yuborish', nextAt: '2026-10-19T10:00' }),
  lead('late1', 'Universitet', { nextStep: "qo'ng'iroq", nextAt: '2026-10-16T09:00' }),
  lead('later', 'Kelajak', { nextStep: 'uchrashuv', nextAt: '2026-10-25T09:00' }),
  lead('f1', 'Shifo Dent', { updatedAt: iso(9) }),
  lead('f2', 'Nur Med', { updatedAt: iso(5), note: 'narx so\'radi' }),
  lead('f3', 'Smile', { updatedAt: iso(4) }),
  lead('f4', 'Dental Pro', { updatedAt: iso(3) }),
  lead('recent', 'Yaqinda', { updatedAt: iso(1) }),
  lead('fresh', 'Yangi klinika', { createdAt: iso(0.2), updatedAt: iso(0.2), stage: 'new', phone: '+998 90 000 11 22' }),
];
ok("unutilganlar: keyingi qadamsiz va 3+ kun jim, eng uzog'i birinchi", forgottenLeads(leads, now, 3).map(l => l.id).join() === 'f1,f2,f3,f4');
const plan = planText({ ...base, leads, repliesPending: 2, tasks: [task('t1', 'Hisobot', '2026-10-19T15:00'), task('t2', 'Bank', '2026-10-17T09:00')],
  week: { leadsAdded: 4, tasksDone: 7, crmLine: null } })!;
const h = plan.html;
const at = (s: string) => h.indexOf(s);
ok('reja: tasdiq kutayotganlar eng tepada', at('Tasdig') > 0 && at('Tasdig') < at('Bugungi qadamlar'), h.slice(0, 120));
ok('reja: bugungi va kechikkan qadamlar (kechikkani birinchi, kechikkani belgilangan)', at('Universitet') < at('Tabassum') && h.includes('taklif yuborish') && !h.includes('Kelajak'));
ok('reja: vazifalar — bugun va kechikkan', h.includes('Hisobot') && h.includes('🔴 Kechikkan (1)'));
ok("reja: unutilganlar soha bo'yicha atalgan («mijozlar»), izohi bilan", h.includes('Unutilgan mijozlar (4)') && h.includes("narx so'radi") && !h.includes('Yaqinda'));
ok('reja: 3 tagacha «✍️» tugma — unutilganlarga', plan.buttons.length === 3 && plan.buttons[0][0].data === 'fu|f1' && plan.buttons[0][0].text.includes('Shifo Dent'));
ok('reja: yangi mijozlar va dushanba yakuni', h.includes('Yangi mijozlar (1)') && h.includes("O'tgan hafta") && h.includes('Bajarilgan vazifalar: 7'));
const clinicPlan = planText({ ...base, profile: industryOf('stomatologiya'), leads: [lead('p', 'Bemor', { updatedAt: iso(2) })], recall: 34, crmLines: ['📅 Bugun 12 ta qabul'] })!;
ok("klinika: bemorlar deb ataladi, 1 kun jim — unutilgan; qaytarish ro'yxati tugmasi", clinicPlan.html.includes('Unutilgan bemorlar (1)') && clinicPlan.html.includes('34 ta bemor') && clinicPlan.buttons.some(r => r[0].data === 'rc|list'));
ok("klinika: CRM qatorlari qadamlardan oldin", clinicPlan.html.indexOf('12 ta qabul') < clinicPlan.html.indexOf('Unutilgan'));
ok("dushanba: hafta bo'sh bo'lsa — yakun bloki yo'q (va faqat shu bilan reja yuborilmaydi)", planText({ ...base, week: { leadsAdded: 0, tasksDone: 0, crmLine: null } }) === null);
const wrote = iso(12);
const prepPlan = planText({ ...base, autoPrep: true, leads: [lead('w', 'Yozgan', { updatedAt: iso(9), lastInboundAt: wrote }), lead('n', 'Yozmagan', { updatedAt: iso(9) })] })!;
ok("AI o'zi faqat bizga yozgan mijozga xabar tayyorlaydi; yozmaganiga — egasi tugma bilan", prepPlan.prep.join() === 'w' && prepPlan.buttons.length === 1 && prepPlan.buttons[0][0].data === 'fu|n');
ok("matndagi begona belgilar HTML'ni buzmaydi", planText({ ...base, leads: [lead('x', '<b>Ali</b> & Co', { updatedAt: iso(9) })] })!.html.includes('&lt;b&gt;Ali&lt;/b&gt; &amp; Co'));

console.log('\n# Natijasi so\'raladigan vazifalar');
ok("uchrashuv, qo'ng'iroq, taklif, demo — natija so'raladi", ['Tabassum bilan uchrashuv', "Universitetga qo'ng'iroq", 'Taklif yuborish', 'Demo ko\'rsatish', 'Встреча с клиентом'].every(t => wantsOutcome({ title: t, leadId: null })));
ok("oddiy ish — so'ralmaydi; mijozga bog'langan har qanday ish — so'raladi", !wantsOutcome({ title: 'Dori olish', leadId: null }) && wantsOutcome({ title: 'Hujjat', leadId: 'l1' }));

// ─── Server ───────────────────────────────────────────────────────────────────
const tgPort = await listen(tgServer), aiPort = await listen(aiServer);
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-work-'));
const PORT = 3293, base_ = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'work-secret', TICK_MS: '500',
    MORNING_HOUR: String(new Date().getHours()), EVENING_HOUR: String(new Date().getHours()), WEB_SEARCH: '0', DIRECTOR_RUN_GAP_MS: '0', BACKUP_KEEP: '0', GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '',
    TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base_ + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && String(s.params.text ?? '').includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const lastUser = () => {
  const r = ai.requests.at(-1);
  const m = r?.messages.filter(x => x.role === 'user').at(-1);
  return typeof m?.content === 'string' ? m.content : (m?.content ?? []).map(b => String(b.text ?? '')).join('\n');
};

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base_}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Sotuv', industry: 'IT xizmatlari', login: 'sotuv', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'sotuv', password: 'secret12' } })).json.token;

  console.log('\n# Mijozning keyingi qadami (panel)');
  const a = (await api('/api/leads', { token, body: { name: 'Tabassum klinikasi', phone: '+998 90 111 22 33' } })).json.lead;
  const b = (await api('/api/leads', { token, body: { name: 'Eski mijoz', note: 'narx so\'ragan edi' } })).json.lead;
  const set = await api(`/api/leads/${a.id}`, { method: 'PATCH', token, body: { stage: 'contacted', nextStep: 'taklif yuborish', nextAt: stamp(new Date()) } });
  ok('keyingi qadam va vaqti saqlandi', set.json.lead?.nextStep === 'taklif yuborish' && set.json.lead?.nextAt === stamp(new Date()), JSON.stringify(set.json));
  ok("noto'g'ri vaqt — rad", (await api(`/api/leads/${a.id}`, { method: 'PATCH', token, body: { nextAt: 'ertaga' } })).status === 400);
  // «Eski mijoz» 5 kundan beri jim (xizmat sohasida 3 kundan keyin unutilgan hisoblanadi)
  const db = new DatabaseSync(join(dataDir, 'palantir.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 5 * 86_400_000).toISOString(), b.id);
  // Ikkalasi ham avval bizga yozgan (AI faqat shundaylarga o'zi xabar tayyorlaydi — plan.ts)
  db.prepare('UPDATE leads SET last_inbound_at = ? WHERE id IN (?, ?)').run(new Date(Date.now() - 6 * 86_400_000).toISOString(), a.id, b.id);
  db.close();

  console.log('\n# Ertalabki reja Telegram\'da — yordamchi xabarlarni o\'zi tayyorlaydi');
  const due = stamp(new Date());
  await api('/api/tasks', { token, body: { title: 'Tabassum bilan uchrashuv', dueAt: due } });
  const link = (await api('/api/me', { token })).json.status.linkUrl as string;
  let mark = sent.length;
  const aiBefore = ai.requests.length;
  say(OWNER, `/start ${link.split('start=')[1]}`);
  const morning = await waitFor('reja', () => toOwner(mark, 'Xayrli tong'));
  const mText = String(morning?.params.text ?? '');
  ok('reja keldi: bugungi qadam, unutilgan mijoz, vazifa', mText.includes('Tabassum klinikasi — taklif yuborish') && mText.includes('Unutilgan mijozlar (1)') && mText.includes('Eski mijoz') && mText.includes('Tabassum bilan uchrashuv'), mText.slice(0, 300));
  ok("AI bor — «✍️» tugma o'rniga «2 ta mijozga xabar tayyorlayapman»", mText.includes('2 ta mijozga xabar tayyorlayapman') && !buttons(morning).some(x => x.callback_data?.startsWith('fu|')), mText.slice(-200));
  const prepReq = await waitFor('tayyorgarlik', () => ai.requests.slice(aiBefore).find(r => JSON.stringify(r.messages).includes('Morning preparation')));
  const prepText = JSON.stringify(prepReq?.messages ?? '');
  ok("yordamchiga ertalabki topshiriq: faqat id'lar (ismlar emas), ikkala mijoz", !!prepReq && prepText.includes(a.id) && prepText.includes(b.id) && !prepText.includes('Eski mijoz'));

  console.log('\n# Kechki savol: kun qanday o\'tdi');
  const evening = await waitFor('kechki savol', () => toOwner(mark, "Kun qanday o'tdi"));
  ok("kechki savol: bugungi vazifa va mijoz qadami, «aytadigan narsa yo'q» tugmasi", !!evening && String(evening.params.text).includes('Tabassum bilan uchrashuv') && String(evening.params.text).includes('taklif yuborish') && buttons(evening).some(x => x.callback_data === 'od|day'));
  await sleep(1500);
  const was0 = ai.requests.length;
  say(OWNER, 'Tabassumga taklifni yubordim, juma kuni javob beradi');
  const dayReq = await waitFor('kun yakuni', () => ai.requests.slice(was0).find(r => JSON.stringify(r.messages).includes('how did the day go')));
  ok("egasining javobi yordamchiga kun yakuni sifatida (bugungi ish id'lari bilan) bordi", !!dayReq && JSON.stringify(dayReq.messages).includes(a.id));
  await sleep(800);

  console.log('\n# «✍️» tugmasi (AI\'siz rejada) — yordamchi qayta yozish xabarini tayyorlaydi');
  const before = ai.requests.length;
  press(OWNER, `fu|${b.id}`, morning!.id!);
  await waitFor('AI', () => ai.requests.length > before);
  ok("yordamchiga topshiriq: mijoz id'si bilan, list_leads va draft_followup", lastUser().includes(`Customer id ${b.id}`) && lastUser().includes('draft_followup'), lastUser().slice(-200));
  await sleep(500);
  const chat = JSON.stringify((await api('/api/chat', { token })).json.entries);
  ok("jurnalda — egasiga tushunarli yozuv (ichki buyruq ham, mijozning ismi ham yo'q)", chat.includes('✍️ Unutilgan mijozga qayta yozish matnini tayyorla') && chat.includes('☀️ Bugungi xabarlarni tayyorla') && !chat.includes('Customer id') && !chat.includes('Morning preparation'));

  console.log('\n# Uchrashuv bajarildi → natija → mijoz yangilanadi');
  const reminder = await waitFor('eslatma', () => sent.find(s => s.method === 'sendMessage' && String(s.params.text ?? '').startsWith('⏰') && String(s.params.text).includes('uchrashuv')));
  const done = buttons(reminder).find(x => x.callback_data?.startsWith('td|'));
  mark = sent.length;
  press(OWNER, done!.callback_data!, reminder!.id!, String(reminder!.params.text));
  const asked = await waitFor('natija savoli', () => toOwner(mark, 'natijasi qanday'));
  ok("«Bajarildi» → natijasi so'raldi (vazifa nomi bilan), «aytadigan narsa yo'q» tugmasi shu vazifaga bog'langan", !!asked && String(asked.params.text).includes('Tabassum bilan uchrashuv') && buttons(asked).some(x => x.callback_data === `oc|${done!.callback_data!.split('|')[1]}`));
  // Ikkinchi marta bosilsa — qayta so'ralmaydi
  const mark2 = sent.length;
  press(OWNER, done!.callback_data!, reminder!.id!, String(reminder!.params.text));
  await sleep(1500);
  ok("«Bajarildi» ikki marta bosilsa — natija qayta so'ralmaydi", !toOwner(mark2, 'natijasi qanday'));
  // Yordamchi: natija haqidagi gapga mijozni yangilaydi (keyingi qadam bilan), keyin bir gap bilan javob beradi
  const nextAt = stamp(new Date(Date.now() + 2 * 86_400_000));
  ai.owner = (messages) => {
    const last = messages.at(-1);
    const answered = Array.isArray(last?.content) && last.content.some(x => x.type === 'tool_result');
    return answered
      ? { content: [{ type: 'text', text: "Yozib qo'ydim: shartnoma yuborish — 2 kundan keyin." }], stop: 'end_turn' }
      : { content: [{ type: 'tool_use', id: 'tu_1', name: 'update_lead', input: { lead_id: a.id, stage: 'contacted', next_step: 'shartnoma yuborish', next_at: nextAt } }], stop: 'tool_use' };
  };
  const was = ai.requests.length;
  mark = sent.length;
  say(OWNER, 'Yaxshi o\'tdi, shartnomani yuboraman');
  await waitFor('javob', () => toOwner(mark, "Yozib qo'ydim"));
  const outcomeReq = ai.requests.slice(was).find(r => JSON.stringify(r.messages).includes('reporting how the task'));
  ok("egasining gapi yordamchiga vazifa nomi bilan bordi", !!outcomeReq && JSON.stringify(outcomeReq.messages).includes('Tabassum bilan uchrashuv'));
  const updated = (await api('/api/leads', { token })).json.leads.find((l: Lead) => l.id === a.id);
  ok('mijoz yangilandi: keyingi qadam — shartnoma yuborish', updated?.nextStep === 'shartnoma yuborish' && updated?.nextAt === nextAt, JSON.stringify(updated));
  ai.owner = null;
  const chat2 = JSON.stringify((await api('/api/chat', { token })).json.entries);
  ok("jurnalda — egasining o'z gapi (ichki izohsiz)", chat2.includes("Yaxshi o'tdi, shartnomani yuboraman") && !chat2.includes('reporting how the task'));
  mark = sent.length;
  const was2 = ai.requests.length;
  say(OWNER, 'Bugun nima qilishim kerak?');
  await waitFor('oddiy javob', () => ai.requests.length > was2);
  ok("natija bir marta olinadi: keyingi gap — oddiy gap", !lastUser().includes('reporting how the task'));

  console.log('\n# Mijoz yozishmasidan keyingi qadam o\'zi chiqadi');
  const general = (await api('/api/me', { token })).json.status.generalLink as string;
  ai.customer = () => ({
    action: 'reply', reply: "Mayli, o'ylab ko'ring — savol bo'lsa yozing.", question: '', note_for_owner: '', lead_note: "Narx so'radi, o'ylab ko'radi",
    customer_name: '', customer_phone: '', follow_up: "narx haqida qayta yozish", follow_up_days: 3,
  });
  say(CUSTOMER, `/start ${general.split('start=')[1]}`);
  await sleep(800);
  say(CUSTOMER, "Narxini bildim, o'ylab ko'raman");


  let customerLead: Lead | undefined;
  for (let i = 0; i < 60 && !customerLead?.nextStep; i++) {
    await sleep(250);
    customerLead = ((await api('/api/leads', { token })).json.leads as Lead[]).find(l => l.channel === 'bot');
  }
  const inThree = stamp(new Date(Date.now() + 3 * 86_400_000)).slice(0, 10);
  ok("mijoz «o'ylab ko'raman» dedi — keyingi qadam: 3 kundan keyin qayta yozish", customerLead?.nextStep === 'narx haqida qayta yozish' && customerLead.nextAt === `${inThree}T10:00`, JSON.stringify(customerLead));
  ai.customer = () => ({ action: 'reply', reply: 'Rahmat!', question: '', note_for_owner: '', lead_note: '', customer_name: '', customer_phone: '', follow_up: 'boshqa qadam', follow_up_days: 1 });
  say(CUSTOMER, 'Rahmat');
  await sleep(2500);
  const again = ((await api('/api/leads', { token })).json.leads as Lead[]).find(l => l.channel === 'bot');
  ok("bor keyingi qadam keyingi xabarda ustidan yozilmaydi", again?.nextStep === 'narx haqida qayta yozish', JSON.stringify(again));
  ai.customer = null;

  console.log('\n# Yutildi — keyingi qadam qolmaydi');
  const won = await api(`/api/leads/${a.id}`, { method: 'PATCH', token, body: { stage: 'won' } });
  ok("«kelishildi» — keyingi qadam o'chdi (rejada chiqmaydi)", won.json.lead?.stage === 'won' && won.json.lead?.nextStep === null && won.json.lead?.nextAt === null);

  console.log('\n# AI Direktor: raqamlar → muammo → taklif → tugma → topshiriq → tekshiruv');
  {
    const ddb = new DatabaseSync(join(dataDir, 'palantir.db'));
    ddb.exec('PRAGMA busy_timeout = 5000');
    const bizId = String((ddb.prepare("SELECT id FROM businesses WHERE login = 'sotuv'").get() as { id: string }).id);
    const ago = (days: number, h = 11) => { const d = new Date(Date.now() - days * 86_400_000); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    let seq = 0;
    const lead = (when: string) => {
      const lid = `dlead${++seq}`;
      ddb.prepare("INSERT INTO leads (id, business_id, name, channel, stage, source, created_at, updated_at, last_inbound_at) VALUES (?, ?, ?, 'instagram', 'new', 'Instagram', ?, ?, ?)").run(lid, bizId, `Mijoz ${seq}`, when, when, when);
      return lid;
    };
    const msg = (lid: string, dir: 'in' | 'out', when: string) =>
      ddb.prepare("INSERT INTO inbox (id, business_id, lead_id, channel, direction, author, text, created_at) VALUES (?, ?, ?, 'instagram', ?, ?, ?, ?)").run(`dmsg${++seq}`, bizId, lid, dir, dir === 'in' ? 'customer' : 'palantir', dir === 'in' ? 'Narxi qancha?' : 'Javob', when);
    // O'tgan hafta: 6 murojaat, hammasiga javob; bu hafta: 4 murojaat, bittasiga javob
    for (let i = 0; i < 6; i++) { const l = lead(ago(9 + (i % 4))); msg(l, 'in', ago(9 + (i % 4))); msg(l, 'out', ago(9 + (i % 4), 12)); }
    const thisWeek = [2, 3, 4, 5].map(d => { const l = lead(ago(d)); msg(l, 'in', ago(d)); return { l, d }; });
    msg(thisWeek[0].l, 'out', ago(thisWeek[0].d, 12));

    ai.directorPlan = () => ({
      summary: 'Javob ulushi keskin tushdi', problem: { title: 'Murojaatlarning ko\'pi javobsiz qolyapti', evidence: 'Javob berilgan ulush 100% → 25%' },
      moves: [
        { member: 'qabulxona', task: 'Har yangi murojaatga darhol javob ber, narxni aytib, qabulga taklif qil', why: 'ulush 25%', metric: 'answered_pct', check_days: 3 },
        { member: 'egasi', task: 'Kechki navbatchi kerakmi — hal qiling', why: 'kechqurun javobsiz qolyapti', metric: 'unanswered', check_days: 7 },
      ],
    });
    const run = await api('/api/director/run', { token, body: {} });
    const seen = ai.director.at(-1) ?? '';
    ok("direktor: modelga oxirgi 7 kun raqamlari bordi (javob ulushi 25 vs 100), egasining qarorlari bilan", seen.includes('answered_pct') && seen.includes('last 7 days 25, previous 7 days 100') && seen.includes('<memory>'), seen.slice(0, 400));
    const waiting = (run.json.waiting ?? []) as { id: string; member: string; status: string; baseline: number }[];
    ok('direktor: muammo va 2 ta taklif tasdiq kutyapti (boshlang\'ich qiymat yozildi)', run.status === 200 && run.json.run?.problem?.includes('javobsiz') && waiting.length === 2 && waiting[0].baseline === 25, JSON.stringify(run.json).slice(0, 400));
    const toReception = waiting.find(m => m.member === 'qabulxona')!, toOwner = waiting.find(m => m.member === 'egasi')!;

    const approved = await api(`/api/director/moves/${toReception.id}`, { token, body: { decision: 'approve' } });
    const order = ((await api('/api/orders?member=qabulxona', { token })).json.orders as { text: string; spec: { kind: string }; active: boolean }[]).find(o => o.text.startsWith('Har yangi murojaatga'));
    const memo = ((await api('/api/notes', { token })).json.notes as { text: string; kind: string; tags: string[]; by: string }[]).find(n => n.tags.includes('direktor'));
    ok("tasdiq: Qabulxonaga doimiy topshiriq bo'ldi", approved.status === 200 && approved.json.message.startsWith('Qabulxonaga topshirildi') && order?.spec.kind === 'standing' && order.active, JSON.stringify(approved.json.message));
    ok("tasdiq: Xotira'ga qaror yozildi (sabab, tekshirish sanasi, boshlang'ich qiymat)", memo?.kind === 'qaror' && memo.by === 'Siz (Direktor taklifi)' && memo.text.includes('Sabab: ulush 25%') && memo.text.includes('javob berilgan ulush 25%'), JSON.stringify(memo));
    ok('ikkinchi bosish ikkinchi topshiriq yaratmaydi', (await api(`/api/director/moves/${toReception.id}`, { token, body: { decision: 'approve' } })).json.message === 'Allaqachon topshirilgan'
      && ((await api('/api/orders?member=qabulxona', { token })).json.orders as { text: string }[]).filter(o => o.text.startsWith('Har yangi murojaatga')).length === 1);

    const cb = press(OWNER, `dn|${toOwner.id}`, 1);
    let declined: { id: string; status: string } | undefined;
    for (let i = 0; i < 60 && !declined; i++) {
      await sleep(250);
      declined = ((await api('/api/director', { token })).json.journal as { id: string; status: string }[]).find(m => m.id === toOwner.id && m.status === 'rad');
    }
    ok("Telegram tugmasi «✖️ kerak emas» — taklif yopildi, egasiga vazifa yaratilmadi", !!declined && !!cb && !((await api('/api/tasks', { token })).json.tasks as { title: string }[]).some(t => t.title.startsWith('Kechki navbatchi')));

    // 3 kun o'tdi: javoblar yozildi, tekshirish kuni keldi
    for (const { l, d } of thisWeek.slice(1)) msg(l, 'out', ago(d, 12));
    ddb.prepare("UPDATE director_moves SET check_at = ? WHERE id = ?").run(stamp(new Date(Date.now() - 86_400_000)).slice(0, 10), toReception.id);
    ai.directorPlan = () => ({ summary: 'Javoblar tiklandi', problem: null, moves: [] });
    const again = await api('/api/director/run', { token, body: {} });
    const checked = (again.json.journal as { id: string; status: string; after: number; verdict: string }[]).find(m => m.id === toReception.id);
    const memo2 = ((await api('/api/notes', { token })).json.notes as { id: string; text: string; tags: string[] }[]).find(n => n.tags.includes('direktor'));
    ok("tekshiruv: muddati kelgan qaror qayta o'lchandi — 25% → 100%, yaxshilandi", checked?.status === 'tekshirildi' && checked.after === 100 && checked.verdict === 'yaxshi', JSON.stringify(checked));
    ok("tekshiruv: natija Xotira'dagi qaror yozuviga qo'shildi", !!memo2?.text.includes('→ Natija') && memo2.text.includes('25% → 100%, yaxshilandi'), memo2?.text);
    ddb.close();
    ai.directorPlan = null;
  }

  ok("serverda kutilmagan xato yo'q", !/\[http\]|TypeError|ReferenceError/.test(log), log.split('\n').filter(l => /\[http\]|Error/.test(l)).slice(0, 3).join(' | '));
} finally {
  await stopProcess(server);
  tgServer.close();
  aiServer.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
process.exit(passed === results.length ? 0 : 1);
