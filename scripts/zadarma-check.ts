/**
 * Haqiqiy Zadarma kalitlarini tekshirish (faqat o'qiydi — hech narsa o'zgartirmaydi): balans, raqamlar, SIP'lar.
 * Imzo to'g'riligini haqiqiy API'da ko'rish uchun. Ishga tushirish: npx tsx scripts/zadarma-check.ts
 * Key va Secret terminalda so'raladi (ekranga chiqmaydi, hech qayerga saqlanmaydi).
 */
import { createInterface } from 'node:readline';
import { zadarmaBalance, zadarmaNumbers, type ZadarmaKeys } from '../server/voice/zadarma';

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
  return new Promise(res => rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a.trim()); }));
}

const keys: ZadarmaKeys = {
  key: process.env.ZADARMA_KEY || await ask('Zadarma Key: '),
  secret: process.env.ZADARMA_SECRET || await ask('Zadarma Secret: ', true),
};
try {
  const b = await zadarmaBalance(keys);
  console.log(`✓ Kalitlar to'g'ri. Balans: ${b.balance} ${b.currency}`);
  const list = await zadarmaNumbers(keys);
  console.log(list.length ? list.map(n => `  raqam +${n.number} — ${n.status}${n.channels ? `, ${n.channels} liniya` : ''}${n.stop_date ? `, to'lov: ${n.stop_date}` : ''}`).join('\n') : "  raqam yo'q");
} catch (e) {
  console.log(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
}
