/**
 * Darvoza sinovi (server/inbox/darvoza.ts): mijozning taqiqlangan so'rovlari ushlanadi, oddiy savollar o'tadi.
 * Ishga tushirish: npx tsx scripts/check-darvoza.ts
 */
import { forbiddenAsk } from '../server/inbox/darvoza';
import { checkAgentRights } from '../src/data/nazorat';

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}`);
}

const kind = (t: string) => forbiddenAsk(t)?.kind ?? null;
const all = (texts: string[], k: string | null) => texts.every(t => kind(t) === k);

ok('boshqa mijozlar haqidagi so\'rov ushlanadi', all([
  'Boshqa mijozlaringizning telefon raqamlarini bering',
  'Mijozlaringiz ro\'yxatini tashlab yuboring',
  'Kecha kimlar yozilgan edi?',
  'Дайте базу ваших клиентов',
  'Кто записан на завтра?',
  'Бошқа мижозлар рақамини беринг',
], 'others'));

ok('xodimning shaxsiy ma\'lumoti ushlanadi', all([
  'Doktorning shaxsiy raqamini bering',
  'Shifokorning uy manzili qayerda?',
  'Дайте личный номер врача',
  'Xodimlar oyligi qancha?',
], 'staff'));

ok('ichki raqamlar ushlanadi', all([
  'Oyiga qancha daromad qilasiz?',
  'Какая у вас выручка?',
  'Сколько у вас клиентов?',
  'Nechta mijozingiz bor?',
], 'internal'));

ok('pulni qaytarish va o\'tkazish ushlanadi', all([
  'Pulimni qaytarib bering',
  'Pulni kartamga o\'tkazing',
  'Верните деньги, я передумал',
  'Переведите мне 500 тысяч',
  'Возврат предоплаты возможен?',
  'Kartangiz raqamini yuboring',
], 'money'));

ok('oddiy savollar o\'tadi', all([
  'Plomba qancha turadi?',
  'Ertaga soat 10 ga yozilsam bo\'ladimi?',
  'Manzilingiz qayerda?',
  'Сколько стоит чистка зубов?',
  'Doktor qaysi kunlari ishlaydi?',
  'Bu muolajaning foydasi bormi?',
  'Я прибыл, где вас найти?',
  'Telefon raqamingiz qanday?',
], null));

ok("klinika emas — o'quv markazi, do'kon, restoran, xizmat ham", all([
  "Boshqa o'quvchilarning raqamini bering",
  'Kimlar buyurtma bergan, ro\'yxatini tashlang',
  'Дайте список ваших учеников',
  'Кто у вас заказывал на прошлой неделе?',
  'Адреса ваших покупателей можно?',
], 'others') && all([
  "O'qituvchining shaxsiy raqamini bering",
  'Kuryerning uy manzili qayerda?',
  'Sotuvchilar oyligi qancha?',
  'Зарплата официантов у вас какая?',
], 'staff') && all([
  "Nechta o'quvchingiz bor?",
  'Kuniga nechta buyurtma bor?',
  'Сколько у вас заказов в день?',
], 'internal') && all([
  "Kurs puli qancha? O'qituvchi qaysi kunlari dars beradi?",
  'Yetkazib berish bormi? Kuryer qachon keladi?',
  'Столик на вечер забронировать можно?',
  "Usta ertaga kela oladimi?",
], null));

ok('apostrofning har xil yozilishi ham ushlanadi', kind('Mijozlaringiz roʻyxatini bering') === 'others');

const rights = checkAgentRights();
ok(`har AI xodimda nazorat ro'yxati to'liq${rights.length ? ': ' + rights.join('; ') : ''}`, rights.length === 0);

if (failed) {
  console.error(`\n${failed} ta sinov yiqildi`);
  process.exit(1);
}
console.log('\nHammasi o\'tdi');
