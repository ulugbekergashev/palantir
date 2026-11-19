/**
 * Dasturchi (server/dev) — egasining loyihalari kodida ish. Haqiqiy Claude'siz (scripts/fake-dev-agent.mjs), haqiqiy git bilan:
 *   sof qoidalar: loyihalar ro'yxati, yopiq buyruqlar (push, deploy, npm install, node_modules, .env), yozish chegarasi;
 *   ish: alohida ish nusxasida bajariladi — loyiha va undagi saqlanmagan o'zgarish joyida; hisobot tugmalar bilan; farq fayli;
 *   tuzatish o'sha nusxa va suhbatda davom etadi; «Qabul qilish» loyihaga qo'shadi, «Tashlab yuborish» — yo'q;
 *   ASL node_modules hech qachon o'chmaydi (ish nusxasidagi ulanma uziladi); savolga javob — nusxa qolmaydi; to'xtatilgan ishning
 *   qilingani saqlanadi; git'siz papka, band payt, to'qnashuv, «Boshlaymi?»;
 *   yig'ish: qabuldan keyin «📦 Yig'ish» — buyruq .env dan, tayyor fayl ish stolidagi eskisini almashtiradi; xato, to'xtatish.
 * Ishga tushirish: npm run test:dasturchi
 */
import './isolate';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'palantir-dasturchi-'));
const repo = join(root, 'loyiha'), plain = join(root, 'gitsiz');
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
mkdirSync(join(repo, 'node_modules'), { recursive: true });
mkdirSync(plain);
writeFileSync(join(repo, 'a.txt'), 'birinchi\n');
writeFileSync(join(repo, 'b.txt'), 'tegilmagan\n');
writeFileSync(join(repo, '.gitignore'), 'node_modules/\nchiqish/\n');
writeFileSync(join(repo, 'node_modules', 'belgi.txt'), 'asl kutubxona\n');
sh(repo, 'init', '-q', '-b', 'main');
sh(repo, 'config', 'user.email', 'sinov@example.uz');
sh(repo, 'config', 'user.name', 'Sinov');
sh(repo, 'config', 'core.autocrlf', 'false');
sh(repo, 'add', '-A');
sh(repo, 'commit', '-q', '-m', 'boshlanishi');
// Egasining saqlanmagan ishi: Dasturchi unga tegmasligi kerak
writeFileSync(join(repo, 'b.txt'), 'egasi yozyapti\n');

process.env.AI_ENGINE = 'subscription';
process.env.DEV_PROJECTS = `X Clinic=${repo};gitsiz=${plain}`;
process.env.DEV_FAKE_AGENT = resolve('scripts/fake-dev-agent.mjs');
process.env.COMPUTER_APPROVE_MINUTES = '1';

const { businesses } = await import('../server/db');
const { setOwnerOutlet } = await import('../server/inbox/core');
const { parseProjects, findProject } = await import('../server/dev/projects');
const { agentEnv, bashDenied, toolDenied, writeDenied } = await import('../server/dev/guard');
const { DevError, acceptCodeJob, answerStart, codeJobs, discardCodeJob, outcomeOf, runningCodeJob, sendCodeDiff, startCodeJob, stopAllCodeJobs, stopCodeJob } = await import('../server/dev/jobs');
const { builtFiles, canBuild, runningBuild, startBuild, stopBuild } = await import('../server/dev/build');
const { BOT_API_MAX, BigFileError, bigFileBlock, isBig, sendBigFile } = await import('../server/inbox/bigFile');
const { ownerToolDefs, runTool } = await import('../server/tools');
const { emptyBusiness } = await import('../server/validate');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

interface Sent { id: number; html: string; buttons: string[]; file?: string }
const sent: Sent[] = [];
/** Bo'sh emas — egasiga fayl yuborish shu xato bilan yiqiladi */
let fileFails = '';
const buttonsOf = (kb: unknown) => ((kb as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat().map(b => b.callback_data ?? '');
setOwnerOutlet({
  notify: async (_b, html, kb) => { sent.push({ id: sent.length + 1, html, buttons: buttonsOf(kb) }); return sent.length; },
  edit: async (_b, id, html, kb) => { const m = sent.find(s => s.id === id); if (m) { m.html = html; m.buttons = buttonsOf(kb); } },
  sendFile: async (_b, path, caption) => { if (fileFails) throw new Error(fileFails); sent.push({ id: sent.length + 1, html: caption, buttons: [], file: path }); },
  sendPhoto: async () => null,
});
const created = businesses.create('dasturchi-sinov', 'x', emptyBusiness('Palantir', 'IT'));
businesses.update(created.id, { ownerChatId: '777' });
const biz = businesses.byId(created.id)!;
const last = (re: RegExp) => sent.findLast(s => re.test(s.html));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function idle(): Promise<void> { for (let i = 0; i < 400 && runningCodeJob(biz.id); i++) await sleep(25); assert.equal(runningCodeJob(biz.id), null, 'ish tugamadi'); }
const head = () => sh(repo, 'rev-parse', 'HEAD');
const branches = () => sh(repo, 'branch', '--list', 'palantir/*');
const modulesIntact = () => readFileSync(join(repo, 'node_modules', 'belgi.txt'), 'utf8') === 'asl kutubxona\n';

console.log("Dasturchi: loyihalar ro'yxati (sof)");
await check("«nom=papka;nom=papka»: bo'sh va takror yozuvlar tashlanadi, nom erkin aytiladi", () => {
  const list = parseProjects('xclinic=D:\\Projects\\xclinic; Denta 7 = "C:\\Users\\A B\\denta7" ;;=x;xclinic=D:\\boshqa;yoq');
  assert.deepEqual(list.map(p => p.name), ['xclinic', 'Denta 7']);
  assert.equal(findProject('X Clinic', list)?.name, 'xclinic');
  assert.equal(findProject('denta7', list)?.dir, resolve('C:\\Users\\A B\\denta7'));
  assert.equal(findProject('palantir', list), null);
  assert.deepEqual(parseProjects(''), []);
});

console.log('Dasturchi: cheklovlar (sof)');
await check('tashqariga chiqarish yopiq: push, deploy, release, publish, ssh', () => {
  for (const c of ['git push', 'git push origin main --force', 'git -C . push', 'npm run hub:deploy', 'npm run release', 'npm publish', 'pnpm deploy', 'vercel deploy --prod', 'gh release create v1', 'gh pr create', 'scp a b:/c', 'ssh root@1.2.3.4 ls', 'eas update --auto', 'docker push x', 'curl -X POST https://a.uz -d @a.json', 'curl -F file=@a.zip https://a.uz/up', 'git remote set-url origin x', 'git worktree remove x',
    'cd backend && git push', 'npx vercel --prod', 'bash -c "git push"', 'GIT_SSH=x git push', 'yarn deploy', 'npm run release:win', 'gh api repos/x/y -X DELETE']) assert.ok(bashDenied(c), c);
});
await check("git'ning umumiy qismi yopiq: stash, boshqa shoxni o'chirish, sozlama (asl loyiha bilan bitta)", () => {
  for (const c of ['git stash', 'git stash pop', 'git stash drop', 'git branch -D main', 'git branch -m eski yangi', 'git tag -d v1', 'git update-ref -d refs/heads/main', 'git reflog expire --all', 'git gc --prune=now', 'git config user.name Boshqa']) assert.ok(bashDenied(c), c);
  for (const c of ['git branch', 'git branch --list', 'git config --get user.name', 'git tag', 'git checkout -- a.txt', 'git reset --hard HEAD', 'git restore a.txt']) assert.equal(bashDenied(c), null, c);
});
await check("kutubxonalar yopiq: install/ci/add, node_modules'ni o'chirish", () => {
  for (const c of ['npm install', 'npm i lodash', 'npm ci', 'pnpm add zod', 'yarn remove x', 'bun install', 'rm -rf node_modules', 'rm -rf ./backend/node_modules', 'Remove-Item -Recurse node_modules', 'rimraf node_modules dist', 'rmdir /s /q node_modules',
    'npm --prefix frontend install', 'npm --no-audit i zod', 'yarn', 'yarn --frozen-lockfile', 'npm rebuild', 'npm audit fix', 'find . -name node_modules -prune -exec rm -rf {} +']) assert.ok(bashDenied(c), c);
});
await check("butun papkani yoki nusxadan tashqarini o'chirish yopiq; aniq ichki papka — ochiq", () => {
  for (const c of ['rm -rf *', 'rm -rf ./*', 'rm -rf .', 'rm -rf ..', 'rm -rf ../loyiha', 'rm -rf /d/Projects/xclinic', 'rm -r D:\\Projects\\xclinic', 'rm -rf ~/x', 'Remove-Item -Recurse -Force *', 'rd /s /q .']) assert.ok(bashDenied(c), c);
  for (const c of ['rm -rf dist', 'rm -rf ./build/tmp', 'rm a.txt', 'rm -f src/old.ts', 'Remove-Item -Recurse dist']) assert.equal(bashDenied(c), null, c);
});
await check('jarayon va tizim: nom bilan o\'ldirish, shutdown, reg — yopiq; PID bilan — ochiq', () => {
  for (const c of ['taskkill /F /IM node.exe', 'Stop-Process -Name node', 'pkill node', 'shutdown /s', 'reg add HKCU\\x', 'sc stop Palantir', 'schtasks /create /tn x']) assert.ok(bashDenied(c), c);
  for (const c of ['taskkill /PID 1234 /F', 'Stop-Process -Id 1234']) assert.equal(bashDenied(c), null, c);
});
await check('maxfiy fayllar yopiq (.env, kalit, baza); .env.example va process.env — ochiq', () => {
  for (const c of ['cat .env', 'type ..\\.env', 'cat backend/.env.local', 'grep KEY .env.production', 'cat ~/.ssh/id_rsa', 'cat data/session.secret', 'sqlite3 data/palantir.db .dump', 'cat cert.pem']) assert.ok(bashDenied(c), c);
  for (const c of ['cat .env.example', 'node -e "console.log(process.env.PORT)"', 'grep -rn "process.env" server', 'npx vitest run src/env.test.ts']) assert.equal(bashDenied(c), null, c);
});
await check('oddiy ish ochiq: tekshiruv, test, git commit/diff/status, qidirish', () => {
  for (const c of ['npm run typecheck', 'npm test', 'npx tsc --noEmit', 'npm run lint', 'npm run build', 'git status', 'git diff', 'git add -A && git commit -m "fix: hisobot"', 'git log --oneline -5', 'grep -rn "sofFoyda" src', 'ls -la', 'node scripts/check.js', 'rm dist/old.js', 'curl -s http://127.0.0.1:3000/api/health']) assert.equal(bashDenied(c), null, c);
});
await check("qoida buyruqning boshiga qaraydi: qidiruv va commit matnidagi so'zlar yopilmaydi", () => {
  for (const c of ['grep -rn "shutdown" server', 'grep -rn "e.key" src', 'grep ssh src', 'rg ftp src', 'git commit -m "fix npm install docs"', 'git commit -m "fix shutdown race"',
    'curl -f http://localhost:3000/health', 'curl -X POST http://127.0.0.1:3200/api/x -d \'{}\'', 'npm run test:release-notes', 'npm run lint:upload-check', 'npm run build:release',
    'node scripts/release-notes.mjs', 'gh issue list --label pr', 'npm test -- --update', 'npm run build', 'grep -rn "git push" docs']) assert.equal(bashDenied(c), null, c);
});
await check("Palantir'ning o'z sirlari va sozlamalari Dasturchi muhitiga o'tmaydi; tizim va obuna tokeni — o'tadi", () => {
  const out = agentEnv({ PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', BOT_TOKEN: '1:a', DATA_DIR: 'data', PORT: '3200', HUB_SECRET: 's', GEMINI_API_KEY: 'g', DEV_PROJECTS: 'a=b', MY_OWN: 'x', CRM_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' }, ['CRM_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
  assert.deepEqual(out, { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', MY_OWN: 'x', CLAUDE_CODE_OAUTH_TOKEN: 't' });
});
await check("yozish faqat ish nusxasi ichida; node_modules, .git va .env — yo'q; boshqa asbob — yo'q", () => {
  const w = join(root, 'ish');
  assert.equal(writeDenied(w, join(w, 'src', 'a.ts')), null);
  assert.equal(writeDenied(w, 'src/a.ts'), null);
  assert.ok(writeDenied(w, join(root, 'loyiha', 'a.txt')));
  assert.ok(writeDenied(w, '../loyiha/a.txt'));
  assert.ok(writeDenied(w, join(w, 'node_modules', 'x', 'index.js')));
  assert.ok(writeDenied(w, join(w, 'Node_Modules', 'x', 'index.js')));
  assert.ok(toolDenied(w, { tool: 'Grep', input: { pattern: 'KEY', path: join(repo, '.env') } }));
  assert.ok(toolDenied(w, { tool: 'Glob', input: { pattern: '**/.env*' } }));
  assert.equal(toolDenied(w, { tool: 'Grep', input: { pattern: '.env', path: 'src' } }), null);
  assert.ok(writeDenied(w, join(w, '.git', 'config')));
  assert.ok(writeDenied(w, join(w, '.env')));
  assert.equal(toolDenied(w, { tool: 'Read', input: { file_path: join(repo, 'a.txt') } }), null);
  assert.ok(toolDenied(w, { tool: 'Read', input: { file_path: join(repo, '.env') } }));
  assert.ok(toolDenied(w, { tool: 'Edit', input: { file_path: join(repo, 'a.txt') } }));
  assert.ok(toolDenied(w, { tool: 'Bash', input: { command: 'git push' } }));
  assert.equal(toolDenied(w, { tool: 'Grep', input: { pattern: 'x' } }), null);
  assert.ok(toolDenied(w, { tool: 'WebFetch', input: { url: 'https://a.uz' } }));
});
await check('hisobot belgisi: [BAJARILDI] / [BAJARILMADI]', () => {
  assert.deepEqual(outcomeOf('[BAJARILDI]\nTayyor'), { ok: true, text: 'Tayyor' });
  assert.deepEqual(outcomeOf('[BAJARILMADI] Test yiqildi'), { ok: false, text: 'Test yiqildi' });
});

console.log('Dasturchi: ish');
const base = head();
let first = '';
await check("yordamchida asbob bor; ish alohida nusxada: loyiha, saqlanmagan o'zgarish va HEAD joyida", async () => {
  assert.ok(ownerToolDefs(false, ['base']).some(([n]) => n === 'code_task'));
  assert.ok(!ownerToolDefs(false, ['kontent']).some(([n]) => n === 'code_task'));
  const out = await runTool('code_task', { project: 'xclinic', task: "Hisobotda sof foyda noto'g'ri — tuzat fayl:hisobot.txt", title: "XClinic: sof foyda" }, { biz, artifacts: [] });
  assert.equal(out.isError, false, out.content);
  first = (JSON.parse(out.content) as { job_id: string }).job_id;
  await idle();
  const job = codeJobs.byId(biz.id, first)!;
  assert.equal(job.status, 'review');
  assert.equal(job.files, 2);
  assert.equal(head(), base);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'birinchi\n');
  assert.equal(readFileSync(join(repo, 'b.txt'), 'utf8'), 'egasi yozyapti\n');
  assert.ok(!existsSync(join(repo, 'hisobot.txt')));
  assert.equal(sh(repo, 'status', '--short'), 'M b.txt');
});
await check('ish nusxasida asl node_modules ko\'rinadi (ulanma), commit\'ga tushmaydi', () => {
  const job = codeJobs.byId(biz.id, first)!;
  assert.equal(readFileSync(join(job.workDir!, 'hisobot.txt'), 'utf8'), 'modules:true resume:-\n');
  assert.equal(sh(job.workDir!, 'diff', '--name-only', `${job.base}..HEAD`), 'a.txt\nhisobot.txt');
  assert.equal(sh(job.workDir!, 'status', '--short'), '');
});
await check("hisobot: sarlavha, matn, fayllar, uchta tugma; holat xabarida «To'xtatish» qolmaydi", () => {
  const m = last(/Tayyor — tekshirib/)!;
  assert.match(m.html, /X Clinic/);
  assert.match(m.html, /XClinic: sof foyda/);
  assert.match(m.html, /Tekshiruv o'tdi/);
  assert.match(m.html, /2 ta fayl o'zgardi \(\+2 −0\)/);
  assert.match(m.html, /hali loyihaga qo'shilmagan/);
  assert.deepEqual(m.buttons, [`bo|${first}`, `bd|${first}`, `bf|${first}`]);
  assert.deepEqual(last(/Dasturchi ishi tugadi/)!.buttons, []);
});
await check("«O'zgarishlarni ko'rish»: farq fayl bo'lib keladi", async () => {
  const v = await sendCodeDiff(biz, first);
  assert.ok(v.ok, v.text);
  const file = sent.findLast(s => s.file)!.file!;
  assert.match(readFileSync(file, 'utf8'), /\+\+\+ b\/hisobot\.txt/);
});
await check("tuzatish: o'sha nusxa, o'sha suhbat davom etadi; yana qarorga keladi", async () => {
  const before = codeJobs.byId(biz.id, first)!;
  const out = await runTool('code_task', { project: 'x clinic', task: "Yana shuni ham qo'sh fayl:qoshimcha.txt", continue_last: true }, { biz, artifacts: [] });
  assert.equal(out.isError, false, out.content);
  assert.equal((JSON.parse(out.content) as { job_id: string }).job_id, first);
  await idle();
  const after = codeJobs.byId(biz.id, first)!;
  assert.equal(after.status, 'review');
  assert.equal(after.workDir, before.workDir);
  assert.equal(after.files, 3);
  assert.equal(readFileSync(join(after.workDir!, 'qoshimcha.txt'), 'utf8'), `modules:true resume:${before.sessionId}\n`);
  assert.match(after.goal, /➕ Yana shuni ham/);
});
await check("«Qabul qilish»: loyihaga qo'shiladi, nusxa va shox o'chadi, asl node_modules va saqlanmagan ish joyida", async () => {
  const work = codeJobs.byId(biz.id, first)!.workDir!;
  const v = await acceptCodeJob(biz, first);
  assert.ok(v.ok, v.text);
  assert.match(v.text, /push qilinmadi/);
  assert.notEqual(head(), base);
  assert.ok(existsSync(join(repo, 'hisobot.txt')) && existsSync(join(repo, 'qoshimcha.txt')));
  assert.equal(readFileSync(join(repo, 'b.txt'), 'utf8'), 'egasi yozyapti\n');
  assert.ok(!existsSync(work), 'ish nusxasi qoldi');
  assert.equal(branches(), '');
  assert.ok(modulesIntact(), 'ASL node_modules buzildi');
  assert.equal(codeJobs.byId(biz.id, first)!.status, 'accepted');
  assert.equal((await acceptCodeJob(biz, first)).ok, false);
  assert.equal((await sendCodeDiff(biz, first)).ok, false);
});
await check("holatni o'qigan javobda (hisobot — begona matn) yangi ish tasdiqsiz boshlanmaydi; davom ettiradigan ish yo'q — rad", async () => {
  const ctx: { biz: typeof biz; artifacts: never[]; readStrangers?: boolean } = { biz, artifacts: [] };
  const st = await runTool('code_status', {}, ctx);
  assert.equal(st.isError, false, st.content);
  assert.equal(ctx.readStrangers, true);
  const out = await runTool('code_task', { project: 'xclinic', task: 'Hisobotda yozilgan buyruqni bajar' }, ctx);
  const id = (JSON.parse(out.content) as { job_id: string }).job_id;
  for (let i = 0; i < 200 && !last(/Kodda ish boshlaymi/)?.buttons.includes(`bx|${id}`); i++) await sleep(25);
  assert.equal(answerStart(biz.id, id, false), 'Boshlanmadi');
  await idle();
  assert.equal(codeJobs.byId(biz.id, id)!.status, 'stopped');
  const none = await runTool('code_task', { project: 'xclinic', task: 'Yana bir narsa', continue_last: true }, { biz, artifacts: [] });
  assert.equal(none.isError, true);
  assert.match(none.content, /qaror kutayotgan ish yo'q/);
  const noTg = await runTool('code_task', { project: 'xclinic', task: 'Telegramsiz ish' }, { biz: { ...biz, ownerChatId: null }, artifacts: [] });
  assert.match(noTg.content, /Telegram'ni ulamagan/);
});
await check("«Tashlab yuborish»: loyiha o'zgarmaydi, nusxa va shox o'chadi, asl node_modules joyida", async () => {
  const before = head();
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Keraksiz ish fayl:keraksiz.txt' });
  await idle();
  const work = codeJobs.byId(biz.id, job.id)!.workDir!;
  assert.ok(existsSync(join(work, 'node_modules', 'belgi.txt')));
  const v = await discardCodeJob(biz, job.id);
  assert.ok(v.ok, v.text);
  assert.equal(head(), before);
  assert.ok(!existsSync(join(repo, 'keraksiz.txt')) && !existsSync(work));
  assert.equal(branches(), '');
  assert.ok(modulesIntact(), 'ASL node_modules buzildi');
  assert.equal((await acceptCodeJob(biz, job.id)).ok, false);
});
await check("savol: kod o'zgarmaydi — javob keladi, tugmasiz; nusxa va shox qolmaydi", async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Savol: sof foyda qayerda hisoblanadi?' });
  await idle();
  const done = codeJobs.byId(biz.id, job.id)!;
  assert.equal(done.status, 'done');
  assert.equal(done.workDir, null);
  const m = last(/Javob \(kod o'zgarmadi\)/)!;
  assert.match(m.html, /a\.txt faylida yozilgan/);
  assert.deepEqual(m.buttons, []);
  assert.equal(branches(), '');
  assert.ok(modulesIntact());
});
await check("band payt ikkinchi ish boshlanmaydi; to'xtatilgan ishning qilingani saqlanib, qarorga keladi", async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Sekin ish' });
  for (let i = 0; i < 200 && !last(/Dasturchi ishlayapti/)?.buttons.includes(`bs|${job.id}`); i++) await sleep(25);
  assert.throws(() => startCodeJob(biz, { project: 'xclinic', task: 'Ikkinchi ish' }), (e: Error) => e instanceof DevError && /boshqa kod ishi/.test(e.message));
  assert.equal((await acceptCodeJob(biz, job.id)).ok, false);
  for (let i = 0; i < 200 && !existsSync(join(codeJobs.byId(biz.id, job.id)!.workDir ?? root, 'yarim.txt')); i++) await sleep(25);
  assert.ok(stopCodeJob(biz.id, job.id));
  await idle();
  const stopped = codeJobs.byId(biz.id, job.id)!;
  assert.equal(stopped.status, 'review');
  assert.match(last(/Chala qoldi/)!.html, /To'xtatildi/);
  assert.ok((await discardCodeJob(biz, job.id)).ok);
});
await check('chala ish ([BAJARILMADI]) — «Chala qoldi», qilingani qarorga keladi', async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Chala ish fayl:chala.txt' });
  await idle();
  assert.equal(codeJobs.byId(biz.id, job.id)!.status, 'review');
  assert.match(last(/Chala qoldi/)!.html, /test yiqilyapti/);
  assert.ok((await discardCodeJob(biz, job.id)).ok);
});
await check("dvigatel yiqilsa — egasiga sababi, nusxa qolmaydi", async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Yiqil' });
  await idle();
  const j = codeJobs.byId(biz.id, job.id)!;
  assert.equal(j.status, 'failed');
  assert.match(last(/Bajarilmadi/)!.html, /soxta dvigatel yiqildi/);
  assert.equal(branches(), '');
});
await check("to'qnashuv: loyihadagi saqlanmagan o'zgarish shu faylda — qabul bo'lmaydi, loyiha va ish joyida", async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'A ni o\'zgartir fayl:tq.txt' });
  await idle();
  const before = head();
  writeFileSync(join(repo, 'a.txt'), 'egasi a.txt ni ham ochgan\n');
  const v = await acceptCodeJob(biz, job.id);
  assert.equal(v.ok, false);
  assert.match(v.text, /saqlanmagan o'zgarishlar/);
  assert.equal(head(), before);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'egasi a.txt ni ham ochgan\n');
  assert.equal(codeJobs.byId(biz.id, job.id)!.status, 'review');
  sh(repo, 'checkout', '--', 'a.txt');
  assert.ok((await acceptCodeJob(biz, job.id)).ok);
  assert.ok(existsSync(join(repo, 'tq.txt')));
});
await check("egasining tugallanmagan merge'i bor — qabul bo'lmaydi va uning merge'iga tegilmaydi", async () => {
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Merge payti fayl:mp.txt' });
  await idle();
  const before = head();
  sh(repo, 'stash');
  sh(repo, 'checkout', '-q', '-b', 'yon');
  writeFileSync(join(repo, 'a.txt'), 'yon shox\n');
  sh(repo, 'commit', '-qam', 'yon');
  sh(repo, 'checkout', '-q', 'main');
  writeFileSync(join(repo, 'a.txt'), 'asosiy\n');
  sh(repo, 'commit', '-qam', 'asosiy');
  try { sh(repo, 'merge', 'yon'); } catch { /* to'qnashuv — kutilgan */ }
  writeFileSync(join(repo, 'a.txt'), 'egasi hal qildi\n');
  sh(repo, 'add', 'a.txt');
  const v = await acceptCodeJob(biz, job.id);
  assert.equal(v.ok, false);
  assert.match(v.text, /tugallanmagan merge/);
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'egasi hal qildi\n');
  assert.ok(sh(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'));
  assert.equal(codeJobs.byId(biz.id, job.id)!.status, 'review');
  sh(repo, 'merge', '--abort');
  sh(repo, 'reset', '-q', '--hard', before);
  sh(repo, 'branch', '-D', 'yon');
  sh(repo, 'stash', 'pop');
  assert.ok((await discardCodeJob(biz, job.id)).ok);
});
await check("commit bo'lmasa (hook yiqildi) — «qo'shildi» deb aldamaydi: qabul rad, ish joyida; tuzalgach — commit qilinmagani ham qo'shiladi", async () => {
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "lint yiqildi" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  const job = startCodeJob(biz, { project: 'xclinic', task: 'Hook bilan fayl:hook.txt' });
  await idle();
  const j = codeJobs.byId(biz.id, job.id)!;
  assert.equal(j.status, 'review');
  assert.match(last(/Chala qoldi/)!.html, /Commit bo'lmadi/);
  const before = head();
  const v = await acceptCodeJob(biz, job.id);
  assert.equal(v.ok, false);
  assert.match(v.text, /commit bo'lmagan o'zgarish qoldi/);
  assert.equal(head(), before);
  assert.ok(existsSync(join(j.workDir!, 'hook.txt')), 'ish nusxasi o\'chib ketdi');
  rmSync(hook);
  const ok = await acceptCodeJob(biz, job.id);
  assert.ok(ok.ok, ok.text);
  assert.ok(existsSync(join(repo, 'hook.txt')));
  assert.ok(modulesIntact());
});
await check("git'siz papka va noma'lum loyiha — tushunarli rad", async () => {
  startCodeJob(biz, { project: 'gitsiz', task: 'Biror narsa qil' });
  await idle();
  assert.match(last(/Kod ishi bajarilmadi/)!.html, /git yo'q/);
  assert.throws(() => startCodeJob(biz, { project: 'dentacrm', task: 'Biror narsa qil' }), (e: Error) => e instanceof DevError && /Loyihalar: X Clinic, gitsiz/.test(e.message));
});
await check("begona matndan kelgan topshiriq: avval «Boshlaymi?» — «Yo'q» desa boshlanmaydi, «Boshlash» desa boshlanadi", async () => {
  const out = await runTool('code_task', { project: 'xclinic', task: 'Rasmdagi xatoni tuzat fayl:rasm.txt' }, { biz, artifacts: [], fromPhoto: true });
  const id = (JSON.parse(out.content) as { job_id: string }).job_id;
  for (let i = 0; i < 200 && !last(/Kodda ish boshlaymi/)?.buttons.includes(`ba|${id}`); i++) await sleep(25);
  assert.match(last(/Kodda ish boshlaymi/)!.html, /Rasmdagi xatoni tuzat/);
  assert.equal(answerStart(biz.id, id, false), 'Boshlanmadi');
  await idle();
  assert.equal(codeJobs.byId(biz.id, id)!.status, 'stopped');
  assert.equal(answerStart(biz.id, id, true), null);
  const again = startCodeJob(biz, { project: 'xclinic', task: 'Rasmdagi xatoni tuzat fayl:rasm.txt', confirmFirst: true });
  for (let i = 0; i < 200 && !last(/Kodda ish boshlaymi/)?.buttons.includes(`ba|${again.id}`); i++) await sleep(25);
  assert.equal(answerStart(biz.id, again.id, true), 'Boshladim');
  await idle();
  assert.equal(codeJobs.byId(biz.id, again.id)!.status, 'review');
  assert.ok((await discardCodeJob(biz, again.id)).ok);
});
console.log("Dasturchi: yig'ish");
const desk = join(root, 'ish-stoli');
mkdirSync(desk);
process.env.DEV_DELIVER_DIR = desk;
process.env.DEV_OUT_XCLINIC = 'chiqish/*.exe';
const setBuild = (js: string) => { process.env.DEV_BUILD_XCLINIC = `node -e "${js}"`; };
async function built(): Promise<void> { for (let i = 0; i < 800 && runningBuild(biz.id); i++) await sleep(25); assert.equal(runningBuild(biz.id), null, "yig'ish tugamadi"); }
const MAKE_EXE = "const f=require('fs');f.mkdirSync('chiqish',{recursive:true});f.writeFileSync('chiqish/Sinov Setup 1.0.exe','yangi exe');console.log('electron-builder: tayyor')";

await check("qabuldan keyin «Yig'ish» taklif qilinadi; tayyor fayl ish stolidagi eskisini almashtiradi", async () => {
  setBuild(MAKE_EXE);
  writeFileSync(join(desk, 'Sinov Setup 1.0.exe'), 'eski exe');
  const job = startCodeJob(biz, { project: 'xclinic', task: "Yig'ishdan oldingi o'zgarish fayl:yig.txt" });
  await idle();
  const v = await acceptCodeJob(biz, job.id);
  assert.ok(v.ok, v.text);
  assert.equal(v.build, true);
  const out = await runTool('code_build', { project: 'X Clinic' }, { biz, artifacts: [] });
  assert.equal(out.isError, false, out.content);
  await built();
  assert.equal(readFileSync(join(desk, 'Sinov Setup 1.0.exe'), 'utf8'), 'yangi exe');
  const m = last(/📦 <b>Tayyor<\/b>/)!;
  assert.match(m.html, /Sinov Setup 1\.0\.exe/);
  assert.ok(m.html.includes(join(desk, 'Sinov Setup 1.0.exe')), m.html);
  assert.deepEqual(last(/Yig'ish tugadi/)!.buttons, []);
  assert.equal(sh(repo, 'status', '--short'), 'M b.txt');
  // Fayl Telegram'ga ham keladi — ish stolidagi nusxadan, «Tayyor» xabaridan keyin
  const file = sent.findLast(s => s.file)!;
  assert.equal(file.file, join(desk, 'Sinov Setup 1.0.exe'));
  assert.match(file.html, /X Clinic: Sinov Setup 1\.0\.exe/);
  assert.ok(file.id > m.id, 'fayl «Tayyor» dan oldin ketdi');
});
await check("fayl Telegram'ga ketmasa — sababi aytiladi, yig'ish baribir «Tayyor» (fayl ish stolida)", async () => {
  setBuild(MAKE_EXE);
  fileFails = 'Telegram: ulanish uzildi <tarmoq>';
  try {
    startBuild(biz, 'xclinic');
    await built();
  } finally { fileFails = ''; }
  assert.ok(last(/📦 <b>Tayyor<\/b>/));
  const m = last(/Telegram'ga yuborilmadi/)!;
  assert.match(m.html, /Sinov Setup 1\.0\.exe/);
  assert.match(m.html, /ulanish uzildi &lt;tarmoq&gt;/);
  assert.ok(m.html.includes(join(desk, 'Sinov Setup 1.0.exe')), m.html);
});
await check("50 MB dan katta fayl: «yuboryapman» → «yuborildi»; kalitlar bo'lmasa — nima kerakligi aytiladi", async () => {
  // Alohida nom: keyingi tekshiruvlar «Sinov Setup» ning mazmuniga qaraydi
  const big = join(desk, 'Katta Setup 2.0.exe'), made = join(repo, 'chiqish', 'Katta Setup 2.0.exe');
  process.env.DEV_OUT_XCLINIC = 'chiqish/Katta*.exe';
  setBuild(`const f=require('fs');f.mkdirSync('chiqish',{recursive:true});f.writeFileSync('chiqish/Katta Setup 2.0.exe','x');f.truncateSync('chiqish/Katta Setup 2.0.exe',${BOT_API_MAX + 1024})`);
  // 1) kalitsiz (sinov muhitida bot ham, TG_API_ID ham yo'q): yuborishga urinilmaydi
  const before = sent.filter(s => s.file).length;
  startBuild(biz, 'xclinic');
  await built();
  assert.equal(isBig(big), true);
  assert.equal(sent.filter(s => s.file).length, before, 'kalitsiz ham yuborishga urinildi');
  assert.match(last(/Telegram'ga yuborilmadi/)!.html, /bot ulanmagan|TG_API_ID/);
  // 2) yo'l ochiq: xabar «yuboryapman» dan «yuborildi» ga aylanadi, fayl ketadi
  process.env.BIG_FILE_FAKE = resolve('scripts/fake-big-file.mjs');
  try {
    assert.equal(bigFileBlock(big), null);
    startBuild(biz, 'xclinic');
    await built();
    assert.equal(sent.filter(s => s.file).length, before + 1);
    const note = last(/Telegram'ga yuborildi/)!;
    assert.match(note.html, /Katta Setup 2\.0\.exe<\/b> — 49 MB/);
    assert.equal(last(/Telegram'ga yuboryapman/), undefined, '«yuboryapman» yozuvi qolib ketdi');
    // 3) sendBigFile o'zi: navbat bilan, soxta yuboruvchiga chat, fayl va izoh yetadi
    const logFile = join(root, 'katta-fayl.jsonl');
    process.env.BIG_FILE_FAKE_LOG = logFile;
    const seen: number[] = [];
    await Promise.all([sendBigFile('777', big, 'birinchi', f => seen.push(f)), sendBigFile('777', big, 'ikkinchi')]);
    const calls = readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { chatId: string; path: string; caption: string; at: string });
    assert.deepEqual(calls.map(c => `${c.at}:${c.caption}`), ['start:birinchi', 'end:birinchi', 'start:ikkinchi', 'end:ikkinchi']);
    assert.equal(calls[0].chatId, '777');
    assert.equal(calls[0].path, big);
    assert.deepEqual(seen, [0.5, 1]);
  } finally { delete process.env.BIG_FILE_FAKE; delete process.env.BIG_FILE_FAKE_LOG; process.env.DEV_OUT_XCLINIC = 'chiqish/*.exe'; }
  await assert.rejects(sendBigFile('777', big, 'x'), (e: Error) => e instanceof BigFileError);
  rmSync(made, { force: true });
  rmSync(big, { force: true });
});
await check('tayyor fayl — faqat shu yig\'ishda yozilgani (eski nusxalar emas)', () => {
  const old = join(repo, 'chiqish', 'Eski Setup 0.9.exe');
  writeFileSync(old, 'eski');
  utimesSync(old, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  const since = Date.now() - 60_000;
  assert.deepEqual(builtFiles(repo, 'chiqish/*.exe', since).map(f => f.split(/[\\/]/).pop()), ['Sinov Setup 1.0.exe']);
  assert.deepEqual(builtFiles(repo, 'yoq-papka/*.exe', since), []);
});
await check("yig'ish yiqilsa — sababi (chiqishning oxiri) va jurnal yo'li egasiga keladi; ish stolidagi fayl o'zgarmaydi", async () => {
  setBuild("console.error('src/a.ts(3,1): error TS2304: lint yiqildi');process.exit(3)");
  startBuild(biz, 'xclinic');
  await built();
  const m = last(/Yig'ilmadi/)!;
  assert.match(m.html, /kod 3/);
  assert.match(m.html, /lint yiqildi/);
  assert.match(m.html, /yigish-xclinic-/);
  assert.equal(readFileSync(join(desk, 'Sinov Setup 1.0.exe'), 'utf8'), 'yangi exe');
});
await check("bir vaqtda bitta yig'ish; «To'xtatish» — jarayon to'xtaydi", async () => {
  setBuild("console.log('boshlandi');setTimeout(()=>{},120000)");
  const b = startBuild(biz, 'xclinic');
  assert.throws(() => startBuild(biz, 'xclinic'), (e: Error) => e instanceof DevError && /yig'ilyapti/.test(e.message));
  for (let i = 0; i < 200 && !last(/Yig'yapman/)?.buttons.includes(`bq|${b.id}`); i++) await sleep(25);
  assert.ok(stopBuild(biz.id, b.id));
  assert.equal(stopBuild(biz.id, b.id), false);
  await built();
  assert.ok(last(/Yig'ish to'xtatildi/));
});
await check("buyrug'i sozlanmagan loyiha yig'ilmaydi — tushunarli rad; buyruq faqat .env dan", async () => {
  assert.equal(canBuild('gitsiz'), false);
  assert.equal(canBuild('x clinic'), true);
  const out = await runTool('code_build', { project: 'gitsiz' }, { biz, artifacts: [] });
  assert.equal(out.isError, true);
  assert.match(out.content, /DEV_BUILD_GITSIZ/);
  assert.match(out.content, /X Clinic/);
});
await check('oxirida: asl node_modules joyida, ortiqcha shox va ish nusxasi yo\'q', async () => {
  await stopAllCodeJobs();
  assert.ok(modulesIntact(), 'ASL node_modules buzildi');
  assert.equal(branches(), '');
  assert.equal(sh(repo, 'worktree', 'list').split('\n').length, 1);
});

try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows: fayl hali band */ }
console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi joyida');
process.exit(failed ? 1 : 0);
