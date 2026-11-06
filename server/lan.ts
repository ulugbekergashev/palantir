/**
 * Klinika ichidagi tarmoq (o'rnatgich standarti — LISTEN_HOST=0.0.0.0, install/tarmoq.ps1): qabulxonadagi boshqa kompyuterlar panelni
 * server kompyuterining ichki manzili bilan ochadi (http://192.168.1.10:3200) — internetsiz, Hub'siz, ma'lumot klinikadan chiqmaydi.
 * Qoidalar (http.ts):
 *   ulanish faqat ichki tarmoqdan (klinika Wi-Fi'si, kabel, shu kompyuter) — kompyuter to'g'ridan-to'g'ri internetga ulangan bo'lsa ham;
 *   Host sarlavhasi — IP, localhost yoki shu kompyuter nomi: begona sayt o'z nomini shu manzilga burib (DNS rebinding) xodim brauzeri
 *   orqali panelga murojaat qila olmasin.
 * Hostingda (proksi ortida, TRUST_PROXY=1) qo'llanmaydi: u yerda manzil va nom proksiniki.
 */
import { BlockList, isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { env } from './env';

/** Ichki tarmoqlar: shu kompyuter, uy/ofis tarmoqlari, link-local (router bermasa Windows o'zi qo'yadigan) */
const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

/** Ekranda ko'rsatilmaydigan tarmoq kartalari: virtual mashinalar va WSL — boshqa kompyuterdan ularga ulanib bo'lmaydi */
const VIRTUAL_ADAPTER = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback/i;
const AUTO_IP = /^169\.254\./;

/** Server hamma tarmoq interfeyslarida tinglaydimi (0.0.0.0, :: yoki bo'sh) */
export const listensEverywhere = (): boolean => !env.listenHost || env.listenHost === '0.0.0.0' || env.listenHost === '::';
/** Klinika ichidagi tarmoq rejimi: hamma interfeysda, proksisiz */
export const lanMode = (): boolean => listensEverywhere() && !env.trustProxy;

/** "::ffff:192.168.1.5" → "192.168.1.5", "fe80::1%12" → "fe80::1" */
function bare(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/%.*$/, '');
  return s.startsWith('::ffff:') && isIP(s.slice(7)) === 4 ? s.slice(7) : s;
}

/** Ulanish manzili ichki tarmoqdanmi (TCP ulanishning o'zi — X-Forwarded-For emas) */
export function lanPeer(ip: string | undefined): boolean {
  if (!ip) return false;
  const a = bare(ip);
  const v = isIP(a);
  return v === 4 ? PRIVATE.check(a, 'ipv4') : v === 6 ? PRIVATE.check(a, 'ipv6') : false;
}

/** Host sarlavhasi (portli yoki portsiz) — shu kompyuterga to'g'ridan-to'g'ri murojaatmi: ichki IP, localhost yoki kompyuter nomi */
export function lanHost(header: string | undefined): boolean {
  const h = (header ?? '').trim().toLowerCase();
  const name = h.startsWith('[') ? h.slice(1, h.indexOf(']')) : h.replace(/:\d+$/, '');
  if (!name) return false;
  if (name === 'localhost') return true;
  if (isIP(name)) return lanPeer(name);
  const me = hostname().toLowerCase();
  return name === me || name === `${me}.local`;
}

/** Boshqa kompyuterlar panelni ochadigan manzillar (http://192.168.1.10:3200); tarmoqqa ochilmagan serverda — bo'sh */
export function lanAddresses(): string[] {
  if (!listensEverywhere()) return [];
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, list]) => list ?? [])
    .flatMap(i => (i.family === 'IPv4' && !i.internal && !AUTO_IP.test(i.address) ? [`http://${i.address}:${env.port}`] : []));
}
