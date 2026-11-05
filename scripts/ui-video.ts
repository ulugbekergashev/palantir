/**
 * Kontent-meyker studiyasi haqiqiy panelda (ko'rinmas brauzer):  npm run build && npm run test:ui-video
 * Brend-buk anketasi → «Brend-buk yaratish» (to'liq brend-tizim, diktor almashtirish) → Reja → mavzudan «Video» → ssenariy va
 * ovoz → «Yuklab olish» (brauzerda yozilgan video).
 * AI o'rnida soxta Anthropic (javob — tizim ko'rsatmasiga qarab), Gemini TTS o'rnida soxta server (har sahnaga xom PCM ovoz).
 * Yuklangan video va skrinshotlar saqlanadi (yo'li oxirida): kadrlarni ko'z bilan tekshirish uchun.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { json, listen, readBody, sleep, stopProcess } from './fakes';
import { chromePath } from './chrome';

/** Kadr vaqtlari (ffprobe bor bo'lsa: FFMPEG_PATH yonida yoki PATH'da) — kadr tushib qolishini o'lchash uchun */
function probeFrames(file: string): number[] | null {
  const near = process.env.FFMPEG_PATH ? join(dirname(process.env.FFMPEG_PATH), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : '';
  for (const bin of [near, 'ffprobe'].filter(Boolean)) {
    const r = spawnSync(bin, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/).map(Number);
  }
  return null;
}

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const BOOK = {
  name: "Ulug'bek Ergashev", positioning: 'Biznesga AI xodim quraman — o\'zbek tilida, ishni oxirigacha qiladigan', tagline: 'Biznesga AI xodim',
  values: ['Amaliy natija', 'Halollik'], voice: ['Qisqa gaplar', '«Siz» bilan', 'Har fikrga bitta misol'], banned: ['inqilob', 'eng zo\'r'],
  colors: { bg: '#0E6B66', deep: '#0A524E', surface: '#FBF8F1', ink: '#16337A', accent: '#F4B63F', muted: '#9FB8B5' },
  motif: "Koshin plitkalari: har ish — bitta plitka, birga — naqsh", font: 'Unbounded',
  pillars: [{ name: 'AI amaliyotda', share: 40, about: 'Real misollar' }, { name: 'Qurilish jurnali', share: 30, about: 'Palantir va DentaCRM' }, { name: 'Saboqlar', share: 30, about: 'Startap' }],
  dont: ['Robot rasmlari', "Va'dalar"],
  essence: 'Halol AI xodim', promise: 'Takroriy ishni AI xodim qiladi — siz mijozga vaqt ajratasiz',
  archetype: { name: 'Donishmand', why: 'Avval sinaydi, keyin oddiy tilda tushuntiradi' }, story: "Palantir'ni avval o'zim uchun qurdim.",
  personas: [{ name: 'Band klinika egasi', who: '2 filial, qabulxona yetishmaydi', pains: ["Kechqurun qo'ng'iroqqa hech kim javob bermaydi"], wants: ["Bemor yo'qolmasin"], objections: ["AI o'zbekcha tushunmaydi"] }],
  messages: [{ message: 'AI xodim ishlaydi, chatbot gapiradi', proof: 'Jonli namoyish' }], difference: ["Chatbot o'rniga — qabulga yozadigan xodim"],
  traits: [{ trait: 'Halol', is: 'Sinalmaganini aytadi', isNot: "Va'da bermaydi" }], examples: [{ bad: 'Inqilobiy AI yechim!', good: "AI xodim kechki qo'ng'iroqqa javob beradi." }],
  words: ['AI xodim'], hooks: ['Narxi qancha?', "Kechki qo'ng'iroq javobsiz qoldi"], ctas: ["Telegram'ga «demo» deb yozing"],
  formats: [{ name: "O'zimda sinadim", how: 'Muammo → sinov → natija' }], bio: "Biznesga AI xodim quraman. O'zbek tilida.",
  visualRules: ['Matn faqat plitkada'], motion: 'Plitkalar yuqoridan tushadi', narrator: 'Charon',
};
const PLAN = { items: Array.from({ length: 10 }, (_, i) => ({ pillar: BOOK.pillars[i % 3].name, title: i ? `Mavzu ${i + 1}` : 'AI xodim — bu chatbot emas', angle: 'Mijoz «Narxi qancha?» deb yozadi — chatbot javob beradi va tamom, AI xodim qabulga yozadi.' })) };
const SCRIPT = {
  scenes: [
    { kind: 'hook', text: 'Narxi qancha?', voice: 'Mijoz yozdi: narxi qancha? Chatbot javob berdi va tamom.' },
    { kind: 'point', text: 'Javob berdi', voice: 'AI xodim esa javob beradi,' },
    { kind: 'point', text: 'Qabulga yozdi', voice: 'qabulga yozib qo\'yadi,' },
    { kind: 'point', text: 'Ertasi eslatdi', voice: 'ertasi kuni eslatadi.' },
    { kind: 'claim', text: 'Chatbot gapiradi. AI xodim ishlaydi.', voice: 'Chatbot gapiradi. AI xodim ishlaydi.' },
    { kind: 'sign', text: "Ulug'bek Ergashev", voice: 'Biznesga AI xodim quraman.' },
  ],
};

// ─── Soxta Anthropic ──────────────────────────────────────────────────────────
const asked: string[] = [];
const aiServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as { system: string; model: string };
  const sys = String(body.system);
  asked.push(sys.slice(0, 40));
  const text = sys.startsWith('You are a senior brand strategist') ? `Mana brend-buk:\n\`\`\`json\n${JSON.stringify(BOOK)}\n\`\`\``
    : sys.startsWith('You plan content') ? JSON.stringify(PLAN)
    : sys.startsWith('You write scripts') ? JSON.stringify(SCRIPT)
    : sys.startsWith('You are the content maker') ? '### POST 1\n🤖 AI xodim — bu chatbot emas\n\nMatn.'
    : sys.startsWith('You write Instagram post captions') ? '### CAPTION\nAI xodim — bu chatbot emas 🤖\nDirect\'ga «demo» deb yozing.\n#aixodim\n### PICTURE\nA calm desk with a laptop and ceramic tiles, teal and gold tones'
    : 'OK';
  json(res, { id: `msg_${asked.length}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } });
});

// ─── Soxta Gemini TTS: har sahnaga matn uzunligicha xom PCM (24 kHz), atrofida jimlik ──────
const PER_CHAR = 0.055;
function pcm(seconds: number): Buffer {
  const rate = 24000, n = Math.floor(seconds * rate), data = Buffer.alloc(n * 2), pad = Math.floor(0.2 * rate);
  for (let i = pad; i < n - pad; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000 * (Math.floor(i / (rate / 4)) % 2 ? 1 : 0.4)), i * 2);
  return data;
}
const spoken: string[] = [];
const voices: string[] = [];
/** Gemini chizgan rasmlar (Instagram posti): so'rov matni va tomonlar nisbati */
const drawn: { prompt: string; aspect: string }[] = [];
const PICTURE = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=864x1080', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { maxBuffer: 20e6 }).stdout as Buffer;
const geminiServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as { input: { content: { text: string }[] }[]; generation_config: { speech_config: { voice: string }[] }; response_format?: { type?: string; aspect_ratio?: string } };
  const text = body.input[0].content[0].text;
  if (body.response_format?.type === 'image') {
    drawn.push({ prompt: text, aspect: String(body.response_format.aspect_ratio) });
    return json(res, { steps: [{ content: [{ type: 'image', mime_type: 'image/jpeg', data: PICTURE.toString('base64') }] }] });
  }
  spoken.push(text);
  voices.push(body.generation_config.speech_config[0].voice);
  json(res, { steps: [{ content: [{ type: 'audio', mime_type: 'audio/l16', data: pcm([...text].length * PER_CHAR + 0.4).toString('base64') }] }] });
});

const aiPort = await listen(aiServer);
const geminiPort = await listen(geminiServer);
const work = mkdtempSync(join(tmpdir(), 'palantir-ui-video-'));
const shots = join(tmpdir(), 'palantir-ui-video-shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const PORT = 3291, base = `http://127.0.0.1:${PORT}`;
let log = '';
const server: ChildProcess = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', VIDEO_RENDER: 'off', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: join(work, 'data'), ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
    BOT_TOKEN: '', ANTHROPIC_API_KEY: 'sk-ant-sinov-kaliti-ui-video-0000000000000000', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, AI_ENGINE: 'api', WEB_SEARCH: '0',
    ELEVENLABS_API_KEY: '', GEMINI_API_KEY: `AIza${'x'.repeat(35)}`, GEMINI_API_ROOT: `http://127.0.0.1:${geminiPort}`, GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', ADMIN_PASSWORD: '', SESSION_SECRET: 'ui-video-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout!.on('data', d => { log += d; });
server.stderr!.on('data', d => { log += d; });
process.on('exit', () => server.kill());
const up = async (url: string) => { for (let i = 0; i < 240; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* hali */ } await sleep(250); } return false; };
const post = (body: unknown, token?: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
let n = 0;
const shot = (p: Page, name: string) => p.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
let videoPath = '';

try {
  ok('Palantir ishga tushdi', await up(`${base}/api/health`));
  const setup = await (await fetch(`${base}/api/login/setup`, post({}))).json() as { token: string };
  const given = await (await fetch(`${base}/api/handover`, post({ login: 'ulugbek' }, setup.token))).json() as { password: string };
  // Yangi profilda jamoa — Direktor va Yordamchi; Kontent-meyker «AI xodimlar»dan olinadi
  const owner = await (await fetch(`${base}/api/login`, post({ login: 'ulugbek', password: given.password }))).json() as { token: string };
  ok("Kontent-meyker jamoaga olindi (standart jamoada yo'q)", (await fetch(`${base}/api/crew`, post({ member: 'kontent', on: true }, owner.token))).ok);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/#/`);
  await page.getByLabel('Login').fill('ulugbek');
  await page.getByLabel('Parol').fill(given.password);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForFunction(() => !document.querySelector('h1')?.textContent?.includes('Kabinetga kirish'), null, { timeout: 15_000 });

  console.log('\n# Brend-buk (kompaniyaniki — Miya → Brend)');
  await page.goto(`${base}/#/miya/brend`);
  ok("brend-buk Miya'da: «Brend» varag'i tanlangan", await page.locator('nav[aria-label="Varaqlar"]').getByRole('link', { name: 'Brend', exact: true }).getAttribute('aria-current') === 'page');
  await page.getByRole('radio', { name: 'Shaxsiy brendim' }).click();
  await page.getByLabel('Nima qilasiz?').fill('Biznesga AI xodim quraman');
  await shot(page, 'brend-anketa');
  await page.getByRole('button', { name: 'Brend-buk yaratish' }).click();
  await page.getByText(BOOK.positioning).first().waitFor({ timeout: 20_000 });
  const main = (await page.locator('main').textContent()) ?? '';
  ok("brend-buk ko'rsatildi: pozitsiya, ranglar, ustunlar", main.includes('#F4B63F') && (await page.getByText('AI amaliyotda').count()) > 0);
  ok("to'liq brend-tizim: auditoriya, ovoz namunasi, ilgaklar, bio", ['Band klinika egasi', 'Inqilobiy AI yechim!', "Kechki qo'ng'iroq javobsiz qoldi", 'Biznesga AI xodim quraman. O\'zbek tilida.'].every(x => main.includes(x)));
  ok('diktor: brend-bukdagisi tanlangan', (await page.getByRole('radio', { name: /^Charon/ }).getAttribute('aria-checked')) === 'true');
  await page.getByRole('radio', { name: /^Orus/ }).click();
  await page.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent?.startsWith('Orus'), null, { timeout: 10_000 });
  ok('diktor almashtirildi (Orus)', true);
  await shot(page, 'brend-buk');

  console.log('\n# Reja');
  await page.goto(`${base}/#/marketolog/reja`);
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Reja tuzish' }).click();
  await page.getByText('AI xodim — bu chatbot emas').first().waitFor({ timeout: 20_000 });
  ok('reja: 10 ta mavzu', (await page.locator('ol > li').count()) === 10);
  await page.getByRole('button', { name: 'Telegram', exact: true }).first().click();
  await page.getByRole('link', { name: 'Telegram posti bor' }).first().waitFor({ timeout: 20_000 });
  ok('mavzudan Telegram kanal posti yozildi', true);
  await page.getByRole('button', { name: 'Instagram', exact: true }).first().click();
  await page.getByRole('link', { name: 'Instagram posti bor' }).first().waitFor({ timeout: 20_000 });
  ok("o'sha mavzudan Instagram posti: matn yozildi, rasm Gemini'da 4:5 da, brend ranglari bilan va yozuvsiz chizildi",
    drawn.length === 1 && drawn[0].aspect === '4:5' && drawn[0].prompt.includes('ceramic tiles') && drawn[0].prompt.includes('#F4B63F') && drawn[0].prompt.includes('No text'), JSON.stringify(drawn));
  await page.getByRole('button', { name: 'Video' }).first().click();
  await page.getByRole('link', { name: 'Video bor' }).first().waitFor({ timeout: 30_000 });
  ok('mavzudan video ssenariysi va ovozi tayyorlandi', true);
  await shot(page, 'reja');
  ok("diktorga «AI» emas «ey-ay» bordi", spoken.some(t => t.includes('ey-ay xodim')) && !spoken.some(t => /\bAI\b/.test(t)), spoken.join(' | ').slice(0, 80));
  ok('har sahna alohida o\'qildi, tanlangan diktor bilan', spoken.length === SCRIPT.scenes.length && voices.every(v => v === 'Orus'), `${spoken.length} so'rov, ${[...new Set(voices)].join(',')}`);

  console.log('\n# Postlar: Telegram kanal va Instagram — bitta varaqda');
  await page.goto(`${base}/#/marketolog/instagram`);
  await page.getByText('rasm — Gemini').first().waitFor({ timeout: 20_000 });
  ok("Kontent-meyker → Postlar → Instagram: qoralama rasmi bilan, «Instagram'ga joylash» tugmasi (egasi bosmaguncha chiqmaydi)",
    await page.getByText("AI xodim — bu chatbot emas 🤖").first().isVisible() && await page.getByRole('button', { name: "Instagram'ga joylash" }).first().isVisible()
    && await page.getByRole('img', { name: /^AI rasmi/ }).first().isVisible());
  ok("«Postlar» varag'i tanlangan, almashtirgichda «Instagram» — 1 ta kutyapti", await page.locator('nav[aria-label="Varaqlar"]').getByRole('link', { name: /^Postlar/ }).getAttribute('aria-current') === 'page'
    && /Instagram\s*1/.test((await page.locator('nav[aria-label="Qayerga"]').getByRole('link', { name: /Instagram/ }).textContent()) ?? ''));
  await shot(page, 'postlar-instagram');
  await page.locator('nav[aria-label="Qayerga"]').getByRole('link', { name: /Telegram kanal/ }).click();
  await page.getByText('🤖 AI xodim — bu chatbot emas').first().waitFor({ timeout: 10_000 });
  ok("almashtirgich: «Telegram kanal» — kanal qoralamalari", page.url().endsWith('#/marketolog/telegram'));

  console.log('\n# Video');
  await page.goto(`${base}/#/marketolog/video`);
  await page.getByText(/Ovoz tayyor · \d+ s/).waitFor({ timeout: 15_000 });
  await sleep(800);
  await shot(page, 'video-karta');
  ok('brauzer mp4 ni kadrma-kadr yig\'a oladi (WebCodecs)', await page.evaluate(() => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined'));
  const download = page.waitForEvent('download', { timeout: 90_000 });
  const began = Date.now();
  await page.getByRole('button', { name: 'Yuklab olish' }).click();
  const d = await download;
  videoPath = join(shots, d.suggestedFilename());
  await d.saveAs(videoPath);
  const size = statSync(videoPath).size;
  ok('video fayli yuklab olindi', size > 50_000 && d.suggestedFilename().endsWith('.mp4'), `${d.suggestedFilename()} · ${Math.round(size / 1024)} KB · ${((Date.now() - began) / 1000).toFixed(1)} s`);
  const frames = probeFrames(videoPath);
  if (frames) {
    const gap = Math.max(...frames.slice(1).map((t, i) => t - frames[i]));
    ok("videoda kadr tushib qolmagan (30 kadr/s, bo'shliqsiz)", gap < 0.05 && frames.length > 25 * frames.at(-1)!, `${frames.length} kadr, ${frames.at(-1)!.toFixed(1)} s, eng katta oraliq ${gap.toFixed(3)} s`);
  } else console.log('  · ffprobe topilmadi — kadrlar tekshirilmadi');
  await shot(page, 'video-yozilgandan-keyin');
  ok("sahifada xato yo'q", !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok('sinov oxirigacha bordi', false, (e as Error).message.split('\n')[0]);
  console.log(log.slice(-3000));
} finally {
  await browser.close();
  await stopProcess(server);
  aiServer.close();
  geminiServer.close();
}

console.log(`\nSkrinshotlar: ${shots}${videoPath ? `\nVideo: ${videoPath}` : ''}`);
const bad = results.filter(r => !r).length;
console.log(bad ? `${bad} ta tekshiruv yiqildi` : "Hammasi o'tdi");
await sleep(100);
process.exit(bad ? 1 : 0);
