/**
 * SMM-menejer — soxta AI, soxta Telegram va soxta Instagram bilan (tarmoq va pulsiz): kalendar tozalash, post tayyorlash (matn → slaydlar
 * → rasm fayllari → egasiga karta), tasdiqlash holatlari, vaqtida o'zi chiqishi (Telegram, Instagram, karusel/storis — egasiga), eski
 * post, shablon HTML (matn qochiriladi, yorug' fonda qorong'i matn). Chrome bo'lsa — haqiqiy rasm ham.
 * Ishga tushirish: npm run test:smm
 */
import './isolate';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const { cleanCalendar, makeCalendar } = await import('../server/smm/plan');
const { cleanPostText, preparePost, prepareAhead, prepareOne, approve, approveRange, reject, reopen } = await import('../server/smm/prepare');
const { publishDue } = await import('../server/smm/publish');
const { smmStore, smmDir, designFormat, postMark } = await import('../server/smm/store');
const { IgUnsure } = await import('../server/inbox/instagram');
const { designHtml, designBrand, renderDesign } = await import('../server/smm/design');
const { brandStore } = await import('../server/content/brand');
const { contentStore } = await import('../server/content/store');
const { setChannelOutlet } = await import('../server/content/factory');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { installedBrowser } = await import('../server/browserPath');
const { businesses } = await import('../server/db');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 4).join('\n    ')}`); }
}

const BOOK = {
  name: 'Denta Smile', positioning: 'Qo\'rqmasdan davolanish', tagline: 'Tabassum', values: ['halol'], voice: ['Qisqa gaplar'], banned: [],
  colors: { bg: '#0e1a24', deep: '#123a4f', surface: '#f3efe8', ink: '#ffffff', accent: '#f2b84b', muted: '#a9b7c2' },
  motif: 'yumshoq yorug\'lik', font: 'Unbounded', pillars: [{ name: 'Maslahat', share: 50, about: '' }, { name: 'Klinika', share: 50, about: '' }], dont: [],
};
const PROFILE = { name: 'Denta Smile', ownerName: 'X', industry: 'stomatologiya', phone: '+998901234567', address: 'Toshkent', contentLang: 'uz', brand: { primary: '#123a4f', accent: '#f2b84b' }, offerings: [], team: [{ name: 'Aziza Karimova', role: 'Ortodont' }] } as never;
const newBiz = () => {
  const b = businesses.byId(businesses.create(`smm${Date.now()}${Math.random()}`, 'x', PROFILE).id)!;
  brandStore.save(b.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  return b;
};

// Egasiga ketganlar
const toOwner: { kind: 'text' | 'photo' | 'file'; html: string; keyboard?: unknown }[] = [];
setOwnerOutlet({
  notify: async (_b, html, keyboard) => { toOwner.push({ kind: 'text', html, keyboard }); return toOwner.length; },
  edit: async () => {},
  sendFile: async (_b, path, caption) => { toOwner.push({ kind: 'file', html: `${path} ${caption}` }); },
  sendPhoto: async (_b, _p, html, keyboard) => { toOwner.push({ kind: 'photo', html, keyboard }); return toOwner.length; },
});
// Kanal
const channel: { chat: string; files: string[]; caption: string }[] = [];
const texts: string[] = [];
setChannelOutlet({
  resolve: async () => ({ id: '-100777', title: 'Kanal' }),
  post: async (_c, text) => { texts.push(text); return 1; },
  postVideo: async () => 1,
  postPhotos: async (chat, files, caption) => { channel.push({ chat, files, caption }); return 2; },
});

const POST_JSON = (slides: number) => JSON.stringify({
  caption: 'Tish cho\'tkasini har 3 oyda almashtiring. Yozilish: Direct.',
  slides: Array.from({ length: slides }, (_, i) => ({ template: i ? 'tip' : 'announce', headline: `Slayd ${i + 1}`, sub: 'Qisqa izoh', badge: i ? `0${i}` : '', bullets: i ? ['bir', 'ikki'] : [], cta: '' })),
  picture: 'stomatologiya kabineti, yumshoq yorug\'lik', team_photo: '',
});
const fakeDeps = (slides = 1) => ({
  write: async () => POST_JSON(slides),
  picture: async () => null,
  render: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
});

console.log('SMM-menejer');

await check("kalendar: noto'g'ri sana/vaqt/kanal tashlanadi, storis — Instagram, kuniga 2 tadan ko'p emas, ustun — brend-bukdan", () => {
  const allowed = new Set(['2026-12-01', '2026-12-02']);
  const out = cleanCalendar({ items: [
    { day: '2026-12-01', time: '09:00', channel: 'telegram', format: 'story', pillar: 'Maslahat', title: 'Storis eslatma', angle: '' },
    { day: '2026-12-01', time: '19:30', channel: 'instagram', format: 'carousel', pillar: 'Yo\'q ustun', title: 'Tishlarni oqartirish: 5 afsona', angle: 'a' },
    { day: '2026-12-01', time: '20:00', channel: 'instagram', format: 'post', pillar: 'Klinika', title: 'Uchinchi post shu kunda', angle: '' },
    { day: '2026-12-09', time: '09:00', channel: 'instagram', format: 'post', pillar: 'Klinika', title: 'Ruxsatsiz kun', angle: '' },
    { day: '2026-12-02', time: '25:00', channel: 'instagram', format: 'post', pillar: 'Klinika', title: 'Noto\'g\'ri vaqt', angle: '' },
    { day: '2026-12-02', time: '13:00', channel: 'facebook', format: 'video', pillar: 'Klinika', title: 'Yangi filial ochildi', angle: '' },
  ] }, allowed, ['Maslahat', 'Klinika'], 10);
  assert.deepEqual(out.map(x => [x.day, x.time, x.channel, x.format, x.pillar]), [
    ['2026-12-01', '09:00', 'instagram', 'story', 'Maslahat'],
    ['2026-12-01', '19:30', 'instagram', 'carousel', 'Maslahat'],
    ['2026-12-02', '13:00', 'instagram', 'post', 'Klinika'],
  ]);
});

await check('post matni: noma\'lum shablon — tip, karusel 6 tadan ko\'p emas, bitta postda bitta slayd, sarlavhasiz slayd tashlanadi', () => {
  const raw = { caption: 'x'.repeat(5000), slides: [{ template: 'magic', headline: 'Bir' }, { template: 'promo', headline: '' }, ...Array.from({ length: 9 }, (_, i) => ({ template: 'tip', headline: `S${i}` }))] };
  const car = cleanPostText(raw, { channel: 'instagram', format: 'carousel' })!;
  assert.equal(car.slides.length, 5, '6 tadan ko\'p olinmaydi, bo\'sh sarlavhali tashlandi');
  assert.equal(car.slides[0].template, 'tip');
  assert.equal(car.caption.length, 2100);
  const tg = cleanPostText(raw, { channel: 'telegram', format: 'post' })!;
  assert.equal(tg.slides.length, 1);
  assert.equal(tg.caption.length, 1000, 'Telegram rasm izohi chegarasi');
  assert.equal(cleanPostText({ caption: '', slides: [] }, { channel: 'instagram', format: 'post' }), null);
});

await check('kanal va format → rasm o\'lchami', () => {
  assert.equal(designFormat({ channel: 'telegram', format: 'post' }), 'cover');
  assert.equal(designFormat({ channel: 'instagram', format: 'story' }), 'story');
  assert.equal(designFormat({ channel: 'instagram', format: 'carousel' }), 'post');
});

await check("shablon: matn HTML sifatida qochiriladi; yorug' fonli shablonda matn qorong'i; logo faqat rasm", () => {
  const biz = newBiz();
  const b = designBrand(biz, BOOK as never);
  const html = designHtml({ template: 'announce', format: 'post', headline: '<script>alert(1)</script>', sub: 'a "b"' }, b);
  assert.ok(!html.includes('<script>alert'), 'skript qochirildi');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(designHtml({ template: 'doctor', format: 'post', headline: 'Dr' }, b), /\.frame\{[^}]*color:#0e1a24/, 'yorug\' surface ustida — brendning qorong\'i rangi');
  const bad = designBrand({ ...biz, profile: { ...biz.profile, brand: { primary: '#000', accent: '#111', logo: 'javascript:alert(1)' } } } as never, null);
  assert.equal(bad.logo, null);
});

await check('kalendar tuzish (soxta AI): g\'oyalar saqlanadi; qayta tuzilsa — faqat tayyorlanmagan g\'oyalar almashadi', async () => {
  const biz = newBiz();
  const start = new Date(2030, 0, 7, 12);
  const write = async () => JSON.stringify({ items: [
    { day: '2030-01-07', time: '09:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Birinchi post mavzusi', angle: 'a' },
    { day: '2030-01-09', time: '19:00', channel: 'telegram', format: 'post', pillar: 'Klinika', title: 'Ikkinchi post mavzusi', angle: 'b' },
  ] });
  const r = await makeCalendar(biz, { start, days: 7, perWeek: 2, wish: '' }, write);
  assert.equal(r.posts.length, 2);
  assert.equal(r.madeBrand, false);
  smmStore.move(biz.id, r.posts[0].id, ['idea'], 'ready');
  await makeCalendar(biz, { start, days: 7, perWeek: 2, wish: '' }, write);
  const all = smmStore.from(biz.id, '2030-01-01');
  assert.equal(all.length, 3, 'tayyor qoldi, g\'oya almashdi');
});

await check("tayyorlash: matn va slaydlar → fayllar → «ready» → egasiga rasm, to'liq matn va tasdiq tugmasi", async () => {
  const biz = newBiz();
  const p = smmStore.add(biz.id, { day: '2030-02-01', time: '10:00', channel: 'instagram', format: 'carousel', pillar: 'Maslahat', title: 'Tish cho\'tkasi', angle: '' });
  toOwner.length = 0;
  const done = await preparePost(biz, p.id, fakeDeps(3));
  assert.equal(done.status, 'ready');
  assert.equal(done.images.length, 3);
  assert.ok(done.images.every(n => existsSync(join(smmDir(biz.id), n))));
  assert.equal(toOwner[0].kind, 'photo');
  assert.match(toOwner[0].html, /3 ta slayd/);
  assert.match(toOwner[1].html, /har 3 oyda almashtiring/);
  assert.match(JSON.stringify(toOwner[1].keyboard), /sa\|/);
  await assert.rejects(preparePost(biz, p.id, fakeDeps()).then(() => approve(biz, p.id)).then(() => preparePost(biz, p.id, fakeDeps())), /tasdiqlangan yoki chiqqan/);
});

await check("tayyorlash yiqilsa — «failed» sababi bilan, qayta tayyorlasa bo'ladi", async () => {
  const biz = newBiz();
  const p = smmStore.add(biz.id, { day: '2030-02-02', time: '10:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Yiqiladigan post', angle: '' });
  await assert.rejects(preparePost(biz, p.id, { ...fakeDeps(), write: async () => 'tushunarsiz' }), /AI javobi tushunarsiz/);
  assert.equal(smmStore.get(biz.id, p.id)?.status, 'failed');
  assert.equal((await preparePost(biz, p.id, fakeDeps())).status, 'ready');
});

await check("tasdiqlash: faqat tayyorini; oraliq bo'yicha hammasi; olib tashlash; matn o'zgarsa — qayta tasdiq", async () => {
  const biz = newBiz();
  const ids = [];
  for (const day of ['2030-03-01', '2030-03-02', '2030-03-05']) {
    const p = smmStore.add(biz.id, { day, time: '10:00', channel: 'telegram', format: 'post', pillar: 'Maslahat', title: `Post ${day}`, angle: '' });
    await preparePost(biz, p.id, fakeDeps());
    ids.push(p.id);
  }
  const idea = smmStore.add(biz.id, { day: '2030-03-02', time: '12:00', channel: 'telegram', format: 'post', pillar: 'Maslahat', title: 'Hali g\'oya', angle: '' });
  assert.equal(approve(biz, idea.id), false, "g'oyani tasdiqlab bo'lmaydi");
  assert.equal(approveRange(biz, '2030-03-01', '2030-03-02'), 2);
  assert.equal(smmStore.get(biz.id, ids[2])?.status, 'ready', 'oraliqdan tashqarisi qoladi');
  assert.equal(approve(biz, ids[0]), false, 'ikki marta tasdiq yo\'q');
  assert.equal(smmStore.edit(biz.id, ids[0], { caption: 'Yangi matn' }), true);
  assert.equal(smmStore.get(biz.id, ids[0])?.status, 'ready', 'tasdiqlangan matn o\'zgardi — qayta ko\'rish kerak');
  assert.equal(reject(biz, ids[2]), true);
  assert.equal(smmStore.get(biz.id, ids[2])?.status, 'cancelled');
});

await check("vaqtida o'zi chiqadi: Telegram kanalga (uzun matn — alohida), Instagram posti, karusel — egasiga; vaqti kelmagani va SMM ishlamaydigani tegilmaydi", async () => {
  const biz = newBiz();
  contentStore.saveSettings(biz.id, { channelId: '-100777', channelTitle: 'Kanal' });
  const mk = async (channel: 'telegram' | 'instagram', format: 'post' | 'carousel', time: string, slides = 1, caption?: string) => {
    const p = smmStore.add(biz.id, { day: '2030-04-01', time, channel, format, pillar: 'Maslahat', title: `${channel} ${format} ${time}`, angle: '' });
    await preparePost(biz, p.id, fakeDeps(slides));
    if (caption) smmStore.edit(biz.id, p.id, { caption });
    approve(biz, p.id);
    return p.id;
  };
  const tg = await mkTg();
  async function mkTg() { return mk('telegram', 'post', '09:00', 1, 'u'.repeat(1500)); }
  const ig = await mk('instagram', 'post', '09:05');
  const car = await mk('instagram', 'carousel', '09:10', 3);
  const later = await mk('instagram', 'post', '18:00');
  const igCalls: string[] = [];
  const n = await publishDue(() => true, new Date(2030, 3, 1, 9, 30), { instagramPhoto: async (_b, _j, w, h, caption) => { igCalls.push(`${w}x${h}:${caption.slice(0, 10)}`); return { url: 'https://instagram.com/p/x' }; } });
  assert.equal(n, 3);
  assert.equal(smmStore.get(biz.id, tg)?.status, 'published');
  assert.equal(channel.at(-1)?.caption, '', 'uzun matn rasm izohiga sig\'maydi');
  assert.equal(texts.at(-1)?.length, 1500, 'matn — alohida xabar');
  assert.equal(smmStore.get(biz.id, ig)?.status, 'published');
  assert.deepEqual(igCalls, ["1080x1350:Tish cho't"]);
  assert.equal(smmStore.get(biz.id, car)?.status, 'handed');
  assert.ok(toOwner.filter(x => x.kind === 'file').length >= 3, 'karusel rasmlari egasiga');
  assert.equal(smmStore.get(biz.id, later)?.status, 'approved', 'vaqti kelmagan');
  assert.equal(await publishDue(() => false, new Date(2030, 3, 1, 19, 0)), 0, 'SMM-menejer ishlamaydi (jamoa/to\'lov) — chiqmaydi');
  assert.equal(smmStore.get(biz.id, later)?.status, 'approved');
});

await check("Instagram'ga joylanmasa — egasiga yuboriladi; kanal ulanmagan — «failed» va xabar; juda eski — chiqmaydi", async () => {
  const biz = newBiz();
  const mk = async (channel: 'telegram' | 'instagram', day: string) => {
    const p = smmStore.add(biz.id, { day, time: '08:00', channel, format: 'post', pillar: 'Maslahat', title: `Post ${channel} ${day}`, angle: '' });
    await preparePost(biz, p.id, fakeDeps());
    approve(biz, p.id);
    return p.id;
  };
  const ig = await mk('instagram', '2030-05-01'), tg = await mk('telegram', '2030-05-01'), old = await mk('instagram', '2030-04-20');
  await publishDue(() => true, new Date(2030, 4, 1, 8, 1), { instagramPhoto: async () => { throw new Error("Instagram brauzer orqali ulanmagan"); } });
  assert.equal(smmStore.get(biz.id, ig)?.status, 'handed');
  assert.match(String(smmStore.get(biz.id, ig)?.error), /ulanmagan/);
  assert.equal(smmStore.get(biz.id, tg)?.status, 'failed');
  assert.match(String(smmStore.get(biz.id, tg)?.error), /kanal ulanmagan/);
  assert.equal(smmStore.get(biz.id, old)?.status, 'failed');
  assert.match(String(smmStore.get(biz.id, old)?.error), /o'tib ketdi/);
});

await check("Instagram javob bermadi (IgUnsure) — «o'zingiz joylang» deyilmaydi (ikki marta chiqardi), tekshirish so'raladi; keyin qayta tasdiqlashga — AI'siz", async () => {
  const biz = newBiz();
  const p = smmStore.add(biz.id, { day: '2030-06-01', time: '08:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Javobsiz Instagram', angle: '' });
  await preparePost(biz, p.id, fakeDeps());
  approve(biz, p.id);
  const files = toOwner.filter(x => x.kind === 'file').length;
  await publishDue(() => true, new Date(2030, 5, 1, 8, 1), { instagramPhoto: async () => { throw new IgUnsure('javob yo\'q'); } });
  const after = smmStore.get(biz.id, p.id)!;
  assert.equal(after.status, 'failed');
  assert.match(String(after.error), /tekshiring/);
  assert.equal(toOwner.filter(x => x.kind === 'file').length, files, 'rasm «joylang» deb yuborilmadi');
  assert.match(toOwner.at(-1)!.html, /chiqqan-chiqmaganini/);
  // Tayyor post qayta tayyorlanmaydi (rasmi bor) — qayta tasdiqlashga qaytadi
  const r = prepareAhead(biz, '2030-06-01', '2030-06-01', { ...fakeDeps(), write: async () => { throw new Error("AI chaqirilmasligi kerak edi"); } });
  assert.equal(r.queued, 0);
  await r.done;
  assert.equal(reopen(biz, p.id), true);
  assert.equal(smmStore.get(biz.id, p.id)?.status, 'ready');
  assert.equal(smmStore.get(biz.id, p.id)?.error, null);
});

await check("uzun Telegram matni oddiy matn: & va < qochirilmaydi; matn chiqmasa — post chiqqan (rasm kanalda), egasiga matn", async () => {
  const biz = newBiz();
  contentStore.saveSettings(biz.id, { channelId: '-100777', channelTitle: 'Kanal' });
  const mk = async (time: string) => {
    const p = smmStore.add(biz.id, { day: '2030-07-01', time, channel: 'telegram', format: 'post', pillar: 'Maslahat', title: `Uzun ${time}`, angle: '' });
    await preparePost(biz, p.id, fakeDeps());
    smmStore.edit(biz.id, p.id, { caption: `Narx & chegirma <yangi> ${'x'.repeat(1100)}` });
    approve(biz, p.id);
    return p.id;
  };
  const a = await mk('08:00');
  await publishDue(() => true, new Date(2030, 6, 1, 8, 1));
  assert.ok(texts.at(-1)?.startsWith('Narx & chegirma <yangi>'), 'xom matn');
  assert.equal(smmStore.get(biz.id, a)?.status, 'published');
  const b = await mk('09:00');
  setChannelOutlet({ resolve: async () => ({ id: '-100777', title: 'Kanal' }), post: async () => { throw new Error('Too Many Requests'); }, postVideo: async () => 1, postPhotos: async () => 3 });
  await publishDue(() => true, new Date(2030, 6, 1, 9, 1));
  setChannelOutlet({ resolve: async () => ({ id: '-100777', title: 'Kanal' }), post: async (_c, text) => { texts.push(text); return 1; }, postVideo: async () => 1, postPhotos: async (chat, files, caption) => { channel.push({ chat, files, caption }); return 2; } });
  const pb = smmStore.get(biz.id, b)!;
  assert.equal(pb.status, 'published', 'rasm chiqdi — qayta joylanmaydi');
  assert.match(String(pb.error), /matn chiqmadi/);
  assert.match(toOwner.at(-1)!.html, /o'zingiz qo'shing/);
});

await check("eski karta: qayta tayyorlangan postni tasdiqlamaydi; «hammasini» — faqat ko'rilganlari; vaqti o'tgani tasdiqlanmaydi; bitta tayyorlash navbatda", async () => {
  const biz = newBiz();
  const p = smmStore.add(biz.id, { day: '2030-08-01', time: '10:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Qayta tayyorlanadigan', angle: '' });
  const first = await preparePost(biz, p.id, fakeDeps());
  const oldMark = postMark(first);
  const second = await preparePost(biz, p.id, { ...fakeDeps(), write: async () => POST_JSON(1).replace('har 3 oyda', 'har 2 oyda') });
  assert.notDeepEqual(second.images, first.images, 'yangi fayl nomlari');
  assert.ok(!existsSync(join(smmDir(biz.id), first.images[0])), 'eski rasm o\'chirildi');
  assert.equal(approve(biz, p.id, oldMark), false, 'eski karta');
  assert.equal(approve(biz, p.id, postMark(second)), true);
  const q = smmStore.add(biz.id, { day: '2030-08-02', time: '10:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Ko\'rilgan', angle: '' });
  const r2 = smmStore.add(biz.id, { day: '2030-08-02', time: '12:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Ko\'rilmagan', angle: '' });
  await preparePost(biz, q.id, fakeDeps());
  await preparePost(biz, r2.id, fakeDeps());
  assert.equal(approveRange(biz, '2030-08-01', '2030-08-03', { ids: [q.id] }), 1);
  assert.equal(smmStore.get(biz.id, r2.id)?.status, 'ready');
  assert.equal(approveRange(biz, '2030-08-01', '2030-08-03', { before: Date.parse('2020-01-01') }), 0, 'tugmadan keyin tayyorlangan');
  const old = smmStore.add(biz.id, { day: '2020-01-01', time: '10:00', channel: 'instagram', format: 'post', pillar: 'Maslahat', title: 'Eski sana', angle: '' });
  await preparePost(biz, old.id, fakeDeps());
  assert.throws(() => approve(biz, old.id), /vaqti o'tib ketgan/);
  let release: () => void = () => {};
  const slow = prepareOne(biz, r2.id, { ...fakeDeps(), write: () => new Promise<string>(ok => { release = () => ok(POST_JSON(1)); }) });
  assert.throws(() => prepareOne(biz, q.id, fakeDeps()), /hozir tayyorlanmoqda/);
  release();
  await slow;
});

if (installedBrowser()) {
  await check('haqiqiy rasm (Chrome): post 4:5 va storis — JPEG', async () => {
    const biz = newBiz();
    const b = designBrand(biz, BOOK as never);
    for (const format of ['post', 'story'] as const) {
      const jpeg = await renderDesign({ template: 'tip', format, headline: "Tish cho'tkasini qachon almashtirish kerak?", bullets: ['Har 3 oyda'], badge: '01' }, b);
      assert.equal(jpeg[0], 0xff);
      assert.equal(jpeg[1], 0xd8);
      assert.ok(jpeg.length > 20_000, `${format}: ${jpeg.length} bayt`);
    }
  });
} else console.log('  – Chrome yo\'q: haqiqiy rasm tekshirilmadi');

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
