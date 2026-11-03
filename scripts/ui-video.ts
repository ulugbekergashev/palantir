/**
 * Kontent-meyker studiyasi haqiqiy panelda (ko'rinmas brauzer):  npm run build && npm run test:ui-video
 *   Brend-buk anketasi → «Brend-buk yaratish» → Reja → mavzudan «Video» → ssenariy va ovoz → «Yuklab olish» (brauzerda yozilgan video).
 * AI o'rnida soxta Anthropic (javob — tizim ko'rsatmasiga qarab), ElevenLabs o'rnida soxta server (WAV ovoz va harf vaqtlari).
 * Yuklangan video va skrinshotlar saqlanadi (yo'li oxirida): kadrlarni ko'z bilan tekshirish uchun.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { json, listen, readBody, sleep, stopProcess } from './fakes';
import { chromePath } from './chrome';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const BOOK = {
  name: "Ulug'bek Ergashev", positioning: 'Biznesga AI xodim quraman — o\'zbek tilida, ishni oxirigacha qiladigan', tagline: 'Biznesga AI xodim',
  values: ['Amaliy natija', 'Halollik'], voice: ['Qisqa gaplar', '«Siz» bilan', 'Har fikrga bitta misol'], banned: ['inqilob', 'eng zo\'r'],
  colors: { bg: '#0E6B66', deep: '#0A524E', surface: '#FBF8F1', ink: '#16337A', accent: '#F4B63F', muted: '#9FB8B5' },
  motif: "Koshin plitkalari: har ish — bitta plitka, birga — naqsh", font: 'Unbounded',
  pillars: [{ name: 'AI amaliyotda', share: 40, about: 'Real misollar' }, { name: 'Qurilish jurnali', share: 30, about: 'Palantir va DentaCRM' }, { name: 'Saboqlar', share: 30, about: 'Startap' }],
  dont: ['Robot rasmlari', "Va'dalar"],
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
  const text = sys.startsWith('You are a brand strategist') ? `Mana brend-buk:\n\`\`\`json\n${JSON.stringify(BOOK)}\n\`\`\``
    : sys.startsWith('You plan content') ? JSON.stringify(PLAN)
    : sys.startsWith('You write scripts') ? JSON.stringify(SCRIPT)
    : sys.startsWith('You are the content maker') ? '### POST 1\n🤖 AI xodim — bu chatbot emas\n\nMatn.'
    : 'OK';
  json(res, { id: `msg_${asked.length}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } });
});

// ─── Soxta ElevenLabs: matn uzunligicha ovoz (WAV, 22 kHz) va harf vaqtlari ──────
const PER_CHAR = 0.055;
function wav(seconds: number): Buffer {
  const rate = 22050, n = Math.floor(seconds * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000 * (Math.floor(i / (rate / 4)) % 2)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const spoken: string[] = [];
const elevenServer = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as { text: string };
  spoken.push(body.text);
  const chars = [...body.text];
  json(res, {
    audio_base64: wav(chars.length * PER_CHAR + 0.2).toString('base64'),
    alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * PER_CHAR), character_end_times_seconds: chars.map((_, i) => (i + 1) * PER_CHAR) },
  });
});

const aiPort = await listen(aiServer);
const elevenPort = await listen(elevenServer);
const work = mkdtempSync(join(tmpdir(), 'palantir-ui-video-'));
const shots = join(tmpdir(), 'palantir-ui-video-shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const PORT = 3291, base = `http://127.0.0.1:${PORT}`;
let log = '';
const server: ChildProcess = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: join(work, 'data'), ONE_PROFILE: '1', HUB_AUTO: '0', PALANTIR_HUB: '',
    BOT_TOKEN: '', ANTHROPIC_API_KEY: 'sk-ant-sinov-kaliti-ui-video-0000000000000000', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${aiPort}`, AI_ENGINE: 'api', WEB_SEARCH: '0',
    ELEVENLABS_API_KEY: `sk_${'ab'.repeat(24)}`, ELEVENLABS_URL: `http://127.0.0.1:${elevenPort}`,
    GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', ADMIN_PASSWORD: '', SESSION_SECRET: 'ui-video-secret', MORNING_HOUR: '99', EVENING_HOUR: '99', BACKUP_KEEP: '0',
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/#/`);
  await page.getByLabel('Login').fill('ulugbek');
  await page.getByLabel('Parol').fill(given.password);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForFunction(() => !document.querySelector('h1')?.textContent?.includes('Kabinetga kirish'), null, { timeout: 15_000 });

  console.log('\n# Brend-buk');
  await page.goto(`${base}/#/marketolog/brend`);
  await page.getByRole('radio', { name: 'Shaxsiy brendim' }).click();
  await page.getByLabel('Nima qilasiz?').fill('Biznesga AI xodim quraman');
  await shot(page, 'brend-anketa');
  await page.getByRole('button', { name: 'Brend-buk yaratish' }).click();
  await page.getByText(BOOK.positioning).first().waitFor({ timeout: 20_000 });
  ok("brend-buk ko'rsatildi: pozitsiya, ranglar, ustunlar", (await page.locator('main').textContent())?.includes('#F4B63F') && (await page.getByText('AI amaliyotda').count()) > 0);
  await shot(page, 'brend-buk');

  console.log('\n# Reja');
  await page.goto(`${base}/#/marketolog/reja`);
  page.once('dialog', d => void d.accept());
  await page.getByRole('button', { name: 'Reja tuzish' }).click();
  await page.getByText('AI xodim — bu chatbot emas').first().waitFor({ timeout: 20_000 });
  ok('reja: 10 ta mavzu', (await page.locator('ol > li').count()) === 10);
  await page.getByRole('button', { name: 'Post' }).first().click();
  await page.getByRole('link', { name: 'Post tayyor' }).first().waitFor({ timeout: 20_000 });
  ok('mavzudan post qoralamasi yozildi', true);
  await page.getByRole('button', { name: 'Video' }).first().click();
  await page.getByRole('link', { name: 'Video bor' }).first().waitFor({ timeout: 30_000 });
  ok('mavzudan video ssenariysi va ovozi tayyorlandi', true);
  await shot(page, 'reja');
  ok("diktorga «AI» emas «ey-ay» bordi", spoken.at(-1)?.includes('ey-ay xodim') && !/\bAI\b/.test(spoken.at(-1) ?? ''), spoken.at(-1)?.slice(0, 60));

  console.log('\n# Video');
  await page.goto(`${base}/#/marketolog/video`);
  await page.getByText(/Ovoz tayyor · \d+ s/).waitFor({ timeout: 15_000 });
  await sleep(800);
  await shot(page, 'video-karta');
  const mime = await page.evaluate(() => ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) ?? null);
  ok('brauzer videoni yoza oladi', !!mime, mime ?? '');
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Yuklab olish' }).click();
  const d = await download;
  videoPath = join(shots, d.suggestedFilename());
  await d.saveAs(videoPath);
  const size = statSync(videoPath).size;
  ok('video fayli yuklab olindi', size > 50_000, `${d.suggestedFilename()} · ${Math.round(size / 1024)} KB`);
  await shot(page, 'video-yozilgandan-keyin');
  ok("sahifada xato yo'q", !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  ok('sinov oxirigacha bordi', false, (e as Error).message.split('\n')[0]);
  console.log(log.slice(-3000));
} finally {
  await browser.close();
  await stopProcess(server);
  aiServer.close();
  elevenServer.close();
}

console.log(`\nSkrinshotlar: ${shots}${videoPath ? `\nVideo: ${videoPath}` : ''}`);
const bad = results.filter(r => !r).length;
console.log(bad ? `${bad} ta tekshiruv yiqildi` : "Hammasi o'tdi");
await sleep(100);
process.exit(bad ? 1 : 0);
