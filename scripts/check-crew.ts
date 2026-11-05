/**
 * AI jamoa tarkibi (src/lib/crew.ts, server/crew.ts) — brauzer va AI'siz:
 *   standart jamoa Direktor va Yordamchi; ishi ulangan xodim o'zi qo'shiladi, egasi olib tashlagani qaytib qo'shilmaydi;
 *   eski baza (tarkib hali hisoblanmagan) — hamma xodim avvalgidek ishlaydi; olib tashlangan Qabulxona javob tayyorlamaydi;
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

const none = { customers: false, crm: false, cameras: 0, metaAi: false, marketingPosts: 0, content: false, ads: false };

console.log('\n# Qoida');
check('yangi biznes: jamoada faqat Direktor va Yordamchi', () => {
  assert.deepEqual(crewList(withInUse(null, inUse(none))), ['direktor', 'yordamchi']);
  assert.deepEqual([...CORE], ['direktor', 'yordamchi']);
});
check("Instagram ulandi — Qabulxona va Tahlilchi o'zi qo'shiladi; kamera — Kuzatuvchi", () => {
  const s = withInUse(null, inUse({ ...none, customers: true, cameras: 2 }));
  assert.deepEqual(crewList(s), ['direktor', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi']);
});
check("Instagram postlari — Kontent-meykerning ishi (Marketolog emas); Meta AI — Marketolog", () => {
  assert.deepEqual(crewList(withInUse(null, inUse({ ...none, marketingPosts: 1 }))), ['direktor', 'yordamchi', 'kontent']);
  assert.deepEqual(crewList(withInUse(null, inUse({ ...none, metaAi: true }))), ['direktor', 'yordamchi', 'marketolog']);
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
  assert.equal(works(setHired(null, 'direktor', false), 'direktor'), true);
  assert.deepEqual(parseCrew('{"hired":["kontent","boshqa","direktor"],"dismissed":"x"}'), { hired: ['kontent'], dismissed: [] });
  assert.equal(parseCrew('{buzuq'), null);
});
check('tarkib hali hisoblanmagan (eski baza) — hamma xodim fonda avvalgidek ishlaydi va jamoada', () => {
  assert.equal(works(null, 'qabulxona'), true);
  assert.equal(crewWorks({ crew: null }, 'kontent'), true);
  assert.equal(crewHas({ crew: null }, 'kontent'), true);
});
check("hali ishga olinmagan, lekin olib tashlanmagan — fonda ishlaydi (panel ochilmasdan kelgan mijoz javobsiz qolmaydi), jamoada esa yo'q", () => {
  const fresh = JSON.stringify({ hired: [], dismissed: [] });
  assert.equal(crewWorks({ crew: fresh }, 'qabulxona'), true);
  assert.equal(crewHas({ crew: fresh }, 'qabulxona'), false);
  assert.equal(hiredIn(null, 'qabulxona'), true);
});
check("o'zgarish bo'lmasa — o'sha holat (bazaga qayta yozilmaydi)", () => {
  const s = withInUse(null, inUse({ ...none, ads: true }));
  assert.equal(withInUse(s, inUse({ ...none, ads: true })), s);
});

console.log('\n# Server');
const biz = businesses.create('crew-sinov', 'x', emptyBusiness('Sinov klinika', 'stomatologiya'));
check("Qabulxona jamoada yo'q — javob rejimi «o'chiq» (sozlamasi saqlanadi)", () => {
  businesses.update(biz.id, { crew: JSON.stringify({ hired: [], dismissed: ['qabulxona'] }) });
  const row = businesses.byId(biz.id)!;
  assert.equal(replySettings(row).mode, 'off');
  assert.equal(row.profile.autoReply?.mode, 'draft');
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  assert.equal(replySettings(businesses.byId(biz.id)!).mode, 'draft');
});
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
    assert.deepEqual(chatGroups({ crew: JSON.stringify({ hired: ['direktor', 'yordamchi', 'kontent'], dismissed: [] }) }), ['base', 'kontent']);
    assert.deepEqual(chatGroups({ crew: null }), ['base', 'qabulxona', 'kontent', 'target', 'marketolog', 'kuzatuvchi'], 'eski baza — hammasi');
    assert.deepEqual(memberGroups('kontent'), ['kontent']);
    assert.deepEqual(memberGroups('tahlilchi'), ['base']);
    assert.deepEqual(memberGroups('qabulxona'), ['base', 'qabulxona'], "Qabulxona topshirig'i mijozlar va yozishmalarni ham o'qiydi");
    assert.equal(toolOwner('draft_followup'), 'qabulxona', 'mijozga yozish — Qabulxonaniki');
    const k = ownerToolDefs(false, ['kontent']).map(([n]) => n);
    assert.ok(k.includes('content_plan') && !k.includes('create_task') && !k.includes('ads_plan'));
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
    assert.deepEqual(day.members.map(x => x.member), ['yordamchi', 'tahlilchi', 'marketolog', 'kontent', 'target']);
    assert.equal(m('kontent').facts.find(f => f.label === 'Post')?.value, 1);
    assert.equal(m('kontent').summary, '1 ta post tayyorladi. 1 ta qoralama tasdiqingizni kutyapti.');
    assert.equal(m('target').summary, 'Hozir reklama ishlamayapti.');
  });
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
  businesses.update(biz.id, { crew: JSON.stringify({ hired: [], dismissed: ['qabulxona'] }) });
  const lead = leads.add(biz.id, { name: 'Ali', phone: '+998901234567', note: null, source: null });
  const refused = await runTool('draft_followup', { lead_ids: [lead.id], text: 'Assalomu alaykum, Ali! Qabulga yozilasizmi?' }, { biz: businesses.byId(biz.id)!, artifacts: [] });
  businesses.update(biz.id, { crew: JSON.stringify({ hired: ['qabulxona'], dismissed: [] }) });
  const artifacts: unknown[] = [];
  const made = await runTool('draft_followup', { lead_ids: [lead.id], text: 'Assalomu alaykum, Ali! Qabulga yozilasizmi?' }, { biz: businesses.byId(biz.id)!, artifacts: artifacts as never });
  check("Qabulxona jamoada yo'q — mijozga xabar tayyorlanmaydi («+ Xodim qo'shish»)", () => {
    assert.equal(refused.isError, true);
    assert.match(refused.content, /Qabulxonaning ishi, u jamoada yo'q/);
  });
  check("Qabulxona jamoada — xabar tayyor (egasi «Yuborish»ni bosadi), Qabulxona jurnalida", () => {
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
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
