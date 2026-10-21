/**
 * Jonli tekshiruv: egasining o'zbekcha/ruscha gapini haqiqiy AI topshiriqqa qanday aylantiradi (orders/parse.ts).
 * Vaqtinchalik bazada (haqiqiy ma'lumotga tegmaydi), .env dagi ANTHROPIC_API_KEY bilan — bir necha pulli so'rov.
 * Ishga tushirish: npx tsx scripts/check-orders.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Camera, OrderMember } from '../src/types';

process.loadEnvFile('.env');
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-orders-'));
process.env.DATA_DIR = dataDir;
process.env.DB_FILE = join(dataDir, 'palantir.db');
const { parseOrder } = await import('../server/orders/parse');
const { specDetails } = await import('../src/components/Orders');

const biz = { id: 'check-orders', profile: { name: 'Tabassum stomatologiya' } } as Parameters<typeof parseOrder>[0];
const cams = [
  { id: 'cam1', name: 'Qabulxona', profile: 'Qabulxona va kassa. Ish vaqti 9:00–20:00.', zones: [{ id: 'z1', kind: 'desk', name: 'Kassa', x: 0.5, y: 0.4, w: 0.3, h: 0.4, doctorId: null }] },
  { id: 'cam2', name: 'Kutish zali', profile: 'Bemorlar kutadigan zal', zones: [] },
  { id: 'cam3', name: '1-kabinet', profile: null, zones: [{ id: 'z2', kind: 'chair', name: 'Kreslo 1', x: 0.3, y: 0.3, w: 0.4, h: 0.5, doctorId: 'd1' }] },
] as unknown as Camera[];

const CASES: [OrderMember, string][] = [
  ['kuzatuvchi', "Kechasi 21:00 dan 07:00 gacha klinikada odam ko'rinsa darhol xabar ber"],
  ['kuzatuvchi', "Kassada 10 daqiqadan ko'p hech kim bo'lmasa ayt"],
  ['kuzatuvchi', 'Если в зале ожидания больше 5 человек дольше 10 минут — сообщи'],
  ['kuzatuvchi', 'Har kuni ertalab 9 da qabulxona toza va tartibli ekanini tekshir'],
  ['kuzatuvchi', 'Har yarim soatda kabinetda shifokor niqobsiz ishlayaptimi qarab tur'],
  ['qabulxona', "Narx so'rasa birinchi konsultatsiya bepul ekanini ham ayt"],
  ['yordamchi', 'Har kuni 8:30 da kun rejamni yubor, yakshanbadan tashqari'],
  ['tahlilchi', "Har dushanba 9 da o'tgan hafta tushumi va qabullar hisobotini yubor"],
  ['yordamchi', 'Kamerada odam ko‘rinsa ayt'],
];

for (const [member, text] of CASES) {
  try {
    const r = await parseOrder(biz, member, text, cams);
    console.log(`\n[${member}] «${text}»`);
    console.log(r.ok ? `  ✓ ${r.spec.kind}: ${r.summary}\n    ${specDetails(r.spec, cams)}\n    ${JSON.stringify(r.spec)}` : `  ? ${r.question}`);
  } catch (e) {
    console.log(`\n[${member}] «${text}»\n  ✗ ${(e as Error).message}`);
  }
}
// Windows baza faylini jarayon tugaguncha band tutadi — vaqtinchalik papka keyin tozalanadi
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* band */ }
