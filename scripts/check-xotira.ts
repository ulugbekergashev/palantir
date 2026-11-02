/**
 * Xotira qatori sinovi (src/lib/memory.ts): Faktlar.md dagi qatorni o'qish va yozish, eski qatorlar, buzib bo'lmasligi.
 * Ishga tushirish: npx tsx scripts/check-xotira.ts
 */
import { cleanTags, cleanText, formatMemory, parseMemory } from '../src/lib/memory';

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}

const old = parseMemory('Naqd va karta qabul qilamiz');
ok("eski qator (maydonsiz) — oddiy fakt, sanasiz, teglarsiz", old.text === 'Naqd va karta qabul qilamiz' && old.kind === 'fakt' && !old.date && !old.tags.length && !old.stale, JSON.stringify(old));

const full = parseMemory('Meta limiti $500 gacha #meta #reklama [tur:: qaror] [sana:: 2026-10-25] [kim:: Siz] [manba:: suhbat]');
ok("to'liq qator: matn, teglar, tur, sana, kim, manba", full.text === 'Meta limiti $500 gacha' && full.tags.join() === 'meta,reklama' && full.kind === 'qaror'
  && full.date === '2026-10-25' && full.by === 'Siz' && full.source === 'suhbat' && !full.stale, JSON.stringify(full));

const line = formatMemory(full);
ok('yozilgan qator qayta o\'qilsa — o\'zi', JSON.stringify(parseMemory(line)) === JSON.stringify(full), line);
ok('yozilgan qator Obsidian uchun o\'qiladigan', line === 'Meta limiti $500 gacha #meta #reklama [tur:: qaror] [sana:: 2026-10-25] [kim:: Siz] [manba:: suhbat]', line);

const stale = parseMemory(formatMemory({ ...full, stale: '2026-11-03' }));
ok('eskirgan belgisi saqlanadi', stale.stale === '2026-11-03');

ok("noma'lum tur — fakt; noto'g'ri sana — e'tiborsiz", parseMemory('X [tur:: boshqa] [sana:: kecha]').kind === 'fakt' && parseMemory('X [sana:: kecha]').date === '');

const tricky = cleanText('Narx [tur:: qaror] ^abc');
ok('matndagi kvadrat qavs maydonga aylanmaydi, oxiridagi ^belgi olib tashlanadi', !tricky.includes('[') && !tricky.includes('^abc') && parseMemory(tricky).kind === 'fakt', tricky);

const kimHack = formatMemory({ ...full, by: 'Siz] [tur:: qoida' });
ok("«kim» qiymati qatorni buzmaydi (qavs olib tashlanadi)", parseMemory(kimHack).kind === 'qaror', kimHack);

ok("teglar: kichik harf, # siz, takrorsiz, 6 tagacha", cleanTags(['#Meta', 'meta', 'Yetkazib Berish', '', '1', '2', '3', '4', '5']).join() === 'meta,yetkazib-berish,1,2,3,4');

ok("matn o'rtasidagi # teg emas", parseMemory('Filial #2 Chilonzorda').text === 'Filial #2 Chilonzorda' && !parseMemory('Filial #2 Chilonzorda').tags.length);

if (failed) {
  console.error(`\n${failed} ta sinov yiqildi`);
  process.exit(1);
}
console.log("\nHammasi o'tdi");
