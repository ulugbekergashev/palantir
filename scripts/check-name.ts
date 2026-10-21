/**
 * Dastur nomi — Palantir. Avvalgi nom faqat eski ma'lumotni (baza fayli, shifr kaliti, MicroSIP, WSL) tanish uchun qoladi:
 * o'sha qatorda yoki bir qator yuqorida «eski nom» izohi bo'lishi shart. npm run typecheck ichida yuradi — CI ham tekshiradi.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OLD = /cerebro/i; // eski nom
const MARK = /eski nom/i;

const files = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
const bad = files.filter(f => OLD.test(f)).map(f => `${f}: fayl nomi`);
for (const file of files) {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (OLD.test(line) && !MARK.test(line) && !MARK.test(lines[i - 1] ?? '')) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
if (bad.length) {
  console.error(`Eski nom qolgan (${bad.length}) — «Palantir» deb yozing yoki eski ma'lumot uchun kerak bo'lsa «eski nom» izohini qo'shing:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`nom: ${files.length} fayl — eski nom faqat izohli joylarda`);
