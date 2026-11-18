/**
 * Shahar raqami (operator SIP) — Asterisk sozlamasi va holatini o'qish. Sof funksiyalar: WSL/Asterisk'siz sinaladi (scripts/e2e-line.ts).
 *   Ikki xil ulanish: parol bilan ro'yxatdan o'tish (Zadarma, Uztelecom ko'pincha) yoki parolsiz — operator klinikaning IP manzilini
 *   biladi va qo'ng'iroqni o'zi yuboradi (Uztelecom ajratilgan IP bilan).
 */
export interface LineTrunk { host: string; port: number; login: string; number: string }
/** password — login/parol bilan ro'yxatdan o'tadi; ip — parolsiz, operator IP bo'yicha taniydi */
export type TrunkAuth = 'password' | 'ip';
export type TrunkState = 'none' | 'registered' | 'failed' | 'unknown';

/** SkyLine (sip.skyline.uz): server, port va UDP'ni operatorning o'zi tasdiqlagan (2026-11-18). Faqat yuridik shaxsga beriladi */
export const SKYLINE_HOST = 'pbx.skyline.uz';

/**
 * SkyLine raqami → to'liq sozlama: login — 9 xonali raqamning o'zi (78113XXXX). Klinika «+998 78 113-12-34» deb yozsa ham bo'ladi —
 * +998, bo'shliq va chiziqlar olib tashlanadi
 */
export function skylineTrunk(number: string): LineTrunk {
  const digits = number.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('998') ? digits.slice(3) : digits;
  if (!/^\d{9}$/.test(local)) throw new Error("SkyLine raqami 9 xonali bo'lsin, masalan 781131234");
  return { host: SKYLINE_HOST, port: 5060, login: local, number: local };
}

/** Asterisk sozlama qatoridagi qiymat: qator uzilishi, izoh va bo'limni buzadigan belgilar o'tmaydi */
export const confValue = (v: string) => v.replace(/[\r\n;[\]]/g, '').trim();

/**
 * Ro'yxatdan o'tish to'xtab qolmasin: Asterisk sukut bo'yicha 10 marta urinib (60 s dan — internet 10 daqiqa uzilsa) yoki operator
 * bir marta «parol noto'g'ri» desa, butunlay to'xtaydi — kompyuter qayta yoqilmaguncha qo'ng'iroq kelmaydi. Shu yerda: cheksiz urinish,
 * rad javobidan keyin ham 2 daqiqada qayta. qualify — har 30 soniyada operatorga «tirikmisan» (OPTIONS): routerdagi yo'l (NAT) yopilib
 * qolmaydi, operator qo'ng'iroqni yubora oladi
 */
export function trunkConf(t: LineTrunk, password: string | null): string {
  const host = confValue(t.host), port = t.port === 5060 ? '' : `:${t.port}`, user = confValue(t.login), num = confValue(t.number);
  // 5061 — shifrlangan SIP (TLS): provayder oddiy SIP'ni to'sganda ham o'tadi. Aks holda UDP (DNS TCP'ni taklif qilsa ham — TCP'da
  // javob kelmaydi, sip.zadarma.com)
  const proto = t.port === 5061 ? 'tls' : 'udp', uriTail = proto === 'tls' ? ';transport=tls' : '';
  const auth = password !== null;
  const registration = auth ? `[shahar]
type=registration
transport=${proto}
outbound_auth=shahar
server_uri=sip:${host}${port}${uriTail}
client_uri=sip:${user}@${host}${port}
contact_user=${num || user}
retry_interval=60
expiration=300
max_retries=1000000
auth_rejection_permanent=no
forbidden_retry_interval=120
fatal_retry_interval=120

[shahar]
type=auth
auth_type=userpass
username=${user}
password=${confValue(password)}

` : '';
  return `; Panel yozgan (Sozlamalar → Telefon liniyasi) — qo'lda o'zgartirmang
; ${auth ? "Login va parol bilan ro'yxatdan o'tadi" : "Parolsiz: operator shu kompyuterni IP manzili bo'yicha taniydi"}
${registration}[shahar]
type=aor
contact=sip:${host}${port}${uriTail}
qualify_frequency=30
qualify_timeout=5

[shahar]
type=endpoint
transport=${proto}
context=shahar
disallow=all
allow=alaw,ulaw
${auth ? 'outbound_auth=shahar\n' : ''}aors=shahar
from_user=${user}
from_domain=${host}
direct_media=no
rtp_symmetric=yes
force_rport=yes

[shahar]
type=identify
endpoint=shahar
match=${host}
`;
}

/**
 * «pjsip show registrations» → shahar raqami holati. Holat so'zi alohida o'qiladi: «Unregistered» ichida ham «registered» bor —
 * avval ulanmagan raqam «ulangan» deb ko'rinardi
 */
export function registrationState(regs: string): TrunkState {
  const row = regs.split(/\r?\n/).find(l => /^\s*shahar\//.test(l));
  if (!row) return 'none';
  const word = row.match(/\b(Registered|Unregistered|Rejected|Stopped)\b/)?.[1];
  return word === 'Registered' ? 'registered' : word ? 'failed' : 'unknown';
}

/** Parolsiz ulanish: ro'yxat yo'q — operator qualify (OPTIONS) ga javob beryaptimi («pjsip show contacts») */
export function contactState(contacts: string): TrunkState {
  const row = contacts.split(/\r?\n/).find(l => /Contact:\s+shahar\//.test(l));
  if (!row) return 'none';
  const word = row.match(/\b(Avail|Unavail|Unknown|NonQual|Reachable|Unreachable)\b/)?.[1];
  return word === 'Avail' || word === 'Reachable' ? 'registered' : word === 'Unavail' || word === 'Unreachable' ? 'failed' : 'unknown';
}

/**
 * Asterisk jurnalidagi oxirgi ro'yxatdan o'tish xatosi → odam tilida sabab. Faqat raqam ulanmaganda chaqiriladi (eski, tuzalgan
 * xato aytilmasin). Javob kodi bo'yicha: 401/403 — parol, 404 — login, javob yo'q — manzil/port/internet
 */
export function trunkReason(state: TrunkState, auth: TrunkAuth, log: string): string | null {
  if (state === 'registered' || state === 'unknown') return null;
  if (state === 'none') return "raqam telefon xizmatiga o'rnatilmagan — «Saqlash va ulash» ni qayta bosing";
  const lines = log.split(/\r?\n/).filter(l => /shahar|registration attempt|outbound registration/i.test(l));
  const last = lines.at(-1) ?? '';
  const m = last.match(/'([45]\d\d)'|\b([45]\d\d) (?:Forbidden|Unauthorized|Not Found|fatal)/i);
  const code = Number(m?.[1] ?? m?.[2] ?? 0);
  // «Maximum retries reached» — eski sozlamada urinishlar tugagan (oldin har safar javob kelmagan)
  const noAnswer = /No response received|Maximum retries|timed? ?out|\b408\b/i.test(last);
  if (auth === 'ip') {
    return "operator serveri javob bermayapti — operatorda shu klinikaning IP manzili ulanganini va server manzilini tekshiring";
  }
  if (code === 401 || code === 403 || code === 407) return "operator login yoki parolni rad etdi — operatordan to'g'ri login va parolni qayta so'rang";
  if (code === 404) return "operator bunday loginni tanimaydi — login (ko'pincha raqamning o'zi) noto'g'ri";
  if (noAnswer || !last) return "operator serveri javob bermayapti — server manzili yoki port noto'g'ri, yoki klinika interneti SIP'ni o'tkazmayapti (Uztelecom raqami faqat Uztelecom internetida ishlaydi)";
  if (code >= 500) return "operator serverida nosozlik — telefon xizmati o'zi qayta urinadi; davom etsa operatorga qo'ng'iroq qiling";
  return `operator ulanishni rad etdi${code ? ` (javob ${code})` : ''} — operatorga ayting`;
}
