/**
 * Ishlash holati (to'lov nazorati): Hub imzolaydi (hub/licenseKey.ts issueAccess), Palantir faqat imzolisini qabul qiladi
 * (server/hubAccess.ts) — eslatma, to'xtatish, aloqasiz 23/30 kun, eski javob, soxta Hub, soat surilishi, begona kompyuter,
 * egasiga xabar matni. Ishga tushirish: npm run test:hub-access
 */
import './isolate';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

const MACHINE = 'AAAA-BBBB-CCCC-DDDD', OTHER = '1111-2222-3333-4444';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
process.env.LICENSE_PUBLIC_KEY = pub;
process.env.LICENSE_MACHINE_ID = MACHINE;

const { issueAccess, checkAccess, MODULES } = await import('../hub/licenseKey');
const { accessRejected, accessView, accessNotice, licensedModules, moduleAllowed, noteAccess, resetAccessCache, tickAccess, OFFLINE_BLOCK_DAYS, OFFLINE_WARN_DAYS } = await import('../server/hubAccess');
const { CREW, CORE, crewHas, crewLicensed, crewList, crewWorks } = await import('../src/lib/crew');
const { ADMIN_PLAN_JS } = await import('../hub/adminPlan');
const { settings } = await import('../server/serviceStore');

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-16T10:00:00Z');
const esc = (s: string) => s.replace(/</g, '&lt;');

console.log('\n# Imzo (hub/licenseKey.ts)');
check("o'z kompyuteri uchun — o'qiladi, matn bilan", () => {
  const g = checkAccess(issueAccess(MACHINE, 'warn', "To'lov 1-dekabrgacha", privateKey, T0), MACHINE, pub);
  assert.deepEqual(g, { state: 'warn', message: "To'lov 1-dekabrgacha", at: new Date(T0).toISOString(), modules: null });
});
check('boshqa kompyuterniki — rad etiladi', () => assert.equal(checkAccess(issueAccess(OTHER, 'active', '', privateKey, T0), MACHINE, pub), null));
check('begona kalit bilan imzolangan (soxta Hub) — rad etiladi', () => {
  const fake = generateKeyPairSync('ed25519').privateKey;
  assert.equal(checkAccess(issueAccess(MACHINE, 'active', '', fake, T0), MACHINE, pub), null);
});
check("o'zgartirilgan (blocked → active) — rad etiladi", () => {
  const [body, sig] = issueAccess(MACHINE, 'blocked', '', privateKey, T0).split('.');
  const j = JSON.parse(Buffer.from(body, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...j, s: 'active' })).toString('base64url');
  assert.equal(checkAccess(`${forged}.${sig}`, MACHINE, pub), null);
});
check('buzuq matn — xato emas, null', () => { assert.equal(checkAccess('', MACHINE, pub), null); assert.equal(checkAccess('a.b.c', MACHINE, pub), null); });

console.log('\n# Palantir tomonda (server/hubAccess.ts)');
const fresh = () => { settings.remove('hub.access'); resetAccessCache(); };
const at = (state: 'active' | 'warn' | 'blocked', hubTime: number, message = '') => issueAccess(MACHINE, state, message, privateKey, hubTime);
check("Hub hech qachon holat bermagan — to'liq ishlaydi (eski Hub, Hub'siz o'rnatish)", () => {
  fresh();
  assert.deepEqual(accessView(T0 + 365 * DAY), { state: 'active', message: '', reason: null, offlineDays: null });
});
check("blocked — to'xtaydi, sotuvchining matni bilan", () => {
  fresh();
  assert.equal(noteAccess(at('blocked', T0, "To'lov qilinmadi"), T0), true);
  const v = accessView(T0 + 60_000);
  assert.equal(v.state, 'blocked'); assert.equal(v.reason, 'hub'); assert.equal(v.message, "To'lov qilinmadi");
});
check('keyin «active» kelsa — ochiladi', () => {
  assert.equal(noteAccess(at('active', T0 + DAY), T0 + DAY), true);
  assert.equal(accessView(T0 + DAY).state, 'active');
});
check('eski javob (Hub vaqti oldingi) yangisini bosib ketmaydi', () => {
  assert.equal(noteAccess(at('blocked', T0), T0 + DAY), false);
  assert.equal(accessView(T0 + DAY).state, 'active');
});
check("begona yoki buzuq javob — saqlanmaydi va «rad etildi» deb belgilanadi (Hub ko'radi)", () => {
  assert.equal(noteAccess(issueAccess(OTHER, 'blocked', '', privateKey, T0 + 2 * DAY), T0 + 2 * DAY), false);
  assert.equal(accessRejected(), true);
  assert.equal(noteAccess('soxta'), false);
  assert.equal(noteAccess(undefined), false);
  assert.equal(accessView(T0 + DAY).state, 'active');
  noteAccess(at('active', T0 + 2 * DAY), T0 + 2 * DAY);
  assert.equal(accessRejected(), false);
});
check("saqlanadi: qayta ishga tushganda (kesh tozalansa) ham o'sha holat", () => {
  noteAccess(at('warn', T0 + 3 * DAY, 'Muddat yaqin'), T0 + 3 * DAY);
  resetAccessCache();
  const v = accessView(T0 + 3 * DAY);
  assert.equal(v.state, 'warn'); assert.equal(v.message, 'Muddat yaqin');
});
check(`aloqasiz ${OFFLINE_WARN_DAYS} kun — eslatma, ${OFFLINE_BLOCK_DAYS} kun — to'xtaydi`, () => {
  fresh();
  noteAccess(at('active', T0), T0);
  assert.equal(accessView(T0 + (OFFLINE_WARN_DAYS - 1) * DAY).state, 'active');
  const w = accessView(T0 + OFFLINE_WARN_DAYS * DAY);
  assert.equal(w.state, 'warn'); assert.equal(w.reason, 'offline'); assert.equal(w.offlineDays, OFFLINE_WARN_DAYS);
  const b = accessView(T0 + OFFLINE_BLOCK_DAYS * DAY);
  assert.equal(b.state, 'blocked'); assert.equal(b.reason, 'offline');
});
check("aloqa tiklansa — o'zi ochiladi", () => {
  noteAccess(at('active', T0 + 40 * DAY), T0 + 40 * DAY);
  assert.equal(accessView(T0 + 40 * DAY).state, 'active');
});
check("soxta Hub oxirgi to'g'ri javobni qayta yuborsa — hisob nolga tushmaydi", () => {
  fresh();
  const last = at('active', T0);
  noteAccess(last, T0);
  for (let d = 1; d <= OFFLINE_BLOCK_DAYS; d++) { tickAccess(T0 + d * DAY); noteAccess(last, T0 + d * DAY); }
  assert.equal(accessView(T0 + OFFLINE_BLOCK_DAYS * DAY).state, 'blocked');
});
check("soatni orqaga surish hisobni to'xtatmaydi va qaytarmaydi", () => {
  fresh();
  noteAccess(at('active', T0), T0);
  tickAccess(T0 + 20 * DAY);
  // Soat 20 kun orqaga surildi, keyin yana 10 kun o'tdi
  tickAccess(T0);
  tickAccess(T0 + 10 * DAY);
  const v = accessView(T0 + 10 * DAY);
  assert.equal(v.state, 'blocked', JSON.stringify(v));
});
check("soat 40 kun oldinda bo'lsa ham yangi javob kelishi bilan — ishlaydi (o'zini bloklamaydi)", () => {
  fresh();
  noteAccess(at('active', T0), T0 + 40 * DAY);
  assert.equal(accessView(T0 + 40 * DAY).state, 'active');
});

console.log('\n# Tarif — modullar');
check("modullar ro'yxati: asosiy bo'lmagan har AI xodim + telefon (Hub alohida joylanadi — src/ ni ko'rmaydi)", () => {
  assert.deepEqual([...MODULES].filter(m => m !== 'telefon').sort(), CREW.filter(m => !CORE.includes(m)).sort());
  assert.ok(MODULES.includes('telefon'));
});
check("Hub sahifasidagi ro'yxat (adminPlan.ts) — xuddi MODULES", () => {
  const ids = [...ADMIN_PLAN_JS.matchAll(/^\s*\['([a-z]+)', '/gm)].map(m => m[1]);
  assert.deepEqual([...ids].sort(), [...MODULES].sort());
});
check("imzoda: ro'yxat (MODULES tartibida); berilmasa — null (hammasi); bo'sh — faqat asosiylar", () => {
  const g = checkAccess(issueAccess(MACHINE, 'active', '', privateKey, T0, ['telefon', 'tahlilchi']), MACHINE, pub);
  assert.deepEqual(g?.modules, ['tahlilchi', 'telefon']);
  assert.equal(checkAccess(issueAccess(MACHINE, 'active', '', privateKey, T0), MACHINE, pub)?.modules, null);
  assert.deepEqual(checkAccess(issueAccess(MACHINE, 'active', '', privateKey, T0, []), MACHINE, pub)?.modules, []);
});
check("ro'yxatni o'zgartirib yoki olib tashlab (tarifni kengaytirib) bo'lmaydi — imzo buziladi", () => {
  const [body, sig] = issueAccess(MACHINE, 'active', '', privateKey, T0, ['tahlilchi']).split('.');
  const j = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
  const forge = (o: Record<string, unknown>) => `${Buffer.from(JSON.stringify(o)).toString('base64url')}.${sig}`;
  assert.equal(checkAccess(forge({ ...j, f: [...MODULES] }), MACHINE, pub), null);
  const { f: _drop, ...noF } = j;
  assert.equal(checkAccess(forge(noF), MACHINE, pub), null);
});
const biz = (hired: string[]) => ({ crew: JSON.stringify({ hired, dismissed: [] }) });
check('Hub tanlamagan — hamma xodim ishlaydi (avvalgidek)', () => {
  fresh();
  assert.equal(licensedModules(), null);
  assert.equal(moduleAllowed('telefon'), true);
  assert.equal(crewHas(biz(['kuzatuvchi']), 'kuzatuvchi'), true);
});
check("tarifda yo'q xodim — jamoada ko'rinmaydi, fonda ishlamaydi; asosiylari doim bor; telefon AI yopiq", () => {
  fresh();
  noteAccess(issueAccess(MACHINE, 'active', '', privateKey, T0, ['tahlilchi']), T0);
  const b = biz(['kuzatuvchi', 'tahlilchi', 'direktor']);
  assert.equal(crewHas(b, 'kuzatuvchi'), false);
  assert.equal(crewWorks(b, 'kuzatuvchi'), false);
  assert.equal(crewWorks(b, 'direktor'), false);
  assert.equal(crewHas(b, 'tahlilchi'), true);
  assert.ok(crewHas(b, 'qabulxona') && crewHas(b, 'yordamchi') && crewLicensed('qabulxona'));
  assert.deepEqual(crewList({ hired: ['kuzatuvchi', 'tahlilchi', 'direktor'], dismissed: [] }), ['qabulxona', 'yordamchi', 'tahlilchi']);
  assert.equal(moduleAllowed('telefon'), false);
});
check("eski bazada ham (tarkib hali hisoblanmagan — null) tarifda yo'q xodim ishlamaydi", () => {
  assert.equal(crewWorks({ crew: null }, 'kuzatuvchi'), false);
  assert.equal(crewWorks({ crew: null }, 'tahlilchi'), true);
});
check("tarif saqlanadi (qayta ishga tushganda); kengaytirilsa — egasi olgan xodim o'z joyiga qaytadi", () => {
  resetAccessCache();
  assert.deepEqual(licensedModules(), ['tahlilchi']);
  noteAccess(issueAccess(MACHINE, 'active', '', privateKey, T0 + DAY), T0 + DAY);
  assert.equal(crewHas(biz(['kuzatuvchi']), 'kuzatuvchi'), true);
  assert.equal(moduleAllowed('telefon'), true);
});

console.log('\n# Egasiga Telegram xabari');
check("to'xtatildi — matn, administrator va sotuvchi aytiladi; HTML qochiriladi", () => {
  const t = accessNotice({ state: 'blocked', message: '<b>pul</b>', reason: 'hub', offlineDays: 0 }, esc);
  assert.ok(t.includes("to'xtatildi") && t.includes('administrator') && t.includes('&lt;b>pul') && !t.includes('<b>pul'), t);
});
check("aloqasiz to'xtadi — internet va avtomatik ochilish aytiladi", () => {
  const t = accessNotice({ state: 'blocked', message: '', reason: 'offline', offlineDays: 31 }, esc);
  assert.ok(t.includes('31 kun') && t.includes('Internet') && t.includes("o'zi ochiladi"), t);
});
check('yana ochildi', () => assert.ok(accessNotice({ state: 'active', message: '', reason: null, offlineDays: 0 }, esc).includes("to'liq ishlayapti")));

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
