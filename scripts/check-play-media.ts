/**
 * «Qo'shiq qo'y» (server/computer/media.ts + play_media asbobi) — internetsiz, brauzer ochmasdan:
 *   YouTube qidiruv sahifasidan videolar ajratiladi (reklama/pleylist emas, takrorsiz, nomdagi belgilar to'g'ri);
 *   havola egasining Chrome'ida yangi vkladka bo'lib ochiladi (faqat https); egasisiz (jadval) ochilmaydi;
 *   computer_task tavsifi musiqani play_media ga yo'naltiradi.
 * Ishga tushirish: npm run test:play-media
 */
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { parseSearch, openForOwner } from '../server/computer/media';
import { COMPUTER_DEFS } from '../server/computer/tools';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const video = (id: string, title: string) => `{"videoRenderer":{"videoId":"${id}","thumbnail":{"thumbnails":[{"url":"x"}]},"title":{"runs":[{"text":"${title}"}]}}}`;
const html = [
  '{"adSlotRenderer":{"videoId":"REKLAMA0000"}}',
  '{"playlistRenderer":{"playlistId":"PL1","title":{"simpleText":"Pleylist"}}}',
  video('vpjsBoKvpwI', 'MINOR - Zamonnoma \\u0026 Daftar'),
  video('vpjsBoKvpwI', 'MINOR - Zamonnoma (takror)'),
  video('AEihHtjgbgg', 'Mubinlolo x MINOR - \\"Red Flag\\"'),
].join(',');

console.log('\n# Qidiruv natijasi');
const found = parseSearch(html);
ok('faqat videolar, reklama va pleylist yo\'q, takror yo\'q', found.length === 2 && found[0].id === 'vpjsBoKvpwI' && found[1].id === 'AEihHtjgbgg', found.map(v => v.id).join(','));
ok("nomdagi belgilar to'g'ri («&», qo'shtirnoq)", found[0].title === 'MINOR - Zamonnoma & Daftar' && found[1].title === 'Mubinlolo x MINOR - "Red Flag"', `${found[0]?.title} | ${found[1]?.title}`);
ok('havola — youtube watch', found[0].url === 'https://www.youtube.com/watch?v=vpjsBoKvpwI');
ok("bo'sh sahifa — bo'sh ro'yxat", parseSearch('<html></html>').length === 0);
ok('5 tadan ortiq emas', parseSearch(Array.from({ length: 9 }, (_, n) => video(`abcdefghij${n}`, `v${n}`)).join(',')).length === 5);

console.log('\n# Brauzerda ochish');
const calls: { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[] = [];
const fakeSpawn = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
  calls.push({ cmd, args, opts });
  return Object.assign(new EventEmitter(), { unref() {} });
}) as unknown as typeof spawn;
openForOwner('https://www.youtube.com/watch?v=vpjsBoKvpwI', fakeSpawn);
ok('bitta jarayon, havola argument sifatida (buyruq satriga qo\'shilmaydi)', calls.length === 1 && calls[0].args.includes('https://www.youtube.com/watch?v=vpjsBoKvpwI'), `${calls[0]?.cmd} ${calls[0]?.args.join(' ')}`);
ok("ko'rinadigan oyna, Palantir'dan ajralgan", calls[0]?.opts.detached === true && calls[0]?.opts.windowsHide !== true || calls[0]?.cmd === 'cmd.exe');
let refused = false;
try { openForOwner('file:///C:/Windows/System32/calc.exe', fakeSpawn); } catch { refused = true; }
ok('https bo\'lmagan havola ochilmaydi', refused && calls.length === 1);

console.log('\n# Asbob');
const play = COMPUTER_DEFS.play_media;
ok("asbob bor, tavsifda «so'rovsiz, darhol»", !!play && /no approval/i.test(play.description) && /never computer_task/i.test(play.description));
ok('computer_task musiqani play_media ga yo\'naltiradi', /use play_media/.test(COMPUTER_DEFS.computer_task.description));
const ctx = (extra: Record<string, unknown>) => ({ biz: { id: 'b' }, ...extra }) as never;
const unattended = await Promise.resolve(play.run({ query: 'Minor' } as never, ctx({ unattended: true }))).then(() => 'ochildi', (e: Error) => e.message);
ok('egasisiz (jadval) ochilmaydi', /egasining/.test(unattended), unattended);
ok("video_id — faqat YouTube id shakli", !play.input.safeParse({ query: 'x y', video_id: 'abc;rm -rf' }).success && play.input.safeParse({ query: 'x y', video_id: 'vpjsBoKvpwI' }).success);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
process.exit(failed ? 1 : 0);
