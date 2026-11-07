/**
 * Hub qorovuli (GitHub Actions, har 30 daqiqada — .github/workflows/hub-watchdog.yml): Oracle bepul serverni «bo'sh turibdi»
 * deb to'xtatib qo'yishi mumkin (Always Free qoidasi) — to'xtatilgan serverni qayta yoqish esa ruxsat etilgan.
 *   /health javob bersa — hech narsa qilinmaydi. Javob bermasa — Oracle API: server holati; STOPPED bo'lsa — START va /health kutiladi.
 *   RUNNING, lekin javob yo'q (server qotgan: xotira to'lgan — SSH ham javob bermaydi) — bir oz kutib yana tekshiriladi (joylash yoki
 *   bir zumlik uzilish bo'lishi mumkin), yana javob yo'q bo'lsa — SOFTRESET (Oracle avval tizimni o'chirishni so'raydi, 15 daqiqada
 *   o'chmasa — o'zi o'chirib yoqadi). Boshqa holat (STARTING, STOPPING…) — kutiladi, keyingi tekshiruvda yana qaraladi.
 * Email yuborilmaydi (egasi so'ragan): ish hech qachon «yiqilmaydi», natija — Actions jurnalida (::warning::).
 * Muhit: HUB_URL, OCI_REGION, OCI_TENANCY, OCI_USER, OCI_FINGERPRINT, HUB_INSTANCE_ID — ochiq identifikatorlar; OCI_PRIVATE_KEY — sir.
 * --holat — Hub sog' bo'lsa ham server holatini Oracle'dan so'raydi (Actions shunday ishga tushiradi: kalit har safar tekshiriladi,
 * buzilgan bo'lsa — Hub haqiqatan to'xtaganda emas, darhol jurnalda ko'rinadi).
 * Tashqi kutubxonasiz: Node 24 to'g'ridan-to'g'ri ishga tushiradi (faqat o'chiriladigan TypeScript sintaksisi).
 */
import { createHash, createSign } from 'node:crypto';

/** Vaqtlar — sinovda (scripts/check-watchdog.ts) WATCHDOG_MS_SCALE bilan qisqartiriladi */
const SCALE = Number(process.env.WATCHDOG_MS_SCALE) || 1;
const HEALTH_TRIES = 3, HEALTH_GAP_MS = 10_000 * SCALE, HEALTH_TIMEOUT_MS = 20_000 * SCALE;
/** Yoqilgandan keyin: server RUNNING bo'lishini va Hub javob berishini shuncha kutamiz */
const START_WAIT_MS = 6 * 60_000 * SCALE, POLL_MS = 10_000 * SCALE;
/** Yoqiq server javob bermasa: qayta yoqishdan oldin shuncha kutib yana tekshiriladi */
const RECHECK_MS = 2 * 60_000 * SCALE;
/** SOFTRESET: Oracle tizim o'chishini 15 daqiqagacha kutadi, keyin yoqadi */
const RESET_WAIT_MS = 20 * 60_000 * SCALE;

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} berilmagan`);
  return v;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const warn = (s: string) => console.log(`::warning::${s}`);

async function healthy(hub: string): Promise<boolean> {
  for (let i = 0; i < HEALTH_TRIES; i++) {
    try {
      const r = await fetch(`${hub}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (r.ok) return true;
    } catch { /* qayta urinamiz */ }
    if (i < HEALTH_TRIES - 1) await sleep(HEALTH_GAP_MS);
  }
  return false;
}

/** Vaqtinchalik xatolar (kalit hali tarqalmagan 401, 429, 5xx) — bir necha marta qayta uriniladi */
const OCI_TRIES = 4, OCI_GAP_MS = 15_000;
async function oci(method: 'GET' | 'POST', path: string): Promise<Record<string, unknown>> {
  for (let i = 1; ; i++) {
    try { return await ociOnce(method, path); }
    catch (e) {
      const status = Number(/Oracle API (\d+)/.exec((e as Error).message)?.[1]);
      if (i >= OCI_TRIES || !(status === 401 || status === 429 || status >= 500)) throw e;
      await sleep(OCI_GAP_MS);
    }
  }
}

/** Oracle API so'rovi: HTTP Signature (rsa-sha256) — https://docs.oracle.com/iaas/Content/API/Concepts/signingrequests.htm */
async function ociOnce(method: 'GET' | 'POST', path: string): Promise<Record<string, unknown>> {
  // OCI_API_URL — faqat sinov uchun (soxta Oracle API)
  const url = new URL(`${process.env.OCI_API_URL || `https://iaas.${need('OCI_REGION')}.oraclecloud.com`}/20160918${path}`);
  const body = method === 'POST' ? '' : undefined;
  const headers: Record<string, string> = { date: new Date().toUTCString(), host: url.host };
  const signed = ['(request-target)', 'date', 'host'];
  if (body !== undefined) {
    Object.assign(headers, { 'x-content-sha256': createHash('sha256').update(body).digest('base64'), 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
    signed.push('x-content-sha256', 'content-type', 'content-length');
  }
  const text = signed.map(h => (h === '(request-target)' ? `${h}: ${method.toLowerCase()} ${url.pathname}${url.search}` : `${h}: ${headers[h]}`)).join('\n');
  const signature = createSign('RSA-SHA256').update(text).sign(need('OCI_PRIVATE_KEY').replace(/\\n/g, '\n'), 'base64');
  const keyId = `${need('OCI_TENANCY')}/${need('OCI_USER')}/${need('OCI_FINGERPRINT')}`;
  // host va content-length'ni fetch o'zi qo'yadi (imzodagi qiymatning o'zi)
  const { host: _host, 'content-length': _length, ...sent } = headers;
  const r = await fetch(url, {
    method, body, signal: AbortSignal.timeout(30_000),
    headers: { ...sent, authorization: `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${signed.join(' ')}",signature="${signature}"` },
  });
  const json = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Oracle API ${r.status}: ${String(json.message ?? json.code ?? '')}`);
  return json;
}

const stateOf = async (id: string) => String((await oci('GET', `/instances/${id}`)).lifecycleState);

async function main(): Promise<void> {
  const hub = need('HUB_URL').replace(/\/+$/, ''), id = need('HUB_INSTANCE_ID');
  const forceCheck = process.argv.includes('--holat');
  if (await healthy(hub)) {
    console.log(`Hub javob beryapti: ${hub}`);
    if (forceCheck) console.log(`::notice::Hub sog', Oracle kaliti ishlayapti: server holati — ${await stateOf(id)}`);
    return;
  }
  const state = await stateOf(id);
  console.log(`Hub javob bermayapti; Oracle: server holati — ${state}`);
  if (state === 'STOPPED') {
    await oci('POST', `/instances/${id}?action=START`);
    console.log('Yoqish buyrug\'i berildi');
    await backUp(hub, id, START_WAIT_MS, 'Oracle serverni to\'xtatgan edi — qayta yoqildi, Hub ishlayapti');
    return;
  }
  if (state !== 'RUNNING') {
    warn(`Hub javob bermayapti, server holati ${state} — o'tish holati, keyingi tekshiruvda yana qaraladi`);
    return;
  }
  // Yoqiq, lekin javob yo'q: joylash (xizmat qayta yoqilyapti) yoki bir zumlik uzilish bo'lishi mumkin — shoshilmaymiz
  await sleep(RECHECK_MS);
  if (await healthy(hub)) {
    console.log('Hub qayta javob berdi — qayta yoqish kerak emas');
    return;
  }
  await oci('POST', `/instances/${id}?action=SOFTRESET`);
  console.log('Server qotgan (yoqiq, lekin javob bermaydi) — qayta yoqish (SOFTRESET) buyrug\'i berildi');
  await backUp(hub, id, RESET_WAIT_MS, 'Server qotib qolgan edi — qayta yoqildi, Hub ishlayapti');
}

/** Yoqish yoki qayta yoqishdan keyin: server RUNNING va Hub javob berguncha kutiladi */
async function backUp(hub: string, id: string, waitMs: number, done: string): Promise<void> {
  for (const end = Date.now() + waitMs; Date.now() < end; await sleep(POLL_MS)) {
    if ((await stateOf(id)) === 'RUNNING' && await healthy(hub)) {
      warn(done);
      return;
    }
  }
  warn(`Server yoqildi, lekin Hub ${Math.round(waitMs / 60_000)} daqiqada javob bermadi — keyingi tekshiruvda yana qaraladi`);
}

// Ish yiqilmaydi: GitHub muvaffaqiyatsiz ish haqida email yuborardi
main().catch(e => warn(`Tekshiruv bajarilmadi: ${(e as Error).message}`));
