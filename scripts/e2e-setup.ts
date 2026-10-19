/**
 * Ulash ustasi sinovi — haqiqiy kalitsiz va pulsiz:
 *   sof qoidalar (kalit turini aniqlash, narx ziddiyatlari, ish vaqti, «Biznes haqida» qatorlari, ONVIF javoblari);
 *   server kalitlarsiz yoqiladi → kalitlar panelda kiritiladi (soxta Telegram, Claude, Gemini) → server to'xtamasdan ishlaydi →
 *   qayta yoqilganda kalitlar joyida (bazada shifrlangan); anketa: yaratish, to'ldirish, kod bilan yuklash;
 *   bo'shliqlar egasidan Telegram'da tugmalar bilan so'raladi; botga yozilgan token o'chiriladi; kamera tarmoqdan topiladi va ulanadi.
 * Ishga tushirish: npm run test:setup
 */
process.env.TZ = 'Asia/Tashkent';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer as createTcp } from 'node:net';
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLine, classifyText, containsSecret, maskSecret } from '../src/lib/secrets';
import { emptyAnketa, hoursText, missingDays, cleanCode } from '../src/lib/anketa';
import { parsePrices, splitConflicts } from '../src/lib/prices';
import { setAboutLine } from '../server/setup/about';
import { brandOf, candidatePaths, parseProbeMatch, pickProfile, withCredentials, wsSecurity } from '../server/camera/discover';
import { OWNER, json, listen, press, readBody, say, sent, sleep, tgServer, waitFor, type Sent } from './fakes';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => {
  results.push(!!cond);
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`);
};

// ─── Sof qoidalar ─────────────────────────────────────────────────────────────
const BOT = '7412589630:AAHk3vQx9LmP2wZr8TnB4yCd6fGh1JsK0eQ';
const CLAUDE = 'sk-ant-api03-Xr7bN2kQp9LmW4zT8vY1cD6fH3jS0aE5gU';
const GEMINI = 'AIzaSyB7xK2mQ9pL4wT8vR1nC6dF3hJ0sE5gU2y';

console.log('\n# Kalit turini aniqlash (AI\'siz)');
ok('bot tokeni', classifyLine(BOT)?.key === 'BOT_TOKEN' && !classifyLine(BOT)?.error);
ok('chala bot tokeni — sababi bilan', /35 belgi/.test(classifyLine('7412589630:AAHk3vQx9')?.error ?? ''), classifyLine('7412589630:AAHk3vQx9')?.error);
ok('Claude, Gemini, Groq kalitlari', classifyLine(CLAUDE)?.key === 'ANTHROPIC_API_KEY' && classifyLine(GEMINI)?.key === 'GEMINI_API_KEY' && classifyLine(`gsk_${'a'.repeat(52)}`)?.key === 'GROQ_API_KEY');
ok('chala Gemini kaliti — xato', !!classifyLine('AIzaSyB7xK2')?.error);
ok('Telegram API hash (32 hex)', classifyLine('0123456789abcdef0123456789abcdef')?.key === 'TG_API_HASH');
ok("Cerebro Hub kodi: «chub.» — tanildi; chala kod — sababi bilan", classifyLine(`chub.aHR0cHM6Ly9odWIuZXhhbXBsZS51eg.a1b2c3d4e5.${'k'.repeat(32)}`)?.key === 'CEREBRO_HUB' && !classifyLine(`chub.aHR0cHM6Ly9odWIuZXhhbXBsZS51eg.a1b2c3d4e5.${'k'.repeat(32)}`)?.error
  && !!classifyLine('chub.abc')?.error);
ok('kamera, DentaCRM, Instagram, telefon', classifyLine('rtsp://admin:p@192.168.1.64:554/x')?.kind === 'rtsp' && classifyLine('https://shifo.dentacrm.uz')?.kind === 'crm'
  && classifyLine('instagram.com/shifodent')?.kind === 'instagram' && classifyLine('+998 90 123 45 67')?.kind === 'phone');
ok('tanilmagan qator — unknown', classifyLine('Klinika2026!')?.kind === 'unknown');
ok('ichki tarmoqdagi oflayn DentaCRM manzili ham taniladi', classifyLine('http://192.168.1.10:3001')?.kind === 'crm');
ok("bir nechta qator: bo'sh va takror tashlanadi", classifyText(`${BOT}\n\n${BOT}\n${CLAUDE}`).length === 2);
ok("ko'rsatishda yashiriladi: bot raqami va oxirgi 4 belgi", maskSecret(BOT) === '7412589630:••••K0eQ' && maskSecret(CLAUDE) === '••••E5gU' && maskSecret('rtsp://admin:parol@1.2.3.4/x') === 'rtsp://admin:••••@1.2.3.4/x', maskSecret(BOT));
ok('token «bot…» va api.telegram.org havolasi ichida ham topiladi', containsSecret(`bot${BOT}`) && containsSecret(`https://api.telegram.org/bot${BOT}/getMe`));
ok('suhbat ichida kalit topiladi', containsSecret(`mana token ${BOT} shu`) && containsSecret('rtsp://admin:12345@192.168.1.64/x') && !containsSecret('ertaga 10:00 da qo\'ng\'iroq'));

console.log('\n# Anketa va narxlar (sof)');
const twice = splitConflicts(parsePrices("Tish tozalash — 250 000\nPlomba — 350 000\nTish tozalash — 300 000\nPlomba — 350 000").items);
ok("bitta xizmatga ikki narx — ziddiyat, bir xil takror — ziddiyat emas", twice.conflicts.length === 1 && twice.conflicts[0].prices.join() === '250000,300000' && twice.clean.length === 1, JSON.stringify(twice));
const h = { ...emptyAnketa().hours, mon: '09:00–19:00', tue: '09:00–19:00', wed: '09:00–19:00', thu: '09:00–19:00', fri: '09:00–19:00', sun: 'yopiq' };
ok('ish vaqti bitta qatorda (kunlar birlashadi)', hoursText(h) === 'Du–Ju 09:00–19:00, Ya dam olish', hoursText(h));
ok('yozilmagan kunlar', missingDays(h).join() === 'sat');
ok('anketa kodi: harf-raqam aralash yozilsa ham tozalanadi', cleanCode('k7qm 2xpa') === 'K7QM-2XPA');
ok('«Biznes haqida»: qator almashadi, yangi qator aloqa qatorlari yoniga', setAboutLine('Matn\n\n- Telefon: 1\n\n## Jamoa\n- A', 'Manzil', 'X') === 'Matn\n\n- Telefon: 1\n- Manzil: X\n\n## Jamoa\n- A'
  && setAboutLine('- Manzil: eski', 'Manzil', 'yangi') === '- Manzil: yangi' && setAboutLine('', 'Manzil', 'X') === '- Manzil: X');

console.log('\n# Kamera qidiruvi (sof)');
const MATCH = `<?xml version="1.0"?><s:Envelope><s:Body><d:ProbeMatches><d:ProbeMatch><d:Scopes>onvif://www.onvif.org/name/HIKVISION%20DS-2CD1043G0-I onvif://www.onvif.org/hardware/DS-2CD1043G0-I</d:Scopes><d:XAddrs>http://192.168.1.64/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;
const cam = parseProbeMatch(MATCH, '192.168.1.64');
ok('ONVIF javobi: IP, marka, model, boshqaruv manzili', cam?.ip === '192.168.1.64' && cam.brand === 'Hikvision' && cam.model === 'DS-2CD1043G0-I' && cam.onvif === 'http://192.168.1.64/onvif/device_service', JSON.stringify(cam));
const spoof = parseProbeMatch(MATCH.replace('http://192.168.1.64/', 'http://127.0.0.1/'), '192.168.1.77');
ok("ONVIF javobidagi begona IP'ga ishonilmaydi: IP — javob kelgan manzil", spoof?.ip === '192.168.1.77' && spoof.onvif === null, JSON.stringify(spoof));
ok('marka modeldan ham taniladi', brandOf('IPC-HFW1230S') === 'Dahua' && brandOf('noma\'lum') === '');
ok('markaning yo\'llari birinchi, umumiylari keyin', candidatePaths('Dahua')[0].startsWith('/cam/realmonitor') && candidatePaths('').length >= 4);
ok('eng yengil profil tanlanadi', pickProfile('<trt:Profiles token="main"><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></trt:Profiles><trt:Profiles token="sub"><tt:Width>640</tt:Width><tt:Height>360</tt:Height></trt:Profiles>') === 'sub');
ok("parolda @ va : bo'lsa ham manzil buzilmaydi", new URL(withCredentials('rtsp://1.2.3.4:554/x', 'admin', 'a@b:c')).password === 'a%40b%3Ac');
const nonce = Buffer.alloc(16, 7), at = new Date('2026-10-18T10:00:00.000Z');
const expected = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(at.toISOString()), Buffer.from('kamera123')])).digest('base64');
ok('ONVIF imzosi: parol ochiq ketmaydi', wsSecurity('admin', 'kamera123', at, nonce).includes(expected) && !wsSecurity('admin', 'kamera123', at, nonce).includes('kamera123'));

// ─── Soxta xizmatlar ──────────────────────────────────────────────────────────
/** Claude kaliti tekshiruvi: ...bad — o'chirilgan kalit, ...poor — hisobda mablag' yo'q */
const keysServer = createServer(async (req: IncomingMessage, res) => {
  await readBody(req);
  const key = String(req.headers['x-api-key'] ?? req.headers['x-goog-api-key'] ?? req.headers.authorization ?? '');
  if (req.url?.startsWith('/v1/messages')) {
    if (key.endsWith('bad')) return json(res, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    if (key.endsWith('poor')) return json(res, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 400);
    return json(res, { id: 'msg_1', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'O' }], stop_reason: 'max_tokens', usage: { input_tokens: 9, output_tokens: 1 } });
  }
  if (req.url?.startsWith('/v1beta/models') || req.url?.startsWith('/openai/v1/models')) return key.includes('WRONG') ? json(res, { error: { message: 'API key not valid' } }, 400) : json(res, { models: [] });
  json(res, { error: 'not found' }, 404);
});

/** Soxta ONVIF kamera: so'rovga javob beradi, profil va manzilni faqat to'g'ri imzo bilan beradi */
const onvif = { authed: 0, token: '', denied: 0 };
let onvifHttpPort = 0;
const PASSWORD = 'kamera123';
const onvifHttp = createServer(async (req, res) => {
  const body = (await readBody(req)).toString();
  const user = /<Username>([^<]*)</.exec(body)?.[1], digest = /PasswordDigest">([^<]*)</.exec(body)?.[1], n = /Base64Binary">([^<]*)</.exec(body)?.[1], created = /<Created[^>]*>([^<]*)</.exec(body)?.[1];
  const good = user === 'admin' && digest === createHash('sha1').update(Buffer.concat([Buffer.from(n ?? '', 'base64'), Buffer.from(created ?? ''), Buffer.from(PASSWORD)])).digest('base64');
  res.setHeader('content-type', 'application/soap+xml');
  if (!good) { onvif.denied++; res.statusCode = 400; return res.end('<s:Fault><s:Code><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code></s:Fault>'); }
  onvif.authed++;
  const self = `http://127.0.0.1:${onvifHttpPort}/onvif/device_service`;
  if (body.includes('GetCapabilities')) return res.end(`<s:Envelope><s:Body><tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>${self}</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse></s:Body></s:Envelope>`);
  if (body.includes('GetProfiles')) return res.end('<s:Envelope><s:Body><trt:GetProfilesResponse><trt:Profiles token="main" fixed="true"><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></trt:Profiles><trt:Profiles token="sub"><tt:Width>640</tt:Width><tt:Height>360</tt:Height></trt:Profiles></trt:GetProfilesResponse></s:Body></s:Envelope>');
  if (body.includes('GetStreamUri')) {
    onvif.token = /ProfileToken>([^<]*)</.exec(body)?.[1] ?? '';
    return res.end('<s:Envelope><s:Body><trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://192.168.1.64:554/Streaming/Channels/102?transportmode=unicast&amp;profile=Profile_2</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse></s:Body></s:Envelope>');
  }
  res.end('');
});
const onvifUdp = createSocket('udp4');
onvifUdp.on('message', (msg, r) => {
  if (!msg.toString().includes('Probe')) return;
  const reply = `<?xml version="1.0"?><s:Envelope><s:Body><d:ProbeMatches><d:ProbeMatch><d:Scopes>onvif://www.onvif.org/name/HIKVISION onvif://www.onvif.org/hardware/DS-2CD1043G0-I</d:Scopes><d:XAddrs>http://127.0.0.1:${onvifHttpPort}/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;
  onvifUdp.send(reply, r.port, r.address);
});
const rtspPort = createTcp(s => s.destroy());

const tgPort = await listen(tgServer);
const keysPort = await listen(keysServer);
onvifHttpPort = await listen(onvifHttp);
const onvifUdpPort = await new Promise<number>(done => onvifUdp.bind(0, '127.0.0.1', () => done(onvifUdp.address().port)));
const scanPort = await new Promise<number>(done => rtspPort.listen(0, '127.0.0.1', () => done((rtspPort.address() as { port: number }).port)));

const dataDir = mkdtempSync(join(tmpdir(), 'cerebro-setup-'));
const PORT = 3291;
const base = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
let serverLog = '';
async function start(): Promise<void> {
  serverLog = '';
  server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env, DOTENV: '0', ASTERISK_WSL: '0', PORT: String(PORT), LISTEN_HOST: '127.0.0.1', DATA_DIR: dataDir, EVENING_HOUR: '99', BOT_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
      GEMINI_API_KEY: '', GROQ_API_KEY: '', VOICELAB_API_KEY: '', SPEECHLAB_API_KEY: '', TG_API_ID: '', TG_API_HASH: '',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${tgPort}`, ANTHROPIC_BASE_URL: `http://127.0.0.1:${keysPort}`,
      GEMINI_API_ROOT: `http://127.0.0.1:${keysPort}`, GROQ_API_ROOT: `http://127.0.0.1:${keysPort}`,
      ADMIN_PASSWORD: 'admin-pass-1', SESSION_SECRET: 'setup-secret', TICK_MS: '700', BACKUP_KEEP: '0',
      CAMERA_TEST_INPUT: JSON.stringify(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=5']),
      CAMERA_PROBE_TARGETS: `127.0.0.1:${onvifUdpPort}`, CAMERA_SCAN_HOSTS: `127.0.0.1:${scanPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', d => { serverLog += d; });
  server.stderr!.on('data', d => { serverLog += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* hali yo'q */ } await sleep(250); }
}
async function stop(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>(done => { s.once('exit', () => done()); s.kill(); setTimeout(done, 5000); });
}
async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const health = async () => (await api('/api/health')).json as { bot: boolean; ai: boolean; voice: boolean };
const textOf = (s: Sent) => String(s.params.text ?? '');
const toOwner = (mark: number, needle: string) => sent.slice(mark).find(s => s.method === 'sendMessage' && Number(s.params.chat_id) === OWNER && textOf(s).includes(needle));
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();

try {
  await start();

  console.log('\n# Server kalitlari: panelda kiritiladi, server to\'xtamaydi');
  ok('kalitsiz server yondi: bot va AI o\'chiq', !(await health()).bot && !(await health()).ai);
  ok('kalitlar ro\'yxati — faqat admin', (await api('/api/admin/keys')).status === 401);
  const admin = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token as string;
  const keys0 = (await api('/api/admin/keys', { token: admin })).json.keys as { name: string; source: string | null }[];
  ok("ro'yxat: 9 ta kalit (Cerebro Hub kodi bilan), hammasi berilmagan", keys0.length === 9 && keys0.every(k => k.source === null));
  const put = (name: string, value: string, force = false) => api(`/api/admin/keys/${name}`, { method: 'PUT', token: admin, body: { value, force } });
  const wrongShape = await put('BOT_TOKEN', CLAUDE);
  ok("bot tokeni o'rniga Claude kaliti — rad, sababi bilan", wrongShape.status === 400 && /claude/i.test(wrongShape.json.error), wrongShape.json.error);
  const revoked = await put('BOT_TOKEN', `1111111111:${'A'.repeat(35)}`);
  ok("bekor qilingan token — rad (baribir saqlab bo'lmaydi)", revoked.status === 400 && revoked.json.canForce === false, revoked.json.error);
  const bot = await put('BOT_TOKEN', BOT);
  ok('bot tokeni tekshirildi va saqlandi', bot.status === 200 && bot.json.check?.info === '@cerebro_test_bot ulandi' && bot.json.key?.source === 'panel', JSON.stringify(bot.json.check));
  const botOn = await (async () => { for (let i = 0; i < 40; i++) { if ((await health()).bot) return true; await sleep(150); } return false; })();
  ok("server to'xtamasdan bot yondi (/api/health)", botOn);
  ok('javobda kalitning o\'zi yo\'q', !JSON.stringify(bot.json).includes('LmP2wZr8'));

  const badClaude = await put('ANTHROPIC_API_KEY', `${CLAUDE}bad`);
  ok("o'chirilgan Claude kaliti — rad", badClaude.status === 400 && badClaude.json.canForce === false, badClaude.json.error);
  const poor = await put('ANTHROPIC_API_KEY', `${CLAUDE}poor`);
  ok("mablag'siz hisob — sababi bilan, baribir saqlash mumkin", poor.status === 400 && poor.json.canForce === true && /mablag/.test(poor.json.error), poor.json.error);
  ok("… «baribir saqlash» — saqlandi, AI yondi", (await put('ANTHROPIC_API_KEY', `${CLAUDE}poor`, true)).status === 200 && (await health()).ai);
  ok('to\'g\'ri kalit — ustidan yoziladi', (await put('ANTHROPIC_API_KEY', CLAUDE)).json.check?.ok === true);
  ok("noto'g'ri Gemini kaliti — rad", (await put('GEMINI_API_KEY', `AIzaSyB7xK2mQ9pL4wT8vR1nC6dF3hWRONG5gU2y`)).status === 400);
  ok('Gemini kaliti — ovoz yondi', (await put('GEMINI_API_KEY', GEMINI)).status === 200 && (await health()).voice);
  ok('Telegram API ID: faqat raqam', (await put('TG_API_ID', 'abc')).status === 400 && (await put('TG_API_ID', '1234567')).status === 200);
  ok("panelda o'chirildi — ovoz o'chdi (.env da ham yo'q)", (await api('/api/admin/keys/GEMINI_API_KEY', { method: 'DELETE', token: admin })).json.key?.source === null && !(await health()).voice);
  ok("noma'lum kalit nomi — 404", (await put('PATH', 'x')).status === 404);

  await stop();
  const dbBytes = Buffer.concat([join(dataDir, 'cerebro.db'), join(dataDir, 'cerebro.db-wal')].filter(f => existsSync(f)).map(f => readFileSync(f)));
  ok('bazada kalit ochiq holda yo\'q (shifrlangan)', dbBytes.length > 0 && !dbBytes.includes(Buffer.from('LmP2wZr8')) && !dbBytes.includes(Buffer.from('Xr7bN2kQ')));
  await start();
  const after = (await api('/api/admin/keys', { token: (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token })).json.keys as { name: string; source: string | null }[];
  ok('qayta yoqilgach kalitlar joyida', after.find(k => k.name === 'BOT_TOKEN')?.source === 'panel' && after.find(k => k.name === 'ANTHROPIC_API_KEY')?.source === 'panel' && (await health()).ai);
  const admin2 = (await api('/api/admin/login', { body: { password: 'admin-pass-1' } })).json.token as string;

  console.log('\n# Anketa: o\'rnatishdan oldin egasi to\'ldiradi');
  const made = await api('/api/admin/anketa', { token: admin2, body: { label: 'Shifo Dent', industry: 'stomatologiya' } });
  const code = made.json.anketa?.code as string;
  ok('anketa yaratildi (kod ABCD-EFGH)', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code ?? ''), code);
  const blank = await api(`/api/anketa/${code.toLowerCase().replace('-', '')}`);
  ok('egasi kod bilan ochadi (kichik harf, chiziqsiz ham)', blank.status === 200 && blank.json.anketa.data.name === 'Shifo Dent' && blank.json.anketa.status === 'new');
  ok("noto'g'ri kod — 404", (await api('/api/anketa/AAAA-BBBB')).status === 404);
  const filled = {
    ...emptyAnketa('stomatologiya'), name: 'Shifo Dent', ownerName: 'Aziz', phone: '+998 71 200 45 67', address: 'Chilonzor 9-kvartal, 14-uy', landmark: 'Chilonzor metrosi',
    hours: { ...emptyAnketa().hours, mon: '09:00–19:00', tue: '09:00–19:00', wed: '09:00–19:00', thu: '09:00–19:00', fri: '09:00–19:00' },
    about: 'Oilaviy stomatologiya, 2015 yildan.', team: 'Dr. Rahimova — terapevt\nDr. Aliyev — jarroh',
    prices: "Konsultatsiya — bepul\nTish tozalash — 250 000\nPlomba — 350 000\nTish tozalash — 300 000\nImplant — 4,5 mln",
    answers: { consult: 'Bepul, davolansa hisobga kirmaydi', payment: 'Naqd, karta, Click, Payme' },
    instagram: 'instagram.com/shifodent', telegramPhone: '+998 90 123 45 67', crm: 'dentacrm' as const, cameras: 3, cameraBrand: 'Hikvision',
  };
  const leaked = await api(`/api/anketa/${code}`, { method: 'PUT', body: { data: { ...filled, notes: `bot tokeni: ${BOT}` } } });
  ok('anketaga token yozilsa — saqlanmaydi', leaked.status === 400 && /kalit/.test(leaked.json.error), leaked.json.error);
  ok('qoralama saqlandi', (await api(`/api/anketa/${code}`, { method: 'PUT', body: { data: filled } })).json.anketa?.status === 'draft');
  ok('yuborildi', (await api(`/api/anketa/${code}`, { method: 'PUT', body: { data: filled, submit: true } })).json.anketa?.status === 'done');
  ok("admin ro'yxatida — to'ldirilgan", (await api('/api/admin/anketa', { token: admin2 })).json.anketas?.[0]?.status === 'done');

  console.log('\n# Klinika kompyuterida: kabinet va anketani yuklash');
  const created = await api('/api/admin/businesses', { token: admin2, body: { name: 'Klinika', industry: 'stomatologiya', login: 'shifo', password: 'secret12' } });
  const session = await api(`/api/admin/businesses/${created.json.id}/session`, { token: admin2, body: {} });
  const token = session.json.token as string;
  ok('ulash ustasi kabinetga admin nomidan kiradi', (await api('/api/me', { token })).status === 200);
  ok('kabinet tokeni bilan admin yo\'llari yopiq', (await api('/api/admin/keys', { token })).status === 401);
  ok("noto'g'ri anketa fayli — rad", (await api('/api/setup/anketa', { token, body: { data: { name: 1 } } })).status === 400);
  const imported = await api('/api/setup/anketa', { token, body: { code, source: base } });
  const r = imported.json.result;
  ok('anketa kod bilan yuklandi', imported.status === 200 && r?.prices.added === 2 && r.prices.conflicts === 1 && r.answers === 2, JSON.stringify(r ?? imported.json));
  const me = (await api('/api/me', { token })).json.business;
  ok('profil: nomi, telefoni, manzil mo\'ljali bilan, Instagram', me.name === 'Shifo Dent' && me.phone === '+998 71 200 45 67' && me.address.includes("mo'ljal: Chilonzor metrosi") && me.instagram === 'shifodent');
  ok("ziddiyatli narx jadvalga taxmin qilib yozilmadi", !me.offerings.some((o: { name: string }) => o.name === 'Tish tozalash') && me.offerings.some((o: { name: string; price: number }) => o.name === 'Implant' && o.price === 4_500_000));
  const brain = (await api('/api/brain', { token })).json.brain;
  const aboutPage = (brain.pages ?? []).find((p: { question: string }) => p.question === 'Biznes haqida')?.answer ?? '';
  ok('«Biznes haqida»: tavsif, aloqa qatorlari, jamoa', aboutPage.startsWith('Oilaviy stomatologiya') && aboutPage.includes("- Manzil: Chilonzor 9-kvartal, 14-uy (mo'ljal: Chilonzor metrosi)") && aboutPage.includes('- Ish vaqti: Du–Ju 09:00–19:00') && aboutPage.includes('## Jamoa\n- Dr. Rahimova — terapevt'), aboutPage);
  ok('tayyor savollarga javoblar bilimga tushdi', brain.pack.filter((q: { answer: string | null }) => q.answer).length === 2);
  const setup = (await api('/api/setup', { token })).json.setup;
  ok('bo\'shliqlar: ikki narx va yozilmagan kunlar', setup.gaps.length === 2 && setup.gaps[0].options?.length === 2 && /shanba, yakshanba/.test(setup.gaps[1].question), JSON.stringify(setup.gaps.map((g: { question: string }) => g.question)));
  ok('egasida bor kanallar eslab qolindi (ulash qadamlari uchun)', setup.has.telegramPhone === '+998 90 123 45 67' && setup.has.cameras === 3 && setup.has.crm === 'dentacrm');

  console.log('\n# Egasidan Telegram\'da so\'rash');
  ok("egasi ulanmagan — tushunarli xato", (await api('/api/setup/ask', { token, body: {} })).status === 409);
  const link = (await api('/api/me', { token })).json.status.linkUrl as string;
  let mark = sent.length;
  say(OWNER, `/start ${link.split('start=')[1]}`);
  ok('egasi botni ulab oldi', !!(await waitFor('ulandi', () => toOwner(mark, 'Ulandi'))));
  mark = sent.length;
  ok('«Egasidan so\'rash» bosildi', (await api('/api/setup/ask', { token, body: {} })).status === 200);
  const first = await waitFor('narx savoli', () => toOwner(mark, 'narxi ikki xil'));
  const opts = buttons(first).filter(b => b.callback_data?.startsWith('iv|o:'));
  mark = sent.length;
  say(OWNER, 'keyin aytaman');
  ok("narxsiz javob («keyin aytaman») ziddiyatni yopmaydi — qayta so'raladi", !!(await waitFor('qayta', () => toOwner(mark, 'topa olmadim'))));
  ok('birinchi savol — ikki narx, tugmalar bilan', opts.length === 2 && opts[0].text === "250 000 so'm", JSON.stringify(buttons(first).map(b => b.text)));
  mark = sent.length;
  press(OWNER, opts[0].callback_data!, first!.id!);
  const second = await waitFor('kunlar savoli', () => toOwner(mark, 'ish vaqti yozilmagan'));
  ok('tugma: narx yozildi, keyingi savol — kunlar', !!second && textOf(second).includes("250 000 so'm deb yozdim"), second && textOf(second).slice(0, 80));
  // Javob berilgan savolning eski tugmasi (boshqa narx) endi hech narsani o'zgartirmasligi kerak — pastda narx tekshiriladi
  press(OWNER, opts[1].callback_data!, first!.id!);
  mark = sent.length;
  say(OWNER, 'Dam olamiz');
  const third = await waitFor('tayyor savollar', () => toOwner(mark, 'Ish vaqti: Du–Ju 09:00–19:00, Sh–Ya dam olish'));
  ok('yozilgan javob: dam olish kunlari ish vaqtiga qo\'shildi', !!third);
  mark = sent.length;
  say(OWNER, "to'xta");
  await waitFor('to\'xtadi', () => toOwner(mark, 'Savollarni to'));
  const me2 = (await api('/api/me', { token })).json.business;
  ok('narx jadvalda: tugmada tanlangani (eski tugma ustidan yozmadi)', me2.offerings.find((o: { name: string }) => o.name === 'Tish tozalash')?.price === 250_000);
  ok("bo'shliq qolmadi", (await api('/api/setup', { token })).json.setup.gaps.length === 0);

  console.log('\n# Maxfiy kalit suhbatga yozilsa');
  mark = sent.length;
  say(OWNER, `mana token: ${BOT}`);
  const warned = await waitFor('ogohlantirish', () => toOwner(mark, 'maxfiy kalit'));
  ok('botga yozilgan token chatdan o\'chirildi va ogohlantirildi', !!warned && sent.slice(mark).some(s => s.method === 'deleteMessage'));
  const log = JSON.stringify((await api('/api/chat', { token })).json.entries);
  ok("token suhbat jurnaliga tushmadi", !log.includes('LmP2wZr8'));
  ok('panel suhbatiga yozilsa — yuborilmaydi', (await api('/api/chat', { token, body: { text: `kalit ${CLAUDE}` } })).status === 400);

  console.log('\n# Kameralar: tarmoqdan topish va ulash');
  const found = await api('/api/cameras/discover', { token, body: {} });
  const hik = found.json.found?.[0];
  ok('ONVIF kamera topildi: marka, model, RTSP porti', hik?.ip === '127.0.0.1' && hik.brand === 'Hikvision' && hik.onvif?.includes(`:${onvifHttpPort}/`) && hik.rtspPort === scanPort, JSON.stringify(found.json));
  ok('mahalliy tarmoqdan tashqari manzil — rad', (await api('/api/cameras/connect', { token, body: { ip: '8.8.8.8', login: 'admin', password: 'x', name: 'X' } })).status === 400);
  const connected = await api('/api/cameras/connect', { token, body: { ip: hik.ip, port: hik.rtspPort, brand: hik.brand, onvif: hik.onvif, login: 'admin', password: PASSWORD, name: 'Qabulxona' } });
  ok('kamera ulandi: manzil ONVIF\'dan, yengil oqim', connected.status === 200 && connected.json.camera?.name === 'Qabulxona' && onvif.token === 'sub' && onvif.authed >= 3, JSON.stringify({ s: connected.status, e: connected.json.error, onvif }));
  ok("kamera manzili — biz topgan IP bilan (kamera aytgani emas)", String(connected.json.camera?.ip).startsWith('127.0.0.1'), connected.json.camera?.ip);
  const again = (await api('/api/cameras/discover', { token, body: {} })).json.found?.[0];
  ok('qayta qidiruvda «ulangan» deb ko\'rinadi', again?.connected === true);

  ok('serverda kutilmagan xato yo\'q', !/\[http\]|TypeError|ReferenceError/.test(serverLog), serverLog.split('\n').filter(l => /\[http\]|Error/.test(l)).slice(0, 3).join(' | '));
} finally {
  await stop();
  for (const s of [tgServer, keysServer, onvifHttp]) s.close();
  onvifUdp.close();
  rtspPort.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} o'tdi`);
process.exit(passed === results.length ? 0 : 1);
