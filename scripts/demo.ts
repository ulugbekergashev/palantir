/**
 * Simulyatsiya: haqiqiy server va panel, soxta klinika. `npm run demo` — brauzerda ochib, hamma narsa "ishlab turganini" ko'rish uchun.
 * Haqiqiy narsalar: server, baza, seans sanash, CRM bilan solishtirish, ovozli agent darvozasi, panel.
 * Soxta narsalar: DentaCRM (scripts/fakeCrm.ts), kameradagi odamlar (ssenariy bo'yicha yuboriladi) va qo'ng'iroqlar (tayyor matnlar).
 * Vaqt siqilgan: bitta qabul bir daqiqacha davom etadi. Ma'lumot .demo-data papkasida turadi va har ishga tushganda yangidan
 * boshlanadi (asosiy `data/` ga va botga tegilmaydi). .env'da AI yoki ovoz kaliti bo'lmasa hech narsa tashqariga chiqmaydi.
 */
import '../server/tz';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { CRM_LOGIN, crm, crmServer } from './fakeCrm';
import { xlsxFile } from './sampleFiles';

const DEFAULT_PORT = 3210;
const PORT = Number(process.env.DEMO_PORT) || DEFAULT_PORT;
const base = `http://127.0.0.1:${PORT}`;
const ACCOUNT = { login: 'demo', password: 'demo-parol-1' };
/** Admin paroli va sessiya kaliti egasiga kerak emas — har safar tasodifiy */
const ADMIN_PASSWORD = randomBytes(12).toString('hex');
/** Bir aylanish (soniya): shu ichida bemor keladi, o'tiradi, to'laydi, ketadi */
const CYCLE = 120;
/** Kadrlar oralig'i. Kiryapti holati kadrlar orasida CAMERA_ENTER_SEC/2 dan uzoq tanaffusni kechirmaydi — shuning uchun tez-tez yuboriladi */
const FRAME_MS = 500;
/** Aylanish ichidagi voqealar (soniya) */
const AT = { sit: 6, stand: 70, deskFrom: 72, pay: 78, deskTo: 84, strangerFrom: 30, strangerTo: 100, calls: 45 };
const PATIENTS = ['Zarina Qodirova', 'Feruza Ismoilova', 'Sardor Aliyev', 'Dilnoza Yusupova', 'Jasur Toshmatov', 'Malika Rahimova'];
const PRICES = [350_000, 480_000, 250_000, 900_000];
const DOCTOR = { id: 'd1', name: 'Rustam Rustamov' };
/** Ikkinchi miya: klinika o'rnatilgan kuni biladigan narsalar. Tayyor savollarning bir qismi ataylab bo'sh — egasi to'ldirishini ko'rish uchun */
const KNOWN: Record<string, string> = {
  payment: 'Naqd, karta, Click va Payme',
  installment: "3 oygacha bo'lib to'lash mumkin, 2 000 000 so'mdan yuqori davolashda",
  children: '3 yoshdan qabul qilamiz',
  xray: "Ha, panoram rentgen shu yerda, 80 000 so'm",
};
const PRICE_LIST = [{ name: 'Plomba', price: 350_000 }, { name: 'Tish olish', price: 150_000 }, { name: 'Professional tozalash', price: 250_000 }, { name: 'Implant', price: 4_500_000 }, { name: 'Konsultatsiya', price: 0 }];
/** Egasi suhbatga tashlagan Excel narxnoma: bitta xizmatning narxi o'zgargan, ikkitasi yangi. «Ikkinchi miya»da tasdiq kutib turadi */
const NEW_PRICES: (string | number)[][] = [['Xizmat', "Narx (so'm)"], ['Plomba', 400_000], ['Vinir', 1_900_000], ['Tish oqartirish', 900_000], ['Maslahat', 'bepul']];
/** Egasi mijozga bergan, lekin hali «Eslab qol» demagan javob. Haqiqatda yozishmadan keladi (bot va AI kerak) — bu yerda papkaga tayyor fayl qilib qo'yiladi */
const WAITING = { question: 'Yakshanba kuni ishlaysizmi?', answer: 'Yakshanba dam olamiz, shanba kuni 15:00 gacha ishlaymiz' };
/** «Biznes haqida» — profil formasi o'rniga: manzil, ish vaqti, jamoa oddiy sahifada (soxta klinika ma'lumoti) */
const ABOUT_PAGE = "# Biznes haqida\n\nTabassum Dental — oilaviy stomatologiya klinikasi.\n\n- Manzil: Toshkent, Chilonzor 7-mavze, 12-uy\n- Ish vaqti: dushanba–shanba 9:00–19:00, yakshanba dam\n- Telefon: +998 71 200 00 00\n\n## Jamoa\n- Rustam Rustamov — terapevt\n- Nodira Aliyeva — ortodont\n";
/** Egasi Obsidian'da o'zi yozgan sahifa: Palantir uni ham o'qiydi */
const OWN_PAGE = { file: 'Implant.md', text: "# Implant\n\nImplant ikki bosqichda qo'yiladi: avval implantning o'zi, 3–4 oydan keyin koronka. Birinchi ko'rikda panoram rentgen qilinadi.\n\nBog'liq: [[Narxlar]]\n" };
const ZONE = { x: 0.3, y: 0.25, w: 0.4, h: 0.55 };
const PERSON = [{ x: 0.42, y: 0.34, w: 0.16, h: 0.36 }];

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const pick = <T,>(list: T[], n: number): T => list[n % list.length];

async function call<T = unknown>(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<T> {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => ({})) as { error?: string };
  if (!r.ok) throw new Error(`${path}: ${r.status} ${json.error ?? ''}`);
  return json as T;
}

/** Soxta klinikaning kuni. Kabinet 2 (Aliyeva) ga hech kim yozilmaydi — u yerda o'tirgan odam "farq" bo'ladi */
const clinic = {
  open(now: Date): void {
    crm.seed(day(now), day(new Date(now.getTime() + 86_400_000)));
    crm.appointments = [];
    crm.transactions = [];
  },
  /** Navbatdagi bemor Rustamovga hozirgi daqiqaga yoziladi */
  book(n: number, now: Date): void {
    crm.appointments = [...crm.appointments, {
      id: `demo-a${n}`, patientId: `demo-p${n}`, patientName: pick(PATIENTS, n), doctorId: DOCTOR.id, doctorName: DOCTOR.name, type: "Ko'rik", date: day(now), time: clock(now), duration: 30,
      status: 'Confirmed', notes: null, clinicId: crm.doctors[0]?.clinicId, reminderSent: false,
    }];
  },
  /** Bemor kassada to'ladi: administrator qabulni «keldi» qiladi va to'lovni kiritadi */
  pay(n: number, now: Date): void {
    crm.appointments = crm.appointments.map(a => (a.id === `demo-a${n}` ? { ...a, status: 'Completed' } : a));
    crm.transactions = [...crm.transactions, {
      id: `demo-t${n}`, patientName: pick(PATIENTS, n), date: day(now), amount: pick(PRICES, n), type: n % 2 ? 'Card' : 'Cash', service: 'Plomba', status: 'Paid',
      clinicId: crm.doctors[0]?.clinicId, doctorId: DOCTOR.id, doctorName: DOCTOR.name, discountAmount: 0,
    }];
  },
};

const HELLO = 'Assalomu alaykum, Tabassum Dental. Men klinikaning AI yordamchisiman. Qanday yordam bera olaman?';
const CALLS = [
  { phone: '+998 91 234 56 78', name: 'Bobur Karimov', durationSec: 24, outcome: 'Qabulga yozildi', booked: 'bugun 16:30, Rustam Rustamov', transcript: [['ai', HELLO], ['caller', "Tishim og'riyapti, bugun ko'rsata olamanmi?"], ['ai', "Albatta. Bugun Rustam Rustamovda 16:30 va 18:00 bo'sh. Qaysi biri qulay?"], ['caller', "16:30 bo'ladi. Bobur Karimov."], ['ai', 'Bobur aka, sizni bugun 16:30 ga yozdim. SMS yuboraman.']] },
  { phone: '+998 93 707 11 22', name: 'Madina Tosheva', durationSec: 21, outcome: "Implant narxini so'radi", booked: null, transcript: [['ai', HELLO], ['caller', 'Implant qancha turadi?'], ['ai', "Implant 4 500 000 so'mdan boshlanadi, aniq narxni shifokor ko'rikdan keyin aytadi. Konsultatsiya bepul — yozib qo'yaymi?"], ['caller', "Hozircha yo'q, rahmat."]] },
  { phone: '+998 90 345 67 89', name: 'Otabek Nazarov', durationSec: 20, outcome: "Qabulini ko'chirdi", booked: 'seshanba 15:00, Rustam Rustamov', transcript: [['ai', HELLO], ['caller', "Dushanbadagi qabulimni seshanbaga ko'chirsa bo'ladimi?"], ['ai', "Albatta. Seshanba kuni 11:00 va 15:00 bo'sh."], ['caller', '15:00 qulay.'], ['ai', "Ko'chirdim: seshanba 15:00. SMS yuboraman."]] },
].map(c => ({ ...c, transcript: c.transcript.map(([who, text]) => ({ who, text })) }));

/** Demo biznes, CRM ulanishi, uchta kamera va ovozli agent kaliti */
async function setUp(crmPort: number, dataDir: string): Promise<{ token: string; voiceKey: string; cameraIds: Record<string, string>; vault: string }> {
  const admin = (await call<{ token: string }>('/api/admin/login', { body: { password: ADMIN_PASSWORD } })).token;
  await call('/api/admin/businesses', { token: admin, body: { name: 'Tabassum Dental', industry: 'Stomatologiya', ...ACCOUNT } });
  const token = (await call<{ token: string }>('/api/login', { body: ACCOUNT })).token;
  await call('/api/crm', { token, body: { url: `http://127.0.0.1:${crmPort}`, ...CRM_LOGIN } });
  const cameraIds: Record<string, string> = {};
  for (const [name, kind, doctorId] of [['Kabinet 1', 'chair', 'd1'], ['Kabinet 2', 'chair', 'd2'], ['Kassa', 'desk', null]] as const) {
    const { id } = (await call<{ camera: { id: string } }>('/api/cameras', { token, body: { name } })).camera;
    await call(`/api/cameras/${id}/zones`, { method: 'PUT', token, body: { zones: [{ ...ZONE, kind, name: kind === 'desk' ? 'Kassa stoli' : name, doctorId }] } });
    cameraIds[name] = id;
  }
  const voiceKey = (await call<{ key: string }>('/api/voice/key', { token, body: {} })).key;
  for (const [packId, answer] of Object.entries(KNOWN)) await call('/api/brain/qa', { token, body: { packId, answer } });
  await call('/api/brain/prices', { token, body: { items: PRICE_LIST } });
  await call('/api/brain/style', { method: 'PUT', token, body: { style: "Qisqa yoz, «siz»lab. Narxni aytgach, qabulga taklif qil." } });
  // Fayl tashlash: haqiqiy Excel fayl haqiqiy yo'l bilan yuklanadi — o'qiladi, asli Manbalar'ga, matni Kutyapti'ga tushadi
  const sent = await fetch(`${base}/api/chat/file?name=${encodeURIComponent('Yangi narxlar (kuz).xlsx')}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` }, body: new Uint8Array(xlsxFile(NEW_PRICES)) });
  if (!sent.ok) throw new Error(`namuna fayl yuklanmadi: ${sent.status} ${await sent.text()}`);
  // Ikkinchi miya — papka: taklif va egasining o'z sahifasi xuddi Obsidian'da yozilgandek fayl qilib qo'yiladi
  const vault = join(dataDir, (await call<{ brain: { vault: string } }>('/api/brain', { token })).brain.vault);
  writeFileSync(join(vault, 'Kutyapti', `${WAITING.question.replace('?', '')}.md`), `---\nmanba: relay\n---\n# ${WAITING.question}\n\n${WAITING.answer}\n`);
  writeFileSync(join(vault, 'Bilim', OWN_PAGE.file), OWN_PAGE.text);
  writeFileSync(join(vault, 'Bilim', 'Biznes haqida.md'), ABOUT_PAGE);
  return { token, voiceKey, cameraIds, vault };
}

/** Port band bo'lsa — oldingi simulyatsiya ochiq qolgan: uning bazasini o'chirishga urinmasdan aytiladi */
const portBusy = (): Promise<boolean> => new Promise(done => {
  const probe = connect(PORT, '127.0.0.1');
  probe.once('connect', () => { probe.destroy(); done(true); });
  probe.once('error', () => done(false));
});

async function main(): Promise<void> {
  if (!existsSync(resolve('dist/index.html'))) throw new Error("Panel yig'ilmagan — avval: npm run build");
  if (await portBusy()) throw new Error(`${PORT}-port band — oldingi simulyatsiya ochiq qolgan bo'lishi mumkin (uni yoping yoki DEMO_PORT bering)`);
  // Boshqa portdagi ikkinchi simulyatsiya birinchisining bazasini o'chirib yubormasin
  const dataDir = resolve(PORT === DEFAULT_PORT ? '.demo-data' : `.demo-data-${PORT}`);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  clinic.open(new Date());
  const crmPort = await new Promise<number>(done => crmServer.listen(0, '127.0.0.1', () => done((crmServer.address() as { port: number }).port)));

  // Tez sinov: seans 3 soniyada boshlanadi, 4 soniya ko'rinmasa tugaydi. Bot o'chiq; AI kaliti .env'da bo'lsa — yordamchi ham javob beradi.
  // Demo paroli hammaga ma'lum — shuning uchun server faqat shu kompyuterdan ochiladi
  const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DB_FILE: join(dataDir, 'palantir.db'), LISTEN_HOST: '127.0.0.1', CRM_ALLOW_PRIVATE: '1', BOT_TOKEN: '', ADMIN_PASSWORD, SESSION_SECRET: randomBytes(32).toString('hex'), CAMERA_ENTER_SEC: '3', CAMERA_LEAVE_SEC: '4', CAMERA_MIN_SESSION_SEC: '3' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // Skript qanday tugasa ham (xato bilan ham) server fonda qolib ketmasin
  process.on('exit', () => { server.kill(); });
  let started = false, stopping = false;
  const stop = (code: number): never => { stopping = true; server.kill(); crmServer.close(); process.exit(code); };
  server.stdout.on('data', d => { if (String(d).includes('Palantir server')) started = true; });
  // Ctrl+C serverga ham boradi va u o'zi (kod 0) to'xtaydi — bu xato emas
  server.on('exit', code => {
    if (stopping) return;
    if (code) console.error(`Server to'xtab qoldi (kod ${code})`);
    stop(code ? 1 : 0);
  });
  process.on('SIGINT', () => stop(0));
  for (let i = 0; i < 120 && !started; i++) await sleep(250);
  if (!started) { console.error('Server ishga tushmadi'); stop(1); }

  const { token, voiceKey, cameraIds, vault } = await setUp(crmPort, dataDir);
  console.log(`\nSimulyatsiya ishlayapti. Brauzerda oching:  ${base}\n  login: ${ACCOUNT.login}    parol: ${ACCOUNT.password}\n`);
  console.log("Birinchi 2 daqiqada:\n  ~10 s  Kabinet 1 ga bemor o'tiradi — CRM'da qabuli bor\n  ~35 s  Kabinet 2 ga odam o'tiradi — CRM'da qabul yo'q: Kameralar va Jurnalda farq chiqadi\n  ~45 s  uchta qo'ng'iroq deyarli bir vaqtda keladi\n  ~80 s  Kabinet 1 dagi bemor kassada to'laydi — CRM'da «keldi» va to'lov paydo bo'ladi\nKeyin har 2 daqiqada: Kabinet 1 ga yangi bemor (qabuli bor, to'laydi) va bitta qo'ng'iroq.\nIkkinchi miya: narxlar va 13 savoldan 4 tasiga javob bor; bitta javobingiz va suhbatga tashlangan bitta Excel narxnoma «Eslab qolaymi?» deb kutyapti (Jurnalda ham). Suhbatda «savollar» deb yozsangiz, Palantir qolgan savollarni o'zi so'raydi.\n");
  console.log(`Miya papkasi (Obsidian'da «Open folder as vault»):\n  ${vault}\n`);
  console.log("Panel 10–15 soniyada o'zi yangilanadi. To'xtatish: Ctrl+C\n");

  const t0 = Date.now(), life = Number(process.env.DEMO_SECONDS) || 0;
  let booked = -1, paid = -1, callsSent = 0;
  for (;;) {
    const sec = (Date.now() - t0) / 1000, cycle = Math.floor(sec / CYCLE), at = sec % CYCLE;
    if (booked < cycle) { clinic.book(cycle, new Date()); booked = cycle; }
    if (paid < cycle && at >= AT.pay) { clinic.pay(cycle, new Date()); paid = cycle; }
    const seen: Record<string, boolean> = {
      'Kabinet 1': at >= AT.sit && at < AT.stand,
      'Kabinet 2': cycle === 0 && at >= AT.strangerFrom && at < AT.strangerTo,
      Kassa: at >= AT.deskFrom && at < AT.deskTo,
    };
    await Promise.all(Object.entries(cameraIds).map(([name, id]) => call(`/api/cameras/${id}/observe`, { token, body: { people: seen[name] ? PERSON : [] } }).catch(e => console.error('kuzatuv:', (e as Error).message))));
    // Birinchi aylanishda uchta qo'ng'iroq ustma-ust; keyin har aylanishda bittadan
    const due = sec >= AT.calls ? CALLS.length + Math.floor((sec - AT.calls) / CYCLE) : 0;
    for (; callsSent < due; callsSent++) await call('/api/voice/calls', { token: voiceKey, body: pick(CALLS, callsSent) }).catch(e => console.error("qo'ng'iroq:", (e as Error).message));
    if (life && sec > life) stop(0);
    await sleep(FRAME_MS);
  }
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
