/**
 * Kanallar nazorati (server/monitor.ts) — egasiga qachon aytiladi: kutish vaqtidan keyin, bir marta, faqat kunduzi (tunda o'chiriladigan
 * kamera har kecha bezovta qilmasin; ertalab ham davom etsa — o'shanda).
 * Ishga tushirish: npm run test:monitor
 */
import './isolate';
import assert from 'node:assert/strict';

const { notifyDue } = await import('../server/monitor');
const { voiceProblemFrom } = await import('../server/voice/health');

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

const HOURS = { from: 8, to: 21 };
const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m).getTime();
const since = (t: number, minutes: number) => new Date(t - minutes * 60_000).toISOString();

console.log('\n# Kanallar nazorati: egasiga aytish vaqti');
check('kunduzi, 10 daqiqadan beri — aytiladi', () => assert.equal(notifyDue({ since: since(at(12), 10), notifiedAt: null }, at(12), HOURS), true));
check('hali kutish vaqti o\'tmagan (2 daqiqa) — aytilmaydi', () => assert.equal(notifyDue({ since: since(at(12), 2), notifiedAt: null }, at(12), HOURS), false));
check('allaqachon aytilgan — takrorlanmaydi', () => assert.equal(notifyDue({ since: since(at(12), 60), notifiedAt: new Date(at(11)).toISOString() }, at(12), HOURS), false));
check('tunda (23:00 va 03:00) — aytilmaydi', () => {
  assert.equal(notifyDue({ since: since(at(23), 30), notifiedAt: null }, at(23), HOURS), false);
  assert.equal(notifyDue({ since: since(at(3), 30), notifiedAt: null }, at(3), HOURS), false);
});
check('tun bo\'yi davom etgan — ertalab 8:00 da aytiladi', () => assert.equal(notifyDue({ since: since(at(8), 9 * 60), notifiedAt: null }, at(8, 1), HOURS), true));

console.log('\n# Ovozli AI (Gemini Live) salomatligi');
{
  const now = Date.parse('2026-11-16T12:00:00Z');
  const state = (ok: boolean, minutesAgo: number, error = '') => JSON.stringify({ ok, error, at: new Date(now - minutesAgo * 60_000).toISOString() });
  check('oxirgi ulanish yiqilgan — muammo, sababi bilan', () => {
    const p = voiceProblemFrom(state(false, 10, 'APIError: 1007 Thinking budget is not supported'), now);
    assert.ok(p && p.includes('1007') && p.includes('administratorga'), String(p));
  });
  check("oxirgisi muvaffaqiyatli — muammo yo'q", () => assert.equal(voiceProblemFrom(state(true, 5), now), null));
  check("fayl yo'q yoki buzuq — muammo yo'q (ovoz ishlatilmagan)", () => { assert.equal(voiceProblemFrom(null, now), null); assert.equal(voiceProblemFrom('{buzuq', now), null); });
  check("3 kundan eski yiqilish — eskirgan, ko'rsatilmaydi", () => assert.equal(voiceProblemFrom(state(false, 4 * 1440, 'x'), now), null));
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
