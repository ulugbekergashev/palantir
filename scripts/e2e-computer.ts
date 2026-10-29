/**
 * Kompyuterda ishlash sinovi — haqiqiy kalitsiz (soxta Telegram va Claude, mahalliy sinov sayti, soxta ekran):
 *   sof qoidalar: manzil siyosati (ichki tarmoq, saytlar ro'yxati), xavfli tugma va Enter, PNG o'lchami, ekran koordinatalari (2560×1600 → 1280×800);
 *   server: egasi «arizani to'ldirib yubor» → yordamchi computer_task → ish fonda, haqiqiy Chrome'da (ko'rinmas): sahifani ochadi va o'qiydi,
 *   parol maydoniga yozmaydi, «O'chirish» — egasi rad etadi (navbatdagi amal bajarilmaydi), «Yuborish» — egasi ruxsat beradi, fayl yuklab
 *   olinib egasiga hujjat bo'lib keladi, ichki tarmoq ochilmaydi; band paytida ikkinchi ish boshlanmaydi; «⏹ To'xtatish»;
 *   butun ekran (soxta haydovchi): avval egasi tasdiqlaydi, rasm 1280×800, bosish haqiqiy piksellarga, bloklovchi tugma bosilmaydi.
 *   Windows'da — haqiqiy yordamchi (C#) yig'iladi: ekran o'lchami va sichqoncha.
 * Ishga tushirish: npm run test:computer
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PolicyError, allowedRequest, checkUrl, privateHost, riskyClick, riskyKey } from '../server/computer/policy';
import { pngSize, solidPng } from '../server/computer/png';
import { DesktopSession, FakeDriver, startDriver } from '../server/computer/desktop';
import { chromePath } from './chrome';
import { OWNER, ai, aiServer, listen, patient, press, say, sent, sleep, stopProcess, tgServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };
const throws = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e as Error; } };

console.log('\n# Manzil siyosati (sof)');
const open = { allowedSites: [], allowHosts: [] };
ok('oddiy sayt ochiladi, sxemasiz — https://', checkUrl('soliq.uz/uz', open) === 'https://soliq.uz/uz' && checkUrl('http://my.gov.uz', open) === 'http://my.gov.uz/');
ok("shu kompyuter va ichki tarmoq yopiq", ['http://localhost:3000', 'http://127.0.0.1', 'http://192.168.1.1', 'http://10.0.0.5', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://router/', 'http://metadata.google.internal']
  .every(u => throws(() => checkUrl(u, open)) instanceof PolicyError));
ok('file:, javascript:, chrome: — ochilmaydi', ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings'].every(u => throws(() => checkUrl(u, open)) instanceof PolicyError));
ok('saytlar ro\'yxati: soliq.uz va uning subdomeni — ha, boshqasi — yo\'q', (() => {
  const p = { allowedSites: ['soliq.uz'], allowHosts: [] };
  return allowedRequest('https://my.soliq.uz/x', p) && allowedRequest('https://soliq.uz', p) && !allowedRequest('https://evil-soliq.uz', p) && !allowedRequest('https://google.com', p);
})());
ok('istisno host:port — faqat aynan o\'sha port', allowedRequest('http://127.0.0.1:4555/a', { allowedSites: [], allowHosts: ['127.0.0.1:4555'] }) && !allowedRequest('http://127.0.0.1:4556/a', { allowedSites: [], allowHosts: ['127.0.0.1:4555'] }));
ok('ichki manzillar: 100.64/10, 172.16/12, IPv6 fc00, ::ffff:', privateHost('100.100.1.1') && privateHost('172.20.0.1') && !privateHost('172.32.0.1') && privateHost('fc00::1') && privateHost('::ffff:127.0.0.1') && !privateHost('8.8.8.8'));

console.log('\n# Xavfli amallar (sof)');
ok('«Yuborish», «Отправить», «Pay now», «O‘chirish» — ruxsat so\'raladi', ['Yuborish', 'Отправить', 'Pay now', 'O‘chirish', "To'lash", 'Buyurtma berish', 'Tasdiqlash']
  .every(name => riskyClick({ tag: 'button', role: 'button', name }) !== null));
ok('«Qidirish», «Batafsil», «Keyingi sahifa» — so\'ralmaydi', ['Qidirish', 'Batafsil', 'Keyingi sahifa'].every(name => riskyClick({ tag: 'a', role: 'link', name }) === null));
ok('formadagi submit tugma (nomi nima bo\'lsa ham) — so\'raladi', riskyClick({ tag: 'button', type: 'submit', role: 'button', name: 'Davom', inForm: true }) !== null);
ok('formadagi maydonda Enter — so\'raladi; matn oynasida (textarea) — yo\'q', riskyKey('Enter', { tag: 'input', type: 'text', name: 'q', inForm: true }) !== null && riskyKey('Enter', { tag: 'textarea', name: 'izoh', inForm: true }) === null && riskyKey('Tab', { tag: 'input', name: 'q', inForm: true }) === null);

console.log('\n# Ekran (sof, soxta haydovchi)');
const png = solidPng(320, 200, [10, 20, 30]);
ok('PNG: o\'lchami o\'qiladi', JSON.stringify(pngSize(png)) === '{"width":320,"height":200}');
const fakeLog: Record<string, unknown>[] = [];
const fd = new FakeDriver({ width: 2560, height: 1600 }, '');
const orig = fd.click.bind(fd);
fd.click = async (x, y, button, count, mods) => { fakeLog.push({ x, y, button, count, mods }); return orig(x, y, button, count, mods); };
const desk = await DesktopSession.open(fd);
const shot = await desk.run('screenshot', {});
const shotImg = shot.content[0] as { type: string; source?: { data: string } };
ok('Retina/4K ekran: rasm 1280×800 ga kichraytiriladi', desk.view.width === 1280 && desk.view.height === 800 && JSON.stringify(pngSize(Buffer.from(shotImg.source?.data ?? '', 'base64'))) === '{"width":1280,"height":800}');
await desk.run('left_click', { coordinate: [640, 400], text: 'shift' });
ok('bosish: rasm koordinatasi → haqiqiy piksel (×2), modifikator bilan', JSON.stringify(fakeLog[0]) === '{"x":1280,"y":800,"button":"left","count":1,"mods":"shift"}', JSON.stringify(fakeLog[0]));
ok('kursor joyi — rasm koordinatasida', (await desk.run('cursor_position', {})).content[0].type === 'text' && JSON.stringify((await desk.run('cursor_position', {})).content).includes('X=640,Y=400'));
ok('Ctrl+Alt+Del, Win+L — bosilmaydi', (await desk.run('key', { text: 'ctrl+alt+delete' })).isError === true && (await desk.run('key', { text: 'super+l' })).isError === true && !(await desk.run('key', { text: 'ctrl+s' })).isError);
const zoom = await desk.run('zoom', { region: [0, 0, 320, 200] });
ok('zoom: kichik hudud kattalashtiriladi (1280×800 dan oshmaydi)', JSON.stringify(pngSize(Buffer.from((zoom.content[0] as { source: { data: string } }).source.data, 'base64'))) === '{"width":1280,"height":800}');

if (process.platform === 'win32') {
  console.log('\n# Windows: haqiqiy yordamchi');
  const work = mkdtempSync(join(tmpdir(), 'palantir-desk-'));
  try {
    const d = await startDriver(work, '', '');
    const size = await d.size();
    ok('yordamchi yig\'ildi va ishga tushdi: ekran o\'lchami', size.width > 0 && size.height > 0, `${size.width}×${size.height}`);
    await d.move(Math.round(size.width / 3), Math.round(size.height / 3));
    const at = await d.cursor();
    ok('sichqoncha: joyiga keldi', Math.abs(at.x - Math.round(size.width / 3)) <= 2 && Math.abs(at.y - Math.round(size.height / 3)) <= 2, JSON.stringify(at));
    const cap = await d.capture({ x: 0, y: 0, w: size.width, h: size.height }, { width: 640, height: 400 }).catch(e => (e as Error).message);
    ok('ekran rasmi olinadi (kichraytirilgan)', typeof cap !== 'string' && pngSize(cap)?.width === 640, typeof cap === 'string' ? cap : '');
    d.close();
  } catch (e) {
    ok('Windows yordamchisi', false, (e as Error).message);
  } finally {
    // Yordamchi .exe yopilguncha Windows faylni band qilib turadi — bir necha urinish, o'chmasa ham sinov yiqilmaydi
    try { rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* vaqtinchalik papka */ }
  }
}

// ─── Sinov sayti ──────────────────────────────────────────────────────────────
const siteHits: string[] = [];
const site = patient(createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  siteHits.push(u.pathname + u.search);
  const html = (title: string, body: string) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`); };
  if (u.pathname === '/form') return html('Ariza', `<h1>Ariza</h1>
    <form action="/done" method="get"><label>Ism <input name="ism"></label> <label>Parol <input type="password" name="parol"></label> <button type="submit">Yuborish</button></form>
    <p><button type="button" onclick="document.title='Ochirildi'">O'chirish</button></p>`);
  if (u.pathname === '/done') return html('Qabul', `<p>Qabul qilindi: ${(u.searchParams.get('ism') ?? '').replace(/[<>&]/g, '')}</p><a href="/hisobot.csv" download>Hisobotni yuklab olish</a>`);
  if (u.pathname === '/hisobot.csv') { res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', 'attachment; filename="hisobot.csv"'); return res.end('sana,summa\n2026-10-22,1200000\n'); }
  if (u.pathname === '/slow') return html('Sekin', '<p>Kutib turing</p>');
  res.statusCode = 404; res.end('yo\'q');
}));

// ─── Server ───────────────────────────────────────────────────────────────────
chromePath();
const tgPort = await listen(tgServer), aiPort = await listen(aiServer), sitePort = await listen(site);
const SITE = `http://127.0.0.1:${sitePort}`;
const dataDir = mkdtempSync(join(tmpdir(), 'palantir-comp-'));
const deskLog = join(dataDir, 'ekran.jsonl');
const PORT = 3320, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, BOT_TOKEN: '123:TEST', TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'comp-secret', TICK_MS: '500',
    MORNING_HOUR: '99', EVENING_HOUR: '99', WEB_SEARCH: '0', BACKUP_KEEP: '0',
    COMPUTER_USE: 'all', COMPUTER_ALLOW_HOSTS: `127.0.0.1:${sitePort}`, COMPUTER_FAKE_SCREEN: '2560x1600', COMPUTER_FAKE_LOG: deskLog, COMPUTER_APPROVE_MINUTES: '1',
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '', TG_CALL_PYTHON: '', TG_CALL_SCRIPT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const textOf = (s: Sent | undefined) => String(s?.params.text ?? s?.params.caption ?? '');
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => (s.method === 'sendMessage' || s.method === 'sendDocument') && Number(s.params.chat_id) === OWNER && textOf(s).includes(needle));
const edited = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'editMessageText' && Number(s.params.chat_id) === OWNER && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
const button = (s: Sent | undefined, code: string) => buttons(s).find(b => b.callback_data?.startsWith(`${code}|`))?.callback_data;
const toasts = (mark: number) => sent.slice(mark).filter(s => s.method === 'answerCallbackQuery').map(s => String(s.params.text ?? ''));

type Block = Record<string, any>;
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
/** Oxirgi xabardagi asbob natijalari (matni) */
const lastResults = (messages: Msg[]) => {
  const last = messages.at(-1);
  return Array.isArray(last?.content) ? last.content.filter(b => b.type === 'tool_result') : [];
};
const resultText = (r: Block | undefined) => (Array.isArray(r?.content) ? r.content.filter((c: Block) => c.type === 'text').map((c: Block) => c.text).join('\n') : String(r?.content ?? ''));
const browserUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, toolset_name: 'browser' });
const deskUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input, toolset_name: 'computer' });
/** Yordamchi (egasi bilan suhbat): computer_task chaqiradi, natijadan keyin bir gap */
const ownerStarts = (task: string, where: 'browser' | 'desktop', reply = 'Yordamchi:') => {
  ai.owner = messages => {
    const r = lastResults(messages)[0];
    return r
      ? { content: [{ type: 'text', text: `${reply} [${resultText(r).slice(0, 200)}]` }], stop: 'end_turn' }
      : { content: [{ type: 'tool_use', id: `tu_${Date.now()}`, name: 'computer_task', input: { task, where } }], stop: 'tool_use' };
  };
};

try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* hali */ } await sleep(250); }
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token;
  await api('/api/admin/businesses', { token: admin, body: { name: 'Mebel Uyi', industry: 'mebel', login: 'mebel', password: 'secret12' } });
  const token = (await api('/api/login', { body: { login: 'mebel', password: 'secret12' } })).json.token;
  const me = (await api('/api/me', { token })).json;
  let mark = sent.length;
  say(OWNER, `/start ${String(me.status.linkUrl).split('start=')[1]}`);
  await waitFor('egasi ulandi', () => toOwner(mark, 'ulandi') || toOwner(mark, 'Mebel Uyi'));

  console.log('\n# Brauzer: ariza, ruxsatlar, yuklab olish');
  // Operator ssenariysi: har qadam — oldingi natijaga qarab
  const seen: Record<string, string> = {};
  const refOf = (tree: string, needle: RegExp) => tree.split('\n').find(l => needle.test(l))?.match(/\[(ref_\d+)\]/)?.[1] ?? 'ref_none';
  const script: ((prev: Block[]) => Block[])[] = [
    () => [{ type: 'text', text: 'Ariza sahifasini ochyapman' }, browserUse('b1', 'navigate', { url: `${SITE}/form` })],
    prev => { seen.navigate = resultText(prev[0]); seen.navigateState = JSON.stringify(prev[0]?.content); return [browserUse('b2', 'read_page', { filter: 'interactive' })]; },
    prev => {
      const tree = resultText(prev[0]);
      seen.tree = tree;
      seen.ism = refOf(tree, /textbox "Ism"/); seen.parol = refOf(tree, /password/); seen.yubor = refOf(tree, /button "Yuborish"/); seen.ochir = refOf(tree, /button "O'chirish"/);
      return [browserUse('b3', 'form_input', { target: { type: 'ref', ref: seen.ism }, value: 'Ali' })];
    },
    prev => { seen.fill = resultText(prev[0]); return [browserUse('b4', 'form_input', { target: { type: 'ref', ref: seen.parol }, value: 'maxfiy123' })]; },
    prev => { seen.password = JSON.stringify(prev[0]); return [browserUse('b4a', 'left_click', { target: { type: 'ref', ref: seen.ism } }), browserUse('b4b', 'type', { text: 'Vali\n' })]; },
    prev => { seen.enter = JSON.stringify(prev); return [browserUse('b5', 'left_click', { target: { type: 'ref', ref: seen.ochir } }), browserUse('b6', 'get_page_text', {})]; },
    prev => { seen.declined = JSON.stringify(prev); return [browserUse('b7', 'left_click', { target: { type: 'ref', ref: seen.yubor } })]; },
    prev => { seen.submitted = JSON.stringify(prev[0]); return [browserUse('b8', 'find', { query: 'Hisobotni yuklab olish' })]; },
    prev => [browserUse('b9', 'left_click', { target: { type: 'ref', ref: refOf(resultText(prev[0]), /link "Hisobotni/) } })],
    () => [browserUse('b10', 'navigate', { url: 'http://192.168.1.1/' })],
    prev => { seen.lan = JSON.stringify(prev[0]); return [browserUse('b11', 'navigate', { url: `http://127.0.0.1:${PORT}/api/health` })]; },
    prev => { seen.self = JSON.stringify(prev[0]); return [browserUse('b12', 'get_page_text', {})]; },
    prev => { seen.text = JSON.stringify(prev[0]); return [{ type: 'text', text: "Ariza yuborildi: Ali. Hisobot yuklab olindi (hisobot.csv)." }]; },
  ];
  ai.operator = messages => {
    const step = messages.filter(m => m.role === 'assistant').length;
    const fn = script[step];
    const content = fn ? fn(lastResults(messages)) : [{ type: 'text', text: 'Tamom' }];
    return { content, stop: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  ownerStarts("Ariza saytida (forma) ismni Ali deb to'ldirib yubor, keyin hisobotni yuklab ol", 'browser');
  mark = sent.length;
  const opsBefore = ai.operatorRequests.length;
  say(OWNER, "Ariza saytida ismni Ali deb to'ldirib yubor, hisobotni yuklab ol");
  const started = await waitFor('yordamchi javobi', () => toOwner(mark, 'Yordamchi:'), 20_000);
  ok('yordamchi: computer_task → «boshlandi», kutmaydi', !!started && textOf(started).includes('"started":true'), textOf(started).slice(0, 200));
  const status = await waitFor('holat xabari', () => toOwner(mark, 'Brauzerda ishlayapman'), 30_000);
  ok("holat xabari: «⏹ To'xtatish» tugmasi bilan", !!button(status, 'cs'));
  const enterAsk = await waitFor('Enter uchun ruxsat', () => sent.slice(mark).find(s => s.method === 'sendMessage' && textOf(s).includes('Ruxsat kerak') && textOf(s).includes('Enter bilan')), 60_000);
  ok("matn ichidagi yangi qator (Enter) formada — ruxsat so'raldi", !!button(enterAsk, 'cx'), textOf(enterAsk).slice(0, 120));
  press(OWNER, button(enterAsk, 'cx')!, enterAsk!.id!);
  const denyAsk = await waitFor("«O'chirish» uchun ruxsat so'rovi", () => toOwner(mark, 'Ruxsat kerak') && sent.slice(mark).find(s => s.method === 'sendMessage' && textOf(s).includes("O'chirish") && textOf(s).includes('Ruxsat kerak')), 60_000);
  ok("«O'chirish» tugmasi — egasidan ruxsat so'raldi (✅/✖️)", !!button(denyAsk, 'ca') && !!button(denyAsk, 'cx'), textOf(denyAsk).slice(0, 160));
  ok('parol maydoniga yozilmadi (xato natija)', /"is_error":true/.test(seen.password ?? '') && /parol/i.test(seen.password ?? ''), (seen.password ?? '').slice(0, 200));
  let m2 = sent.length;
  press(OWNER, button(denyAsk, 'cx')!, denyAsk!.id!);
  await waitFor('rad javobi', () => toasts(m2).length);
  ok("rad etildi — xabar yangilandi", !!(await waitFor('tahrir', () => edited(m2, 'Rad etildi'))));
  const approveAsk = await waitFor('«Yuborish» ruxsati', () => sent.slice(m2).find(s => s.method === 'sendMessage' && textOf(s).includes('Ruxsat kerak') && textOf(s).includes('Yuborish')), 60_000);
  ok('Enter rad etildi: forma yuborilmadi, matn yozilmadi', /Egasi ruxsat bermadi/.test(seen.enter ?? '') && !siteHits.some(h => h.includes('Vali')), (seen.enter ?? '').slice(0, 200));
  ok("rad etilgan bosish bajarilmadi, shu navbatdagi keyingi amal ham («Not executed»)", /Egasi ruxsat bermadi/.test(seen.declined ?? '') && /Not executed/.test(seen.declined ?? ''), (seen.declined ?? '').slice(0, 300));
  ok("formadagi «Yuborish» — ruxsat so'raldi", !!approveAsk && !siteHits.some(h => h.startsWith('/done')));
  m2 = sent.length;
  press(OWNER, button(approveAsk, 'ca')!, approveAsk!.id!);
  const done = await waitFor('ish tugadi', () => toOwner(m2, 'Ish tugadi'), 90_000);
  ok('ruxsatdan keyin forma yuborildi (sayt ism=Ali ni oldi)', siteHits.some(h => h.startsWith('/done?ism=Ali')), `${siteHits.join(' ')} | ${(seen.submitted ?? '').slice(0, 300)}`);
  ok('sahifa matni o\'qildi', (seen.text ?? '').includes('Qabul qilindi: Ali'), (seen.text ?? '').slice(0, 300));
  ok('ichki tarmoq (192.168.1.1) va Palantir\'ning o\'zi ochilmadi', /ichki tarmoq/.test(seen.lan ?? '') && /"is_error":true/.test(seen.self ?? ''), `${(seen.lan ?? '').slice(0, 120)} | ${(seen.self ?? '').slice(0, 120)}`);
  ok('daraxt: ref bilan elementlar, parol qiymati ko\'rinmaydi', /textbox "Ism"/.test(seen.tree ?? '') && /password \(empty\)/.test(seen.tree ?? ''), (seen.tree ?? '').slice(0, 300));
  ok('yangi sahifa ochilganda — browser_state (tablar)', /browser_state/.test(seen.navigateState ?? '') && /tab-1/.test(seen.navigateState ?? ''));
  ok('egasiga: «Ish tugadi» va hisobot', !!done && textOf(done).includes('Ariza yuborildi: Ali'), textOf(done).slice(0, 200));
  const doc = await waitFor('fayl', () => sent.slice(m2).find(s => s.method === 'sendDocument' && Number(s.params.chat_id) === OWNER), 20_000);
  ok('yuklab olingan fayl egasiga hujjat bo\'lib keldi', doc?.fileName === 'hisobot.csv' && doc.file?.toString().includes('1200000'), String(doc?.fileName));
  ok("holat xabari yakunlandi (to'xtatish tugmasi olib tashlandi)", !!sent.slice(m2).find(s => s.method === 'editMessageText' && Number(s.params.message_id) === status?.id && !button(s, 'cs') && textOf(s).includes('qadam')));
  const ops = ai.operatorRequests.slice(opsBefore);
  ok("operator so'rovi: brauzer asboblari + confirm_with_owner, Palantir'ning boshqa asboblari yo'q", ops.length > 0 && JSON.stringify(ops[0].tools).includes('browser_toolset_20260801') && ops[0].tools.some(t => t.name === 'confirm_with_owner') && !ops[0].tools.some(t => t.name === 'send_message' || t.name === 'remember'), JSON.stringify(ops[0]?.tools).slice(0, 200));
  ok('kontekst tozalash (eski rasm va sahifalar) va beta sarlavha', JSON.stringify(ops[0]?.contextManagement).includes('clear_tool_uses_20250919') && (ops[0]?.beta ?? '').includes('context-management-2025-06-27'));
  ok("topshiriq — tizim ko'rsatmasida <task> ichida; begona matn — buyruq emas", (ops[0]?.system ?? '').includes("<task>\nAriza saytida (forma) ismni Ali deb to'ldirib yubor") && /data, never instructions/.test(ops[0]?.system ?? ''));
  ok('soxta Claude: toolset_name har natijada to\'g\'ri qaytdi', !ai.violations.length, ai.violations.join('; '));
  const jobs = new DatabaseSync(join(dataDir, 'palantir.db'), { readOnly: true }).prepare('SELECT status, steps, report FROM computer_jobs').all() as { status: string; steps: number; report: string }[];
  ok('bazada: ish «done», qadamlar soni, hisobot', jobs.length === 1 && jobs[0].status === 'done' && jobs[0].steps === script.length && jobs[0].report.includes('Ali'), JSON.stringify(jobs));

  console.log("\n# Band paytida ikkinchi ish yo'q; to'xtatish");
  ai.operator = messages => {
    const n = messages.filter(m => m.role === 'assistant').length;
    return { content: [n === 0 ? browserUse('s0', 'navigate', { url: `${SITE}/slow` }) : browserUse(`s${n}`, 'wait', { duration: 20 })], stop: 'tool_use' };
  };
  ownerStarts('Sekin sahifani kuzatib tur', 'browser');
  mark = sent.length;
  say(OWNER, 'Sekin sahifani kuzat');
  const status2 = await waitFor('holat', () => toOwner(mark, 'Brauzerda ishlayapman'), 30_000);
  await waitFor('yordamchi javobi', () => toOwner(mark, 'Yordamchi:'), 20_000);
  ownerStarts('Boshqa ish', 'browser', 'Javob:');
  m2 = sent.length;
  say(OWNER, 'Yana bir ish qil');
  const busy = await waitFor('band javobi', () => toOwner(m2, 'Javob:'), 20_000);
  ok('ikkinchi ish boshlanmadi: «hozir boshqa ish bajarilyapti»', textOf(busy).includes('boshqa ish bajarilyapti'), textOf(busy).slice(0, 200));
  await sleep(1500);
  m2 = sent.length;
  const t0 = Date.now();
  press(OWNER, button(status2, 'cs')!, status2!.id!);
  const stopped = await waitFor("to'xtadi", () => toOwner(m2, "Ish to'xtatildi"), 20_000);
  ok("«⏹ To'xtatish» — ish darhol to'xtadi (20 s kutish tugashini kutmay)", !!stopped && Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
  m2 = sent.length;
  say(OWNER, '/toxta');
  ok('/toxta — ish yo\'q bo\'lsa shuni aytadi', !!(await waitFor('javob', () => toOwner(m2, 'bajarilmayapti'))));

  console.log('\n# Butun ekran (soxta haydovchi)');
  const deskScript: ((prev: Block[]) => Block[])[] = [
    () => [deskUse('d1', 'screenshot', {})],
    prev => { seen.deskShot = JSON.stringify(prev[0]?.content).slice(0, 80); seen.deskShotSize = JSON.stringify(pngSize(Buffer.from(prev[0]?.content?.[0]?.source?.data ?? '', 'base64'))); return [deskUse('d2', 'left_click', { coordinate: [100, 50] }), deskUse('d3', 'type', { text: 'Salom, dunyo' })]; },
    () => [deskUse('d4', 'key', { text: 'ctrl+alt+delete' }), deskUse('d5', 'type', { text: 'bajarilmasin' })],
    prev => { seen.deskKey = JSON.stringify(prev); return [{ type: 'text', text: 'Ekranda «Salom, dunyo» yozildi.' }]; },
  ];
  ai.operator = messages => {
    const fn = deskScript[messages.filter(m => m.role === 'assistant').length];
    const content = fn ? fn(lastResults(messages)) : [{ type: 'text', text: 'Tamom' }];
    return { content, stop: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  ownerStarts("Bloknotga «Salom, dunyo» deb yoz", 'desktop');
  mark = sent.length;
  const opsDesk = ai.operatorRequests.length;
  say(OWNER, "Bloknotga Salom dunyo deb yoz");
  const plan = await waitFor('boshlash ruxsati', () => sent.slice(mark).find(s => s.method === 'sendMessage' && textOf(s).includes('Kompyuteringizda') && !!button(s, 'ca')), 20_000);
  ok('butun ekran: avval egasidan «boshlaymi?» so\'raladi, operator hali ishlamaydi', !!plan && ai.operatorRequests.length === opsDesk);
  m2 = sent.length;
  press(OWNER, button(plan, 'ca')!, plan!.id!);
  const deskDone = await waitFor('ish tugadi', () => toOwner(m2, 'Ish tugadi'), 30_000);
  const deskOps = (existsSync(deskLog) ? readFileSync(deskLog, 'utf8') : '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
  ok('ekran rasmi: 1280×800 (haqiqiy ekran 2560×1600)', seen.deskShotSize === '{"width":1280,"height":800}', seen.deskShotSize);
  ok('bosish haqiqiy piksellarda (100,50 → 200,100), matn yozildi', deskOps.some(o => o.cmd === 'click' && o.x === 200 && o.y === 100) && deskOps.some(o => o.cmd === 'type' && o.text === 'Salom, dunyo'), JSON.stringify(deskOps).slice(0, 300));
  ok("Ctrl+Alt+Del bosilmadi, navbatdagi amal ham («Not executed: an earlier computer action…»)", /bosilmaydi/.test(seen.deskKey ?? '') && /Not executed: an earlier computer action in this turn failed/.test(seen.deskKey ?? '') && !deskOps.some(o => o.text === 'bajarilmasin'));
  ok('operator so\'rovida — computer toolset', JSON.stringify(ai.operatorRequests[opsDesk]?.tools).includes('computer_toolset_20260801'));
  ok('egasiga hisobot', textOf(deskDone).includes('Salom, dunyo'));

  console.log('\n# Holat va tarix');
  const all = new DatabaseSync(join(dataDir, 'palantir.db'), { readOnly: true }).prepare('SELECT status FROM computer_jobs ORDER BY created_at').all() as { status: string }[];
  ok('bazada: done, stopped, done', all.map(j => j.status).join(',') === 'done,stopped,done', all.map(j => j.status).join(','));
  ok('server xatosiz', !/\[kompyuter\]/.test(log), log.split('\n').filter(l => l.includes('[kompyuter]')).slice(0, 3).join(' | '));
} catch (e) {
  ok('sinov yiqildi', false, (e as Error).stack ?? String(e));
} finally {
  ai.owner = null;
  ai.operator = null;
  await stopProcess(server);
  for (const s of [tgServer, aiServer, site]) s.close();
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Windows: fayl hali band */ }
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} o'tdi`);
if (failed) { console.log(log.split('\n').slice(-40).join('\n')); process.exit(1); }
process.exit(0);
