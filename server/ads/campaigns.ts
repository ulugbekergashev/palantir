/**
 * Targetolog: Meta reklama kabinetini ulash, kampaniyani ishga tushirish, to'xtatish va sarfni kuzatish.
 *
 * Ishga tushirish (faqat egasi tugmasi bilan; biznesda bir vaqtda bittasi): limitlar haqiqiy sarf bilan qayta tekshiriladi → rasmlar
 * yuklanadi → kampaniya PAUZADA yaratiladi (byudjet Meta'dan o'qib solishtiriladi — Meta o'zgartirgan bo'lsa to'xtaydi) → guruh,
 * kreativlar, reklamalar → bazada «ishlayapti» deb yoziladi (kuzatuvga tushadi) → oxirida kampaniya yoqiladi. Yoqishgacha biror qadam
 * yiqilsa — kampaniya o'chiriladi (pauzada edi: pul ketmagan). Yoqish so'rovi yiqilsa — avval pauza, keyin o'chirish; bo'lmasa kampaniya
 * kuzatuvda qoladi va egasiga aytiladi. Birlik xatosidan himoya — valyutalar ro'yxati (plan.ts CURRENCIES).
 * Kuzatuv (alohida taymer, botdan mustaqil): sarf, natija; limitga yetsa yoki limit olib tashlansa — Palantir kampaniyalari to'xtatiladi.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdCampaign } from '../../src/types';
import type { BusinessRow } from '../db';
import { env } from '../env';
import { notifyOwner } from '../inbox/core';
import { posts } from '../marketing/posts';
import { videoMp4 } from '../content/render';
import { AdsError, graph, graphUpload } from './graph';
import { CURRENCIES, adParams, adsetParams, campaignParams, creativeParams, money, planProblems, planSummary, toMinor, type Plan, type Spend } from './plan';
import { TargetError, adsStore, type AdsConnection, type MetaIds } from './store';

export { TargetError } from './store';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const planMark = (plan: Plan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 8);
const DAY_MS = 86_400_000;

// ─── Rasmlar ──────────────────────────────────────────────────────────────────

/** Panelda yuklangan reklama rasmlari — har biznesning o'z papkasida */
export const uploadDir = (bizId: string) => join(env.dataDir, 'reklama', bizId.replace(/[^A-Za-z0-9]/g, ''));
const FILE = /^[a-z0-9]{8,24}\.jpg$/;
const ID = /^[A-Za-z0-9_-]{6,20}$/;
/**
 * Rasm: «post:<id>» — shu biznesning Instagram posti rasmi; «file:<nom>» — shu biznes panelda yuklagani; «video:<id>» — Kontent-meyker
 * videosining muqovasi (reklamada videoning o'zi, videoFile). Yo'l tashqariga va boshqa biznesga chiqmaydi
 */
export function imagePath(ref: string, bizId: string): string | null {
  const [kind, name = ''] = ref.split(':');
  if (kind === 'video') return ID.test(name) ? videoMp4(bizId, name, true) : null;
  const path = kind === 'post' && ID.test(name) && posts.get(bizId, name) ? join(env.dataDir, 'postlar', `${name}.jpg`)
    : kind === 'file' && FILE.test(name) ? join(uploadDir(bizId), name) : null;
  return path && existsSync(path) ? path : null;
}
/** «video:<id>» — shu biznesning yig'ilgan mp4 videosi; boshqa ref — null */
export function videoFile(ref: string, bizId: string): string | null {
  const [kind, name = ''] = ref.split(':');
  return kind === 'video' && ID.test(name) ? videoMp4(bizId, name) : null;
}

/** Meta videoni qayta ishlashini kutish (yuklangach «processing» → «ready») */
const VIDEO_READY_MS = Number(process.env.ADS_VIDEO_WAIT_MS) || 5 * 60_000;
const VIDEO_POLL_MS = Number(process.env.ADS_VIDEO_POLL_MS) || 5_000;
async function uploadVideo(c: AdsConnection, act: string, file: string, name: string): Promise<string> {
  const up = await graphUpload<{ id?: string }>(c.token, `${act}/advideos`, { name, type: 'video/mp4', data: readFileSync(file) }, { name });
  if (!up.id) throw new TargetError("Meta video raqamini qaytarmadi");
  const until = Date.now() + VIDEO_READY_MS;
  for (;;) {
    const st = await graph<{ status?: { video_status?: string } }>(c.token, 'GET', up.id, { fields: 'status' });
    const s = st.status?.video_status;
    if (s === 'ready') return up.id;
    if (s === 'error') throw new TargetError("Meta videoni qabul qilmadi (format yoki o'lcham) — boshqa video tanlang");
    if (Date.now() > until) throw new TargetError("Meta videoni hali tayyorlayapti — birozdan keyin qayta urinib ko'ring");
    await new Promise(r => setTimeout(r, VIDEO_POLL_MS));
  }
}
export const ensureUploadDir = (bizId: string) => { mkdirSync(uploadDir(bizId), { recursive: true }); };

// ─── Ulash ────────────────────────────────────────────────────────────────────

interface AccountInfo { name?: string; currency?: string; account_status?: number; timezone_name?: string }

/** Ishga tushgan yoki ishga tushirilayotgan kampaniyalar bor-yo'qligi (kabinetni almashtirish/uzishda) */
const tracked = (bizId: string) => adsStore.campaigns(bizId).some(x => x.status === 'launching' || x.status === 'active' || x.status === 'paused');

export async function connect(biz: BusinessRow, input: { token: string; adAccountId: string; pageId: string; igActorId?: string | null }): Promise<AdsConnection> {
  const token = input.token.trim();
  const id = input.adAccountId.trim().replace(/^act_/, '');
  if (!/^\d{5,20}$/.test(id)) throw new TargetError("Reklama kabineti ID'si raqamlardan iborat bo'lishi kerak (act_ siz ham bo'ladi)");
  if (!/^\d{5,20}$/.test(input.pageId.trim())) throw new TargetError("Facebook sahifa ID'si raqamlardan iborat bo'lishi kerak");
  const ig = input.igActorId?.trim() || null;
  if (ig && !/^\d{5,25}$/.test(ig)) throw new TargetError("Instagram akkaunt ID'si raqamlardan iborat bo'lishi kerak");
  // Kuzatuvdagi kampaniyalar eski kabinetda: boshqa kabinetga o'tsa, ularni to'xtatib ham, kuzatib ham bo'lmay qoladi (token yangilash — mumkin)
  const prev = adsStore.connection(biz.id);
  if (prev && prev.adAccountId !== id && tracked(biz.id)) throw new TargetError("Avval eski kabinetdagi kampaniyalarni tugating — keyin boshqa kabinetga o'ting");
  const acc = await graph<AccountInfo>(token, 'GET', `act_${id}`, { fields: 'name,currency,account_status,timezone_name' }).catch(wrap);
  if (acc.account_status !== 1) throw new TargetError(`Reklama kabineti faol emas (holati: ${acc.account_status ?? "noma'lum"}) — Ads Manager'da tekshiring`);
  const currency = (acc.currency ?? '').toUpperCase();
  if (!CURRENCIES.has(currency)) throw new TargetError(`Kabinet valyutasi ${currency || "noma'lum"} — hozircha faqat ${[...CURRENCIES].join(', ')} qo'llanadi (summa birligi aniq)`);
  const page = await graph<{ name?: string }>(token, 'GET', input.pageId.trim(), { fields: 'name' }).catch(wrap);
  const c: AdsConnection = {
    token, adAccountId: id, accountName: acc.name ?? '', currency, timezone: acc.timezone_name ?? '',
    pageId: input.pageId.trim(), pageName: page.name ?? '', igActorId: ig,
  };
  adsStore.saveConnection(biz.id, c);
  return c;
}

/** Uzish: kuzatuvdagi kampaniya bo'lsa — yo'q (to'xtatib bo'lmay qoladi) */
export function disconnect(biz: BusinessRow): void {
  if (tracked(biz.id)) throw new TargetError("Avval ishlayotgan va to'xtatilgan kampaniyalarni tugating (yoki Ads Manager'da o'chiring)");
  adsStore.removeConnection(biz.id);
}

const wrap = (e: unknown): never => { throw e instanceof AdsError ? new TargetError(e.message) : e; };
const need = (biz: BusinessRow): AdsConnection => {
  const c = adsStore.connection(biz.id);
  if (!c) throw new TargetError('Meta reklama kabineti ulanmagan (Marketing → Targetolog → Ulash)');
  return c;
};

// ─── Sarf ─────────────────────────────────────────────────────────────────────

const spendOf = (r: { data?: { spend?: string }[] }) => Number.parseFloat(r.data?.[0]?.spend ?? '0') || 0;
const remaining = (x: AdCampaign) => Math.max(0, (x.plan.budget ?? 0) - x.spent);
const daysLeft = (x: AdCampaign, now = Date.now()) => Math.max(1, Math.ceil(((x.endsAt ? Date.parse(x.endsAt) : now + x.plan.days * DAY_MS) - now) / DAY_MS));

/**
 * Akkaunt bo'yicha bugun va shu oy (Palantir'dan tashqari reklamalar ham — ehtiyot uchun); ishlayotgan va ishga tushirilayotganlarga
 * band qolgan byudjet va ularning kunlik tezligi
 */
export async function spendNow(biz: BusinessRow, c: AdsConnection, except?: string): Promise<Spend> {
  const [today, month] = await Promise.all([
    graph<{ data?: { spend?: string }[] }>(c.token, 'GET', `act_${c.adAccountId}/insights`, { fields: 'spend', date_preset: 'today' }),
    graph<{ data?: { spend?: string }[] }>(c.token, 'GET', `act_${c.adAccountId}/insights`, { fields: 'spend', date_preset: 'this_month' }),
  ]).catch(wrap);
  const running = adsStore.campaigns(biz.id).filter(x => (x.status === 'active' || x.status === 'launching') && x.id !== except);
  return {
    today: spendOf(today), month: spendOf(month),
    committed: running.reduce((n, x) => n + remaining(x), 0),
    dailyRate: running.reduce((n, x) => n + remaining(x) / daysLeft(x), 0),
  };
}

// ─── Taklif ───────────────────────────────────────────────────────────────────

interface GeoHit { key?: string; name?: string; country_code?: string; type?: string }

/** Shahar nomlari → Meta joy kodi (topilmasa — key bo'sh qoladi, reja ishga tushmaydi) */
export async function resolveCities(c: AdsConnection, plan: Plan): Promise<Plan> {
  const cities = await Promise.all(plan.cities.map(async city => {
    if (city.key) return city;
    const r = await graph<{ data?: GeoHit[] }>(c.token, 'GET', 'search', { type: 'adgeolocation', location_types: ['city'], q: city.name, limit: 10 }).catch(() => ({ data: [] }));
    const hit = (r.data ?? []).find(h => h.key && (!h.country_code || plan.countries.includes(h.country_code.toUpperCase())));
    return { ...city, key: hit?.key ?? null, name: hit?.name ?? city.name };
  }));
  return { ...plan, cities };
}

/** Rejani saqlaydi va egasiga karta yuboradi */
export async function propose(biz: BusinessRow, task: string, plan: Plan): Promise<AdCampaign> {
  const c = adsStore.connection(biz.id);
  const resolved = c ? await resolveCities(c, plan) : plan;
  const saved = adsStore.add(biz.id, task, resolved, c?.currency ?? 'USD');
  await card(biz, saved.id).catch(e => console.error('[targetolog] karta:', (e as Error).message));
  return saved;
}

/** Kartadagi va paneldagi muammolar. spend: berilmasa — Meta'dan olinadi; null — olinmagan (qayta so'ralmaydi) */
export async function problemsOf(biz: BusinessRow, plan: Plan, spend?: Spend | null): Promise<string[]> {
  const c = adsStore.connection(biz.id);
  const s = spend !== undefined ? spend : c ? await spendNow(biz, c).catch(() => null) : null;
  const out = planProblems(plan, adsStore.limits(biz.id), s ?? { today: 0, month: 0, committed: 0, dailyRate: 0 }, c, c?.currency ?? 'USD');
  return c && !s ? [...out, "Meta'dan sarf ma'lumoti olinmadi — ishga tushirishdan oldin qayta tekshiriladi"] : out;
}

/** Kartaga to'liq sig'adigan rejaning eng uzun matni: undan uzun bo'lsa — tugma yo'q, panelda ko'rib tasdiqlanadi */
const CARD_TEXT = 3300;

/** Egasiga karta: hamma narsa to'liq — reklama matnlari, sarlavhalar, mijozga birinchi xabar. Egasi ko'rmagan narsa chiqmasin */
export async function card(biz: BusinessRow, id: string): Promise<void> {
  const camp = adsStore.campaign(biz.id, id);
  if (!camp || camp.status !== 'proposed') return;
  const p = camp.plan, problems = await problemsOf(biz, p);
  const ads = p.ads.map((a, i) => `${i + 1}) ${a.headline ? `[${a.headline}] ` : ''}${a.text}`).join('\n');
  const body = [planSummary(p, camp.currency).join('\n'), `Reklama matnlari:\n${ads}`, p.welcome ? `Yozganlarga birinchi xabar: ${p.welcome}` : '', p.notes.join('\n')].filter(Boolean).join('\n\n');
  const long = body.length > CARD_TEXT;
  const tail = problems.length
    ? `⚠️ <b>Ishga tushmaydi:</b>\n${esc(problems.map(x => `— ${x}`).join('\n'))}\n<i>Panel → Marketing → Targetolog'da tuzating.</i>`
    : long ? "<i>Reja uzun — to'liq ko'rib, panelda ishga tushiring (Marketing → Targetolog).</i>"
      : `<i>Tasdiqlasangiz Meta'da yaratiladi va ishga tushadi. Limitlar ishga tushirishdan oldin yana tekshiriladi.</i>`;
  const html = `🎯 <b>Targetolog: kampaniya rejasi</b>\n«${esc(p.name)}»\n\n${esc(long ? `${body.slice(0, CARD_TEXT)}…` : body)}\n\n${tail}`;
  const cancel = { text: '✖️ Bekor', callback_data: `tx|${id}` };
  const keyboard = { inline_keyboard: [problems.length || long ? [cancel] : [{ text: '🚀 Ishga tushirish', callback_data: `tl|${id}|${planMark(p)}` }, cancel]] };
  await notifyOwner(biz, html, keyboard);
}

// ─── Ishga tushirish ──────────────────────────────────────────────────────────

const imageHash = (r: { images?: Record<string, { hash?: string }> }): string => {
  const hash = Object.values(r.images ?? {}).find(x => x?.hash)?.hash;
  if (!hash) throw new TargetError("Meta rasmni qabul qildi, lekin kodini qaytarmadi");
  return hash;
};

/** Biznesda bir vaqtda bitta ishga tushirish: ikkitasi bir-birining limitini ko'rmay o'tib ketmasin */
const launching = new Set<string>();

export async function launch(biz: BusinessRow, id: string, opts: { mark?: string } = {}): Promise<AdCampaign> {
  if (launching.has(biz.id)) throw new TargetError('Boshqa kampaniya hozir ishga tushirilmoqda — tugashini kuting');
  launching.add(biz.id);
  try {
    return await launchOne(biz, id, opts);
  } finally {
    launching.delete(biz.id);
  }
}

async function launchOne(biz: BusinessRow, id: string, opts: { mark?: string }): Promise<AdCampaign> {
  const first = adsStore.campaign(biz.id, id);
  if (!first) throw new TargetError('Kampaniya topilmadi');
  if (first.status !== 'proposed') throw new TargetError(first.status === 'cancelled' ? 'Bekor qilingan' : 'Allaqachon ishga tushirilgan yoki yopilgan');
  const expect = opts.mark ?? planMark(first.plan);
  if (expect !== planMark(first.plan)) throw new TargetError("Reja panelda o'zgargan — yangi kartadan yoki paneldan ishga tushiring");
  const c = need(biz);
  if (first.currency !== c.currency) throw new TargetError(`Reja ${first.currency} da tuzilgan, kabinet esa ${c.currency} da — rejani qayta tuzing`);
  // Haqiqiy sarf bilan qayta: kartadan beri sarf o'zgargan bo'lishi mumkin
  const problems = planProblems(first.plan, adsStore.limits(biz.id), await spendNow(biz, c, id), c, c.currency);
  if (problems.length) throw new TargetError(problems.join('; '));
  if (!adsStore.move(biz.id, id, ['proposed'], 'launching')) throw new TargetError("Kampaniya holati o'zgardi — sahifani yangilang");
  // Sarf so'ralayotganda egasi rejani o'zgartirgan bo'lsa — Meta'ga eski reja ketmasin
  const camp = adsStore.campaign(biz.id, id)!;
  if (planMark(camp.plan) !== expect) {
    adsStore.move(biz.id, id, ['launching'], 'proposed');
    throw new TargetError("Reja shu payt o'zgardi — qayta tekshirib ishga tushiring");
  }
  const images = camp.plan.ads.map(a => imagePath(a.image, biz.id));
  const videos = camp.plan.ads.map(a => (a.image.startsWith('video:') ? videoFile(a.image, biz.id) : null));
  if (images.some(x => !x) || camp.plan.ads.some((a, i) => a.image.startsWith('video:') && !videos[i])) {
    adsStore.move(biz.id, id, ['launching'], 'proposed');
    throw new TargetError('Reklama rasmi yoki videosi topilmadi — panelda qayta tanlang');
  }

  const p = camp.plan, meta: MetaIds = {};
  const act = `act_${c.adAccountId}`;
  const start = new Date();
  try {
    meta.imageHashes = [];
    for (const [i, path] of images.entries()) {
      const r = await graph<{ images?: Record<string, { hash?: string }> }>(c.token, 'POST', `${act}/adimages`, { bytes: readFileSync(path!).toString('base64'), name: `palantir-${id}-${i}.jpg` });
      meta.imageHashes.push(imageHash(r));
    }
    // Video — kampaniyadan oldin: Meta qayta ishlashini kutadi; yiqilsa Meta'da hali kampaniya yo'q (pul ketmaydi)
    meta.videoIds = [];
    for (const [i, file] of videos.entries()) meta.videoIds.push(file ? await uploadVideo(c, act, file, `palantir-${id}-${i}.mp4`) : '');
    const created = await graph<{ id: string }>(c.token, 'POST', `${act}/campaigns`, campaignParams(p, c.currency));
    meta.campaignId = created.id;
    adsStore.setMeta(biz.id, id, meta);
    // Meta byudjetni yuborilganidek saqlaganini tekshiradi (birlik xatosidan himoya — valyutalar ro'yxati, plan.ts CURRENCIES)
    const back = await graph<{ lifetime_budget?: string }>(c.token, 'GET', created.id, { fields: 'lifetime_budget' });
    const want = toMinor(p.budget ?? 0, c.currency);
    if (Number(back.lifetime_budget) !== want) throw new TargetError(`Meta'da byudjet boshqacha chiqdi (${back.lifetime_budget} ≠ ${want}) — kampaniya o'chirildi, pul ketmadi`);
    meta.adsetId = (await graph<{ id: string }>(c.token, 'POST', `${act}/adsets`, adsetParams(p, c, created.id, start))).id;
    meta.creativeIds = [];
    meta.adIds = [];
    for (let i = 0; i < p.ads.length; i++) {
      const cr = await graph<{ id: string }>(c.token, 'POST', `${act}/adcreatives`, creativeParams(p, c, i, meta.imageHashes[i], meta.videoIds[i] || undefined));
      meta.creativeIds.push(cr.id);
      adsStore.setMeta(biz.id, id, meta);
      meta.adIds.push((await graph<{ id: string }>(c.token, 'POST', `${act}/ads`, adParams(p, i, meta.adsetId, cr.id))).id);
    }
    adsStore.setMeta(biz.id, id, meta);
  } catch (e) {
    const why = reason(e);
    let cleanup = '';
    if (meta.campaignId) {
      // Pauzadagi kampaniya o'chiriladi (bolalari bilan): Meta'da yarim-yaratilgan narsa qolmasin
      await graph(c.token, 'DELETE', meta.campaignId).catch(() => { cleanup = " Meta kabinetida pauzadagi qoralama qoldi — Ads Manager'da o'chiring."; });
    }
    adsStore.move(biz.id, id, ['launching'], 'failed', { error: `${why}${cleanup}` });
    throw new TargetError(`Ishga tushmadi: ${why}${cleanup}`);
  }

  // Yoqishdan OLDIN kuzatuvga: server shu payt to'xtasa yoki yoqish javobi kelmasa ham kampaniya nazoratdan chiqmasin
  const ends = new Date(start.getTime() + p.days * DAY_MS).toISOString();
  adsStore.move(biz.id, id, ['launching'], 'active', { launchedAt: start.toISOString(), endsAt: ends, error: null });
  try {
    await graph(c.token, 'POST', meta.campaignId!, { status: 'ACTIVE' });
  } catch (e) {
    const why = reason(e);
    // Javob kelmagan bo'lsa ham Meta yoqib qo'ygan bo'lishi mumkin: avval pauza, keyin o'chirish
    const paused = await graph(c.token, 'POST', meta.campaignId!, { status: 'PAUSED' }).then(() => true, () => false);
    const deleted = await graph(c.token, 'DELETE', meta.campaignId!).then(() => true, () => false);
    if (paused || deleted) {
      adsStore.move(biz.id, id, ['active'], 'failed', { error: why });
      throw new TargetError(`Ishga tushmadi: ${why}`);
    }
    // Hech biri o'tmadi: kampaniya yoqilgan bo'lishi mumkin — kuzatuvda qoldiriladi (limitda to'xtatiladi), egasi tekshiradi
    adsStore.move(biz.id, id, ['active'], 'active', { stopReason: `Yoqish javobi kelmadi (${why}) — Ads Manager'da holatini tekshiring` });
    await notifyOwner(biz, `⚠️ <b>Targetolog</b>: «${esc(p.name)}» yoqildimi — aniq emas (Meta javob bermadi). Kuzatuvda turibdi; Ads Manager'da tekshiring yoki to'xtating.`,
      { inline_keyboard: [[{ text: "⏸ To'xtatish", callback_data: `tp|${id}` }]] }).catch(() => {});
    return adsStore.campaign(biz.id, id)!;
  }
  await notifyOwner(biz, `✅ <b>Targetolog</b>: «${esc(p.name)}» ishga tushdi — ${money(p.budget ?? 0, c.currency)}, ${p.days} kun. Meta tekshiruvidan o'tgach ko'rsatila boshlaydi.`,
    { inline_keyboard: [[{ text: "⏸ To'xtatish", callback_data: `tp|${id}` }]] }).catch(() => {});
  return adsStore.campaign(biz.id, id)!;
}

const reason = (e: unknown): string => {
  if (e instanceof AdsError || e instanceof TargetError) return e.message;
  console.error('[targetolog] ishga tushirish:', e);
  return 'ichki xato';
};

// ─── To'xtatish, davom ettirish, bekor ────────────────────────────────────────

export async function pause(biz: BusinessRow, id: string, why = "Egasi to'xtatdi"): Promise<AdCampaign> {
  const camp = adsStore.campaign(biz.id, id);
  if (!camp?.meta.campaignId || camp.status !== 'active') throw new TargetError(!camp ? 'Kampaniya topilmadi' : 'Kampaniya ishlamayapti');
  await graph(need(biz).token, 'POST', camp.meta.campaignId, { status: 'PAUSED' }).catch(wrap);
  adsStore.move(biz.id, id, ['active'], 'paused', { stopReason: why });
  return adsStore.campaign(biz.id, id)!;
}

/** Davom ettirish — pul ketadi: limitlar haqiqiy sarf bilan, shu kampaniyaning qolgan byudjeti va kunlik tezligi bilan tekshiriladi */
export async function resume(biz: BusinessRow, id: string): Promise<AdCampaign> {
  const camp = adsStore.campaign(biz.id, id);
  if (!camp?.meta.campaignId || camp.status !== 'paused') throw new TargetError(!camp ? 'Kampaniya topilmadi' : "Kampaniya to'xtatilmagan");
  if (camp.endsAt && Date.parse(camp.endsAt) <= Date.now()) throw new TargetError("Muddati tugagan — yangi kampaniya tuzing");
  const c = need(biz), l = adsStore.limits(biz.id), s = await spendNow(biz, c, id), cur = c.currency;
  if (!(l.daily > 0 && l.monthly > 0 && l.perCampaign > 0)) throw new TargetError("Limitlar o'rnatilmagan");
  const left = remaining(camp), rate = left / daysLeft(camp);
  if (s.today >= l.daily) throw new TargetError(`Bugungi limit tugagan (${money(s.today, cur)} / ${money(l.daily, cur)}) — ertaga davom ettiring`);
  if (rate + s.dailyRate > l.daily) throw new TargetError(`Qolgan ${money(Math.round(left * 100) / 100, cur)} qolgan kunlarga bo'linsa kuniga ~${money(Math.round(rate * 100) / 100, cur)} — kunlik limitdan ko'p`);
  if (s.month + s.committed + left > l.monthly) throw new TargetError(`Oylik limit yetmaydi: sarflangan ${money(s.month, cur)}, band ${money(s.committed, cur)}, bu kampaniyada qolgan ${money(Math.round(left * 100) / 100, cur)}`);
  await graph(c.token, 'POST', camp.meta.campaignId, { status: 'ACTIVE' }).catch(wrap);
  adsStore.move(biz.id, id, ['paused'], 'active', { stopReason: null });
  return adsStore.campaign(biz.id, id)!;
}

export function cancel(biz: BusinessRow, id: string): void {
  if (adsStore.move(biz.id, id, ['proposed', 'failed'], 'cancelled')) return;
  throw new TargetError('Faqat rejani yoki yaratilmagan kampaniyani bekor qilish mumkin — ishlayotganini to\'xtating');
}

// ─── Kuzatuv ──────────────────────────────────────────────────────────────────

interface Insight { spend?: string; impressions?: string; clicks?: string; actions?: { action_type?: string; value?: string }[] }
/** Yozishma boshlandi (messaging) yoki havola bosildi (sayt) — kampaniya maqsadidagi natija */
const resultsOf = (i: Insight, destination: Plan['destination']): number =>
  (i.actions ?? []).filter(a => (destination === 'website' ? a.action_type === 'link_click' : (a.action_type ?? '').includes('messaging_conversation_started')))
    .reduce((n, a) => n + (Number(a.value) || 0), 0);

/** Egasiga ogohlantirish kuniga bir marta (sababi bo'yicha) */
const warned = new Map<string, string>();
const warnOnce = async (biz: BusinessRow, key: string, html: string, now: Date) => {
  const day = now.toISOString().slice(0, 10), k = `${biz.id}:${key}`;
  if (warned.get(k) === day) return;
  warned.set(k, day);
  await notifyOwner(biz, html).catch(() => {});
};
/** Ketma-ket muvaffaqiyatsiz kuzatuvlar: limit nazorati ishlamay qolsa egasi bilsin */
const misses = new Map<string, number>();
const MISS_ALERT = 3;

/** Bitta biznes: sarf va natijani yangilaydi; muddati tugaganini yopadi; limitga yetsa yoki limit olib tashlansa — hammasini to'xtatadi */
export async function watch(biz: BusinessRow, now = new Date()): Promise<void> {
  const live = adsStore.live(biz.id).filter(x => x.status === 'active');
  if (!live.length) return;
  const c = adsStore.connection(biz.id);
  if (!c) {
    await warnOnce(biz, 'nocon', '⚠️ <b>Targetolog</b>: kampaniyalar ishlayapti, lekin reklama kabineti uzilgan — sarfni kuzatib bo\'lmayapti. Ads Manager\'da tekshiring.', now);
    return;
  }
  for (const camp of live) {
    if (!camp.meta.campaignId) continue;
    const r = await graph<{ data?: Insight[] }>(c.token, 'GET', `${camp.meta.campaignId}/insights`, { fields: 'spend,impressions,clicks,actions', date_preset: 'maximum' }).catch(() => null);
    const i = r?.data?.[0];
    if (i) adsStore.setStats(biz.id, camp.id, { spent: Number.parseFloat(i.spend ?? '0') || 0, results: resultsOf(i, camp.plan.destination), clicks: Number(i.clicks) || 0, impressions: Number(i.impressions) || 0 });
    if (camp.endsAt && Date.parse(camp.endsAt) <= now.getTime()) adsStore.move(biz.id, camp.id, ['active'], 'finished', { stopReason: 'Muddati tugadi' });
  }
  const l = adsStore.limits(biz.id);
  const s = await spendNow(biz, c).catch(() => null);
  if (!s) {
    const n = (misses.get(biz.id) ?? 0) + 1;
    misses.set(biz.id, n);
    if (n >= MISS_ALERT) await warnOnce(biz, 'blind', "⚠️ <b>Targetolog</b>: Meta'dan sarf ma'lumoti bir necha marta olinmadi — limit nazorati hozir ishlamayapti. Token va internetni tekshiring yoki kampaniyalarni to'xtating.", now);
    return;
  }
  misses.delete(biz.id);
  const cur = c.currency;
  // Limit olib tashlangan (0) — «hech narsa ishlamasin» qoidasi ishlayotganlarga ham
  const over = !(l.daily > 0 && l.monthly > 0) ? 'limitlar olib tashlandi'
    : s.today >= l.daily ? `bugungi sarf ${money(s.today, cur)} — kunlik limit ${money(l.daily, cur)}`
      : s.month >= l.monthly ? `bu oy ${money(s.month, cur)} — oylik limit ${money(l.monthly, cur)}` : null;
  if (!over) return;
  const stopped: string[] = [], stuck: string[] = [];
  for (const camp of adsStore.live(biz.id).filter(x => x.status === 'active')) {
    try { await pause(biz, camp.id, `Limit: ${over}`); stopped.push(camp.plan.name); } catch (e) { stuck.push(camp.plan.name); console.error("[targetolog] limitda to'xtatilmadi:", (e as Error).message); }
  }
  if (stopped.length) await warnOnce(biz, 'limit', `⛔️ <b>Targetolog</b>: limitga yetildi (${esc(over)}). To'xtatildi: ${esc(stopped.join(', '))}. Davom ettirish — panelda.`, now);
  if (stuck.length) await warnOnce(biz, 'stuck', `🚨 <b>Targetolog</b>: limitga yetildi (${esc(over)}), lekin to'xtatib bo'lmadi: ${esc(stuck.join(', '))}. Darhol Ads Manager'da to'xtating!`, now);
}

/** Hamma bizneslar: jadval chaqiradi (bot ulanmagan bo'lsa ham) */
export async function watchAll(getBiz: (id: string) => BusinessRow | undefined, now = new Date()): Promise<void> {
  for (const bizId of adsStore.bizWithActive()) {
    const biz = getBiz(bizId);
    if (biz?.active) await watch(biz, now).catch(e => console.error(`[targetolog] kuzatuv (${biz.profile.name}):`, (e as Error).message));
  }
}
