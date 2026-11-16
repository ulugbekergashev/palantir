/**
 * AI jamoa tarkibi (src/lib/crew.ts, server/crew.ts) — brauzer va AI'siz:
 *   asosiy — AI administrator (Qabulxona) va Palantir, Direktor o'zi qo'shiladi (olib tashlasa bo'ladi — B1); ishi ulangan xodim o'zi
 *   qo'shiladi, egasi olib tashlagani qaytib qo'shilmaydi; eski baza (tarkib hali hisoblanmagan) — hamma xodim avvalgidek ishlaydi;
 *   B1 migratsiyasi (Qabulxonani olib tashlagan klinika — javob «o'chiq», telefon «faqat administrator»);
 *   Direktor jamoada yo'q xodimga taklif bermaydi; API: ishga olish, asosiy xodimni olib tashlab bo'lmaydi.
 * Ishga tushirish: npm run test:crew
 */
import './isolate';
import assert from 'node:assert/strict';

const { CORE, crewHas, crewList, crewWorks, hiredIn, inUse, parseCrew, setHired, withInUse, works } = await import('../src/lib/crew');
const { businesses } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');
const { replySettings } = await import('../server/inbox/core');
const { cleanPlan } = await import('../server/director/logic');
const { moveMembersOf } = await import('../server/director/index');

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const none = { customers: false, crm: false, cameras: 0, metaAi: false, marketingPosts: 0, content: false, ads: false, vacancies: false, trainings: false };

console.log('\n# Qoida');
check('yangi biznes: asosiy — AI administrator va Palantir, Direktor o\'zi qo\'shiladi (B1)', () => {
  assert.deepEqual(crewList(withInUse(null, inUse(none))), ['direktor', 'qabulxona', 'yordamchi']);
  assert.deepEqual([...CORE], ['qabulxona', 'yordamchi']);
});
check("B1: Direktorni olib tashlasa bo'ladi va u o'zi qaytib qo'shilmaydi; AI administratorni — yo'q", () => {
  const out = setHired(withInUse(null, inUse(none)), 'direktor', false);
  assert.equal(crewList(out).includes('direktor'), false);
  assert.equal(crewList(withInUse(out, inUse(none))).includes('direktor'), false);
  assert.equal(works(setHired(out, 'qabulxona', false), 'qabulxona'), true);
});
check("Instagram ulandi — Qabulxona va Tahlilchi o'zi qo'shiladi; kamera — Kuzatuvchi", () => {
  const s = withInUse(null, inUse({ ...none, customers: true, cameras: 2 }));
  assert.deepEqual(crewList(s), ['direktor', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi']);
});
check("Instagram postlari — Kontent-meykerning ishi (Marketolog emas); Meta AI — Marketolog", () => {
  assert.deepEqual(crewList(withInUse(null, inUse({ ...none, marketingPosts: 1 }))), ['direktor', 'qabulxona', 'yordamchi', 'kontent']);
  assert.deepEqual(crewList(withInUse(null, inUse({ ...none, metaAi: true }))), ['direktor', 'qabulxona', 'yordamchi', 'marketolog']);
});
check("egasi olib tashlagan xodim ishi ulangan bo'lsa ham qaytib qo'shilmaydi; «Ishga olish» bilan qaytadi", () => {
  const hired = withInUse(null, inUse({ ...none, cameras: 1 }));
  const out = setHired(hired, 'kuzatuvchi', false);
  assert.equal(works(out, 'kuzatuvchi'), false);
  assert.equal(works(withInUse(out, inUse({ ...none, cameras: 1 })), 'kuzatuvchi'), false);
  const back = setHired(out, 'kuzatuvchi', true);
  assert.equal(works(back, 'kuzatuvchi'), true);
  assert.deepEqual(back.dismissed, []);
});
check("asosiy xodimni olib tashlab bo'lmaydi; noma'lum nom va buzuq JSON — e'tiborsiz", () => {
  assert.equal(works(setHired(null, 'qabulxona', false), 'qabulxona'), true);
  assert.deepEqual(parseCrew('{"hired":["kontent","boshqa","qabulxona"],"dismissed":"x"}'), { hired: ['kontent'], dismissed: [] });
  assert.equal(parseCrew('{buzuq'), null);
});
check('tarkib hali hisoblanmagan (eski baza) — hamma xodim fonda avvalgidek ishlaydi va jamoada', () => {
  assert.equal(works(null, 'qabulxona'), true);
  assert.equal(crewWorks({ crew: null }, 'kontent'), true);
  assert.equal(crewHas({ crew: null }, 'kontent'), true);
});
check("hali ishga olinmagan, lekin olib tashlanmagan — fonda ishlaydi (panel ochilmasdan ishi ulangan), jamoada esa yo'q", () => {
  const fresh = JSON.stringify({ hired: [], dismissed: [] });
  assert.equal(crewWorks({ crew: fresh }, 'kuzatuvchi'), true);
  assert.equal(crewHas({ crew: fresh }, 'kuzatuvchi'), false);
  assert.equal(hiredIn(null, 'kuzatuvchi'), true);
  assert.equal(crewHas({ crew: fresh }, 'qabulxona'), true, 'AI administrator — doim jamoada');
});
check("o'zgarish bo'lmasa — o'sha holat (bazaga qayta yozilmaydi)", () => {
  const s = withInUse(null, inUse({ ...none, ads: true }));
  assert.equal(withInUse(s, inUse({ ...none, ads: true })), s);
});

console.log('\n# Server');
const biz = businesses.create('crew-sinov', 'x', emptyBusiness('Sinov klinika', 'stomatologiya'));
check("B1: javob rejimi — faqat egasining sozlamasi (AI administrator jamoadan chiqmaydi; eski «olib tashlangan» yozuvi e'tiborsiz)", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: [], dismissed: ['qabulxona'] }) });
  assert.equal(replySettings(businesses.byId(biz.id)!).mode, 'draft');
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
});

console.log('\n# B1 migratsiyasi (server/migrate.ts v3)');
{
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS } = await import('../server/migrate');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE businesses (id TEXT PRIMARY KEY, crew TEXT, profile TEXT NOT NULL); CREATE TABLE connections (business_id TEXT NOT NULL, kind TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}')");
  const add = db.prepare('INSERT INTO businesses (id, crew, profile) VALUES (?, ?, ?)');
  add.run('off', JSON.stringify({ hired: ['kuzatuvchi'], dismissed: ['qabulxona', 'kontent'] }), JSON.stringify({ name: 'A', autoReply: { mode: 'auto', contacts: true, delayMin: 5 } }));
  add.run('on', JSON.stringify({ hired: ['qabulxona'], dismissed: [] }), JSON.stringify({ name: 'B', autoReply: { mode: 'auto', contacts: false, delayMin: 2 } }));
  add.run('nodir', JSON.stringify({ hired: [], dismissed: ['direktor'] }), JSON.stringify({ name: 'C' }));
  add.run('eski', null, JSON.stringify({ name: 'D' }));
  db.prepare("INSERT INTO connections (business_id, kind, meta) VALUES ('off', 'sip_line', ?), ('on', 'sip_line', ?)").run(JSON.stringify({ mode: 'day_admin', ring: '20' }), JSON.stringify({ mode: 'ai' }));
  MIGRATIONS.find(m => m.version === 3)!.up(db);
  const row = (id: string) => db.prepare('SELECT crew, profile FROM businesses WHERE id = ?').get(id) as { crew: string | null; profile: string };
  const meta = (id: string) => JSON.parse((db.prepare("SELECT meta FROM connections WHERE business_id = ? AND kind = 'sip_line'").get(id) as { meta: string }).meta);
  check("AI administratorni olib tashlagan klinika: bemorlarga javob «o'chiq» (qolgan sozlama joyida), telefon «faqat administrator»", () => {
    assert.deepEqual(JSON.parse(row('off').profile).autoReply, { mode: 'off', contacts: true, delayMin: 5 });
    assert.deepEqual(meta('off'), { mode: 'human', ring: '20' });
    assert.deepEqual(JSON.parse(row('off').crew!), { hired: ['kuzatuvchi', 'direktor'], dismissed: ['kontent'] });
  });
  check("olib tashlamagan klinika: javob va telefon o'zgarmaydi, Direktor jamoada qoladi", () => {
    assert.equal(JSON.parse(row('on').profile).autoReply.mode, 'auto');
    assert.equal(meta('on').mode, 'ai');
    assert.deepEqual(JSON.parse(row('on').crew!).hired, ['direktor']);
  });
  check("Direktorni egasi olib tashlagan bo'lsa — qaytmaydi; tarkibi hisoblanmagan eski baza — tegilmaydi", () => {
    assert.deepEqual(JSON.parse(row('nodir').crew!), { hired: [], dismissed: ['direktor'] });
    assert.equal(row('eski').crew, null);
  });
  db.close();
}
check("Direktor faqat jamoadagi xodimga va egasiga taklif beradi", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  const members = moveMembersOf(businesses.byId(biz.id)!);
  assert.deepEqual(members, ['qabulxona', 'yordamchi', 'egasi']);
  const numbers = { inquiries: { now: 4, prev: 6 } };
  const plan = cleanPlan({ summary: 's', problem: null, moves: [
    { member: 'marketolog', task: "Post yoz", why: 'x', metric: 'inquiries', check_days: 5 },
    { member: 'qabulxona', task: 'Tezroq javob ber', why: 'x', metric: 'inquiries', check_days: 5 },
  ] }, numbers, members);
  assert.deepEqual(plan.moves.map(m => m.member), ['qabulxona']);
});
check("Direktor Marketologga bermaydi (o'zi ishlaydigan fon ishi yo'q) — u egasiga; Tahlilchi, Kontent-meyker va Targetolog o'qiydi", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona', 'kuzatuvchi', 'tahlilchi', 'marketolog', 'kontent', 'target'], dismissed: [] }) });
  assert.deepEqual(moveMembersOf(businesses.byId(biz.id)!), ['qabulxona', 'yordamchi', 'tahlilchi', 'kontent', 'target', 'kuzatuvchi', 'egasi']);
});
{
  const { companyContext } = await import('../server/company');
  const { orders } = await import('../server/orders/store');
  check("Kontent-meyker va Targetolog topshirig'i ularning ishiga yetadi (reja/post — content, reklama rejasi — ads); boshqasiga aralashmaydi", () => {
    orders.create(biz.id, 'kontent', "Haftada 2 marta bolalar stomatologiyasi haqida post", { kind: 'standing' }, 'x');
    orders.create(biz.id, 'target', 'Implant reklamasini to\'xtat, tozalashni reklama qil', { kind: 'standing' }, 'x');
    const b = businesses.byId(biz.id)!;
    const content = companyContext(b, 'content'), ads = companyContext(b, 'ads'), customers = companyContext(b, 'customers');
    assert.ok(content.includes('<owner_standing_orders>') && content.includes('bolalar stomatologiyasi') && !content.includes('Implant reklamasini'), content);
    assert.ok(ads.includes('Implant reklamasini') && !ads.includes('bolalar stomatologiyasi'), ads);
    assert.ok(!customers.includes('owner_standing_orders'), customers);
  });
  const { analystFocus } = await import('../server/insights/analyze');
  check("Tahlilchi topshirig'i haftalik va chuqur tahlilga yetadi; boshqa xodimnikisi aralashmaydi", () => {
    assert.equal(analystFocus(biz.id), '');
    orders.create(biz.id, 'tahlilchi', "Breket haqidagi savollarni alohida kuzat", { kind: 'standing' }, 'x');
    const f = analystFocus(biz.id);
    assert.ok(f.includes('<owner_focus>') && f.includes('Breket') && !f.includes('bolalar stomatologiyasi') && !f.includes('Implant reklamasini'), f);
  });
}

console.log("\n# Asboblar xodim bo'yicha (3-bosqich)");
{
  const { toolOwner, chatGroups, memberGroups, ownerToolDefs, runTool } = await import('../server/tools');
  const { businesses } = await import('../server/db');
  check('asbob egasi: kontent, reklama, kamera, Meta AI — mutaxassisniki; vazifa — Yordamchiniki', () => {
    assert.equal(toolOwner('content_video'), 'kontent');
    assert.equal(toolOwner('draft_post'), 'kontent');
    assert.equal(toolOwner('ads_plan'), 'target');
    assert.equal(toolOwner('look_camera'), 'kuzatuvchi');
    assert.equal(toolOwner('meta_ai'), 'marketolog');
    assert.equal(toolOwner('create_task'), null);
  });
  check("suhbatda — Yordamchi va jamoadagi mutaxassislar; topshiriqda — faqat bajaruvchiniki", () => {
    assert.deepEqual(chatGroups({ crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'kontent'], dismissed: [] }) }), ['base', 'qabulxona', 'kontent'], 'AI administrator — doim jamoada (B1)');
    assert.deepEqual(chatGroups({ crew: null }), ['base', 'qabulxona', 'kontent', 'target', 'marketolog', 'kuzatuvchi', 'rekruter', 'murabbiy'], 'eski baza — hammasi');
    assert.deepEqual(memberGroups('kontent'), ['kontent']);
    assert.deepEqual(memberGroups('tahlilchi'), ['base']);
    assert.deepEqual(memberGroups('qabulxona'), ['base', 'qabulxona'], "Qabulxona topshirig'i mijozlar va yozishmalarni ham o'qiydi");
    assert.equal(toolOwner('draft_followup'), 'qabulxona', 'mijozga yozish — Qabulxonaniki');
    const k = ownerToolDefs(false, ['kontent']).map(([n]) => n);
    assert.ok(k.includes('content_plan') && !k.includes('create_task') && !k.includes('ads_plan'));
  });
  check("kameralar va CRM taqqoslashi (clinic_cameras) — Kuzatuvchiniki: u olinmagan bo'lsa Yordamchida yo'q", () => {
    assert.equal(toolOwner('clinic_cameras'), 'kuzatuvchi');
    assert.ok(!ownerToolDefs(true, ['base']).some(([n]) => n === 'clinic_cameras'));
    assert.ok(ownerToolDefs(true, ['base', 'kuzatuvchi']).some(([n]) => n === 'clinic_cameras'));
    assert.ok(ownerToolDefs(true, ['base']).some(([n]) => n === 'clinic_day'), 'qolgan klinika asboblari joyida');
  });
  check("brend-buk — hammaniki: Kontent-meykersiz ham Yordamchida bor, Kontent-meyker topshirig'ida ham", () => {
    assert.equal(toolOwner('content_brand_book'), null);
    assert.ok(ownerToolDefs(false, ['base']).some(([n]) => n === 'content_brand_book'), 'Yordamchi (Kontent-meyker olinmagan)');
    assert.ok(ownerToolDefs(false, ['kontent']).some(([n]) => n === 'content_brand_book'), "Kontent-meyker o'z topshirig'ida video uchun brend-buk yoza oladi");
  });
  const biz = businesses.create(`jamoa${Date.now()}`, 'x', { name: 'J', ownerName: 'X', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['direktor', 'yordamchi'], dismissed: [] }) });
  const b = businesses.byId(biz.id)!;
  const out = await runTool('content_plan', { count: 5 }, { biz: b, artifacts: [] });
  check("jamoada yo'q mutaxassis asbobi chaqirilsa ham ishlamaydi — «+ Xodim qo'shish»", () => {
    assert.equal(out.isError, true);
    assert.match(out.content, /Kontent-meykerning ishi, u jamoada yo'q/);
  });
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'kontent', 'tahlilchi'], dismissed: [] }) });
  const other = await runTool('content_plan', { count: 5 }, { biz: businesses.byId(biz.id)!, artifacts: [], as: 'tahlilchi' });
  check("topshiriq bajaruvchi boshqa xodimning ishini qilmaydi", () => {
    assert.equal(other.isError, true);
    assert.match(other.content, /Tahlilchi uni qilmaydi/);
  });
}

console.log("\n# «Bugun jamoa» hisoblagichlari va kamera zonalari (5-bosqich)");
{
  const { teamDay } = await import('../server/teamDay');
  const { events } = await import('../server/orders/store');
  const { contentStore } = await import('../server/content/store');
  const { camerasText } = await import('../server/orders/parse');
  const biz = businesses.create(`kun${Date.now()}`, 'x', emptyBusiness('Kun klinika', 'stomatologiya'));
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'tahlilchi', 'marketolog', 'kontent', 'target'], dismissed: [] }) });
  events.add(biz.id, { member: 'tahlilchi', orderId: 'o1', level: 'info', title: 'Bajarildi: haftalik hisobot', body: 'x', cameraId: null });
  events.add(biz.id, { member: 'tahlilchi', orderId: 'o2', level: 'warn', title: 'Bajarilmadi: oylik hisobot', body: "internet yo'q", cameraId: null });
  events.add(biz.id, { member: 'marketolog', orderId: null, level: 'warn', title: 'Bajarilmadi — Raqobatchilar', body: 'x', cameraId: null });
  events.add(biz.id, { member: 'tahlilchi', orderId: 'o3', level: 'info', title: 'Direktordan topshiriq', body: 'Javobsizlarni kuzat', cameraId: null });
  events.add(biz.id, { member: 'marketolog', orderId: 'o4', level: 'info', title: 'Direktordan topshiriq', body: "Raqobatchilarni o'rgan", cameraId: null });
  contentStore.addDraft(biz.id, { text: 'Post', sourceUrl: null, topic: null });
  const day = teamDay(businesses.byId(biz.id)!);
  const m = (k: string) => day.members.find(x => x.member === k)!;
  check("bajarilmagan urinish va Direktor bergan topshiriq hisobot/tahlil deb sanalmaydi", () => {
    assert.equal(m('tahlilchi').facts[0].value, 1);
    assert.match(m('tahlilchi').summary, /^Bugun 1 ta hisobot tayyorladi\. 1 ta urinish bajarilmadi/);
    assert.equal(m('marketolog').facts[0].value, 0);
  });
  check("Kontent-meyker va Targetolog ham «Bugun jamoa»da — bugungi postlar va reklama", () => {
    assert.deepEqual(day.members.map(x => x.member), ['qabulxona', 'yordamchi', 'tahlilchi', 'marketolog', 'kontent', 'target']);
    assert.equal(m('kontent').facts.find(f => f.label === 'Post')?.value, 1);
    assert.equal(m('kontent').summary, '1 ta post tayyorladi. 1 ta qoralama tasdiqingizni kutyapti.');
    assert.equal(m('target').summary, 'Hozir reklama ishlamayapti.');
  });
  // Tahlilchi va Marketolog jamoadan olib tashlandi: ularning jurnal yozuvlari «Bugun jamoa» lentasida ko'rinmaydi (D1)
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'kontent', 'target'], dismissed: ['tahlilchi', 'marketolog'] }) });
  const fewer = teamDay(businesses.byId(biz.id)!);
  check("olinmagan xodimlarning yozuvlari bugungi lentada yo'q", () => {
    assert.ok(!fewer.timeline.some(e => e.member === 'tahlilchi' || e.member === 'marketolog'), JSON.stringify(fewer.timeline.map(e => e.member)));
  });
  const { orders } = await import('../server/orders/store');
  const { standingOrders } = await import('../server/agent');
  orders.create(biz.id, 'tahlilchi', 'Har dushanba hisobot', { kind: 'standing' }, 'Har dushanba hisobot');
  orders.create(biz.id, 'kontent', 'Har kuni bitta post', { kind: 'standing' }, 'Har kuni bitta post');
  check("olinmagan Tahlilchi va Marketolog doimiy topshiriqlari Yordamchi ko'rsatmasiga qo'shilmaydi (D2)", () => {
    const sys = standingOrders(businesses.byId(biz.id)!);
    assert.ok(!sys.includes('Har dushanba hisobot'), sys);
    assert.ok(sys.includes('Har kuni bitta post'), "jamoadagi Kontent-meykerniki qoladi");
  });
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'tahlilchi', 'marketolog', 'kontent', 'target'], dismissed: [] }) });
  const { runTool, ownerToolDefs, memberGroups } = await import('../server/tools');
  const { iso } = await import('../src/lib/week');
  const ctx = { biz: businesses.byId(biz.id)!, artifacts: [] };
  const week = await runTool('business_numbers', { period: 'week' }, { ...ctx, as: 'tahlilchi' });
  const custom = await runTool('business_numbers', { period: 'custom', from: '2026-11-01', to: '2026-11-03' }, ctx);
  const half = await runTool('business_numbers', { period: 'custom', from: '2026-11-01' }, ctx);
  check("Tahlilchi topshirig'ida raqamlar asbobi bor — panel bilan bir xil «7 kun» (kechagacha to'liq kunlar)", () => {
    assert.ok(ownerToolDefs(false, memberGroups('tahlilchi')).some(([n]) => n === 'business_numbers'));
    assert.equal(week.isError, false, week.content);
    const r = JSON.parse(week.content);
    const day = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
    assert.deepEqual([r.period.label, r.period.from, r.period.to], ['7 kun', day(7), day(1)]);
    assert.deepEqual(r.inquiries.now, 0);
    assert.match(r.crm, /DentaCRM ulanmagan/);
    assert.equal(JSON.parse(custom.content).period.from, '2026-11-01');
    assert.equal(half.isError, true);
  });
  check("topshiriq tuzuvchiga zona turi to'g'ri boradi (kutish joyi «kassa» emas; maxfiy joy — AI ko'rmaydi)", () => {
    const zone = (id: string, kind: string, name: string) => ({ id, kind, name, x: 0, y: 0, w: 0.5, h: 0.5, doctorId: null });
    const text = camerasText([{ id: 'c1', name: 'Zal', profile: null, zones: [zone('z1', 'waiting', 'Kutish'), zone('z2', 'private', 'Xona'), zone('z3', 'desk', 'Kassa')] }] as never);
    assert.match(text, /"z1" Kutish \(waiting area\)/);
    assert.match(text, /"z2" Xona \(private area — blacked out/);
    assert.match(text, /"z3" Kassa \(cash desk\)/);
  });
}

console.log("\n# Mijozga yozish — Qabulxonaniki");
{
  const { runTool } = await import('../server/tools');
  const { leads } = await import('../server/db');
  const { events } = await import('../server/orders/store');
  const biz = businesses.create(`qx${Date.now()}`, 'x', emptyBusiness('Qx klinika', 'stomatologiya'));
  // Eski bazadagi «olib tashlangan» yozuvi (B1 dan oldingi) — e'tiborsiz: AI administrator doim jamoada
  businesses.update(biz.id, { crew: JSON.stringify({ hired: [], dismissed: ['qabulxona'] }) });
  const lead = leads.add(biz.id, { name: 'Ali', phone: '+998901234567', note: null, source: null });
  const artifacts: unknown[] = [];
  const made = await runTool('draft_followup', { lead_ids: [lead.id], text: 'Assalomu alaykum, Ali! Qabulga yozilasizmi?' }, { biz: businesses.byId(biz.id)!, artifacts: artifacts as never });
  check("AI administrator doim jamoada — xabar tayyor (egasi «Yuborish»ni bosadi), Qabulxona jurnalida", () => {
    assert.equal(made.isError, false, made.content);
    assert.equal(artifacts.length, 1);
    const ev = events.since(biz.id, '2000-01-01', 10).find(e => e.member === 'qabulxona');
    assert.ok(ev && ev.title.startsWith('Mijozga xabar tayyorlandi') && ev.body.includes('Yordamchi orqali'), JSON.stringify(ev));
  });
}

console.log("\n# Ish paydo bo'lishi bilan xodim jamoada (panel ochilishini kutmay)");
{
  const { crewFromData } = await import('../server/crew');
  const { cameras } = await import('../server/db');
  const mk = (crew: string | null) => {
    const b = businesses.create(`ish${Date.now()}${Math.random().toString(36).slice(2, 6)}`, 'x', emptyBusiness('Ish klinika', 'stomatologiya'));
    businesses.update(b.id, { crew });
    cameras.create(b.id, 'Zal');
    return businesses.byId(b.id)!;
  };
  check("kamera qo'shildi — egasi yozishi bilan Kuzatuvchi jamoada (asbobi shu gapdayoq bor)", () => {
    const b = crewFromData(mk(JSON.stringify({ hired: [], dismissed: [] })));
    assert.ok(crewHas(b, 'kuzatuvchi'));
    assert.ok(crewHas(businesses.byId(b.id)!, 'kuzatuvchi'), 'bazada saqlandi');
  });
  check("egasi olib tashlagan Kuzatuvchi qaytib qo'shilmaydi; eski baza (tarkib hisoblanmagan) o'zgarmaydi", () => {
    const off = crewFromData(mk(JSON.stringify({ hired: [], dismissed: ['kuzatuvchi'] })));
    assert.ok(!crewHas(off, 'kuzatuvchi'));
    const old = mk(null);
    assert.equal(crewFromData(old), old);
    assert.equal(businesses.byId(old.id)!.crew, null);
  });
  const { brandStore } = await import('../server/content/brand');
  check("Miya → Brend'da brend-buk to'ldirildi — Kontent-meyker o'zi jamoaga qo'shilmaydi", () => {
    const b = mk(JSON.stringify({ hired: [], dismissed: [] }));
    brandStore.save(b.id, {} as never, null);
    assert.ok(!crewHas(crewFromData(b), 'kontent'));
  });
}

console.log("\n# Qabulxona kartasi: telefon liniyasi va javob rejimi (A5)");
{
  const { receptionStatus } = await import('../src/lib/receptionStatus');
  check("faqat telefon liniyasi ulangan — «Kanal ulanmagan» emas, telefonda navbatchi", () => {
    const s = receptionStatus({ talking: false, text: false, phone: true, mode: 'draft' });
    assert.ok(s.on && s.status.startsWith('Telefonda navbatchi'), s.status);
  });
  check("bot bor, lekin «tasdiqlayman» — «Navbatchilikda» emas, rejimni yoqish havolasi bilan", () => {
    const s = receptionStatus({ talking: false, text: true, phone: false, mode: 'draft' });
    assert.equal(s.status, 'Javoblarni siz tasdiqlaysiz');
    assert.match(s.next?.href ?? '', /sozlamalar\/asosiy/);
  });
  check("«o'zi javob bersin» — Navbatchilikda; hech narsa ulanmagan — «Kanal ulanmagan»; javob o'chiq — o'chiq", () => {
    assert.equal(receptionStatus({ talking: false, text: true, phone: false, mode: 'auto' }).status, 'Navbatchilikda');
    assert.equal(receptionStatus({ talking: false, text: false, phone: false, mode: 'auto' }).status, 'Kanal ulanmagan');
    const off = receptionStatus({ talking: false, text: true, phone: false, mode: 'off' });
    assert.ok(!off.on && off.status === 'Javob berish o‘chiq');
  });
}

console.log("\n# Direktor: ertalabki xabar qayta yuborilsa (internet uzilgan) — Direktor qismi tushib qolmaydi (A13)");
{
  const { directorRuns, directorMoves } = await import('../server/director/store');
  const { directorReport } = await import('../server/director/telegram');
  const { iso } = await import('../src/lib/week');
  const b = businesses.create(`dir${Date.now()}`, 'x', emptyBusiness('Direktor klinika', 'stomatologiya'));
  const run = directorRuns.add(b.id, iso(new Date()), 'Javob ulushi tushdi', { title: 'Javobsiz murojaatlar', evidence: '80% → 60%' },
    { inquiries: { now: 40, prev: 50 }, answered_pct: { now: 60, prev: 80 } });
  directorMoves.add(b.id, run.id, { member: 'qabulxona', task: "Narx so'raganga darhol javob ber", why: '60%', metric: 'answered_pct', baseline: 60, checkDays: 3 });
  directorMoves.add(b.id, run.id, { member: 'egasi', task: 'Chegirma kerakmi — hal qiling', why: '', metric: 'booked', baseline: 8, checkDays: 7 });
  const again = await directorReport(businesses.byId(b.id)!);
  check("bugungi tahlil bor — hisobot saqlanganidan qayta yig'iladi (AI'siz): muammo, takliflar, tugmalar", () => {
    assert.ok(again, 'hisobot yo\'q');
    assert.match(again!.html, /Javobsiz murojaatlar/);
    assert.match(again!.html, /1\. <b>AI administrator<\/b>: Narx so'raganga/);
    assert.match(again!.html, /2\. <b>Egasi<\/b>|2\. <b>Sizga<\/b>|2\. <b>/);
    assert.equal(again!.buttons.flat().filter(x => x.data.startsWith('dv|')).length, 2);
  });
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
