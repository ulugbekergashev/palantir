/**
 * HR (server/hr) — AI'siz: Murabbiy kursidagi buzuq savollar tashlanadi (to'g'ri javob indeksi yo'q, variant kam), natija hisobi;
 * Rekruter — vakansiya va nomzod yozuvlari (ikki marta bosilgan qaror, nomzodlar chegarasi, eski nomzod qayta boshlamaydi).
 * Ishga tushirish: npm run test:hr
 */
import './isolate';
import assert from 'node:assert/strict';

const { cleanLessons, score } = await import('../server/hr/train');
const { candidates, vacancies } = await import('../server/hr/store');

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`); }
}

check("buzuq savollar tashlanadi, savolsiz dars ham", () => {
  const l = cleanLessons([
    { title: 'Narxlar', text: 'Matn', quiz: [
      { q: 'Yaxshi', options: ['a', 'b', 'c'], correct: 2, why: 'x' },
      { q: 'Indeks tashqarida', options: ['a', 'b'], correct: 2, why: '' },
      { q: 'Bitta variant', options: ['a'], correct: 0, why: '' },
      { q: '', options: ['a', 'b'], correct: 0, why: '' },
      { q: 'Kasr', options: ['a', 'b'], correct: 0.5, why: '' },
    ] },
    { title: 'Bo\'sh', text: 'Matn', quiz: [] },
    { title: 'Matnsiz', text: '', quiz: [{ q: 'S', options: ['a', 'b'], correct: 0, why: '' }] },
    'buzuq',
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].quiz.length, 1);
  assert.equal(l[0].quiz[0].correct, 2);
});

check("ko'pi bilan 6 dars, 3 savol, 4 variant", () => {
  const q = { q: 'S', options: ['1', '2', '3', '4', '5', '6'], correct: 0, why: '' };
  const l = cleanLessons(Array.from({ length: 9 }, () => ({ title: 'D', text: 'T', quiz: [q, q, q, q, q] })));
  assert.equal(l.length, 6);
  assert.equal(l[0].quiz.length, 3);
  assert.equal(l[0].quiz[0].options.length, 4);
});

check("natija: to'g'ri javoblar va xato qilingan mavzular (takrorsiz)", () => {
  const quiz = { q: 'S', options: ['a', 'b'], correct: 0, why: '' };
  const t = { id: 'x', businessId: 'b', staffId: 's', title: 'K', lesson: 1, status: 'active' as const, createdAt: '', updatedAt: '',
    lessons: [{ title: 'Narxlar', text: 'T', quiz: [quiz, quiz] }, { title: 'Yozish', text: 'T', quiz: [quiz] }],
    answers: [{ lesson: 0, quiz: 0, ok: false }, { lesson: 0, quiz: 1, ok: false }, { lesson: 1, quiz: 0, ok: true }] };
  assert.deepEqual(score(t), { right: 1, total: 3, weak: ['Narxlar'] });
});

check("nomzod: qayta bossa — o'sha yozuv; qaror bir marta; begona biznes qaror qila olmaydi", () => {
  const v = vacancies.create('hr-biz', { title: 'Administrator', text: 'T', questions: ['a', 'b', 'c'], needs: '' });
  const c1 = candidates.start(v, '100', 'Ali', null)!;
  assert.equal(candidates.start(v, '100', 'Ali', null)!.id, c1.id);
  candidates.answer(c1.id, ['1', '2', '3'], 'phone');
  candidates.setPhone(c1.id, '+998901112233', 'Mijoz');
  assert.equal(candidates.get('hr-biz', c1.id)!.name, 'Ali');
  candidates.scored(c1.id, 7, 'ok');
  assert.equal(candidates.decide('boshqa-biz', c1.id, 'invited'), false);
  assert.equal(candidates.decide('hr-biz', c1.id, 'invited'), true);
  assert.equal(candidates.decide('hr-biz', c1.id, 'rejected'), false);
  assert.equal(candidates.get('hr-biz', c1.id)!.status, 'invited');
});

check("yopilgan vakansiya qayta yopilmaydi; ochiqlar soni", () => {
  const v = vacancies.create('hr-biz2', { title: 'Hamshira', text: 'T', questions: ['a', 'b', 'c'], needs: '' });
  assert.equal(vacancies.openCount('hr-biz2'), 1);
  assert.equal(vacancies.close('hr-biz2', v.id), true);
  assert.equal(vacancies.close('hr-biz2', v.id), false);
  assert.equal(vacancies.openCount('hr-biz2'), 0);
});

console.log(failed ? `\n${failed} ta sinov yiqildi` : '\nHR: hammasi o\'tdi');
process.exit(failed ? 1 : 0);
