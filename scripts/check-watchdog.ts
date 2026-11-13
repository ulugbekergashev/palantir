/**
 * Hub qorovuli (scripts/hub-watchdog.ts) — soxta Hub va soxta Oracle API bilan, vaqtlar qisqartirilgan (WATCHDOG_MS_SCALE):
 *   Hub sog' — Oracle'ga buyruq yo'q; to'xtatilgan (STOPPED) — START; yoqiq, lekin qotgan (RUNNING, javob yo'q) — kutib, yana
 *   tekshirib, keyin SOFTRESET; kutish paytida o'zi tiklansa — buyruq yo'q; o'tish holati (STARTING) — tegilmaydi.
 * Ishga tushirish: npm run test:watchdog
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const results: boolean[] = [];
const ok = (name: string, cond: unknown, info = '') => { results.push(!!cond); console.log(`${cond ? '  ✓' : '  ✗'} ${name}${info ? ` — ${info}` : ''}`); };

const world = { hub: 'ok' as 'ok' | 'hang', state: 'RUNNING', actions: [] as string[], signed: true };
/** Oracle buyrug'idan keyin server shuncha vaqtda tiklanadi */
const RECOVER_MS = 300;

const hub = createServer((_req: IncomingMessage, res: ServerResponse) => {
  if (world.hub === 'hang') return; // qotgan server: ulanadi, lekin javob yo'q
  res.end(JSON.stringify({ ok: true }));
});
const oci = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (!String(req.headers.authorization ?? '').startsWith('Signature version="1"')) world.signed = false;
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'POST') {
    const action = url.searchParams.get('action') ?? '?';
    world.actions.push(action);
    world.state = action === 'SOFTRESET' ? 'STOPPING' : 'STARTING';
    setTimeout(() => { world.state = 'RUNNING'; world.hub = 'ok'; }, RECOVER_MS);
    return res.end(JSON.stringify({ lifecycleState: world.state }));
  }
  res.end(JSON.stringify({ lifecycleState: world.state }));
});
const listen = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const [hubPort, ociPort] = [await listen(hub), await listen(oci)];
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

function watchdog(): Promise<string> {
  return new Promise(done => {
    const p = spawn(process.execPath, ['--no-warnings', 'scripts/hub-watchdog.ts'], {
      env: {
        ...process.env, HUB_URL: `http://127.0.0.1:${hubPort}`, OCI_API_URL: `http://127.0.0.1:${ociPort}`, OCI_REGION: 'sinov', OCI_TENANCY: 't', OCI_USER: 'u',
        OCI_FINGERPRINT: 'f', HUB_INSTANCE_ID: 'ocid1.instance.sinov', OCI_PRIVATE_KEY: privateKey, WATCHDOG_MS_SCALE: '0.01',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', () => done(out));
  });
}
const run = async (hubMode: 'ok' | 'hang', state: string, during?: () => void) => {
  Object.assign(world, { hub: hubMode, state, actions: [] });
  // Birinchi tekshiruv (3 urinish) ~0,8 s, keyin 1,2 s kutish: o'rtasida tiklanadi
  const timer = during ? setTimeout(during, 1300) : null;
  const out = await watchdog();
  if (timer) clearTimeout(timer);
  return out;
};

try {
  console.log('\n# Hub qorovuli');
  let out = await run('ok', 'RUNNING');
  ok("Hub sog' — Oracle'ga buyruq yo'q", world.actions.length === 0 && out.includes('Hub javob beryapti'), out.trim());

  out = await run('hang', 'STOPPED');
  ok("Oracle to'xtatgan (STOPPED) — START, Hub tiklangani jurnalda", world.actions.join() === 'START' && out.includes("to'xtatgan edi — qayta yoqildi"), out.trim());

  out = await run('hang', 'RUNNING');
  ok("yoqiq, lekin qotgan (RUNNING, javob yo'q) — kutib, yana tekshirib, SOFTRESET; Hub tiklandi", world.actions.join() === 'SOFTRESET' && out.includes('qotib qolgan edi — qayta yoqildi'), out.trim());

  out = await run('hang', 'RUNNING', () => { world.hub = 'ok'; });
  ok("kutish paytida o'zi tiklandi (joylash, bir zumlik uzilish) — qayta yoqilmaydi", world.actions.length === 0 && out.includes('qayta javob berdi'), out.trim());

  out = await run('hang', 'STARTING');
  ok("o'tish holati (STARTING) — tegilmaydi, keyingi tekshiruvga", world.actions.length === 0 && out.includes("o'tish holati"), out.trim());

  ok('Oracle so\'rovlari imzolangan (HTTP Signature)', world.signed);
} catch (e) {
  ok(`sinov to'xtab qoldi: ${(e as Error).message}`, false);
} finally {
  for (const s of [hub, oci]) { s.closeAllConnections(); s.close(); }
}
const failed = results.filter(r => !r).length;
console.log(`\n${failed ? `✗ ${failed} ta tekshiruv o'tmadi` : `✓ hammasi o'tdi (${results.length})`}`);
process.exit(failed ? 1 : 0);
