/**
 * AI administrator avtonomiyasi (server/inbox/autonomy.ts) — brauzer va AI'siz:
 *   ishonch so'nggi 20 taklifdan; 16 tasi o'zgarishsiz bo'lsa — «tasdiqlayman» rejimida egasiga «o'zi javob bersinmi?» taklifi;
 *   boshqa rejimda va 7 kun ichida qayta taklif qilinmaydi; har taklif bir marta hisoblanadi.
 * Ishga tushirish: npm run test:autonomy
 */
import './isolate';
import assert from 'node:assert/strict';

const { autonomyOffer, offerDue, recordOutcome, trustFrom, trustOf, PASS, WINDOW } = await import('../server/inbox/autonomy');
const { businesses } = await import('../server/db');
const { emptyBusiness } = await import('../server/validate');

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}

const many = (clean: number, other: number) => [...Array(clean).fill('clean'), ...Array(other).fill('fixed')] as ('clean' | 'fixed')[];

console.log('\n# Qoida');
check(`${WINDOW} tadan ${PASS} tasi o'zgarishsiz — tayyor; ${PASS - 1} tasi yoki ${WINDOW} tadan kam — hali yo'q`, () => {
  assert.equal(trustFrom(many(PASS, WINDOW - PASS)).ready, true);
  assert.equal(trustFrom(many(PASS - 1, WINDOW - PASS + 1)).ready, false);
  assert.equal(trustFrom(many(PASS, 0)).ready, false, `${WINDOW} tadan kam`);
});
check("faqat so'nggi 20 tasi sanaladi (eski xatolar unutiladi)", () => {
  const t = trustFrom([...many(WINDOW, 0), ...many(0, 30)]);
  assert.deepEqual([t.decided, t.clean, t.ready], [WINDOW, WINDOW, true]);
});
check("taklif: faqat «tasdiqlayman» rejimida; qayta — 7 kundan keyin", () => {
  const ready = trustFrom(many(18, 2)), now = new Date('2026-11-16T10:00:00Z');
  assert.equal(offerDue(ready, 'draft', null, now), true);
  assert.equal(offerDue(ready, 'auto', null, now), false);
  assert.equal(offerDue(ready, 'off', null, now), false);
  assert.equal(offerDue(ready, 'draft', '2026-11-12T10:00:00Z', now), false);
  assert.equal(offerDue(ready, 'draft', '2026-11-09T09:00:00Z', now), true);
  assert.equal(offerDue(trustFrom(many(10, 10)), 'draft', null, now), false);
});

console.log('\n# Baza');
const biz = businesses.create('avto-sinov', 'x', emptyBusiness('Avto klinika', 'stomatologiya'));
check("har taklif bir marta hisoblanadi (yuborilgandan keyin egasi yozsa ham — o'zgarmaydi)", () => {
  recordOutcome(biz.id, 'r-dup', 'clean', new Date('2026-11-01T08:00:00Z'));
  recordOutcome(biz.id, 'r-dup', 'fixed', new Date('2026-11-01T08:01:00Z'));
  assert.deepEqual([trustOf(biz.id).decided, trustOf(biz.id).clean], [1, 1]);
});
check("19 ta hal qilingan — taklif yo'q; 20-si (17 toza) — egasiga taklif matni va tugmalar, keyin 7 kun jim", () => {
  for (let i = 0; i < 18; i++) recordOutcome(biz.id, `r${i}`, i < 15 ? 'clean' : 'fixed', new Date(Date.parse('2026-11-02T08:00:00Z') + i * 60_000));
  assert.equal(autonomyOffer(biz.id, 'draft', [], new Date('2026-11-03T08:00:00Z')), null);
  recordOutcome(biz.id, 'r-last', 'clean', new Date('2026-11-03T08:00:00Z'));
  const offer = autonomyOffer(biz.id, 'draft', ['ish vaqti'], new Date('2026-11-03T09:00:00Z'));
  assert.ok(offer, 'taklif kerak edi');
  assert.match(offer.html, /So'nggi 20 ta javob taklifidan 17 tasini o'zgartirmasdan yubordingiz/);
  assert.match(offer.html, /Hali bilmaydi: ish vaqti/);
  assert.deepEqual(offer.keyboard.inline_keyboard[0].map(b => 'callback_data' in b ? b.callback_data : ''), ['av|on', 'av|no']);
  assert.equal(autonomyOffer(biz.id, 'draft', [], new Date('2026-11-05T09:00:00Z')), null, '7 kun ichida — qayta yo\'q');
  assert.ok(autonomyOffer(biz.id, 'draft', [], new Date('2026-11-11T09:00:00Z')), '7 kundan keyin — yana');
});
check("«o'zi javob bersin» rejimida taklif qilinmaydi", () => {
  assert.equal(autonomyOffer(biz.id, 'auto', [], new Date('2026-12-01T09:00:00Z')), null);
});

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
