/**
 * AI jamoa: har xodim kim, qaysi bo'limda, nima qiladi va hozir nima bilan band — bosh ekrandagi kartalar, «AI xodimlar» sahifasi
 * va xodim sahifasining sarlavhasi shu yerdan. Holat haqiqiy ma'lumotdan (so'rovlar, qo'ng'iroqlar, vazifalar, kameralar, DentaCRM),
 * 30 soniyada yangilanadi. Kim jamoada — src/lib/crew.ts (standart: Direktor va Yordamchi, qolgani «+ Xodim qo'shish»dan).
 * about — xodim haqiqatan nima qiladi (egasi shunga qarab ishga oladi): bajarmaydigan ishini yozmang.
 */
import { useEffect, useState } from 'react';
import { Camera, ChartLine, Compass, Headset, Megaphone, PenLine, Target, UserRound, type LucideIcon } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api, type ContentView } from '../data/api';
import type { AdsView, DirectorView } from '../types';
import { iso } from '../lib/week';
import { hrefOf, type Area } from '../lib/nav';
import { som } from '../lib/text';
import { CREW, isCore, type CrewMember } from '../lib/crew';

export type Member = CrewMember;

/**
 * Bo'limlar — «AI xodimlar» sahifasida xodimlar shu tartibda guruhlanadi (ishdagilari ham, tez kunda keladiganlari ham).
 * Yangi xodim — o'z bo'limiga, va bitta ishni ikki xodim qilmasin (masalan, video — Kontent-meykerning ishi, alohida xodim emas)
 */
export type Department = 'boshqaruv' | 'sotuv' | 'marketing' | 'sifat' | 'hr' | 'moliya' | 'taminot' | 'huquq';
export const DEPARTMENTS: Record<Department, { name: string; about: string }> = {
  boshqaruv: { name: 'Boshqaruv', about: 'Qarorlar, raqamlar va sizning ishlaringiz' },
  sotuv: { name: 'Mijozlar va sotuv', about: "Javob berish, yangi mijoz, qaytarish va obro'" },
  marketing: { name: 'Marketing', about: 'Strategiya, kontent, reklama va hamkorliklar' },
  sifat: { name: 'Nazorat va sifat', about: 'Kameralar, xizmat sifati va standartlar' },
  hr: { name: 'HR', about: "Ishga olish, o'rgatish va jamoaning ishi" },
  moliya: { name: 'Moliya', about: 'Hisob, kassa va qarzlar' },
  taminot: { name: "Ta'minot", about: 'Xarid va ombor' },
  huquq: { name: 'Huquq', about: 'Shartnoma va hujjatlar' },
};

export const TEAM: Record<Member, { name: string; role: string; about: string; icon: LucideIcon; department: Department }> = {
  direktor: { name: 'Direktor', role: 'Raqamlar · qarorlar · jamoa', icon: Compass, department: 'boshqaruv', about: "Har tong raqamlarni o'qiydi, eng katta muammoni topadi va jamoadagi xodimlarga topshiriq taklif qiladi; siz tasdiqlasangiz — topshiradi va natijasini o'lchaydi." },
  qabulxona: { name: 'Qabulxona', role: 'Telefon · Instagram · Telegram', icon: Headset, department: 'sotuv', about: "Mijozlarga javob tayyorlaydi — siz tasdiqlab yuborasiz yoki o'zi yuboradi (o'zingiz tanlaysiz); yozilishni hal qiladi, bilmaganini sizdan so'raydi. Unutilgan mijozlarga qayta yozish ham uniki — o'sha ovoz va qoidalar bilan." },
  yordamchi: { name: 'Yordamchi', role: "Sizning o'ng qo'lingiz", icon: UserRound, department: 'boshqaruv', about: 'Eslatadi, hujjat tayyorlaydi, savolingizga javob beradi — ovoz bilan yoki yozib.' },
  kuzatuvchi: { name: 'Kuzatuvchi', role: 'Kameralar', icon: Camera, department: 'sifat', about: "Kameralarni kuzatadi, siz bergan topshiriqlarni bajaradi (kassada odam bormi, kim uzoq kutyapti); muammo bo'lsa — kadri bilan Telegram'ga yozadi, savolingizga kadrga qarab javob beradi va kechqurun hisobot yuboradi." },
  tahlilchi: { name: 'Tahlilchi', role: 'Raqamlar', icon: ChartLine, department: 'boshqaruv', about: "Murojaatlar, so'rovlar va natija (CRM ulangan bo'lsa — qabul va tushum ham) — kun, 7 kun, 30 kun yoki o'zingiz tanlagan davr; har hafta mijozlar nimani so'rayotganini o'zi guruhlaydi va Direktorga beradi, so'rasangiz — chuqur tahlil (Kashfiyotlar)." },
  marketolog: { name: 'Marketolog', role: 'Bozor · raqobatchilar', icon: Megaphone, department: 'marketing', about: "Meta AI orqali raqobatchilarni, akkauntingizni va sohangizda nima ishlayotganini o'rganadi, joylangan postlar natijasini o'lchaydi; topilmalari kontent-rejaga tushadi." },
  target: { name: 'Targetolog', role: 'Meta reklama · Facebook va Instagram', icon: Target, department: 'marketing', about: "Topshirig'ingizdan reklama kampaniyasini tuzadi, siz tasdiqlasangiz — Meta'da ishga tushiradi; sarfni kuzatadi va limitga yetsa o'zi to'xtatadi." },
  kontent: { name: 'Kontent-meyker', role: 'Telegram · Instagram · video', icon: PenLine, department: 'marketing', about: "Kontent-reja tuzadi; Telegram kanali va Instagram uchun post (rasmi bilan) va qisqa video tayyorlaydi; siz tasdiqlagach joylaydi." },
};
export const MEMBERS: Member[] = [...CREW];
export { isCore };

/**
 * Bo'limlar: pastki panelda (telefonda 7 tugma sig'adi) bo'lim bitta tugma, ichida xodimlari. Marketing — Marketolog va Kontent-meyker.
 * DEPARTMENT_OF — bo'lim ichidagi xodim (o'z tugmasi yo'q) qaysi bo'limda va qaysi varaqdan ochiladi
 */
export const DEPARTMENT_OF: Partial<Record<Member, { area: Area; tab: string }>> = { kontent: { area: 'marketolog', tab: 'postlar' }, target: { area: 'marketolog', tab: 'kampaniyalar' } };
export const RAIL_MEMBERS = MEMBERS.filter(m => !DEPARTMENT_OF[m]);
/** Bo'lim tugmasining nomi (ichida bir nechta xodim) */
export const DEPARTMENT_LABEL: Partial<Record<Member, string>> = { marketolog: 'Marketing' };
export const memberHref = (m: Member): string => { const d = DEPARTMENT_OF[m]; return d ? hrefOf(d.area, d.tab) : hrefOf(m as Area); };
/** Pastki paneldagi xodim (o'z bo'limi bor) */
export type RailMember = Exclude<Member, 'kontent' | 'target'>;
export const isMember = (a: Area): a is RailMember => (RAIL_MEMBERS as string[]).includes(a);

/**
 * on — ishlayapti (yashil nuqta); live — hozir faol ish ustida (qo'ng'iroqda, kamera kuzatyapti): nuqta yorqin halqa bilan.
 * next — birinchi kun: xodim ishlashi uchun egasi qiladigan bitta keyingi qadam (bosh ekrandagi kartada tugma); tayyor bo'lsa — null
 */
export interface MemberState { status: string; detail: string; on: boolean; live: boolean; badge: number; next: { label: string; href: string } | null }

/** Direktor: nechta taklif tasdiq kutyapti (nishon), nechta qaror ishda, oxirgi tahlil qachon */
function directorState(v: DirectorView | null): MemberState {
  // Nishon «Sizni kutyapti»dagi Direktor bandlari bilan bir xil (server/attention.ts — tasdiq kutayotgan takliflar)
  const waiting = v?.waiting.length ?? 0;
  const inWork = v?.journal.filter(m => m.status === 'topshirildi').length ?? 0;
  return {
    on: !!v?.run, live: false, badge: waiting, next: null,
    status: waiting ? `${waiting} ta taklif sizni kutyapti` : v?.run ? 'Bugungi tahlil tayyor' : 'Ertalab raqamlarni o‘qiydi',
    detail: v?.run?.problem ? `Muammo: ${v.run.problem}` : inWork ? `${inWork} ta qaror ishda — natijasi o‘lchanadi` : 'Muammo topsa — xodimlarga topshiriq taklif qiladi',
  };
}

/** Targetolog: kabinet ulanganmi, limitlar bormi, nechta reja tasdiq kutyapti (nishon), nechtasi ishlayapti */
function adsState(v: AdsView | null): MemberState {
  const waiting = v?.campaigns.filter(c => c.status === 'proposed').length ?? 0;
  const active = v?.campaigns.filter(c => c.status === 'active').length ?? 0;
  const limits = !!v && v.limits.perCampaign > 0 && v.limits.daily > 0 && v.limits.monthly > 0;
  const tab = (t: string) => hrefOf('marketolog', t);
  const cur = v?.account?.currency ?? '';
  return {
    on: !!v?.account && limits, live: active > 0, badge: waiting,
    status: active ? `${active} ta kampaniya ishlayapti` : waiting ? `${waiting} ta reja tasdiq kutyapti` : v?.account ? 'Kabinet ulangan' : 'Reklama kabineti ulanmagan',
    detail: v?.spend && v.account ? `Bugun ${v.spend.today} ${cur} · oy ${v.spend.month} ${cur}` : 'Ulash — bir marta, token bilan',
    next: !v?.account ? { label: 'Reklama kabinetini ulash', href: tab('kabinet') } : !limits ? { label: 'Limitlarni belgilash', href: tab('kabinet') } : null,
  };
}

/**
 * Kontent-meyker: qayerga joylaydi (Telegram kanal, Instagram), nechta post tasdiq kutyapti (nishon — ikkalasi birga).
 * Keyingi qadam: joylaydigan joy yo'q — ulash; bor, lekin reja yo'q — reja tuzish
 */
function contentState(c: ContentView | null, instagram: string | null): MemberState {
  const waiting = (c?.drafts.filter(d => d.status === 'draft' || d.status === 'failed').length ?? 0) + (c?.igPosts.waiting ?? 0);
  const sources = c?.sources.length ?? 0, channel = c?.settings.channelTitle;
  const drawing = !!c?.igPosts.drawing;
  const where = [channel && `Kanal: ${channel}`, instagram && `Instagram: ${instagram}`].filter(Boolean).join(' · ');
  const tab = (t: string) => hrefOf('marketolog', t);
  return {
    on: !!channel || !!instagram, live: !!c?.running || drawing, badge: waiting,
    status: c?.running ? 'Post yozyapti…' : drawing ? 'Rasm chizilyapti…' : waiting ? `${waiting} ta post tasdiq kutyapti` : where || 'Kanal ulanmagan',
    detail: `${c?.plan.length ? `Rejada ${c.plan.length} mavzu` : 'Reja yo\'q'} · ${sources} ta manba${c?.settings.auto ? ' · har kuni ertalab' : ''}`,
    next: !channel && !instagram ? { label: 'Kanalingizni ulash', href: tab('kanal') } : c && !c.plan.length ? { label: 'Kontent-reja tuzish', href: tab('reja') } : null,
  };
}

/** tick — biror ish bajarilganda (so'rov yopildi, vazifa qo'shildi) darhol yangilash uchun; clinic — DentaCRM bilan ishlaydigan soha */
export function useTeam(status: LiveStatus, tick = 0, clinic = false): Record<Member, MemberState> | null {
  const [team, setTeam] = useState<Record<Member, MemberState> | null>(null);
  const crm = !!status.crm?.account;
  const meta = status.metaAi;
  // Qabulxona navbatchilikda — mijoz yozadigan yoki qo'ng'iroq qiladigan kamida bitta kanal ulangan bo'lsa
  const reachable = !!(status.bot || status.telegramBusiness?.account || status.instagram?.account || status.instagramApi?.account);
  const ownerLinked = !!status.ownerLinked;
  const igAccount = status.instagram?.account ?? null;
  useEffect(() => {
    let stale = false;
    const load = async () => {
      const today = iso(new Date());
      // Kontent-meyker holati boshqalari bilan parallel
      const contentP = api.content().catch(() => null);
      const adsP = api.ads().catch(() => null);
      const directorP = api.director().catch(() => null);
      const [requests, calls, tasks, cameras, day, att, reports] = await Promise.all([
        api.requests('open').catch(() => null), api.calls().catch(() => null), api.tasks('open').catch(() => null),
        api.cameras().catch(() => null), crm ? api.crmDay().then(r => r.day).catch(() => null) : Promise.resolve(null),
        api.attention().catch(() => null), api.agentEvents('marketolog').catch(() => null),
      ]);
      const content = await contentP;
      const ads = await adsP;
      const director = await directorP;
      if (stale) return;
      const callsToday = calls?.calls.filter(c => c.startedAt.slice(0, 10) === today) ?? [];
      const talking = calls?.calls.some(c => c.status === 'talking' || c.status === 'ringing') ?? false;
      const stamp = `${today}T${new Date().toTimeString().slice(0, 5)}`;
      const late = tasks?.tasks.filter(t => t.dueAt && t.dueAt < stamp).length ?? 0;
      const todayLeft = tasks?.tasks.filter(t => t.dueAt && t.dueAt >= stamp && t.dueAt.slice(0, 10) === today).length ?? 0;
      const next = tasks?.tasks.filter(t => t.dueAt && t.dueAt >= stamp).sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))[0] ?? tasks?.tasks.find(t => t.dueAt && t.dueAt < stamp);
      const cams = cameras?.cameras.length ?? 0;
      // Nishon — bosh ekrandagi «Sizni kutyapti»dagi shu xodimning bandlari: hamma joyda bir xil son (jami = bosh ekrandagi)
      const waiting = (m: Member) => att?.items.filter(i => i.member === m).length ?? 0;
      const reception = waiting('qabulxona');
      setTeam({
        direktor: directorState(director),
        qabulxona: {
          on: talking || reachable, live: talking, badge: reception,
          status: talking ? 'Hozir qo‘ng‘iroqda' : reachable ? 'Navbatchilikda' : 'Kanal ulanmagan',
          next: reachable ? null : { label: 'Telegram yoki Instagram’ni ulash', href: hrefOf('sozlamalar', 'telegram') },
          detail: `Bugun ${callsToday.length} qo‘ng‘iroq${reception ? ` · ${reception} ta ish sizni kutyapti` : requests?.open ? ` · ${requests.open} so‘rov` : ''}`,
        },
        yordamchi: {
          on: true, live: false, badge: waiting('yordamchi'),
          status: late ? `${late} ta kechikkan ish` : todayLeft ? `Bugun ${todayLeft} ish` : 'Bugun ish yo‘q',
          detail: next ? `Keyingisi: ${next.title}` : 'Eslatma qo‘yish uchun ayting',
          // Eslatma va ertalabki reja egasining Telegram'iga keladi
          next: ownerLinked ? null : { label: 'Telegram’da ulanish', href: hrefOf('sozlamalar', 'telegram') },
        },
        kuzatuvchi: {
          on: cams > 0, live: cams > 0, badge: waiting('kuzatuvchi'),
          status: cams ? `${cams} kamera kuzatyapti` : 'Kamera ulanmagan',
          // Jadval bilan solishtirish — faqat DentaCRM ulangan bo'lsa (qabullar shundan)
          detail: cams ? (crm ? 'Kreslo va kassa — jadval bilan solishtiriladi' : 'Kreslo, kassa va kutish joyi kuzatiladi') : 'Ulash — 2 daqiqa',
          next: cams ? null : { label: 'Kamerani ulash', href: hrefOf('kuzatuvchi', 'ulash') },
        },
        tahlilchi: {
          // CRM bo'lmasa ham murojaat va so'rovlar hisoblanadi — ishlayapti
          on: crm ? !!day : true, live: !!day, badge: waiting('tahlilchi'),
          status: day ? `Bugun ${day.total} qabul · ${day.came} keldi` : crm ? 'DentaCRM javob bermadi' : `Ochiq so‘rovlar: ${requests?.open ?? 0}`,
          detail: day ? `Bugungi tushum (klinika) ${som(day.revenue.total)}` : crm ? 'Birozdan keyin qayta urinadi' : 'Murojaat va so‘rovlarni hisoblaydi',
          next: clinic && !crm ? { label: 'DentaCRM’ni ulash', href: hrefOf('sozlamalar', 'dentacrm') } : null,
        },
        marketolog: {
          on: !!meta?.connected && !meta.problem, live: false, badge: waiting('marketolog'),
          status: meta?.problem ? 'Meta AI qayta kirishni so‘rayapti' : meta?.connected ? 'Meta AI ulangan' : 'Meta AI ulanmagan',
          next: meta?.problem ? { label: 'Meta AI’ga qayta kirish', href: hrefOf('marketolog', 'ulash') } : meta?.connected ? null : { label: 'Meta AI’ga kirish', href: hrefOf('marketolog', 'ulash') },
          detail: meta?.connected ? `Bugun ${reports?.events.filter(e => iso(new Date(e.at)) === today).length ?? 0} ta tahlil · ${meta.usedToday}/${meta.dailyLimit} savol` : 'Ulash — akkauntingizga bir marta kirasiz',
        },
        kontent: contentState(content, igAccount),
        target: adsState(ads),
      });
    };
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    return () => { stale = true; clearInterval(t); };
  }, [crm, clinic, reachable, ownerLinked, igAccount, meta?.connected, meta?.problem, meta?.usedToday, meta?.dailyLimit, tick]);
  return team;
}
