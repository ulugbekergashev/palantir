/**
 * Boshqaruv markazini ko'rish: vaqtinchalik Hub (D:\palantir-sinov-tmp), soxta mijozlar va 14 kunlik grafik, uch ko'rinishda
 * (qorong'i, yorug', telefon) ekran rasmlari — headless, ekranga chiqmaydi. Sahifadagi JS xatosi bo'lsa — ko'rsatiladi.
 * Ishga tushirish: npm run hub:demo [-- <rasmlar papkasi>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { createClients } from '../hub/clients.ts';
import { parseHubCode } from '../src/lib/hubCode';
import { chromePath } from './chrome';

const PORT = 3418, HUB = `http://127.0.0.1:${PORT}`, KEY = 'hub-admin-demo-kaliti-0123456789abcdef';
const OUT = process.argv[2] || 'D:/palantir-sinov-tmp/hub-shots';
const work = mkdtempSync('D:/palantir-sinov-tmp/hubdemo-');
const dbFile = join(work, 'hub.db');
// 14 kunlik grafik uchun soatlik ko'rsatkichlar
{
  const db = new DatabaseSync(dbFile);
  let t = Date.now() - 13 * 86_400_000;
  const c = createClients(db, () => new Date(t));
  for (let d = 0; d < 14; d++) for (const hour of [9, 13, 18]) {
    t = Date.now() - (13 - d) * 86_400_000 + (hour - 12) * 3_600_000;
    const total = 5 + Math.floor(d / 4);
    c.snapshot(total, total - (d % 5 === 2 ? 2 : hour === 9 ? 1 : 0), d === 4 ? 2 : d === 11 ? 1 : 0);
  }
  db.close();
}
const hub = spawn(process.execPath, ['--import', 'tsx', 'hub/server.ts'], {
  env: { ...process.env, PORT: String(PORT), HUB_DB: dbFile, HUB_ADMIN_KEY: KEY, HUB_PUBLIC_URL: HUB, HUB_RELEASE_URL: 'http://127.0.0.1:9/yoq', HUB_OFFLINE_MS: '600000' },
  stdio: 'ignore', cwd: process.cwd(),
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const admin = { authorization: `Bearer ${KEY}` };
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${HUB}/health`)).ok) break; } catch { /* */ } await sleep(250); }
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const clients = [
    { name: 'Tabassum Dental', label: 'Tabassum Dental', kinds: ['clinic'], version: '0.4.18', card: { owner: 'Akmal Karimov', phone: '+998 90 123 45 67', city: 'Toshkent', plan: 600000, paidUntil: day(20) } },
    { name: 'Shifo Med', label: 'Shifo Med', kinds: ['clinic'], version: '0.4.14', problems: [{ business: 'Shifo Med', label: 'Telefon liniyasi', problem: "AI ulanmayapti — qo'ng'iroqlar administratorga o'tyapti", since: new Date().toISOString() }], card: { owner: 'Dilnoza Aliyeva', phone: '+998 93 555 11 22', city: 'Samarqand', plan: 500000, paidUntil: day(-3) } },
    { name: 'Smart English', label: 'Smart English', kinds: ['education'], version: '0.4.15', card: { owner: 'Javohir', phone: '+998 97 777 00 11', city: 'Toshkent', plan: 400000, paidUntil: day(4) } },
    { name: 'Mebel Uyi', label: 'Mebel Uyi', kinds: ['manufacturing'], version: '0.4.13', disk: 1200, card: { owner: 'Bahodir', city: 'Namangan', plan: 450000, paidUntil: day(40) } },
    { name: 'Denta Smile', label: 'Denta Smile', kinds: ['clinic'], version: '0.4.12', update: { from: '0.4.12', to: '0.4.15', result: 'qaytarildi', reason: 'papka band (EBUSY)', at: new Date().toISOString() }, license: { activated: false, daysLeft: 6 }, card: { owner: 'Sardor', phone: '+998 99 101 20 30', city: "Farg'ona", plan: 500000, paidUntil: day(12) } },
    { name: 'Avto Servis 77', label: 'Avto Servis 77', kinds: ['services'], version: '0.4.15', offline: true, card: { city: 'Buxoro' } },
  ];
  for (const c of clients) {
    const made = await (await fetch(`${HUB}/admin/clinics`, { method: 'POST', headers: admin, body: JSON.stringify({ name: c.name }) })).json() as { clinicId: string; code: string };
    const auth = { authorization: `Bearer ${parseHubCode(made.code)!.key}` };
    if (!c.offline) await fetch(`${HUB}/api/heartbeat`, { method: 'POST', headers: auth, body: JSON.stringify({
      version: c.version, schema: 3, startedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), diskFreeMb: c.disk ?? 48_000, businesses: 1, label: c.label,
      problems: c.problems ?? [], lastUpdate: c.update ?? { from: '0.4.14', to: c.version, result: 'ok', at: new Date().toISOString() },
      lastOffsite: { day: day(0), ok: true, size: 120000, at: new Date().toISOString() }, license: c.license ?? { activated: true, daysLeft: null }, setup: false, kinds: c.kinds, industries: [],
      // Tarif (16-band): Tabassum kamera, telefon va Direktorni ishlatadi
      uses: c.name === 'Tabassum Dental' ? ['direktor', 'tahlilchi', 'kuzatuvchi', 'telefon'] : ['direktor'], modules: null,
    }) });
    await fetch(`${HUB}/admin/clinics/${made.clinicId}/card`, { method: 'POST', headers: admin, body: JSON.stringify(c.card) });
    // To'lov nazorati: biri to'xtatilgan, biri eslatmada
    const access = c.name === 'Denta Smile' ? { state: 'blocked', message: "To'lov 2 oy kechikdi. Savol bo'lsa: +998 90 000 00 00" }
      : c.name === 'Smart English' ? { state: 'warn', message: "To'lov muddati yaqin — 4 kun qoldi" } : null;
    if (c.name === 'Tabassum Dental') await fetch(`${HUB}/admin/clinics/${made.clinicId}/modules`, { method: 'POST', headers: admin, body: JSON.stringify({ modules: ['direktor', 'tahlilchi', 'kontent', 'telefon'] }) });
    if (access) await fetch(`${HUB}/admin/clinics/${made.clinicId}/access`, { method: 'POST', headers: admin, body: JSON.stringify(access) });
    // Masofadan amallar (17-band): Tabassum'da diagnostika va xabar bajarilgan, qayta ishga tushirish kutilmoqda
    if (c.name === 'Tabassum Dental') {
      const cmd = async (body: unknown) => ((await (await fetch(`${HUB}/admin/clinics/${made.clinicId}/command`, { method: 'POST', headers: admin, body: JSON.stringify(body) })).json()) as { command: { id: string } }).command.id;
      const d = await cmd({ action: 'diag' });
      await fetch(`${HUB}/api/command/${d}`, { method: 'POST', headers: auth, body: JSON.stringify({ ok: true, note: 'Diagnostika yuborildi (48 KB)', diag: 'Palantir diagnostika — namuna\n\n## Holat\n{ "version": "0.4.18" }' }) });
      const m = await cmd({ action: 'message', text: "Ertaga 10:00 da o'rnatuvchi keladi — kompyuterni o'chirmang" });
      await fetch(`${HUB}/api/command/${m}`, { method: 'POST', headers: auth, body: JSON.stringify({ ok: true, note: 'Egasiga yetkazildi' }) });
      await cmd({ action: 'restart' });
    }
    if (c.name === 'Shifo Med') await fetch(`${HUB}/api/help`, { method: 'POST', headers: auth, body: JSON.stringify({ text: "Telefonda AI javob bermayapti, bemorlar administratorga tushyapti. Tekshirib bering.", by: 'Dilnoza' }) });
  }
  // O'zi ulangan, hali tasdiqlanmagan kompyuter
  await fetch(`${HUB}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: 'ABCD-EF12-3456-7890', name: 'DESKTOP-NEW' }) });

  const browser = await chromium.launch({ executablePath: chromePath() });
  for (const [label, viewport, scheme] of [['desktop', { width: 1440, height: 1000 }, 'dark'], ['light', { width: 1440, height: 1000 }, 'light'], ['phone', { width: 390, height: 844 }, 'dark']] as const) {
    const page = await browser.newPage({ viewport, colorScheme: scheme });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${HUB}/admin`);
    await page.fill('#k', KEY);
    await page.click('#key button');
    await page.waitForSelector('#kpis .kpi');
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${label}-1-umumiy.png`, fullPage: true });
    await page.click('nav button[data-view=clients]');
    await page.waitForSelector('#rows tr');
    await page.screenshot({ path: `${OUT}/${label}-2-mijozlar.png`, fullPage: true });
    // Qatordagi «⋯» — tezkor oyna (sahifa ochilmaydi)
    await page.click('#rows tr:has-text("Denta Smile") .more-btn');
    await page.waitForSelector('#quick[open] .qpart');
    if (!(await page.locator('#v-client').isHidden())) errors.push("«⋯» bosilganda mijoz sahifasi ham ochildi");
    await sleep(200);
    await page.screenshot({ path: `${OUT}/${label}-8-tezkor-toxtatilgan.png` });
    await page.keyboard.press('Escape');
    await page.click('#rows tr:has-text("Mebel Uyi") .more-btn');
    await page.waitForSelector('#quick[open] .qpart');
    await page.screenshot({ path: `${OUT}/${label}-9-tezkor-ishlayapti.png` });
    await page.keyboard.press('Escape');
    // Qatorni bosish — mijozning o'z sahifasi (#/mijoz/<id>)
    await page.click('#rows tr:nth-child(1)');
    await page.waitForSelector('#v-client:not([hidden]) #dBody .sect');
    if (!/^#\/mijoz\/[0-9a-f]{10}$/.test(await page.evaluate(() => location.hash))) errors.push("Mijoz sahifasi manzilda yo'q (#/mijoz/<id>)");
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${label}-3-karta.png`, fullPage: true });
    await page.goBack();
    await page.waitForSelector('#v-clients:not([hidden]) #rows tr');
    await page.click('#rows tr:has-text("Tabassum Dental")');
    await page.waitForSelector('#v-client:not([hidden]) #dBody .sect');
    await sleep(300);
    if (!(await page.locator('#dBody .sect:has(h3:text("Klinika sozlamalari")) .link').count())) errors.push("Tabassum sahifasida «Klinika sozlamalari» yo'q");
    const tarif = page.locator('#dBody .sect:has(h3:text("Tarif"))');
    if (await tarif.count()) await tarif.scrollIntoViewIfNeeded();
    else errors.push("Tabassum oynasida «Tarif» bo'limi yo'q: " + (await page.locator('#dBody .sect h3').allTextContents()).join(' | '));
    await page.screenshot({ path: `${OUT}/${label}-6-tarif.png` });
    const boshqar = page.locator('#dBody .sect:has(h3:text("Masofadan boshqarish"))');
    if (await boshqar.count()) {
      await boshqar.scrollIntoViewIfNeeded();
      await boshqar.locator('button:has-text("Diagnostikani")').click();
      await sleep(400);
      await boshqar.screenshot({ path: `${OUT}/${label}-7-boshqarish.png` });
    } else errors.push("Tabassum oynasida «Masofadan boshqarish» bo'limi yo'q");
    await page.click('#clientBack');
    await page.click('#rows tr:has-text("Denta Smile")');
    await page.waitForSelector('#v-client:not([hidden]) #dBody .sect');
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${label}-5-tolov.png`, fullPage: true });
    await page.click('nav button[data-view=help]');
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${label}-4-yordam.png`, fullPage: true });
    console.log(label, errors.length ? 'XATOLAR: ' + errors.join(' | ') : "xato yo'q");
    await page.close();
  }
  // Tezkor oyna amallari (ma'lumotni o'zgartiradi — rasmlardan keyin): to'xtatish, to'lagach yoqish, o'chirish
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    const list = async () => ((await (await fetch(`${HUB}/admin/clinics`, { headers: admin })).json()) as { clinics: { id: string; name: string; access?: { state: string }; card?: { paidUntil: string | null } }[] }).clinics;
    const find = async (name: string) => (await list()).find(c => c.name === name);
    await page.goto(`${HUB}/admin`);
    await page.fill('#k', KEY);
    await page.click('#key button');
    await page.click('nav button[data-view=clients]');
    await page.waitForSelector('#rows tr');
    const step = async (row: string, button: string, fill?: string) => {
      await page.click(`#rows tr:has-text("${row}") .more-btn`);
      await page.waitForSelector('#quick[open] .qpart');
      if (fill) await page.fill('#quick .danger-zone input', fill);
      await page.click(`#quick button:has-text("${button}")`);
      await sleep(600);
      if (await page.locator('#quick[open]').count()) await page.keyboard.press('Escape');
    };
    await step('Mebel Uyi', "To'xtatish");
    if ((await find('Mebel Uyi'))?.access?.state !== 'blocked') errors.push("Mebel Uyi to'xtamadi");
    const before = (await find('Denta Smile'))?.card?.paidUntil;
    await step('Denta Smile', "To'ladi — yoqish");
    const ds = await find('Denta Smile');
    if (ds?.access?.state !== 'active') errors.push('Denta Smile yoqilmadi');
    if (!ds?.card?.paidUntil || !before || ds.card.paidUntil <= before) errors.push(`Denta Smile to'langan sanasi surilmadi: ${before} → ${ds?.card?.paidUntil}`);
    await step('DESKTOP-NEW', "O'chirish");
    if (await find('DESKTOP-NEW')) errors.push("Tasdiqlanmagan DESKTOP-NEW o'chmadi");
    await step('Avto Servis 77', "O'chirish", 'Avto Servis 77');
    if (await find('Avto Servis 77')) errors.push("Avto Servis 77 nomi yozilganda ham o'chmadi");
    console.log('tezkor amallar', errors.length ? 'XATOLAR: ' + errors.join(' | ') : `o'tdi (Denta Smile: ${before} → ${ds?.card?.paidUntil})`);
    await page.close();
  }
  await browser.close();
} finally {
  hub.kill();
}
