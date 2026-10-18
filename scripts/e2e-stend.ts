/**
 * Stend sinovi: taqlid miya (sof mantiq) va stendning o'zi — haqiqiy server soxta dunyo bilan, dunyo qo'lda boshqariladigan yo'llar orqali.
 * Ishga tushirish: npx tsx scripts/e2e-stend.ts          (faqat mantiq: --logic)
 */
process.env.TZ = 'Asia/Tashkent';
import { ownerTurn, type Msg } from './stendBrain';
import { customerTurn } from './stendCustomer';
import { dueAt, parseAmount, parseName, parsePhone, parseWhen } from './stendParse';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let passed = 0;
const failures: string[] = [];
const ok = (name: string, cond: unknown, info = ''): void => {
  if (cond) passed++; else failures.push(name);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info.slice(0, 500)}` : ''}`);
};

/** 2026-10-13 — seshanba */
const NOW = new Date('2026-10-13T14:05:00');
const STAMP = '[2026-10-13 14:05, Seshanba · panel]\n';
const TOOLS = ['create_task', 'list_tasks', 'update_task', 'save_lead', 'list_leads', 'draft_followup', 'create_document', 'recent_conversations', 'remember', 'save_prices', 'read_page', 'write_page', 'get_summary',
  'clinic_day', 'clinic_period', 'clinic_cameras', 'clinic_alerts', 'find_patient', 'free_slots', 'book_appointment', 'record_payment', 'record_expense', 'pay_doctor'].map(name => ({ name }));

/** Egasi yozadi → taqlid miya asbob chaqiradi → `results` navbati bilan natija bo'lib qaytadi → oxirgi javob */
function ownerSays(text: string, results: (Json | { error: string })[] = [], tools = TOOLS): { calls: { name: string; input: Json }[]; text: string } {
  const messages: Msg[] = [{ role: 'user', content: STAMP + text }];
  const calls: { name: string; input: Json }[] = [];
  for (let step = 0; step < 8; step++) {
    const turn = ownerTurn(messages, tools, 'Name: Tabassum Dental\n<business_pages>\n- [pg1] Biznes haqida\n</business_pages>');
    messages.push({ role: 'assistant', content: turn.content });
    const use = turn.content.find(b => b.type === 'tool_use');
    if (!use) return { calls, text: String(turn.content.find(b => b.type === 'text')?.text ?? '') };
    calls.push({ name: use.name, input: use.input });
    // Natija berilmagan — sinov faqat chaqiruvning o'zini tekshiradi
    if (calls.length > results.length) return { calls, text: '' };
    const result = results[calls.length - 1];
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: 'error' in result ? result.error : JSON.stringify(result), ...('error' in result ? { is_error: true } : {}) }] });
  }
  return { calls, text: '(tugamadi)' };
}

function parseTests(): void {
  console.log('\n# Stend: sana, vaqt, summa, ism');
  /** «~09:00» — aniq soat aytilmagan, faqat kun qismi («ertalab») */
  const when = (text: string) => { const w = parseWhen(text, NOW); return `${w.date ?? '-'} ${w.time ?? (w.part ? `~${w.part}` : '-')} | ${w.rest}`; };
  ok('«ertaga soat 10 da»', when('Ertaga soat 10 da bankka borishni eslat') === '2026-10-14 10:00 | bankka borishni eslat', when('Ertaga soat 10 da bankka borishni eslat'));
  ok('hafta kuni va «15:30 da»', when("Juma kuni 15:30 da Alisherga qo'ng'iroq qilishni eslatib qo'y").startsWith('2026-10-16 15:30 | Alisherga'), when("Juma kuni 15:30 da Alisherga qo'ng'iroq qilishni eslatib qo'y"));
  ok('«shanba» «dushanba» ichidan topilmaydi', when('dushanba kuni yig\'ilish').startsWith('2026-10-19 -') && when('shanba kuni').startsWith('2026-10-17 -'), `${when("dushanba kuni yig'ilish")} / ${when('shanba kuni')}`);
  ok('«2 soatdan keyin», «yarim soatdan keyin»', when('2 soatdan keyin dori ichishni eslat').startsWith('2026-10-13 16:05') && when('yarim soatdan keyin').startsWith('2026-10-13 14:35'), when('2 soatdan keyin dori ichishni eslat'));
  ok('«kechqurun 7 da» — 19:00, «tushdan keyin 3 da» — 15:00, «kechasi soat 1» — 01:00', when('kechqurun 7 da').startsWith('- 19:00') && when('tushdan keyin 3 da').startsWith('- 15:00') && when('kechasi soat 1 da').startsWith('- 01:00') && when('kechasi 11 da').startsWith('- 23:00'), `${when('kechqurun 7 da')} / ${when('tushdan keyin 3 da')} / ${when('kechasi soat 1 da')}`);
  ok("«ertalab» — aniq soat emas: alohida belgilanadi (eslatmaga 09:00, qabulga — yo'q)", when('ertaga ertalab').startsWith('2026-10-14 ~09:00') && parseWhen('ertaga ertalab', NOW).time === null && dueAt(parseWhen('kechqurun dori ichish', NOW), NOW) === '2026-10-13T18:00', when('ertaga ertalab'));
  ok("telefon raqami va summa soat yoki sana bo'lib ketmaydi", when("+998 90 123 45 12 ga qo'ng'iroq qilishni eslat") === "- - | +998 90 123 45 12 ga qo'ng'iroq qilishni eslat" && when('Ijaraga 2.5 million ketdi') === '- - | Ijaraga 2.5 million ketdi' && when('3.5k berdim').startsWith('- -'), `${when("+998 90 123 45 12 ga qo'ng'iroq qilishni eslat")} / ${when('Ijaraga 2.5 million ketdi')}`);
  ok("taqvimda yo'q sana olinmaydi; «2,5 soatdan keyin» — ikki yarim soat", when('45-may').startsWith('- -') && when('2026-13-45').startsWith('- -') && when('31.02 da').startsWith('- -') && when('2,5 soatdan keyin').startsWith('2026-10-13 16:35'), `${when('45-may')} / ${when('2026-13-45')} / ${when('31.02 da')} / ${when('2,5 soatdan keyin')}`);
  ok("bugunga to'g'ri kelgan hafta kuni, soati o'tgan — keyingi hafta", dueAt(parseWhen('seshanba kuni soat 9 da', NOW), NOW) === '2026-10-20T09:00' && dueAt(parseWhen('seshanba kuni soat 18 da', NOW), NOW) === '2026-10-13T18:00', String(dueAt(parseWhen('seshanba kuni soat 9 da', NOW), NOW)));
  ok('«15.10.2026» — sana, «soat 15.30» — vaqt', when('15.10.2026 da').startsWith('2026-10-15 -') && when('soat 15.30 da').startsWith('- 15:30'), `${when('15.10.2026 da')} / ${when('soat 15.30 da')}`);
  ok('«25-oktabr», «indinga»', when('25-oktabr').startsWith('2026-10-25') && when('indinga').startsWith('2026-10-15'), `${when('25-oktabr')} / ${when('indinga')}`);
  ok("summa sana yoki vaqt bo'lib ketmaydi", when('Ijaraga 2 million ketdi') === '- - | Ijaraga 2 million ketdi' && when("Ali Valiyev 350 ming to'ladi") === "- - | Ali Valiyev 350 ming to'ladi", `${when('Ijaraga 2 million ketdi')} / ${when("Ali Valiyev 350 ming to'ladi")}`);
  ok("muddat: o'tgan soat — ertaga, kelgusi soat — bugun, vaqtsiz kun — 09:00", dueAt(parseWhen('soat 9 da', NOW), NOW) === '2026-10-14T09:00' && dueAt(parseWhen('soat 18 da', NOW), NOW) === '2026-10-13T18:00' && dueAt(parseWhen('juma kuni', NOW), NOW) === '2026-10-16T09:00' && dueAt(parseWhen('bankka borish', NOW), NOW) === null);

  const amount = (text: string) => parseAmount(text)?.amount ?? null;
  ok('summa: ming, mln, «1 mln 200 ming», ajratgichli son', amount('350 ming') === 350_000 && amount('1,5 mln') === 1_500_000 && amount('1 mln 200 ming') === 1_200_000 && amount("350 000 so'm") === 350_000 && amount('2 million') === 2_000_000 && amount('350000') === 350_000, [amount('350 ming'), amount('1,5 mln'), amount('1 mln 200 ming'), amount("350 000 so'm"), amount('2 million')].join());
  ok("summa: o'nlik nuqta bilan («2.5 million»)", amount('Ijaraga 2.5 million ketdi') === 2_500_000 && amount('1.5 milyon') === 1_500_000, `${amount('Ijaraga 2.5 million ketdi')} ${amount('1.5 milyon')}`);
  ok("summa: birliksiz kichik son va telefon — summa emas", amount('Breket 350') === null && amount('+998 90 123 45 67') === null && amount('998901234567') === null, `${amount('Breket 350')} ${amount('+998 90 123 45 67')} ${amount('998901234567')}`);
  ok('summa matndan olib tashlanadi', parseAmount("Ali Valiyev 350 ming to'ladi, karta")?.rest === "Ali Valiyev to'ladi, karta", parseAmount("Ali Valiyev 350 ming to'ladi, karta")?.rest);
  ok("ism: kelishik qo'shimchasi olinadi, shifokor familiyasi qo'shilmaydi", parseName('Ali Valiyevni Rustamovga yoz') === 'Ali Valiyev' && parseName('Ertaga Sardor Aliyev keladi') === 'Sardor Aliyev' && parseName('Saida Karimovaga') === 'Saida Karimova' && parseName('bankka borish') === null, `${parseName('Ali Valiyevni Rustamovga yoz')} / ${parseName('Ertaga Sardor Aliyev keladi')} / ${parseName('Saida Karimovaga')}`);
  ok('telefon: «+998…», mahalliy 9 raqam; summa telefon emas', parsePhone('+998 90 123 45 67')?.phone === '+998 90 123 45 67' && parsePhone('tel 90 123 45 67')?.phone === '90 123 45 67' && parsePhone('100 000 000') === null && parsePhone('350 000') === null, JSON.stringify([parsePhone('tel 90 123 45 67'), parsePhone('100 000 000')]));
}

const PATIENTS = { total: 2, patients: [{ patient_id: 'p1', name: 'Ali Valiyev', phone: '+998901112233', last_visit: null, balance: 0 }, { patient_id: 'p2', name: 'Vali Valiyev', phone: '+998932223344', last_visit: null, balance: 0 }] };
const BOARD = { date: '2026-10-13', doctors: [{ doctor_id: 'd1', doctor: 'Rustam Rustamov', specialty: 'Terapevt', slots: ['15:00', '15:30', '16:00', '17:30'], off: null }, { doctor_id: 'd2', doctor: 'Nodira Aliyeva', specialty: 'Ortodont', slots: [], off: null }] };

function ownerTests(): void {
  console.log('\n# Stend: taqlid miya — egasining gapi');
  const task = ownerSays('Ertaga soat 10 da bankka borishni eslat', [{ created: { id: 't1', title: 'Bankka borish', due_at: '2026-10-14T10:00', status: 'open', notes: null } }]);
  ok("eslatma: sarlavha va muddat egasining gapidan", task.calls.length === 1 && task.calls[0].name === 'create_task' && task.calls[0].input.title === 'Bankka borish' && task.calls[0].input.due_at === '2026-10-14T10:00' && task.text.includes('Ertaga 10:00'), JSON.stringify(task));
  const later = ownerSays("Juma kuni 15:30 da Alisherga qo'ng'iroq qilishni eslatib qo'y");
  ok("eslatma: «eslatib qo'y», ism katta harfda qoladi", later.calls[0]?.input.title === "Alisherga qo'ng'iroq qilish" && later.calls[0]?.input.due_at === '2026-10-16T15:30', JSON.stringify(later.calls));
  ok("eslatma: muddatsiz vazifa", ownerSays("Vazifa qo'sh: hisobot topshirish").calls[0]?.input.due_at === null && ownerSays("Vazifa qo'sh: hisobot topshirish").calls[0]?.input.title === 'Hisobot topshirish', JSON.stringify(ownerSays("Vazifa qo'sh: hisobot topshirish").calls));

  const done = ownerSays('Bankka borishni bajardim', [{ tasks: [{ id: 't1', title: 'Bankka borish', due_at: null, status: 'open' }, { id: 't2', title: 'Hisobot topshirish', due_at: null, status: 'open' }] }, { updated: { id: 't1', title: 'Bankka borish', due_at: null, status: 'done' } }]);
  ok("bajarildi: ro'yxatdan mos vazifani topib yopadi", done.calls.map(c => c.name).join() === 'list_tasks,update_task' && done.calls[1].input.task_id === 't1' && done.calls[1].input.status === 'done', JSON.stringify(done.calls));

  const fact = ownerSays('Eslab qol: yakshanba kuni ishlamaymiz');
  ok('fakt: «eslab qol» — eslatma emas', fact.calls[0]?.name === 'remember' && fact.calls[0].input.fact === 'Yakshanba kuni ishlamaymiz', JSON.stringify(fact.calls));
  const priced = ownerSays('Narxlarni saqla: Plomba 400 ming, Vinir 1,9 mln');
  ok('narx: ikki xizmat, «1,9 mln» bitta son', priced.calls[0]?.name === 'save_prices' && JSON.stringify(priced.calls[0].input.items) === JSON.stringify([{ name: 'Plomba', price: 400_000 }, { name: 'Vinir', price: 1_900_000 }]), JSON.stringify(priced.calls));
  ok("narx: «Plomba narxi 400 ming bo'ldi»", JSON.stringify(ownerSays("Plomba narxi 400 ming bo'ldi").calls[0]?.input.items) === JSON.stringify([{ name: 'Plomba', price: 400_000 }]), JSON.stringify(ownerSays("Plomba narxi 400 ming bo'ldi").calls));

  const paid = ownerSays("Ali Valiyev 350 ming to'ladi, karta, Rustamov", [PATIENTS, BOARD, { draft_id: 'm1', status: 'waiting_for_owner', summary: ["To'lov qabul qilish: 350 000 so'm", 'Bemor: Ali Valiyev'] }]);
  ok("to'lov: bemor → shifokor → karta taklifi (o'zi yozmaydi)", paid.calls.map(c => c.name).join() === 'find_patient,free_slots,record_payment' && paid.calls[0].input.query === 'Ali Valiyev' && JSON.stringify(paid.calls[2].input) === JSON.stringify({ patient_id: 'p1', amount: 350_000, doctor_id: 'd1', method: 'Card' }) && paid.text.includes('Tasdiqlash'), JSON.stringify(paid));
  const noDoctor = ownerSays("Ali Valiyev 350 ming to'ladi", [PATIENTS, BOARD]);
  ok("to'lov: shifokor aytilmasa — taxmin qilmaydi, so'raydi", noDoctor.calls.length === 2 && noDoctor.text.includes('qaysi shifokorga'), JSON.stringify(noDoctor));
  const stranger = ownerSays("Bobur Karimov 200 ming to'ladi, Rustamov", [{ total: 0, patients: [] }]);
  ok("to'lov: bazada yo'q bemor — to'xtaydi", stranger.calls.length === 1 && stranger.text.includes('topilmadi'), JSON.stringify(stranger));

  const rent = ownerSays('Ijaraga 2 million ketdi');
  ok('xarajat: summa, tur va nom', JSON.stringify(rent.calls[0]) === JSON.stringify({ name: 'record_expense', input: { amount: 2_000_000, category: 'Rent', title: 'Ijara' } }), JSON.stringify(rent.calls));
  const share = ownerSays('Rustamovga 3 million ulush berdim', [BOARD]);
  ok("shifokorga to'lov — xarajat emas", share.calls.map(c => c.name).join() === 'free_slots,pay_doctor' && JSON.stringify(share.calls[1].input) === JSON.stringify({ doctor_id: 'd1', amount: 3_000_000 }), JSON.stringify(share.calls));

  const booked = ownerSays('Ali Valiyevni ertaga 15:00 ga Rustamovga yoz', [PATIENTS, BOARD, { booked: { appointment_id: 'a9', patient: 'Ali Valiyev', doctor: 'Rustam Rustamov', date: '2026-10-14', time: '15:00', duration: 30, type: "Ko'rik" } }]);
  ok('qabulga yozish: bemor, kun, vaqt, shifokor', booked.calls.map(c => c.name).join() === 'find_patient,free_slots,book_appointment' && booked.calls[1].input.date === '2026-10-14' && JSON.stringify(booked.calls[2].input) === JSON.stringify({ patient_id: 'p1', doctor_id: 'd1', date: '2026-10-14', time: '15:00' }), JSON.stringify(booked.calls));
  const busy = ownerSays('Ali Valiyevni ertaga 15:00 ga Rustamovga yoz', [PATIENTS, BOARD, { error: 'Bu vaqt band: 15:00–15:30 (Sardor Aliyev)' }]);
  ok("asbob xatosi egasiga aytiladi, qayta urinilmaydi", busy.calls.length === 3 && busy.text.includes('Bu vaqt band'), busy.text);

  const absent = ownerSays('Ali Valiyev bugun 15:00 da qabulga kelmadi, Rustamov');
  ok("«…qabulga kelmadi» — xabar, buyruq emas: qabul yozilmaydi", !absent.calls.some(c => c.name === 'book_appointment' || c.name === 'find_patient') && !ownerSays('Ali Valiyev ertaga 15:00 da qabulga kelmaydi').calls.some(c => c.name === 'book_appointment'), JSON.stringify(absent.calls));
  const vague = ownerSays('Ali Valiyevni ertaga ertalab Rustamovga yoz');
  ok("«ertaga ertalab» — aniq soatsiz qabul yozilmaydi, soat so'raladi", !vague.calls.length && vague.text.includes('soat'), JSON.stringify(vague));
  const partial = ownerSays('Sardor Ali ertaga 15:00 ga Rustamovga yoz, +998 90 000 11 22', [{ total: 1, patients: [{ patient_id: 'p5', name: 'Sardor Aliyev', phone: '+998975556677', last_visit: null, balance: 0 }] }, BOARD]);
  ok("qidiruv ismning bir bo'lagi bo'yicha topgan boshqa bemor yozilmaydi — yangi bemor ochiladi", partial.calls[2]?.name === 'book_appointment' && !partial.calls[2].input.patient_id && partial.calls[2].input.new_patient?.last_name === 'Ali' && partial.calls[2].input.new_patient?.phone === '+998 90 000 11 22', JSON.stringify(partial.calls));
  const noApostrophe = ownerSays('Oktam Karimovni ertaga 15:00 ga Rustamovga yoz', [{ total: 1, patients: [{ patient_id: 'p3', name: "O'ktam Karimov", phone: '+998913334455', last_visit: null, balance: 0 }] }, BOARD]);
  ok("apostrofsiz yozilgan ism o'sha bemor", noApostrophe.calls[2]?.input.patient_id === 'p3', JSON.stringify(noApostrophe.calls));
  const ring = ownerSays("+998 90 123 45 12 ga qo'ng'iroq qilishni eslat");
  ok("eslatma: telefon raqamining oxiri soat bo'lib ketmaydi", ring.calls[0]?.name === 'create_task' && ring.calls[0].input.due_at === null && String(ring.calls[0].input.title).includes('45 12'), JSON.stringify(ring.calls));
  ok("xarajat: «2.5 million» — ikki yarim million", ownerSays('Ijaraga 2.5 million ketdi').calls[0]?.input.amount === 2_500_000, JSON.stringify(ownerSays('Ijaraga 2.5 million ketdi').calls));
  ok("«xabar yubormang» — qoralama tayyorlanmaydi", !ownerSays('Mijozlarga xabar yubormang: hali emas').calls.some(c => c.name === 'draft_followup' || c.name === 'list_leads'));
  ok("so'rovlar: klinika kuni, davr, bo'sh vaqt, bemor, yozishmalar, vazifalar, xulosa", [
    ['Bugungi qabullar va tushum', 'clinic_day'], ["O'tgan hafta hisoboti", 'clinic_period'], ["Ertaga bo'sh vaqt bormi?", 'free_slots'], ['Bemorni top: Valiyev', 'find_patient'],
    ['Kim yozdi?', 'recent_conversations'], ['Vazifalar', 'list_tasks'], ['Bugun nima qilishim kerak?', 'get_summary'], ['Kamera hisobi', 'clinic_cameras'],
  ].every(([text, tool]) => ownerSays(text).calls[0]?.name === tool), ['Bugungi qabullar va tushum', "O'tgan hafta hisoboti", "Ertaga bo'sh vaqt bormi?", 'Bemorni top: Valiyev', 'Kim yozdi?', 'Vazifalar', 'Bugun nima qilishim kerak?', 'Kamera hisobi'].map(t => ownerSays(t).calls[0]?.name).join());
  ok("davr va sana to'g'ri uzatiladi", ownerSays("O'tgan hafta hisoboti").calls[0]?.input.period === 'last_week' && ownerSays("Ertaga bo'sh vaqt bormi?").calls[0]?.input.date === '2026-10-14' && ownerSays('Bemorni top: Valiyev').calls[0]?.input.query === 'Valiyev');
  ok("CRM ulanmagan bo'lsa — CRM ishi chaqirilmaydi", ownerSays('Bugungi qabullar va tushum', [], TOOLS.slice(0, 13)).text.includes('DentaCRM ulangan') && !ownerSays("Ali Valiyev 350 ming to'ladi", [], TOOLS.slice(0, 13)).calls.length);
  const moved = ownerSays("Manzil o'zgardi: Yunusobod 4-mavze, 15-uy", [{ title: 'Biznes haqida', text: "Tabassum Dental.\n\n- Manzil: Chilonzor 7-mavze\n- Ish vaqti: 9:00–19:00" }, { saved: { page_id: 'pg1', title: 'Biznes haqida' } }]);
  ok("manzil o'zgardi: sahifani o'qib, faqat shu qatorni almashtiradi", moved.calls.map(c => c.name).join() === 'read_page,write_page' && moved.calls[1].input.text === "Tabassum Dental.\n\n- Manzil: Yunusobod 4-mavze, 15-uy\n- Ish vaqti: 9:00–19:00", JSON.stringify(moved.calls[1]?.input));
  const unknown = ownerSays('Nega osmon ko\'k?');
  ok("tushunmagan gapni taxmin qilmaydi — ochiq aytadi", !unknown.calls.length && unknown.text.includes('taqlid miya') && unknown.text.startsWith('🧪'), unknown.text.slice(0, 120));
  ok("telefon haqidagi eslatma «Biznes haqida»ni o'zgartirmaydi", ownerSays('Ertaga yangi telefon olishni eslat').calls[0]?.name === 'create_task', JSON.stringify(ownerSays('Ertaga yangi telefon olishni eslat').calls));
}

const SCHEDULE = ['- doctor_id d1 — Rustam Rustamov, Terapevt', "  2026-10-13 (Seshanba): 16:00–17:30", '  2026-10-14 (Chorshanba): 09:00–09:30, 11:00–17:30', '  2026-10-15 (Payshanba): klinika dam olish kuni',
  '- doctor_id d2 — Nodira Aliyeva, Ortodont', '  2026-10-13 (Seshanba): bo\'sh vaqt yo\'q', '  2026-10-14 (Chorshanba): 10:00–12:00', "  2026-10-15 (Payshanba): klinika dam olish kuni"].join('\n');
const KNOWLEDGE = ["ANSWERS THE OWNER APPROVED. …", "Q: Bo'lib to'lash bormi?\nA: 3 oygacha bo'lib to'lash mumkin", 'Q: Bolalarni qabul qilasizmi?\nA: 3 yoshdan qabul qilamiz', '',
  'PAGES THE OWNER WROTE OR APPROVED ABOUT THE BUSINESS …', '- Biznes haqida: Tabassum Dental — oilaviy klinika. - Manzil: Toshkent, Chilonzor 7-mavze, 12-uy - Ish vaqti: dushanba–shanba 9:00–19:00', "- Implant: Implant ikki bosqichda qo'yiladi. Avval implant, 3–4 oydan keyin koronka."].join('\n');

/** Mijoz yozadi (yozishma tarixi bilan) → taqlid miyaning qarori */
function customerSays(conversation: string[], clinic = true): Record<string, string> {
  return customerTurn([
    '<business_profile>\nName: Tabassum Dental\nProducts and services (price in so\'m, 0 = not given):\n- Plomba: 350000\n- Tish olish: 150000\n- Professional tozalash: 250000\n- Implant: 4500000\n- Konsultatsiya: 0\n</business_profile>',
    '<saved_facts>\n- Naqd va karta qabul qilamiz\n</saved_facts>',
    'Now: 2026-10-13 14:05 (Seshanba). Channel: Telegram bot. Customer: Mijoz.',
    `<owner_knowledge>\n${KNOWLEDGE}\n</owner_knowledge>`,
    ...(clinic ? [`<clinic_schedule>\n${SCHEDULE}\n</clinic_schedule>`] : []),
    `<conversation>\n${conversation.map(l => `[10-13 14:05] ${l}`).join('\n')}\n</conversation>`,
    "Decide how to answer the customer's latest message(s).",
  ].join('\n\n'));
}

function customerTests(): void {
  console.log('\n# Stend: taqlid miya — mijozning gapi');
  const known = customerSays(["Customer: Assalomu alaykum, bo'lib to'lash bormi?"]);
  ok('tasdiqlangan javob — bilimdan', known.action === 'reply' && known.reply === "3 oygacha bo'lib to'lash mumkin", JSON.stringify(known));
  ok("«Bolalarni qabul qilasizmi?» — savol, qabulga yozish emas", customerSays(['Customer: Bolalarni qabul qilasizmi?']).reply === '3 yoshdan qabul qilamiz');
  const price = customerSays(['Customer: Plomba qancha turadi?']);
  ok('narx — jadvaldan', price.action === 'reply' && price.reply === "Plomba — 350 000 so'm.", JSON.stringify(price));
  const noPrice = customerSays(['Customer: Breket qancha turadi?']);
  ok("jadvalda yo'q narx o'ylab topilmaydi — egasidan so'raladi", noPrice.action === 'ask_owner' && noPrice.question === 'Breket qancha turadi?' && !/\d{3}/.test(noPrice.reply), JSON.stringify(noPrice));
  ok('manzil va ish vaqti — egasining sahifasidan', customerSays(['Customer: Manzilingiz qayerda?']).reply === 'Manzilimiz: Toshkent, Chilonzor 7-mavze, 12-uy.' && customerSays(['Customer: Ish vaqtingiz qanday?']).reply.includes('9:00–19:00'), customerSays(['Customer: Manzilingiz qayerda?']).reply);
  ok('sahifadan javob', customerSays(["Customer: Implant qanday qo'yiladi?"]).reply.includes('ikki bosqichda'), customerSays(["Customer: Implant qanday qo'yiladi?"]).reply);
  const unknown = customerSays(['Customer: Homilador ayollarni qabul qilasizmi?']);
  ok("noma'lum savol — egasiga, umumiy savol bo'lib", unknown.action === 'ask_owner' && unknown.question === 'Homilador ayollarni qabul qilasizmi?', JSON.stringify(unknown));
  ok("«rahmat» — javob kerak emas", customerSays(['Customer: Plomba qancha?', "Business (assistant): Plomba — 350 000 so'm.", 'Customer: Rahmat!']).action === 'ignore');
  const two = customerSays(['Customer: Assalomu alaykum, plomba qancha turadi?', 'Customer: Homilador ayollarni qabul qilasizmi?']);
  ok("ikki savol: bilgani aytiladi, bilmagani egasidan so'raladi", two.action === 'ask_owner' && two.reply.startsWith("Plomba — 350 000 so'm.") && two.question === 'Homilador ayollarni qabul qilasizmi?' && two.note_for_owner.includes('Homilador'), JSON.stringify(two));
  const both = customerSays(["Customer: Plomba qancha turadi? Bo'lib to'lash bormi?"]);
  ok('bitta xabardagi ikki savolning ikkalasiga javob', both.action === 'reply' && both.reply === "Plomba — 350 000 so'm. 3 oygacha bo'lib to'lash mumkin", JSON.stringify(both));
  ok('faqat salom — salomga javob', customerSays(['Customer: Assalomu alaykum']).reply.startsWith('Assalomu alaykum'));

  const wants = customerSays(['Customer: Qabulga yozilmoqchi edim']);
  ok("qabul: avval bo'sh vaqtlarni taklif qiladi", wants.action === 'reply' && wants.reply.includes('16:00–17:30') && wants.reply.includes('Nodira Aliyeva — 10:00–12:00') && !wants.book_time, wants.reply);
  const chose = customerSays(['Customer: Qabulga yozilmoqchi edim', "Business (assistant): Yaqin bo'sh vaqtlar…", 'Customer: Ertaga soat 11 da']);
  ok("qabul: vaqt tanlandi, ism va telefon yo'q — so'raydi, «yozdik» demaydi", chose.action === 'reply' && chose.reply.includes('11:00') && chose.reply.includes('Rustam Rustamov') && chose.reply.includes('telefon') && !/yozdik|yozib qo'y/.test(chose.reply), chose.reply);
  const full = customerSays(['Customer: Qabulga yozilmoqchi edim', "Business (assistant): Yaqin bo'sh vaqtlar…", 'Customer: Ertaga soat 11 da', 'Business (assistant): …ism-familiyangiz va telefon…', 'Customer: Bobur Karimov, +998 90 123 45 67']);
  ok("qabul: hammasi bor — «book», shifokor, kun, vaqt, ism, telefon", full.action === 'book' && full.book_doctor_id === 'd1' && full.book_date === '2026-10-14' && full.book_time === '11:00' && full.customer_name === 'Bobur Karimov' && full.customer_phone === '+998 90 123 45 67', JSON.stringify(full));
  const taken = customerSays(['Customer: Meni ertaga 10:00 ga Rustamovga yozing, Bobur Karimov +998901234567']);
  ok("qabul: band vaqt taklif qilinmaydi — shu kunning bo'sh vaqtlari aytiladi", taken.action === 'reply' && taken.reply.includes('band') && taken.reply.includes('11:00–17:30'), taken.reply);
  ok("qabul: jadvalda yo'q kun — egasiga", customerSays(['Customer: Meni 25-oktabrga yozing']).action === 'ask_owner');
  ok("qabul: dam olish kuni — boshqa kunlar taklif qilinadi", customerSays(['Customer: Meni payshanba kuni soat 10 ga yozing']).reply.includes("qabul yo'q"), customerSays(['Customer: Meni payshanba kuni soat 10 ga yozing']).reply);
  ok("qabulni ko'chirish va og'riq — egasiga", customerSays(["Customer: Qabulimni boshqa kunga ko'chirsa bo'ladimi?"]).action === 'ask_owner' && customerSays(["Customer: Tishim og'riyapti"]).action === 'ask_owner');
  const after = customerSays(['Customer: Meni ertaga 11:00 ga yozing, Bobur Karimov +998901234567', 'Business (assistant): Sizni 14-oktabr kuni soat 11:00 ga yozdik. / 📅 2026-10-14 11:00, Rustam Rustamov', 'Customer: Plomba qancha turadi?']);
  ok("qabuldan keyingi oddiy savol qayta yozib qo'ymaydi", after.action === 'reply' && after.reply.startsWith('Plomba') && !after.book_time, JSON.stringify(after));
  const noName = customerSays(['Customer: Qabulga yozilmoqchi edim', "Business (assistant): Yaqin bo'sh vaqtlar…", 'Customer: Men ertaga soat 11 da kelaman', 'Customer: +998 90 123 45 67']);
  ok("qabul: ism aytilmagan — istalgan ikki so'z ism bo'lib ketmaydi, yozilmaydi", noName.action === 'reply' && noName.customer_name === '' && noName.reply.includes('ism-familiya') && customerSays(['Customer: Meni ertaga 11:00 ga yozing', 'Customer: Tish davolash 90 123 45 67']).action !== 'book', JSON.stringify(noName));
  const lower = customerSays(['Customer: Meni ertaga 11:00 ga yozing', 'Business (assistant): …ism-familiyangiz va telefon raqamingizni yuboring.', 'Customer: bobur karimov, 90 123 45 67']);
  ok("qabul: ism so'ralgandan keyin kichik harf bilan yozilgan ism ham olinadi", lower.action === 'book' && lower.customer_name === 'Bobur Karimov' && lower.book_time === '11:00', JSON.stringify(lower));
  const morning = customerSays(['Customer: Meni yozing, Bobur Karimov +998901234567', "Business (assistant): Yaqin bo'sh vaqtlar…", 'Customer: Ertaga ertalab kelaman']);
  ok("qabul: «ertaga ertalab» — soat o'ylab topilmaydi, shu kunning bo'sh vaqtlari so'raladi", morning.action === 'reply' && !morning.book_time && morning.reply.includes('Qaysi vaqt'), JSON.stringify(morning));
  const namesake = customerSays(['Customer: Meni ertaga 11:00 ga yozing, Madina Aliyeva +998901234567']);
  ok("qabul: bemorning familiyasi shifokornikiga o'xshasa ham shifokor shundan tanlanmaydi", namesake.action === 'book' && namesake.book_doctor_id === 'd1' && namesake.customer_name === 'Madina Aliyeva', JSON.stringify(namesake));
  const toDoctor = customerSays(['Customer: Ertaga 11:00 ga Nodira Aliyevaga yozilmoqchiman']);
  ok("qabul: shifokorning ismi bemorning ismi deb olinmaydi", toDoctor.action === 'reply' && toDoctor.customer_name === '' && toDoctor.reply.includes('Nodira Aliyeva') && toDoctor.reply.includes('ism-familiya'), JSON.stringify(toDoctor));
  const otherService = customerSays(['Customer: Tish oqartirish qancha turadi?']);
  ok("narx: nomi o'xshash boshqa xizmatning narxi aytilmaydi («Tish oqartirish» ≠ «Tish olish»)", otherService.action === 'ask_owner' && !/\d{3}/.test(otherService.reply), JSON.stringify(otherService));
  ok("narx: nomining bir qismi bilan so'ralsa — o'sha xizmat", customerSays(['Customer: Tozalash qancha?']).reply === "Professional tozalash — 250 000 so'm." && customerSays(['Customer: Tish olish narxi qancha?']).reply === "Tish olish — 150 000 so'm.", `${customerSays(['Customer: Tozalash qancha?']).reply} / ${customerSays(['Customer: Tish olish narxi qancha?']).reply}`);
  const bare = customerSays(['Customer: Narxi qancha?']);
  ok("mazmunsiz qisqa savol salomga aylanmaydi — egasiga o'tadi", bare.action === 'ask_owner' && customerSays(['Customer: Mumkinmi?']).action === 'ask_owner', JSON.stringify(bare));
  ok("mijoz o'z raqamini aytsa — bizning telefon aytilmaydi", !customerSays(['Customer: Mening raqamim 90 123 45 67'], false).reply.includes('Telefonimiz'));
  ok("savolga javob bilimda bo'lsa — qabul taklif qilinmaydi", customerSays(['Customer: Bolam bilan kelmoqchiman, bolalarni qabul qilasizlarmi?']).reply === '3 yoshdan qabul qilamiz', customerSays(['Customer: Bolam bilan kelmoqchiman, bolalarni qabul qilasizlarmi?']).reply);
  ok("klinika bo'lmagan biznesda qabul maydonlari yo'q", !('book_time' in customerSays(['Customer: Plomba qancha turadi?'], false)));
}

// ─── Stendning o'zi: haqiqiy server, dunyo — stend yo'llari orqali ───────────

const PORT = 3240;
const WORLD = `http://127.0.0.1:${PORT + 1}`;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const world = async (path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
  const r = await fetch(WORLD + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const snapshot = async (): Promise<Json> => (await world('/api/state')).json;
const plain = (m: Json): string => String(m.text).replace(/<[^>]+>/g, '');
const chatIn = (s: Json, id: number): Json => s.telegram.chats.find((c: Json) => c.id === id);
/** Suhbatdagi `mark`dan keyingi bot xabari */
const botSaid = (s: Json, id: number, mark: number, has: string): Json => chatIn(s, id)?.messages.find((m: Json) => m.id > mark && !m.mine && plain(m).includes(has));
const newest = (s: Json): number => Math.max(0, ...s.telegram.chats.flatMap((c: Json) => c.messages.map((m: Json) => m.id)));
async function seen<T>(what: string, pick: (s: Json) => T | undefined | false | null, ms = 20_000): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await pause(300)) {
    const v = pick(await snapshot());
    if (v) return v;
  }
  console.log(`    (kutildi, bo'lmadi: ${what})`);
  return undefined;
}
const button = (m: Json, code: string): string => m?.buttons.flat().find((b: Json) => String(b.data).startsWith(`${code}|`))?.data ?? '';

async function liveTests(): Promise<void> {
  const { spawn } = await import('node:child_process');
  let log = '';
  const stend = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'scripts/stend.ts'], { env: { ...process.env, STEND_PORT: String(PORT), STEND_FAKE_AI: '1', EVENING_HOUR: '99' }, stdio: ['ignore', 'pipe', 'pipe'] });
  stend.stdout.on('data', d => { log += d; });
  stend.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 240 && !log.includes('Stend tayyor') && stend.exitCode === null; i++) await pause(250);
    if (!log.includes('Stend tayyor')) throw new Error(`stend ishga tushmadi:\n${log.slice(-800)}`);

    console.log('\n# Stend: ishga tushdi');
    const first = await snapshot();
    const OWNER = first.owner as number;
    ok("model — taqlid, rejim — «Men tasdiqlayman», uchta kamera, egasi ulangan", first.model === 'taqlid' && first.mode?.mode === 'draft' && first.cameras.list.length === 3 && !!botSaid(first, OWNER, 0, 'Ulandi'), JSON.stringify({ model: first.model, mode: first.mode, cams: first.cameras.list.length }));
    ok("ertalabki xulosa keldi: CRM'dagi qabullar bilan", !!(await seen('ertalabki xulosa', s => botSaid(s, OWNER, 0, 'Xayrli tong') && botSaid(s, OWNER, 0, 'Qabullar'))));
    const from = async (headers: Record<string, string>, path = '/api/state', method = 'GET') => (await fetch(WORLD + path, { method, headers })).status;
    ok("begona sayt stendga buyruq bera olmaydi: boshqa Origin, «null» Origin, boshqa saytdagi rasm yoki ramka — 403", await from({ origin: 'http://evil.example' }) === 403 && await from({ origin: 'null' }) === 403
      && await from({ 'sec-fetch-site': 'cross-site' }) === 403 && await from({ 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, '/api/stop', 'POST') === 403
      && await from({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, '/') === 403);
    // Brauzerning havola bosilgandagi so'rovi (fetch «sec-fetch-mode»ni o'zi qo'yadi — shuning uchun oddiy HTTP so'rov)
    const { get } = await import('node:http');
    const opened = await new Promise<{ status: number; policy: string; body: string }>((done, fail) => {
      get(`${WORLD}/`, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, r => {
        let body = '';
        r.on('data', d => { body += d; });
        r.on('end', () => done({ status: r.statusCode ?? 0, policy: String(r.headers['content-security-policy'] ?? ''), body }));
      }).on('error', fail);
    });
    ok("sahifaning o'zi havola orqali ochiladi; skript faqat bir martalik belgi bilan ishlaydi, ramkaga qo'yib bo'lmaydi", opened.status === 200 && /script-src 'nonce-[^']+'/.test(opened.policy) && opened.policy.includes("frame-ancestors 'none'") && opened.body.includes(`<script nonce="${/nonce-([^']+)/.exec(opened.policy)?.[1]}">`), `${opened.status} ${opened.policy}`);
    ok("buzuq manzil stendni yiqitmaydi", await from({}, '//a:b') === 404 && await from({}, '/api/tg/file?chat=1', 'POST') === 400 && (await snapshot()).model === 'taqlid');

    console.log('\n# Stend: mijoz botga yozadi («Men tasdiqlayman»)');
    const bobur = (await world('/api/tg/customer', { name: 'Bobur Karimov' })).json.chat.id as number;
    ok("mijoz botga kirdi: salom va «raqamni yuborish» tugmasi", !!(await seen('salom', s => chatIn(s, bobur)?.messages.some((m: Json) => !m.mine && m.askContact))));
    let mark = newest(await snapshot());
    await world('/api/tg/send', { chat: bobur, text: 'Assalomu alaykum, plomba qancha turadi?' });
    const card = await seen('taklif kartasi', s => botSaid(s, OWNER, mark, 'Javob taklifi'));
    ok("egasiga taklif: narx jadvaldan, ikki tugma", !!card && plain(card).includes("Plomba — 350 000 so'm.") && !!button(card, 'ra') && !!button(card, 'rx'), card ? plain(card) : '');
    ok("mijozga hali javob ketmadi — faqat «yetkazildi»", !botSaid(await snapshot(), bobur, mark, '350 000') && !!botSaid(await snapshot(), bobur, mark, 'yetkazildi'));
    await world('/api/tg/press', { chat: OWNER, id: card.id, data: button(card, 'ra') });
    ok("«Yuborish» bosildi: mijoz javobni oldi, karta yopildi", !!(await seen('javob mijozda', s => botSaid(s, bobur, mark, "Plomba — 350 000 so'm."))) && !!(await seen('karta yopildi', s => { const m = chatIn(s, OWNER).messages.find((x: Json) => x.id === card.id); return m.edited && plain(m).includes('Yuborildi') && !m.buttons.length; })));

    console.log("\n# Stend: noma'lum savol → egasi javob beradi → «Eslab qol» → keyingi mijozga taklif bilimdan");
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: bobur, text: 'Homilador ayollarni qabul qilasizmi?' });
    const ask = await seen('egasidan so\'rash', s => botSaid(s, OWNER, mark, 'Homilador'));
    ok("bilmagan savol: egasiga izoh bilan", !!ask && plain(ask).includes("so'rayapti"), ask ? plain(ask) : '');
    await world('/api/tg/send', { chat: OWNER, text: 'Ha, ikkinchi uch oylikda qabul qilamiz, shifokor ruxsati bilan', replyTo: ask.id });
    ok("egasi kartaga «Reply» qildi — javob mijozga ketdi", !!(await seen('javob mijozda', s => botSaid(s, bobur, mark, 'ikkinchi uch oylikda'))));
    const learn = await seen('eslab qolaymi', s => botSaid(s, OWNER, mark, 'Eslab qolaymi?'), 30_000);
    ok("«Eslab qolaymi?» so'raldi", !!learn && !!button(learn, 'ky'), learn ? plain(learn) : '');
    await world('/api/tg/press', { chat: OWNER, id: learn.id, data: button(learn, 'ky') });
    ok("«Eslab qol» bosildi", !!(await seen('eslab qoldim', s => plain(chatIn(s, OWNER).messages.find((x: Json) => x.id === learn.id)).includes('Eslab qoldim'))));
    const dilnoza = (await world('/api/tg/customer', { name: 'Dilnoza Yusupova' })).json.chat.id as number;
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: dilnoza, text: 'Salom! Homilador ayollarni qabul qilasizmi?' });
    const learned = await seen('bilimdan taklif', s => botSaid(s, OWNER, mark, 'Javob taklifi'));
    ok("keyingi mijozga taklif — o'rganilgan javob", !!learned && plain(learned).includes('ikkinchi uch oylikda'), learned ? plain(learned) : '');

    console.log("\n# Stend: «O'zi javob bersin» va qabulga yozish");
    await world('/api/mode', { mode: 'auto', contacts: false, delayMin: 1 });
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: dilnoza, text: 'Manzilingiz qayerda?' });
    ok("mijozga o'zi javob berdi, egasiga xabar qildi", !!(await seen('manzil', s => botSaid(s, dilnoza, mark, 'Chilonzor 7-mavze'))) && !!(await seen('xabar', s => botSaid(s, OWNER, mark, 'javob berdim'))));
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: dilnoza, text: 'Qabulga yozilmoqchi edim' });
    ok("bo'sh vaqtlar CRM jadvalidan taklif qilindi", !!(await seen("bo'sh vaqtlar", s => botSaid(s, dilnoza, mark, 'Rustam Rustamov'))));
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: dilnoza, text: 'Ertaga soat 11 da' });
    ok("vaqt tanlandi — ism va telefon so'raldi (hali yozilmadi)", !!(await seen('ism va telefon', s => botSaid(s, dilnoza, mark, 'telefon'))) && !(await snapshot()).crm.appointments.some((a: Json) => a.origin === 'cerebro'));
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: dilnoza, text: 'Dilnoza Yusupova, +998 90 765 43 21' });
    const visit = await seen("CRM'da qabul", s => s.crm.appointments.find((a: Json) => a.origin === 'cerebro' && a.patientName === 'Dilnoza Yusupova'));
    ok("qabul CRM'ga yozildi: ertaga 11:00, Rustamov", !!visit && visit.time === '11:00' && visit.doctorId === 'd1' && visit.date > (await snapshot()).crm.today, JSON.stringify(visit));
    ok("bemorga tasdiq ketdi, egasi xabardor", !!(await seen('tasdiq', s => botSaid(s, dilnoza, mark, '11:00'))) && !!(await seen('egasiga', s => botSaid(s, OWNER, mark, 'Qabulga yozdim'))));
    ok("yangi bemor CRM bazasida ochildi", (await snapshot()).crm.patients.some((p: Json) => p.origin === 'cerebro' && p.lastName === 'Yusupova'));

    console.log('\n# Stend: yordamchi — vazifa, eslatma, pul yozuvi');
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: OWNER, text: 'Ertaga soat 10 da bankka borishni eslat' });
    ok("eslatma qo'yildi — egasining o'z gapidan", !!(await seen('eslatma', s => botSaid(s, OWNER, mark, 'Eslatma qo\'ydim: «Bankka borish» — Ertaga 10:00'))));
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: OWNER, text: '1 daqiqadan keyin suv ichishni eslat' });
    await seen('eslatma', s => botSaid(s, OWNER, mark, 'Suv ichish'));
    const remind = await seen('eslatma vaqti keldi', s => chatIn(s, OWNER).messages.find((m: Json) => m.id > mark && !m.mine && plain(m).startsWith('⏰') && plain(m).includes('Suv ichish')), 80_000);
    ok("vaqti kelganda bot o'zi eslatdi (uch tugma bilan)", !!remind && !!button(remind, 'td') && !!button(remind, 'ts') && !!button(remind, 'tt'));
    await world('/api/tg/press', { chat: OWNER, id: remind.id, data: button(remind, 'td') });
    ok("«Bajarildi» bosildi", !!(await seen('bajarildi', s => plain(chatIn(s, OWNER).messages.find((x: Json) => x.id === remind.id)).includes('✅ Bajarildi'))));

    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: OWNER, text: "Ali Valiyev 350 ming to'ladi, karta, Rustamov" });
    // Yordamchining matnli javobi emas, alohida keladigan karta: «Tasdiqlash» tugmasi shunda
    const moneyCard = (s: Json, title: string): Json => chatIn(s, OWNER).messages.find((m: Json) => m.id > mark && !m.mine && plain(m).includes(title) && button(m, 'ma'));
    const pay = await seen("to'lov kartasi", s => moneyCard(s, "To'lov qabul qilish: 350 000 so'm"));
    ok("to'lov: tekshirish kartasi keldi, CRM'ga hali yozilmadi", !!pay && !!button(pay, 'ma') && !(await snapshot()).crm.transactions.some((t: Json) => t.origin === 'cerebro'), pay ? plain(pay) : '');
    await world('/api/tg/press', { chat: OWNER, id: pay.id, data: button(pay, 'ma') });
    const written = await seen("CRM'da to'lov", s => s.crm.transactions.find((t: Json) => t.origin === 'cerebro'));
    ok("«Tasdiqlash»dan keyin CRM'ga yozildi: summa, usul, shifokor", written?.amount === 350_000 && written.type === 'Card' && written.doctorId === 'd1' && written.patientName === 'Ali Valiyev', JSON.stringify(written));
    const undo = await seen('ortga qaytarish tugmasi', s => { const m = chatIn(s, OWNER).messages.find((x: Json) => x.id === pay.id); return button(m, 'mu') ? m : undefined; });
    await world('/api/tg/press', { chat: OWNER, id: pay.id, data: button(undo, 'mu') });
    ok("«Ortga qaytarish» — CRM'dan o'chdi", !!(await seen("o'chdi", s => !s.crm.transactions.some((t: Json) => t.origin === 'cerebro'))));
    mark = newest(await snapshot());
    await world('/api/tg/send', { chat: OWNER, text: 'Ijaraga 2 million ketdi' });
    const rent = await seen('xarajat kartasi', s => moneyCard(s, "Xarajat: 2 000 000 so'm"));
    await world('/api/tg/press', { chat: OWNER, id: rent?.id, data: button(rent, 'ma') });
    ok("xarajat CRM'ga yozildi", !!(await seen("CRM'da xarajat", s => s.crm.expenses.find((x: Json) => x.origin === 'cerebro' && x.amount === 2_000_000 && x.category === 'Rent'))));
    mark = newest(await snapshot());
    await world('/api/tg/voice', { chat: OWNER, text: 'Bugungi qabullar va tushum' });
    ok("ovozli xabar: matnga aylandi va CRM'dan hisobot keldi", !!(await seen('ovoz', s => botSaid(s, OWNER, mark, '🎙') && botSaid(s, OWNER, mark, 'Tushum'))));

    console.log("\n# Stend: shaxsiy Telegram va Instagram (o'zi javob beradi, 1 «daqiqa» kutib)");
    const person = (await world('/api/personal/send', { name: 'Madina', username: 'madina_95', text: 'Assalomu alaykum, implant qancha turadi?' })).json.userId as string;
    const fromOwner = await seen('shaxsiy Telegram javobi', s => s.personal.find((p: Json) => p.userId === person)?.lines.find((l: Json) => !l.mine && l.text.includes('4 500 000')), 40_000);
    ok("shaxsiy Telegram: javob egasining akkauntidan ketdi", !!fromOwner && String(fromOwner.by).startsWith('Cerebro'), JSON.stringify(fromOwner));
    const thread = (await world('/api/instagram/send', { username: 'sardor.dev', name: 'Sardor', pending: true, text: 'Ish vaqtingiz qanday?' })).json.thread as string;
    const direct = await seen('Instagram javobi', s => s.instagram.find((t: Json) => t.id === thread)?.lines.find((l: Json) => !l.mine && l.text.includes('9:00–19:00')), 50_000);
    ok("Instagram: «So'rovlar»dagi suhbat qabul qilindi va javob yozildi", !!direct && String(direct.by).startsWith('Cerebro') && !(await snapshot()).instagram.find((t: Json) => t.id === thread).pending, JSON.stringify(direct));

    console.log("\n# Stend: kamera — CRM'da yo'q o'tirish");
    const before = await snapshot();
    // Kabinet 2 shifokorining bugungi qabullari bekor: endi u yerdagi har qanday o'tirish — farq (kun vaqtiga bog'liq bo'lmasin)
    for (const a of before.crm.appointments.filter((x: Json) => x.doctorId === 'd2' && x.date === before.crm.today)) await world('/api/crm/status', { id: a.id, status: 'Cancelled' });
    const cabinet = before.cameras.list.find((c: Json) => c.name === 'Kabinet 2').id as string;
    await world('/api/camera', { id: cabinet, present: true });
    ok('odam zonada 3 soniya turdi — seans ochildi', !!(await seen('seans', s => s.cameras.list.find((c: Json) => c.id === cabinet).state === 'open', 12_000)));
    await pause(6000);
    await world('/api/camera', { id: cabinet, present: false });
    const ghost = await seen('farq', s => s.cameras.summary?.findings.find((f: Json) => f.level === 'crit' && String(f.text).startsWith('Kabinet 2')), 25_000);
    ok("kresloga o'tirdi, CRM'da qabul yo'q — farq topildi", !!ghost && (await snapshot()).cameras.summary.seated >= 1, JSON.stringify((await snapshot()).cameras.summary));

    console.log("\n# Stend: ovozli agent darvozasi va tarmoq jurnali");
    const knows = String((await world('/api/voice/knowledge')).json.knowledge);
    ok("agent bilimi: narxlar, o'rganilgan javob, manzil", knows.includes('Plomba: 350000') && knows.includes('ikkinchi uch oylikda') && knows.includes('Chilonzor'), knows.slice(0, 300));
    mark = newest(await snapshot());
    const logged = await world('/api/voice/call', { name: 'Madina Tosheva', phone: '+998 93 707 11 22', outcome: "Implant narxini so'radi", durationSec: 21, transcript: [{ who: 'ai', text: 'Assalomu alaykum' }, { who: 'caller', text: 'Implant qancha?' }] });
    ok("qo'ng'iroq jurnalga tushdi, egasiga Telegram'da xabar keldi", logged.status === 200 && !!(await seen("qo'ng'iroq xabari", s => botSaid(s, OWNER, mark, 'Madina Tosheva'))));
    const toasts = (await snapshot()).telegram.toasts as Json[];
    ok("tugma ogohlantirishlari tartib raqami bilan keladi (20 tadan oshsa ham yangisi ko'rinadi)", toasts.length > 3 && toasts.every((t, i) => typeof t.n === 'number' && (i === 0 || t.n === toasts[i - 1].n + 1)), JSON.stringify(toasts.map(t => t.n)));
    const wire = (await snapshot()).wire as Json[];
    const services = new Set(wire.map(w => w.service));
    ok("tarmoq jurnali: Telegram, model, CRM, shaxsiy Telegram, Instagram chaqiruvlari", ['Telegram bot', 'Model', 'DentaCRM', 'Shaxsiy Telegram', 'Instagram'].every(x => services.has(x)), [...services].join());
    const model = wire.findLast(w => w.service === 'Model' && w.more);
    ok("jurnalda modelga berilgan matn va uning qarori ko'rinadi", !!model && JSON.stringify((await world(`/api/wire?n=${model.n}`)).json.entry.detail).length > 50);
    const errors = log.split('\n').filter(l => /^\[(http|server|bot|ai|asbob|crm|dentacrm|miya|mijozlar|kamera|ovoz|instagram|telegram-akkaunt|rasm|jadval)\]/.test(l.trim()));
    ok("butun sinov davomida serverda xato yozilmadi", !errors.length, errors.slice(0, 5).join(' | '));
  } finally {
    // Stend o'zi to'xtaydi (server bilan birga); javob bermasa — majburan
    await world('/api/stop', {}).catch(() => {});
    for (let i = 0; i < 20 && stend.exitCode === null; i++) await pause(250);
    stend.kill();
  }
}

parseTests();
ownerTests();
customerTests();
if (!process.argv.includes('--logic')) {
  try { await liveTests(); } catch (e) { ok('stend sinovi oxirigacha yetdi', false, String((e as Error).stack ?? e)); }
}
console.log(`\n${passed}/${passed + failures.length} o'tdi`);
if (failures.length) { console.log(`O'tmadi:\n${failures.map(f => `  - ${f}`).join('\n')}`); process.exit(1); }
process.exit(0);
