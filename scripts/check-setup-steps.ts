/**
 * Ishga tushirish ro'yxati (src/lib/setup.ts): bilim — ulash ustasining «Bo'shliqlar» qadami bilan bitta ta'rif (I2).
 * Ishga tushirish: npm run test:setup-steps
 */
import { setupSteps } from '../src/lib/setup';
import type { BrainView, LiveStatus } from '../src/types';

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}

const status = { ownerLinked: true, bot: true, crm: { account: null, problem: null } } as unknown as LiveStatus;
const brain = (priced: number, answered: number, total: number) =>
  ({ priced, pack: Array.from({ length: total }, (_, i) => ({ answer: i < answered ? 'javob' : null })) }) as unknown as BrainView;
const knowledge = (b: BrainView, missing: string[] | null) => setupSteps(status, false, b, missing).find(s => s.key === 'knowledge');

const noAddress = knowledge(brain(5, 13, 13), ['manzil', 'ish vaqti']);
ok("narx bor, savollarga javob bor, lekin manzil yo'q — bilim tayyor EMAS (avval «tayyor» chiqardi, ustada esa bo'shliq)",
  noAddress?.done === false && noAddress.text.includes('Hali bilmaydi: manzil, ish vaqti'), noAddress?.text);
const empty = knowledge(brain(0, 0, 13), ['narxlar', 'manzil']);
ok("hammasi bo'sh — bitta qadam: yetishmagani va savollar 0/13 (Miya bilan bir xil son)", empty?.done === false && empty.text.includes('0/13'), empty?.text);
const full = knowledge(brain(5, 13, 13), []);
ok("bo'shliq yo'q, hamma savolga javob — tayyor", full?.done === true && full.text.includes('bor'), full?.text);
ok("bo'shliqlar hali kelmagan (null) — bilim qadami ko'rsatilmaydi (taxmin qilinmaydi)", knowledge(brain(5, 13, 13), null) === undefined);
ok('ro\'yxatda alohida «narx» va «savollar» qadami yo\'q — bitta «bilim»', setupSteps(status, false, brain(0, 0, 13), []).map(s => s.key).join() === 'bot,knowledge');

if (failed) {
  console.error(`\n${failed} ta sinov yiqildi`);
  process.exit(1);
}
console.log("\nHammasi o'tdi");
