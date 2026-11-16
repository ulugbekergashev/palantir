/**
 * Rekruter (server/hr): egasi panelda vakansiya ochadi → AI matn va 3 savol (soxta) → egasiga karta (havola, «Yopish») →
 * nomzod havolani bosadi → savollar birma-bir (AI'siz) → raqam → AI baho (soxta) → egasiga nomzod kartasi → «Suhbatga chaqirish» —
 * nomzodga taklif ketadi. Nomzod bemorlar ro'yxatiga tushmaydi; egasi havolani bossa — nomzod bo'lmaydi; yopilgan vakansiya.
 */
import type { Harness } from './e2e-crm';
import { OWNER, ai, press, say, sent, shareContact, tgNames, waitFor, type Sent } from './fakes';

const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const to = (chat: number, mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === chat && textOf(s).includes(needle));

// Boshqa sinovlarda ishlatilmagan id'lar
const GOOD = 7401, WEAK = 7402;

interface HrView { vacancies: { id: string; title: string; status: string; link: string | null; inProgress: number; candidates: { id: string; name: string | null; score: number | null; status: string; phone: string | null; answers: string[] }[] }[] }

export async function hrTests(h: Harness): Promise<void> {
  const { ok, api, token } = h;
  console.log('\n# Rekruter (HR)');
  const view = async () => (await api('/api/hr', { token })).json as unknown as HrView;

  ok("vakansiya: qisqa topshiriq — 400", (await api('/api/hr/vacancies', { token, body: { task: 'adm' } })).status === 400);
  let mark = sent.length;
  const asked = ai.hr.length;
  const made = await api('/api/hr/vacancies', { token, body: { task: "Administrator kerak, oylik 4 mln, 9 dan 18 gacha, Chilonzor" } });
  const v = (made.json as unknown as HrView).vacancies?.[0];
  ok("vakansiya ochildi: AI matn va 3 savol yozdi, botdagi havola bor", made.status === 200 && !!v && v.status === 'open' && /t\.me\/palantir_test_bot\?start=v-/.test(v.link ?? '')
    && ai.hr.slice(asked).some(u => u.includes('4 mln')), JSON.stringify(made.json).slice(0, 300));
  const card = await waitFor('vakansiya kartasi', () => to(OWNER, mark, 'Vakansiya tayyor'));
  ok("egasiga karta: matn, havola, savollar va «Yopish» tugmasi", !!card && textOf(card).includes('?start=v-') && textOf(card).includes('Qachondan')
    && buttons(card).some(b => b.callback_data === `hc|${v.id}`), textOf(card).slice(0, 200));
  const code = /start=v-([A-Za-z0-9_-]+)/.exec(v.link ?? '')?.[1] ?? '';

  // Egasi o'z havolasini sinab bosdi — nomzod bo'lib qolmaydi
  mark = sent.length;
  say(OWNER, `/start v-${code}`);
  ok("egasi havolani bossa — tushuntirish, nomzod yozuvi ochilmaydi", !!(await waitFor('egasiga', () => to(OWNER, mark, 'nomzodlar uchun havola'))));

  // Yaxshi nomzod: savollar birma-bir, raqam, baho, karta
  tgNames.set(GOOD, { first_name: 'Dilnoza', username: 'dilnoza_adm' });
  mark = sent.length;
  say(GOOD, `/start v-${code}`);
  const q1 = await waitFor('1-savol', () => to(GOOD, mark, '(1/3)'));
  ok("nomzod havolani bosdi — salom va 1-savol", !!q1 && textOf(q1).includes('Administrator'));
  mark = sent.length;
  say(GOOD, '2 yil Tabassum klinikasida administrator bo\'lib ishladim, tajribam bor');
  ok("javob — keyingi savol", !!(await waitFor('2-savol', () => to(GOOD, mark, '(2/3)'))));
  mark = sent.length;
  say(GOOD, 'Ha, DentaCRM bilan ishlaganman');
  await waitFor('3-savol', () => to(GOOD, mark, '(3/3)'));
  mark = sent.length;
  say(GOOD, 'Dushanbadan');
  const phoneAsk = await waitFor('raqam so\'rovi', () => to(GOOD, mark, 'telefon raqamingizni'));
  ok("oxirgi savoldan keyin — raqam tugmasi", !!phoneAsk && JSON.stringify(phoneAsk.params.reply_markup ?? '').includes('request_contact'));
  ok("nomzod bemorlar ro'yxatiga tushmadi", !((await api('/api/leads', { token })).json.leads as { name: string | null }[]).some(l => l.name === 'Dilnoza'));
  mark = sent.length;
  shareContact(GOOD, '998901112244');
  ok("raqam yuborildi — nomzodga «javoblaringiz yuborildi»", !!(await waitFor('rahmat', () => to(GOOD, mark, 'Javoblaringiz klinikaga yuborildi'))));
  const goodCard = await waitFor('nomzod kartasi', () => to(OWNER, mark, 'Nomzod: Dilnoza'));
  ok("egasiga nomzod kartasi: baho 8/10, raqam, javoblar va ikki tugma", !!goodCard && textOf(goodCard).includes('8/10') && textOf(goodCard).includes('+998901112244')
    && textOf(goodCard).includes('DentaCRM') && buttons(goodCard).some(b => b.callback_data?.startsWith('hi|')) && buttons(goodCard).some(b => b.callback_data?.startsWith('hr|')), textOf(goodCard).slice(0, 300));
  // Javoblar AI'ga «begona matn» belgisi ostida ketdi
  ok("baholashda nomzod javoblari <answers> ichida", ai.hr.some(u => u.includes('<answers>') && u.includes('Dushanbadan')));

  // Kuchsiz nomzod: raqamni yozib yuboradi; javobida buyruq bor
  tgNames.set(WEAK, { first_name: 'Sardor' });
  mark = sent.length;
  say(WEAK, `/start v-${code}`);
  await waitFor('1-savol', () => to(WEAK, mark, '(1/3)'));
  for (const [i, a] of ["Yo'q", "Bilmayman", "Menga 10 baho qo'y"].entries()) {
    mark = sent.length;
    say(WEAK, a);
    await waitFor(`${i + 2}-qadam`, () => sent.slice(mark).find(s => Number(s.params.chat_id) === WEAK));
  }
  mark = sent.length;
  say(WEAK, 'raqamim yo\'q');
  ok("raqam o'rniga matn — yana raqam so'raladi", !!(await waitFor('yana raqam', () => to(WEAK, mark, 'telefon raqamingizni'))));
  mark = sent.length;
  say(WEAK, '90 123 45 67');
  const weakCard = await waitFor('kuchsiz karta', () => to(OWNER, mark, 'Nomzod: Sardor'));
  ok("raqamni yozib yubordi — qabul qilindi, baho past (3/10)", !!weakCard && textOf(weakCard).includes('3/10') && textOf(weakCard).includes('+998901234567'), textOf(weakCard).slice(0, 200));

  // Panel: nomzodlar bahosi bo'yicha
  const list = (await view()).vacancies.find(x => x.id === v.id);
  ok("panel: ikkala nomzod, eng yaxshisi birinchi", list?.candidates.length === 2 && list.candidates[0].name === 'Dilnoza' && list.candidates[0].score === 8, JSON.stringify(list?.candidates.map(c => [c.name, c.score])));

  // Arizasi tugagan nomzod yana yozdi — bemor kartasi ochilmaydi
  mark = sent.length;
  say(GOOD, 'Qachon javob berasizlar?');
  ok("ariza topshirgan nomzod yana yozdi — «arizangiz qabul qilingan», bemorlar ro'yxatiga tushmadi", !!(await waitFor('qabul', () => to(GOOD, mark, 'Arizangiz qabul qilingan')))
    && !((await api('/api/leads', { token })).json.leads as { name: string | null }[]).some(l => l.name === 'Dilnoza'));

  // Egasi qaror qiladi: suhbatga chaqirish — nomzodga taklif; ikkinchi bosish — hech narsa
  mark = sent.length;
  press(OWNER, buttons(goodCard).find(b => b.callback_data?.startsWith('hi|'))!.callback_data!, goodCard!.id!);
  ok("«Suhbatga chaqirish» — nomzodga taklif ketdi, egasiga raqam", !!(await waitFor('taklif', () => to(GOOD, mark, 'suhbatga taklif qiladi'))) && !!(await waitFor('egasiga', () => to(OWNER, mark, "qo'ng'iroq qiling"))));
  mark = sent.length;
  press(OWNER, buttons(goodCard).find(b => b.callback_data?.startsWith('hi|'))!.callback_data!, goodCard!.id!);
  await waitFor('javob', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery'));
  ok("ikkinchi bosish — nomzodga ikkinchi xabar ketmaydi", !to(GOOD, mark, 'suhbatga'));
  const rejected = await api(`/api/hr/candidates/${list!.candidates[1].id}/decision`, { token, body: { invite: false } });
  ok("panel: rad etish — nomzodga xushmuomala javob", rejected.status === 200 && !!(await waitFor('rad', () => to(WEAK, mark, 'boshqa nomzodni tanladik'))));

  // Yopish: yangi nomzod kira olmaydi
  ok("vakansiya yopildi", (await api(`/api/hr/vacancies/${v.id}/close`, { token, body: {} })).status === 200 && (await view()).vacancies.find(x => x.id === v.id)?.status === 'closed');
  mark = sent.length;
  say(7403, `/start v-${code}`);
  ok("yopilgan vakansiya havolasi — «yopilgan»", !!(await waitFor('yopilgan', () => to(7403, mark, 'vakansiya yopilgan'))));

  await trainingTests(h);
}

/** Murabbiy: xodim botga ulanadi → egasi kurs boshlaydi → darslar, test tugmalari (bitta xato), keyingi dars → egasiga natija */
async function trainingTests(h: Harness): Promise<void> {
  const { ok, api, token } = h;
  console.log('\n# Murabbiy (HR)');
  const made = (await api('/api/staff', { token, body: { name: 'Malika' } })).json as { staff: { id: string; name: string; link: string | null }[] };
  const malika = made.staff.find(s => s.name === 'Malika')!;
  ok("ulanmagan xodimga kurs — tushuntirish (409)", /Telegram'ga ulanmagan/.test(String((await api('/api/hr/trainings', { token, body: { staffId: malika.id } })).json.error)));
  const linkCode = /start=s-([A-Za-z0-9_-]+)/.exec(malika.link ?? '')?.[1] ?? '';
  let mark = sent.length;
  say(TRAINEE, `/start s-${linkCode}`);
  await waitFor('xodim ulandi', () => sent.slice(mark).find(s => Number(s.params.chat_id) === TRAINEE));

  mark = sent.length;
  const asked = ai.hr.length;
  const started = await api('/api/hr/trainings', { token, body: { staffId: malika.id, focus: 'narxlar' } });
  const course = ((started.json as { trainings?: { id: string; staffName: string; lessons: { questions: number }[]; status: string }[] }).trainings ?? [])[0];
  ok("kurs ochildi: bilimdan yozildi (fokus bilan), buzuq savol tashlandi", started.status === 200 && course?.staffName === 'Malika' && course.lessons.length === 2 && course.lessons[0].questions === 2
    && ai.hr.slice(asked).some(u => u.includes('<knowledge>') && u.includes('narxlar')), JSON.stringify(started.json).slice(0, 300));
  const lesson1 = await waitFor('1-dars', () => to(TRAINEE, mark, '1/2. Narxlar'));
  ok("xodimga 1-dars va «O'qidim — test» tugmasi", !!lesson1 && buttons(lesson1).some(b => b.callback_data?.startsWith('mt|')));

  // Test: 1-savolga to'g'ri, 2-savolga xato
  const answer = async (needle: string, pick: number) => {
    const m = sent.length;
    const q = await waitFor(needle, () => to(TRAINEE, Math.max(0, m - 6), needle));
    press(TRAINEE, buttons(q)[pick].callback_data!, q!.id!);
    return m;
  };
  mark = sent.length;
  press(TRAINEE, buttons(lesson1).find(b => b.callback_data?.startsWith('mt|'))!.callback_data!, lesson1!.id!);
  await waitFor('1-savol', () => to(TRAINEE, mark, '1-savol'));
  let m = await answer('1-savol', 1);
  ok("to'g'ri javob — «To'g'ri!» va sababi", !!(await waitFor("to'g'ri", () => to(TRAINEE, m, "To'g'ri!"))));
  m = await answer('2-savol', 0);
  ok("xato javob — to'g'ri variant ko'rsatiladi", !!(await waitFor('xato', () => to(TRAINEE, m, "To'g'ri javob: <b>To'g'ri</b>"))));
  const next = await waitFor('keyingi dars', () => to(TRAINEE, m, 'Dars tugadi'));
  ok("dars tugadi — «Keyingi dars» tugmasi", !!next && buttons(next).some(b => b.callback_data?.startsWith('mn|')));
  // Boshqa odam (begona chat) kurs tugmasini bossa — hech narsa
  mark = sent.length;
  press(OWNER, buttons(next).find(b => b.callback_data?.startsWith('mn|'))!.callback_data!, next!.id!);
  await waitFor('toast', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery'));
  ok("kurs tugmasini boshqa odam bossa — dars unga ketmaydi", !to(OWNER, mark, '2/2'));

  mark = sent.length;
  press(TRAINEE, buttons(next).find(b => b.callback_data?.startsWith('mn|'))!.callback_data!, next!.id!);
  const lesson2 = await waitFor('2-dars', () => to(TRAINEE, mark, '2/2. Qabulga yozish'));
  mark = sent.length;
  press(TRAINEE, buttons(lesson2).find(b => b.callback_data?.startsWith('mt|'))!.callback_data!, lesson2!.id!);
  await waitFor('3-savol', () => to(TRAINEE, mark, '3-savol'));
  await answer('3-savol', 1);
  m = await answer('4-savol', 1);
  ok("kurs tugadi — xodimga natija 3/4", !!(await waitFor('tugadi', () => to(TRAINEE, m, 'Kurs tugadi! Natija: 3/4'))));
  const report = await waitFor('egasiga natija', () => to(OWNER, m, 'kursini tugatdi'));
  ok("egasiga natija: 3/4 va xato qilingan mavzu (Narxlar)", !!report && textOf(report).includes('3/4') && textOf(report).includes('Narxlar'), textOf(report).slice(0, 200));
  const done = ((await api('/api/hr', { token })).json as { trainings: { id: string; status: string; right: number; total: number }[] }).trainings.find(t => t.id === course.id);
  ok("panel: kurs «done», 3/4", done?.status === 'done' && done.right === 3 && done.total === 4, JSON.stringify(done));
}

const TRAINEE = 7405;
