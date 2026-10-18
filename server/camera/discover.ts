/**
 * Klinika tarmog'idagi IP kameralarni topish va RTSP manzilini o'zi aniqlash — o'rnatuvchi manzilni qo'lda yozmasin.
 *   1) ONVIF qidiruvi (WS-Discovery): kameralar multicast so'roviga o'zi javob beradi — IP, markasi, modeli, boshqaruv manzili.
 *   2) Zaxira: mahalliy tarmoqda 554-port (RTSP) ochiq qurilmalar — ONVIF'i o'chirilgan kameralar va registratorlar.
 * Manzil: avval ONVIF'dan so'raladi (login-parol bilan, yengil oqim), bo'lmasa — markaning odatiy yo'llari bittalab sinab ko'riladi.
 * Hamma so'rov faqat mahalliy tarmoqda; kamera paroli diskka yozilmaydi (ulangach manzil shifrlanib saqlanadi).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { FoundCamera } from '../../src/types';
import { readCapped } from '../readCapped';


const WSD_ADDRESS = '239.255.255.250', WSD_PORT = 3702;
const PROBE_WAIT_MS = 3_000, PORT_TIMEOUT_MS = 400, SCAN_PARALLEL = 64, MAX_SUBNETS = 2;
const RTSP_PORT = 554;

const probeMessage = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;

const tag = (xml: string, name: string): string | null => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml)?.[1]?.trim() ?? null;
const scope = (scopes: string, key: string): string => {
  const m = new RegExp(`onvif://www\\.onvif\\.org/${key}/([^\\s]+)`, 'i').exec(scopes);
  try { return m ? decodeURIComponent(m[1]).replace(/_/g, ' ').trim() : ''; } catch { return m?.[1] ?? ''; }
};

/** Markani nom va modeldan taniydi */
export function brandOf(text: string): string {
  const t = text.toLowerCase();
  if (/hikvision|\bhik\b|^ds-\d|\sds-\d/.test(t)) return 'Hikvision';
  if (/dahua|ipc-h[fd]w|\bdh-/.test(t)) return 'Dahua';
  if (/uniview|uniarch|\bipc\d{4}/.test(t)) return 'Uniview';
  if (/ezviz/.test(t)) return 'EZVIZ';
  if (/tp-?link|tapo|vigi/.test(t)) return 'TP-Link';
  if (/xiongmai|\bxm\b|sofia/.test(t)) return 'Xiongmai';
  if (/reolink/.test(t)) return 'Reolink';
  return '';
}

/** Manzil http(s) va aynan shu IP'da */
export const hostIs = (url: string, ip: string): boolean => {
  try { const u = new URL(url); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === ip; } catch { return false; }
};

/**
 * ONVIF ProbeMatch javobi → kamera. IP — javob kelgan manzil (javob ichidagi gapga ishonilmaydi: tarmoqdagi begona qurilma
 * o'zini boshqa IP deb ko'rsatolmasin); boshqaruv manzili faqat o'sha IP'dagisi olinadi
 */
export function parseProbeMatch(xml: string, from: string): FoundCamera | null {
  if (!/ProbeMatch/.test(xml)) return null;
  const xaddrs = (tag(xml, 'XAddrs') ?? '').split(/\s+/);
  const scopes = tag(xml, 'Scopes') ?? '';
  const onvif = xaddrs.find(a => hostIs(a, from)) ?? null;
  const ip = from;
  const name = scope(scopes, 'name'), hardware = scope(scopes, 'hardware'), maker = scope(scopes, 'manufacturer');
  return { ip, brand: brandOf(`${maker} ${name} ${hardware}`), model: hardware || name, onvif, rtspPort: RTSP_PORT };
}

/** Shu kompyuterning mahalliy IPv4 manzillari (Wi-Fi, kabel) — virtual va VPN'larsiz */
function localAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|hyper-v|docker|wsl|tailscale|zerotier|loopback/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out;
}

/** ONVIF so'rovi: targets berilsa — o'shalarga (sinov), bo'lmasa — har tarmoqdan multicast */
function probe(targets: { host: string; port: number }[] | null, waitMs: number): Promise<FoundCamera[]> {
  const found = new Map<string, FoundCamera>();
  const binds = targets ? ['127.0.0.1'] : localAddresses();
  if (!binds.length) return Promise.resolve([]);
  return new Promise(done => {
    const sockets = binds.map(addr => {
      const s = createSocket({ type: 'udp4', reuseAddr: true });
      s.on('error', () => s.close());
      s.on('message', (msg, rinfo) => {
        const cam = parseProbeMatch(msg.toString('utf8'), rinfo.address);
        if (cam && !found.has(cam.ip)) found.set(cam.ip, cam);
      });
      s.bind(0, addr, () => {
        const body = Buffer.from(probeMessage());
        for (const t of targets ?? [{ host: WSD_ADDRESS, port: WSD_PORT }]) s.send(body, t.port, t.host, () => {});
      });
      return s;
    });
    setTimeout(() => { for (const s of sockets) { try { s.close(); } catch { /* yopilgan */ } } done([...found.values()]); }, waitMs);
  });
}

const portOpen = (host: string, port: number): Promise<boolean> => new Promise(done => {
  const s = new Socket();
  const end = (ok: boolean) => { s.destroy(); done(ok); };
  s.setTimeout(PORT_TIMEOUT_MS, () => end(false));
  s.once('connect', () => end(true));
  s.once('error', () => end(false));
  s.connect(port, host);
});

/** Ro'yxatdagi manzillarda port ochiqmi — bir vaqtda SCAN_PARALLEL tadan */
async function scan(hosts: { host: string; port: number }[]): Promise<{ host: string; port: number }[]> {
  const open: { host: string; port: number }[] = [];
  for (let i = 0; i < hosts.length; i += SCAN_PARALLEL) {
    const batch = hosts.slice(i, i + SCAN_PARALLEL);
    const r = await Promise.all(batch.map(h => portOpen(h.host, h.port)));
    batch.forEach((h, n) => { if (r[n]) open.push(h); });
  }
  return open;
}

const subnetHosts = (self: string): { host: string; port: number }[] => {
  const base = self.split('.').slice(0, 3).join('.');
  return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter(h => h !== self).map(host => ({ host, port: RTSP_PORT }));
};

export interface DiscoverOptions {
  /** Sinov uchun: ONVIF so'rovi shu manzillarga (multicast o'rniga) */
  probeTargets?: { host: string; port: number }[];
  /** Sinov uchun: port shu manzillarda tekshiriladi (butun tarmoq o'rniga) */
  scanHosts?: { host: string; port: number }[];
  waitMs?: number;
}

/** Tarmoqdagi kameralar: ONVIF bilan topilganlar va 554-porti ochiq qolganlari (IP bo'yicha tartibda) */
export async function discoverCameras(opts: DiscoverOptions = {}): Promise<FoundCamera[]> {
  const scanList = opts.scanHosts ?? localAddresses().slice(0, MAX_SUBNETS).flatMap(subnetHosts);
  const [onvif, rtsp] = await Promise.all([probe(opts.probeTargets ?? null, opts.waitMs ?? PROBE_WAIT_MS), scan(scanList)]);
  const all = new Map(onvif.map(c => [c.ip, c]));
  for (const h of rtsp) {
    const known = all.get(h.host);
    if (known) all.set(h.host, { ...known, rtspPort: h.port });
    else all.set(h.host, { ip: h.host, brand: '', model: '', onvif: null, rtspPort: h.port });
  }
  const order = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
  return [...all.values()].sort((a, b) => order(a.ip) - order(b.ip));
}

// ─── RTSP manzilini aniqlash ─────────────────────────────────────────────────

/** Markaning odatiy yengil oqim (substream) yo'llari: ONVIF javob bermasa shular sinab ko'riladi */
const PATHS: Record<string, string[]> = {
  Hikvision: ['/Streaming/Channels/102', '/Streaming/Channels/101'],
  Dahua: ['/cam/realmonitor?channel=1&subtype=1', '/cam/realmonitor?channel=1&subtype=0'],
  Uniview: ['/media/video2', '/media/video1'],
  EZVIZ: ['/h264/ch1/sub/av_stream', '/h264/ch1/main/av_stream'],
  'TP-Link': ['/stream2', '/stream1'],
  Xiongmai: ['/user=admin&password=&channel=1&stream=1.sdp'],
  Reolink: ['/h264Preview_01_sub', '/h264Preview_01_main'],
};
const GENERIC = ['/Streaming/Channels/102', '/cam/realmonitor?channel=1&subtype=1', '/stream2', '/h264/ch1/sub/av_stream', '/live/ch00_1', '/1'];

/** Sinab ko'riladigan manzillar (parolsiz): avval shu markaniki, keyin umumiylari */
export function candidatePaths(brand: string): string[] {
  return [...new Set([...(PATHS[brand] ?? []), ...GENERIC])];
}

/** Manzilga login-parol qo'yadi (parolda @ yoki : bo'lsa ham to'g'ri kodlanadi) */
export function withCredentials(rtsp: string, login: string, password: string): string {
  const u = new URL(rtsp);
  u.username = encodeURIComponent(login);
  u.password = encodeURIComponent(password);
  return u.href;
}

const SOAP_TIMEOUT_MS = 6_000;

/** ONVIF so'rovi uchun WS-Security imzosi: parol ochiq ketmaydi (nonce + vaqt + parol → SHA-1) */
export function wsSecurity(login: string, password: string, now = new Date(), nonce = randomBytes(16)): string {
  const created = now.toISOString();
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest('base64');
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${x(login)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created></UsernameToken></Security>`;
}

/** Kamera javobining eng katta hajmi: begona qurilma xotirani to'ldirib, tahlilni og'irlashtirmasin */
const MAX_SOAP_BYTES = 256 * 1024;

async function soap(url: string, body: string, login: string, password: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Header>${wsSecurity(login, password)}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/soap+xml; charset=utf-8' }, body: envelope, redirect: 'manual', signal: AbortSignal.timeout(SOAP_TIMEOUT_MS) });
  const text = await readCapped(r, MAX_SOAP_BYTES);
  if (!r.ok) throw new Error(/NotAuthorized|Unauthorized|401/i.test(text) || r.status === 401 ? 'login yoki parol noto\'g\'ri' : `ONVIF rad etdi (${r.status})`);
  return text;
}

/** Profillar ichidan eng kichik o'lchamlisi (yengil oqim — kompyuterni bekorga yuklamaydi) */
export function pickProfile(xml: string): string | null {
  const profiles = [...xml.matchAll(/<(?:[\w-]+:)?Profiles\b[^>]*\btoken="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Profiles>/g)].map(m => {
    const w = Number(tag(m[2], 'Width') ?? 0), h = Number(tag(m[2], 'Height') ?? 0);
    return { token: m[1], pixels: w * h || Number.MAX_SAFE_INTEGER };
  });
  if (!profiles.length) return null;
  return profiles.reduce((a, b) => (b.pixels < a.pixels ? b : a)).token;
}

/** ONVIF orqali RTSP manzili (login-parolsiz). Kamera ONVIF bilmasa yoki rad etsa — xato */
export async function onvifStreamUri(onvif: string, ip: string, login: string, password: string): Promise<string> {
  if (!hostIs(onvif, ip)) throw new Error('boshqaruv manzili boshqa qurilmaniki');
  const caps = await soap(onvif, '<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>', login, password).catch(() => '');
  // Kamera ko'rsatgan media manzili ham faqat shu kameraning o'zida bo'lsa olinadi: imzolangan so'rov boshqa joyga ketmasin
  const offered = /<(?:[\w-]+:)?Media\b[^>]*>[\s\S]*?<(?:[\w-]+:)?XAddr>([^<]+)</.exec(caps)?.[1]?.trim();
  const media = offered && hostIs(offered, ip) ? offered : onvif;
  const profiles = await soap(media, '<trt:GetProfiles/>', login, password);
  const token = pickProfile(profiles);
  if (!token) throw new Error('kamerada video profili topilmadi');
  const x = token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const uri = tag(await soap(media, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${x}</trt:ProfileToken></trt:GetStreamUri>`, login, password), 'Uri');
  if (!uri || !/^rtsps?:\/\//i.test(uri)) throw new Error("kamera RTSP manzilini bermadi");
  return uri.replace(/&amp;/g, '&');
}
