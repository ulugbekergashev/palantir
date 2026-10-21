/**
 * Haqiqiy DentaCRM bilan jonli sinov (har bir klinikaga o'rnatishda ishlatiladi):
 *   Palantir serveri vaqtinchalik bazada ko'tariladi, Claude — soxta (pul ketmaydi), DentaCRM — haqiqiy.
 *   Ulash → kun hisoboti → bemor qidirish → bo'sh vaqtlar → (CRM_WRITE=1 bo'lsa) qabulga yozish va rad etilishi kerak holatlar.
 *
 * Ishga tushirish:
 *   CRM_URL=http://192.168.1.20:3001 CRM_USER=admin CRM_PASS=… [CRM_DATE=2026-10-01] [CRM_WRITE=1] npx tsx scripts/crm-live.ts
 * CRM_WRITE=1 CRM'ga haqiqatan yozadi (sinov bemori va qabullar) — faqat sinov bazasida yoki nusxada ishlating.
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iso } from '../src/lib/week';
import { OWNER, ai, aiServer, listen, say, sent, sleep, tgServer, waitFor, type Sent } from './fakes';

const { CRM_URL, CRM_USER, CRM_PASS } = process.env;
if (!CRM_URL || !CRM_USER || !CRM_PASS) {
  console.error('CRM_URL, CRM_USER va CRM_PASS kerak. Masalan: CRM_URL=http://127.0.0.1:3001 CRM_USER=admin CRM_PASS=… npx tsx scripts/crm-live.ts');
  process.exit(2);
}
const WRITE = process.env.CRM_WRITE === '1';
const today = iso(new Date());
const tomorrow = iso(new Date(Date.now() + 86_400_000));
const reportDay = process.env.CRM_DATE || today;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const som = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} so'm`;

const aiPort = await listen(aiServer);
const tgPort = await listen(tgServer);
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-crm-live-'));
const PORT = 3293;
const NAME = 'Sinov klinika';
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'live-admin-1', SESSION_SECRET: 'live-secret', WEB_SEARCH: '0',
    // Haqiqiy bot ham, haqiqiy Claude ham ishlatilmaydi
    BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`,
    TG_API_ID: '', TG_API_HASH: '', IG_VIA_BROWSER: '1', IG_FAKE_URL: 'http://127.0.0.1:1', INBOX_DEBOUNCE_MS: '300', MORNING_HOUR: '25',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

const base = `http://127.0.0.1:${PORT}`;
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) as Json };
}

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'live-admin-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: NAME, industry: 'stomatologiya klinikasi', login: 'sinov', password: 'sinov-parol-1' } });
  const token = (await api('/api/login', { body: { login: 'sinov', password: 'sinov-parol-1' } })).json.token as string;

  /** Egasi yozadi → soxta Claude asbobni chaqiradi → haqiqiy CRM'dan kelgan natija */
  const tool = async (text: string) => {
    const before = ai.requests.length;
    const r = await api('/api/chat', { token, body: { text } });
    const last = r.status === 200 ? ai.requests.slice(before).filter(q => q.system.includes(`Name: ${NAME}`)).at(-1)?.messages.at(-1)?.content : undefined;
    const block = Array.isArray(last) ? last.find(b => b.type === 'tool_result') : undefined;
    let result: Json = block?.content;
    try { result = JSON.parse(String(block?.content)); } catch { /* xato matni */ }
    return { result, isError: !block || !!block.is_error };
  };
  const book = (input: Record<string, unknown>) => tool(`qabulga yoz ${JSON.stringify(input)}`);

  console.log(`\n# Ulash: ${CRM_URL}`);
  const bad = await api('/api/crm', { token, body: { url: CRM_URL, username: CRM_USER, password: `${CRM_PASS}-xato` } });
  ok("noto'g'ri parol rad etiladi", bad.status === 400, bad.json.error);
  const good = await api('/api/crm', { token, body: { url: CRM_URL, username: CRM_USER, password: CRM_PASS } });
  ok('ulandi', good.status === 200, good.json.status?.crm?.account ?? good.json.error);
  if (good.status !== 200) throw new Error('ulanmadi — qolgan sinovlar o\'tkazilmaydi');

  console.log(`\n# Kun hisoboti: ${reportDay}`);
  const day = await tool(`klinika kuni {"date":"${reportDay}"}`);
  ok('clinic_day javob berdi', !day.isError, day.isError ? String(day.result) : `${day.result.total} qabul: ${day.result.came} keldi, ${day.result.no_show} kelmadi, ${day.result.cancelled} bekor, ${day.result.expected} kutilmoqda`);
  if (!day.isError) {
    console.log(`    tushum: ${som(day.result.revenue.total)} ${JSON.stringify(day.result.revenue.by_method)}; avans ${som(day.result.revenue.advance)}; balansdan ${som(day.result.revenue.from_balance)}; to'lanmagan ${som(day.result.unpaid.total)} (${day.result.unpaid.count} ta)`);
    for (const d of day.result.doctors) console.log(`    ${d.doctor}: ${d.appointments.map((a: Json) => `${a.time} ${a.patient} [${a.status}]`).join('; ')}`);
  }
  const todayDay = reportDay === today ? day : await tool(`klinika kuni {"date":"${today}"}`);
  ok('bugungi kun ham o\'qiladi', !todayDay.isError, todayDay.isError ? String(todayDay.result) : `${todayDay.result.total} qabul, tushum ${som(todayDay.result.revenue.total)}`);

  console.log('\n# Davr hisoboti va nazorat');
  const move = (date: string, n: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const around = await tool(`davr hisoboti ${JSON.stringify({ from: move(reportDay, -3), to: move(reportDay, 3) })}`);
  const sameDay = around.result?.by_day?.find((d: Json) => d.date === reportDay);
  ok('clinic_period: 7 kunlik davr, ichidagi kun clinic_day bilan bir xil', !around.isError && !day.isError && sameDay?.appointments === day.result.total && sameDay.revenue === day.result.revenue.total,
    around.isError ? String(around.result) : `${around.result.appointments.total} qabul (${around.result.appointments.came} keldi, ${around.result.appointments.no_show} kelmadi), tushum ${som(around.result.revenue.total)}; oldingi 7 kun ${som(around.result.previous?.revenue ?? 0)}`);
  if (!around.isError) for (const d of around.result.doctors) console.log(`    ${d.doctor}: ${d.appointments} qabul, ${d.came} keldi, tushum ${som(d.revenue)}`);
  const began = Date.now();
  const month = await tool('davr hisoboti {"period":"last_30_days"}');
  ok("clinic_period: oxirgi 30 kun (60 kunlik ma'lumot yig'iladi)", !month.isError && month.result.days === 30, month.isError ? String(month.result) : `${Date.now() - began} ms; ${month.result.appointments.total} qabul, tushum ${som(month.result.revenue.total)}, eng yaxshi kun ${month.result.best_day?.date ?? '—'}`);
  const watch = await tool('klinika nazorati {}');
  ok('clinic_alerts javob berdi', !watch.isError && Array.isArray(watch.result.alerts), watch.isError ? String(watch.result) : watch.result.alerts.length ? watch.result.alerts.join(' | ') : "hammasi joyida (ogohlantirish yo'q)");

  console.log('\n# Bemor qidirish');
  const seedName: string = day.result?.doctors?.[0]?.appointments?.[0]?.patient ?? process.env.CRM_QUERY ?? 'a';
  const word = seedName.split(' ').sort((a, b) => b.length - a.length)[0];
  const byName = await tool(`bemor top ${JSON.stringify({ query: word })}`);
  ok(`ism bo'yicha («${word}»)`, !byName.isError && byName.result.total > 0, byName.isError ? String(byName.result) : `${byName.result.total} ta, birinchisi: ${byName.result.patients[0]?.name} ${byName.result.patients[0]?.phone ?? ''}`);
  const withPhone = byName.result?.patients?.find((p: Json) => String(p.phone ?? '').replace(/\D/g, '').length >= 9);
  if (withPhone) {
    const digits = String(withPhone.phone).replace(/\D/g, '').slice(-9);
    const byPhone = await tool(`bemor top ${JSON.stringify({ query: digits })}`);
    ok(`telefon bo'yicha (…${digits.slice(-4)})`, !byPhone.isError && byPhone.result.patients.some((p: Json) => p.patient_id === withPhone.patient_id), `${byPhone.result?.total} ta`);
  } else console.log('    (telefonli bemor topilmadi — telefon bo\'yicha qidiruv o\'tkazilmadi)');
  const none = await tool('bemor top {"query":"zzzqqq-yoq-bunday"}');
  ok("yo'q bemor — bo'sh ro'yxat", !none.isError && none.result.total === 0);

  console.log(`\n# Bo'sh vaqtlar: ${tomorrow}`);
  const free = await tool(`bo'sh vaqt {"date":"${tomorrow}"}`);
  ok('free_slots javob berdi', !free.isError && free.result.doctors.length > 0, free.isError ? String(free.result) : free.result.doctors.map((d: Json) => `${d.doctor}: ${d.slots.length} ta (${d.slots[0] ?? '—'}…${d.slots.at(-1) ?? '—'})`).join('; '));

  if (WRITE && !free.isError && byName.result?.patients?.length) {
    console.log('\n# Qabulga yozish (CRM_WRITE=1)');
    const doctor = free.result.doctors.find((d: Json) => d.slots.length >= 4) ?? free.result.doctors[0];
    const [s1, s2, s3] = [doctor.slots[1], doctor.slots[2], doctor.slots[3]];
    const patient = byName.result.patients[0];
    const first = await book({ patient_id: patient.patient_id, doctor_id: doctor.doctor_id, date: tomorrow, time: s1, type: 'Palantir sinov' });
    ok(`mavjud bemor yozildi: ${patient.name} → ${doctor.doctor}, ${tomorrow} ${s1}`, !first.isError && first.result.booked?.time === s1, first.isError ? String(first.result) : `qabul ${String(first.result.booked.appointment_id).slice(0, 8)}`);
    const after = await tool(`klinika kuni {"date":"${tomorrow}"}`);
    const seen = after.result?.doctors?.flatMap((d: Json) => d.appointments).find((a: Json) => a.time === s1 && a.patient === first.result?.booked?.patient);
    ok("CRM'dan qayta o'qilganda qabul bor", !!seen, seen ? `${seen.time} ${seen.patient} [${seen.status}]` : 'topilmadi');
    const freeAfter = await tool(`bo'sh vaqt ${JSON.stringify({ date: tomorrow, doctor_id: doctor.doctor_id })}`);
    ok("yozilgan vaqt endi bo'sh emas", !freeAfter.isError && !freeAfter.result.doctors[0].slots.includes(s1));
    const again = await book({ patient_id: patient.patient_id, doctor_id: doctor.doctor_id, date: tomorrow, time: s3 });
    ok('shu bemor shu kunga ikkinchi marta yozilmaydi', again.isError && String(again.result).includes('allaqachon'), String(again.result));
    const phone = `+99899${String(Date.now()).slice(-7)}`;
    const clash = await book({ new_patient: { first_name: 'Palantir', last_name: 'Band', phone: `+99898${String(Date.now()).slice(-7)}` }, doctor_id: doctor.doctor_id, date: tomorrow, time: s1 });
    ok('band vaqtga boshqa bemor yozilmaydi (yangi bemor ham yaratilmaydi)', clash.isError && String(clash.result).includes('band'), String(clash.result));
    const fresh = await book({ new_patient: { first_name: 'Palantir', last_name: 'Sinov', phone }, doctor_id: doctor.doctor_id, date: tomorrow, time: s2, type: 'Palantir sinov' });
    ok(`yangi bemor yaratildi va yozildi: ${tomorrow} ${s2}`, !fresh.isError && fresh.result.booked?.time === s2, fresh.isError ? String(fresh.result) : fresh.result.new_patient_created?.name);
    const found = await tool(`bemor top ${JSON.stringify({ query: phone })}`);
    ok('yangi bemor telefon bo\'yicha topiladi', !found.isError && found.result.total === 1, `${found.result?.total} ta`);
    const dup = await book({ new_patient: { first_name: 'Palantir', last_name: 'Takror', phone }, doctor_id: doctor.doctor_id, date: tomorrow, time: s3 });
    ok('shu telefon bilan ikkinchi bemor yaratilmaydi', dup.isError && String(dup.result).includes('bazada bor'), String(dup.result));
    const past = await book({ patient_id: patient.patient_id, doctor_id: doctor.doctor_id, date: iso(new Date(Date.now() - 86_400_000)), time: '10:00' });
    ok("o'tgan kunga yozilmaydi", past.isError, String(past.result));
    const night = await book({ patient_id: byName.result.patients[1]?.patient_id ?? patient.patient_id, doctor_id: doctor.doctor_id, date: iso(new Date(Date.now() + 2 * 86_400_000)), time: '03:00' });
    ok('ish vaqtidan tashqari yozilmaydi', night.isError, String(night.result));

    console.log("\n# Pul yozuvlari: to'lov, xarajat, shifokorga to'lov — tasdiq bilan, keyin ortga qaytariladi");
    const money = (id: string, verb: string) => api(`/api/crm/money/${id}/${verb}`, { token, body: {} });
    const revenue = async () => (await tool(`klinika kuni {"date":"${today}"}`)).result.revenue.total as number;
    const before = await revenue();
    const pay = await tool(`to'lov yoz ${JSON.stringify({ patient_id: patient.patient_id, amount: 123000, method: 'Card', service: 'Palantir sinov', doctor_id: doctor.doctor_id })}`);
    ok("record_payment: taklif tayyorlandi, tushum o'zgarmadi", !pay.isError && pay.result.status === 'waiting_for_owner' && await revenue() === before, pay.isError ? String(pay.result) : pay.result.summary.join('; '));
    const paid = await money(pay.result.draft_id, 'confirm');
    ok("tasdiqlangach: bugungi tushum 123 000 so'mga oshdi", paid.status === 200 && paid.json.entry?.status === 'done' && await revenue() === before + 123000, paid.status === 200 ? '' : String(paid.json.error));
    ok('ikkinchi marta tasdiqlab bo\'lmaydi', (await money(pay.result.draft_id, 'confirm')).status === 409 && await revenue() === before + 123000);
    const back = await money(pay.result.draft_id, 'undo');
    ok("ortga qaytarildi: tushum avvalgi holiga keldi", back.status === 200 && back.json.entry?.status === 'undone' && await revenue() === before, back.status === 200 ? '' : String(back.json.error));
    const spend = await tool('xarajat yoz {"amount":45000,"category":"Other","title":"Palantir sinov xarajati"}');
    const spent = await money(spend.result?.draft_id, 'confirm');
    ok("record_expense: xarajat yozildi", !spend.isError && spent.status === 200 && spent.json.entry?.status === 'done', spent.status === 200 ? spent.json.entry.details.join('; ') : String(spent.json.error));
    const twin = await tool('xarajat yoz {"amount":45000,"category":"Other","title":"Palantir sinov xarajati"}');
    const twinRefused = await money(twin.result?.draft_id, 'confirm');
    ok("aynan shunday xarajat ikkinchi marta yozilmaydi (CRM'dagi ro'yxatdan tekshiriladi)", twinRefused.status === 409 && String(twinRefused.json.error).includes('allaqachon bor'), String(twinRefused.json.error));
    ok("xarajat ortga qaytarildi", (await money(spend.result?.draft_id, 'undo')).json.entry?.status === 'undone');
    const rewritten = await money((await tool('xarajat yoz {"amount":45000,"category":"Other","title":"Palantir sinov xarajati"}')).result?.draft_id, 'confirm');
    ok("o'chirilgach xuddi shu xarajatni yana yozsa bo'ladi (o'chirish haqiqatan ishlagan)", rewritten.status === 200, String(rewritten.json.error ?? ''));
    await money(rewritten.json.entry?.id, 'undo');
    const share = await tool(`maosh ber ${JSON.stringify({ doctor_id: doctor.doctor_id, amount: 67000 })}`);
    const shared = await money(share.result?.draft_id, 'confirm');
    ok("pay_doctor: shifokorga to'lov yozildi", !share.isError && shared.status === 200, share.isError ? String(share.result) : shared.status === 200 ? shared.json.entry.details.join('; ') : String(shared.json.error));
    ok("shifokorga to'lov ortga qaytarildi", (await money(share.result?.draft_id, 'undo')).json.entry?.status === 'undone');

    console.log('\n# Resepshn: bemor botga yozadi, Palantir CRM\'ga yozadi');
    const textOf = (s: Sent) => String(s.params.text ?? s.params.caption ?? '');
    const got = (mark: number, chat: number, pred: (s: Sent) => boolean) => sent.slice(mark).find(s => Number(s.params.chat_id) === chat && pred(s));
    const me = (await api('/api/me', { token })).json.status;
    let mark = sent.length;
    say(OWNER, `/start o-${String(me.linkUrl).split('start=o-')[1]}`);
    await waitFor('egasi ulandi', () => got(mark, OWNER, s => textOf(s).includes('Ulandi')));
    await api('/api/business/auto-reply', { method: 'PUT', token, body: { mode: 'auto', contacts: false, delayMin: 0 } });
    const bizId = String(me.generalLink).split('start=l-')[1];
    const [P1, P2] = [7201, 7202];
    for (const id of [P1, P2]) { mark = sent.length; say(id, `/start l-${bizId}`); await waitFor('bemorga salom', () => got(mark, id, () => true)); }
    mark = sent.length;
    say(P1, "Ertaga bo'sh vaqt bormi?");
    await waitFor('bemorga javob', () => got(mark, P1, s => textOf(s).includes('Qaysi vaqt')));
    const block = /<clinic_schedule>\n([\s\S]*?)\n<\/clinic_schedule>/.exec(ai.replier.at(-1)?.user ?? '')?.[1] ?? '';
    ok("javob beruvchiga haqiqiy CRM'dan jadval berildi", block.includes('doctor_id') && block.includes(tomorrow), `${block.split('\n').length} qator`);
    console.log(block.split('\n').slice(0, 9).map(l => `    ${l}`).join('\n'));
    const target = free.result.doctors.find((d: Json) => d.slots.length >= 8) ?? free.result.doctors[0];
    const slot = target.slots[6];
    const phone1 = `+99897${String(Date.now()).slice(-7)}`;
    mark = sent.length;
    say(P1, `Meni yozing ${JSON.stringify({ doctor_id: target.doctor_id, date: tomorrow, time: slot, name: 'Resepshn Sinov', phone: phone1 })}`);
    const told = await waitFor('bemorga tasdiq', () => got(mark, P1, s => textOf(s).includes('yozdik')));
    ok(`bemor yozildi va unga aytildi: ${target.doctor}, ${tomorrow} ${slot}`, !!told, told ? textOf(told).replace(/\n/g, ' ') : '');
    ok('egasiga xabar berildi', !!(await waitFor('egaga xabar', () => got(mark, OWNER, s => textOf(s).includes('📅') && textOf(s).includes('Resepshn Sinov')))));
    const check = await tool(`klinika kuni {"date":"${tomorrow}"}`);
    const row = check.result?.doctors?.flatMap((d: Json) => d.appointments).find((a: Json) => a.time === slot && String(a.patient).includes('Resepshn'));
    ok("CRM'dan qayta o'qilganda qabul bor", !!row, row ? `${row.time} ${row.patient} [${row.status}] ${row.type}` : 'topilmadi');
    mark = sent.length;
    say(P2, `Meni yozing ${JSON.stringify({ doctor_id: target.doctor_id, date: tomorrow, time: slot, name: 'Ikkinchi Sinov', phone: `+99895${String(Date.now()).slice(-7)}` })}`);
    const refused = await waitFor('band kartasi', () => got(mark, OWNER, s => textOf(s).includes('band')));
    await sleep(500);
    ok('band vaqtga ikkinchi bemor yozilmadi, unga «yozdik» deyilmadi', !!refused && !got(mark, P2, s => textOf(s).includes('yozdik')), refused ? textOf(refused).replace(/\n/g, ' ').slice(0, 170) : '');
  } else if (!WRITE) {
    console.log("\n(Yozish sinovlari o'tkazilmadi — CRM_WRITE=1 bilan ishga tushiring; u CRM'ga sinov bemori va qabullar yozadi)");
  }

  console.log('\n# Holat');
  const st = (await api('/api/me', { token })).json.status.crm;
  ok('panelda muammo belgisi yo\'q', st.account && !st.problem, st.problem ?? st.account);
  const skipped = log.split('\n').filter(l => l.includes('[dentacrm]'));
  ok("CRM javoblarida o'qilmagan qator yo'q", skipped.length === 0, skipped.join(' | '));
  const errors = log.split('\n').filter(l => /\[(http|ai|asbob|crm)\]/.test(l));
  ok('serverda kutilmagan xato yo\'q', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  server.kill();
  aiServer.close();
  tgServer.close();
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows fayl band */ }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
process.exit(passed === results.length ? 0 : 1);
