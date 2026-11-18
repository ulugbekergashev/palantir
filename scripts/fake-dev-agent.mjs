/**
 * Soxta Dasturchi dvigateli (DEV_FAKE_AGENT, server/dev/agent.ts) — haqiqiy Claude o'rniga: topshiriq matnidagi so'zga qarab ish
 * nusxasida fayl o'zgartiradi. Sinov: scripts/check-dasturchi.ts
 *   «savol»  — kod o'zgarmaydi, faqat javob;
 *   «sekin»  — bitta fayl yozib, to'xtatilguncha kutadi;
 *   «yiqil»  — xato tashlaydi;
 *   «chala»  — fayl yozadi, lekin [BAJARILMADI];
 *   boshqa   — a.txt ga qator qo'shadi va yangi fayl yaratadi (nomi — topshiriqdagi «fayl:<nom>», bo'lmasa yangi.txt).
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };

export default async function fakeAgent(r) {
  const task = (/<task>\n([\s\S]*?)\n<\/task>/.exec(r.prompt)?.[1] ?? r.prompt).trim();
  const sessionId = r.resume ?? `sess-${Date.now()}`;
  r.onEvent({ kind: 'text', text: 'Loyihani o\'qiyapman' });
  if (/savol/i.test(task)) return { text: '[BAJARILDI]\nJavob: bu a.txt faylida yozilgan.', sessionId, cut: false, usage };
  if (/yiqil/i.test(task)) throw new Error('soxta dvigatel yiqildi');
  if (/sekin/i.test(task)) {
    writeFileSync(join(r.workDir, 'yarim.txt'), 'yarim ish\n');
    r.onEvent({ kind: 'tool', name: 'Write', detail: join(r.workDir, 'yarim.txt') });
    await new Promise(done => { r.abort.signal.addEventListener('abort', done, { once: true }); });
    return { text: '', sessionId, cut: true, usage };
  }
  const file = /fayl:(\S+)/.exec(task)?.[1] ?? 'yangi.txt';
  appendFileSync(join(r.workDir, 'a.txt'), `${task.split('\n')[0]}\n`);
  // Ulangan node_modules ko'rinadimi va davom ettirilgan suhbatmi — faylga yoziladi (sinov o'qiydi)
  writeFileSync(join(r.workDir, file), `modules:${existsSync(join(r.workDir, 'node_modules', 'belgi.txt'))} resume:${r.resume ?? '-'}\n`);
  r.onEvent({ kind: 'tool', name: 'Edit', detail: join(r.workDir, 'a.txt') });
  if (/chala/i.test(task)) return { text: '[BAJARILMADI]\nYarmi qilindi: test yiqilyapti.', sessionId, cut: false, usage };
  return { text: `[BAJARILDI]\na.txt ga qator qo'shildi, ${file} yaratildi. Tekshiruv o'tdi.`, sessionId, cut: false, usage };
}
