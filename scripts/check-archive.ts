/**
 * Reliz arxiviga qaysi fayl tushishi (scripts/archive.ts → shipsInRelease) tekshiruvi:
 *   1. Ishchi papkalar (replica/ — raqobatchilar tahlili, .claude/ — Claude Code skill'lari) hech qaysi nashrga tushmaydi
 *   2. Yig'ilgan nashrga manba kod tushmaydi, manbali nashrga (--manba) tushadi
 *   3. Klinikaga kerakli fayllar (o'rnatish, yangilovchi, server yonidagi yordamchilar) ikkala nashrda ham qoladi
 *   npm run test:archive
 */
import { shipsInRelease } from './archive';

let failed = 0, passed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
}

console.log('Ishchi papkalar hech qachon ketmaydi');
for (const f of ['replica/kommo/recon.md', 'replica/features.csv', '.claude/skills/replica-recon/SKILL.md', '.claude/settings.json']) {
  ok(`${f} — yig'ilgan nashrda yo'q`, !shipsInRelease(f, true));
  ok(`${f} — manbali nashrda ham yo'q`, !shipsInRelease(f, false));
}

console.log('Manba kod faqat manbali nashrda');
for (const f of ['src/App.tsx', 'server/index.ts', 'docs/PLAN.md', 'hub/server.ts', 'scripts/release.ts']) {
  ok(`${f} — yig'ilgan nashrda yo'q`, !shipsInRelease(f, true));
  ok(`${f} — manbali nashrda bor`, shipsInRelease(f, false));
}

console.log('Klinikaga kerakli fayllar qoladi');
for (const f of ['install/Stansiya.cmd', 'scripts/update.mjs', 'scripts/supervise.mjs', 'server/phone/hook/PalantirCall.cs', 'Ornatish.cmd']) {
  ok(`${f} — yig'ilgan nashrda bor`, shipsInRelease(f, true));
  ok(`${f} — manbali nashrda bor`, shipsInRelease(f, false));
}

console.log(`\n${passed} o'tdi, ${failed} yiqildi`);
if (failed) process.exit(1);
