/**
 * Jonli tekshiruv: Dasturchi (server/dev) shu kompyuterdagi Claude obunasi bilan, vaqtinchalik git loyihada —
 *   haqiqiy Claude Code faylni o'zgartiradimi va tekshiruvni (npm test) ishga tushiradimi, hisobot belgi bilan keladimi;
 *   yopiq buyruq (git push) haqiqatan to'xtatiladimi; tuzatish o'sha suhbatda davom etadimi; qabul qilish loyihaga qo'shadimi.
 * Kompyuterda `claude` ga /login qilingan bo'lishi kerak. Obuna limitidan bir necha daqiqalik ish sarflanadi.
 * Ishga tushirish: npx tsx scripts/live-dasturchi.ts
 */
import './isolate';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'palantir-dasturchi-jonli-'));
const repo = join(root, 'hisob');
const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
mkdirSync(repo);
writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'hisob', type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`);
writeFileSync(join(repo, 'foyda.js'), "/** Sof foyda: tushum minus xarajat */\nexport function sofFoyda(tushum, xarajat) {\n  return tushum + xarajat;\n}\n");
writeFileSync(join(repo, 'foyda.test.js'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sofFoyda } from './foyda.js';\n\ntest('sof foyda = tushum - xarajat', () => {\n  assert.equal(sofFoyda(1000, 300), 700);\n});\n");
writeFileSync(join(repo, 'README.md'), '# Hisob\n\nKichik sinov loyihasi. Tekshiruv: `npm test`.\n');
sh('init', '-q', '-b', 'main');
sh('config', 'user.email', 'sinov@example.uz');
sh('config', 'user.name', 'Sinov');
sh('add', '-A');
sh('commit', '-q', '-m', 'boshlanishi');

process.env.AI_ENGINE = 'subscription';
process.env.DEV_PROJECTS = `hisob=${repo}`;
process.env.DEV_MAX_MINUTES = '10';
delete process.env.DEV_FAKE_AGENT;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { businesses } = await import('../server/db');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { acceptCodeJob, codeJobs, runningCodeJob, startCodeJob } = await import('../server/dev/jobs');
const { emptyBusiness } = await import('../server/validate');

const sent: string[] = [];
setOwnerOutlet({
  notify: async (_b, html) => { sent.push(html); console.log(`\n── Telegram ──\n${html}`); return sent.length; },
  edit: async (_b, _id, html) => { console.log(`   · ${html.split('\n').slice(-1)[0].replace(/<[^>]+>/g, '')}`); },
  sendFile: async () => {},
  sendPhoto: async () => null,
});
const biz = businesses.create(`jonli${Date.now()}`, 'x', { ...emptyBusiness('Palantir', 'IT'), ownerName: "Ulug'bek" });
const idle = async () => { while (runningCodeJob(biz.id)) await new Promise(r => setTimeout(r, 500)); };

console.log('1) Xatoni tuzatish');
const t0 = Date.now();
const job = startCodeJob(biz, { project: 'hisob', task: "Hisobotda sof foyda noto'g'ri chiqyapti: xarajat ayirilishi kerak, qo'shilyapti. Tuzat va testni ishga tushirib tekshir.", title: "Hisob: sof foyda noto'g'ri" });
await idle();
const done = codeJobs.byId(biz.id, job.id)!;
console.log(`\n   ${((Date.now() - t0) / 1000).toFixed(0)} s, holat: ${done.status}, fayllar: ${done.files}`);
assert.equal(done.status, 'review', done.report ?? '');
assert.match(readFileSync(join(done.workDir!, 'foyda.js'), 'utf8'), /tushum\s*-\s*xarajat/);
assert.match(readFileSync(join(repo, 'foyda.js'), 'utf8'), /tushum \+ xarajat/, "loyihaning o'zi qabuldan oldin o'zgarib qoldi");
assert.match(sent.at(-1)!, /Tayyor — tekshirib/);

console.log("\n2) Tuzatish o'sha suhbatda + yopiq buyruq (git push)");
const t1 = Date.now();
startCodeJob(biz, { project: 'hisob', task: "Yana: README ga «Sof foyda = tushum − xarajat» degan bir qator qo'sh. Keyin `git push` qilib ko'r — nima bo'lganini hisobotda ayt.", continueId: job.id });
await idle();
const fixed = codeJobs.byId(biz.id, job.id)!;
console.log(`\n   ${((Date.now() - t1) / 1000).toFixed(0)} s, holat: ${fixed.status}, fayllar: ${fixed.files}`);
assert.equal(fixed.status, 'review');
assert.equal(fixed.sessionId, done.sessionId, 'suhbat davom etmadi');
assert.match(readFileSync(join(fixed.workDir!, 'README.md'), 'utf8'), /Sof foyda/);
assert.match(fixed.report ?? '', /push/i, 'yopiq buyruq haqida hisobotda gap yo\'q');

console.log('\n3) Qabul qilish');
const v = await acceptCodeJob(biz, job.id);
console.log(`   ${v.text}`);
assert.ok(v.ok, v.text);
assert.match(readFileSync(join(repo, 'foyda.js'), 'utf8'), /tushum\s*-\s*xarajat/);
assert.ok(!existsSync(fixed.workDir!));
console.log(`   git log: ${sh('log', '--oneline', '-4').replace(/\n/g, ' | ')}`);

try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
console.log('\nHammasi joyida');
process.exit(0);
