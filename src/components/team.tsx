/**
 * AI jamoa: har xodim kim, nima qiladi va hozir nima bilan band — bosh ekrandagi kartalar va xodim sahifasining sarlavhasi
 * shu yerdan. Holat haqiqiy ma'lumotdan (so'rovlar, qo'ng'iroqlar, vazifalar, kameralar, DentaCRM), 30 soniyada yangilanadi.
 */
import { useEffect, useState } from 'react';
import { Camera, ChartLine, Headset, Megaphone, PenLine, UserRound, type LucideIcon } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api, type ContentView } from '../data/api';
import { iso } from '../lib/week';
import { hrefOf, type Area } from '../lib/nav';
import { som } from '../lib/text';

export type Member = 'qabulxona' | 'yordamchi' | 'kuzatuvchi' | 'tahlilchi' | 'marketolog' | 'kontent';

export const TEAM: Record<Member, { name: string; role: string; about: string; icon: LucideIcon }> = {
  qabulxona: { name: 'Qabulxona', role: 'Telefon · Instagram · Telegram', icon: Headset, about: "Mijozlarga kunu tun javob beradi, yozilish va savollarni hal qiladi; o'zi hal qila olmaganini sizga so'rov qilib qoldiradi." },
  yordamchi: { name: 'Yordamchi', role: "Sizning o'ng qo'lingiz", icon: UserRound, about: 'Eslatadi, hujjat tayyorlaydi, savolingizga javob beradi — ovoz bilan yoki yozib.' },
  kuzatuvchi: { name: 'Kuzatuvchi', role: 'Kameralar', icon: Camera, about: "Kameralarni kuzatadi, siz bergan topshiriqlarni bajaradi va kadrga qarab savolingizga javob beradi; kelganlarni jadval bilan solishtiradi." },
  tahlilchi: { name: 'Tahlilchi', role: 'Raqamlar', icon: ChartLine, about: "Murojaatlar, so'rovlar va natija (CRM ulangan bo'lsa — qabul va tushum ham) — kunlik va haftalik ko'rinishda." },
  marketolog: { name: 'Marketolog', role: 'Meta AI · Instagram', icon: Megaphone, about: "Meta AI orqali raqobatchilarni, akkauntingizni va videolarni tahlil qiladi; kontent-reja va post g'oyalarini tayyorlaydi." },
  kontent: { name: 'Kontent-meyker', role: 'Telegram kanal · kontent-zavod', icon: PenLine, about: "Siz kuzatadigan kanallardagi yangiliklardan kanalingiz uchun post yozadi; siz «Joylash»ni bossangiz — kanalga chiqaradi." },
};
export const MEMBERS = Object.keys(TEAM) as Member[];

/**
 * Bo'limlar: pastki panelda (telefonda 7 tugma sig'adi) bo'lim bitta tugma, ichida xodimlari. Marketing — Marketolog va Kontent-meyker.
 * DEPARTMENT_OF — bo'lim ichidagi xodim (o'z tugmasi yo'q) qaysi bo'limda va qaysi varaqdan ochiladi
 */
export const DEPARTMENT_OF: Partial<Record<Member, { area: Area; tab: string }>> = { kontent: { area: 'marketolog', tab: 'qoralamalar' } };
export const RAIL_MEMBERS = MEMBERS.filter(m => !DEPARTMENT_OF[m]);
/** Bo'lim tugmasining nomi (ichida bir nechta xodim) */
export const DEPARTMENT_LABEL: Partial<Record<Member, string>> = { marketolog: 'Marketing' };
export const memberHref = (m: Member): string => { const d = DEPARTMENT_OF[m]; return d ? hrefOf(d.area, d.tab) : hrefOf(m as Area); };
/** Pastki paneldagi xodim (o'z bo'limi bor) */
export type RailMember = Exclude<Member, 'kontent'>;
export const isMember = (a: Area): a is RailMember => (RAIL_MEMBERS as string[]).includes(a);

/**
 * on — ishlayapti (yashil nuqta); live — hozir faol ish ustida (qo'ng'iroqda, kamera kuzatyapti): nuqta yorqin halqa bilan.
 * next — birinchi kun: xodim ishlashi uchun egasi qiladigan bitta keyingi qadam (bosh ekrandagi kartada tugma); tayyor bo'lsa — null
 */
export interface MemberState { status: string; detail: string; on: boolean; live: boolean; badge: number; next: { label: string; href: string } | null;
  /** Bu biznesda ishlatilmaydi (kamerasi yo'q, klinika emas): bosh ekranda ko'rsatilmaydi va «ulang» deb bezovta qilmaydi */
  hidden?: boolean }

/** Kontent-meyker: kanal ulanganmi, nechta manba, nechta qoralama tasdiq kutyapti (nishon) */
function contentState(c: ContentView | null): MemberState {
  const waiting = c?.drafts.filter(d => d.status === 'draft' || d.status === 'failed').length ?? 0;
  const sources = c?.sources.length ?? 0, channel = c?.settings.channelTitle;
  const tab = (t: string) => hrefOf('marketolog', t);
  return {
    on: !!channel && sources > 0, live: !!c?.running, badge: waiting,
    // Ishlatilmayotgan biznesda (kanal ham, manba ham yo'q) bosh ekranda ko'rinmaydi — Marketing bo'limida bor
    hidden: !!c && !channel && !sources && !waiting,
    status: c?.running ? 'Post yozyapti…' : waiting ? `${waiting} ta post tasdiq kutyapti` : channel ? `Kanal: ${channel}` : 'Kanal ulanmagan',
    detail: `${sources} ta manba${c?.settings.auto ? ' · har kuni ertalab' : ''}`,
    next: !sources ? { label: "Kuzatiladigan kanal qo'shish", href: tab('manbalar') } : !channel ? { label: 'Kanalingizni ulash', href: tab('kanal') } : null,
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
  useEffect(() => {
    let stale = false;
    const load = async () => {
      const today = iso(new Date());
      // Kontent-meyker holati boshqalari bilan parallel
      const contentP = api.content().catch(() => null);
      const [requests, calls, tasks, cameras, day, att, reports] = await Promise.all([
        api.requests('open').catch(() => null), api.calls().catch(() => null), api.tasks('open').catch(() => null),
        api.cameras().catch(() => null), crm ? api.crmDay().then(r => r.day).catch(() => null) : Promise.resolve(null),
        api.attention().catch(() => null), api.agentEvents('marketolog').catch(() => null),
      ]);
      const content = await contentP;
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
          on: cams > 0, live: cams > 0, badge: waiting('kuzatuvchi'), hidden: !cams && !clinic,
          status: cams ? `${cams} kamera kuzatyapti` : 'Kamera ulanmagan',
          detail: cams ? 'Kreslo va kassa — jadval bilan solishtiriladi' : 'Ulash — 2 daqiqa',
          next: cams ? null : { label: 'Kamerani ulash', href: hrefOf('kuzatuvchi', 'ulash') },
        },
        tahlilchi: {
          // CRM bo'lmasa ham murojaat va so'rovlar hisoblanadi — ishlayapti
          on: crm ? !!day : true, live: !!day, badge: waiting('tahlilchi'),
          status: day ? `Bugun ${day.total} qabul · ${day.came} keldi` : crm ? 'DentaCRM javob bermadi' : `Ochiq so‘rovlar: ${requests?.open ?? 0}`,
          detail: day ? `Tushum ${som(day.revenue.total)}` : crm ? 'Birozdan keyin qayta urinadi' : 'Murojaat va so‘rovlarni hisoblaydi',
          next: clinic && !crm ? { label: 'DentaCRM’ni ulash', href: hrefOf('sozlamalar', 'dentacrm') } : null,
        },
        marketolog: {
          on: !!meta?.connected && !meta.problem, live: false, badge: waiting('marketolog'),
          status: meta?.problem ? 'Meta AI qayta kirishni so‘rayapti' : meta?.connected ? 'Meta AI ulangan' : 'Meta AI ulanmagan',
          next: meta?.problem ? { label: 'Meta AI’ga qayta kirish', href: hrefOf('marketolog', 'ulash') } : meta?.connected ? null : { label: 'Meta AI’ga kirish', href: hrefOf('marketolog', 'ulash') },
          detail: meta?.connected ? `Bugun ${reports?.events.filter(e => iso(new Date(e.at)) === today).length ?? 0} ta tahlil · ${meta.usedToday}/${meta.dailyLimit} savol` : 'Ulash — akkauntingizga bir marta kirasiz',
        },
        kontent: contentState(content),
      });
    };
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    return () => { stale = true; clearInterval(t); };
  }, [crm, clinic, reachable, ownerLinked, meta?.connected, meta?.problem, meta?.usedToday, meta?.dailyLimit, tick]);
  return team;
}
