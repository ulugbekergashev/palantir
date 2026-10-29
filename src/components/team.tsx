/**
 * AI jamoa: har xodim kim, nima qiladi va hozir nima bilan band — bosh ekrandagi kartalar va xodim sahifasining sarlavhasi
 * shu yerdan. Holat haqiqiy ma'lumotdan (so'rovlar, qo'ng'iroqlar, vazifalar, kameralar, DentaCRM), 30 soniyada yangilanadi.
 */
import { useEffect, useState } from 'react';
import { Camera, ChartLine, Headset, UserRound, type LucideIcon } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api } from '../data/api';
import { iso } from '../lib/week';
import type { Area } from '../lib/nav';
import { som } from '../lib/text';

export type Member = 'qabulxona' | 'yordamchi' | 'kuzatuvchi' | 'tahlilchi';

export const TEAM: Record<Member, { name: string; role: string; about: string; icon: LucideIcon }> = {
  qabulxona: { name: 'Qabulxona', role: 'Telefon · Instagram · Telegram', icon: Headset, about: "Mijozlarga kunu tun javob beradi, qabulga yozadi; o'zi hal qila olmaganini sizga so'rov qilib qoldiradi." },
  yordamchi: { name: 'Yordamchi', role: "Sizning o'ng qo'lingiz", icon: UserRound, about: 'Eslatadi, hujjat tayyorlaydi, savolingizga javob beradi — ovoz bilan yoki yozib.' },
  kuzatuvchi: { name: 'Kuzatuvchi', role: 'Kameralar', icon: Camera, about: "Kameralarni kuzatadi, siz bergan topshiriqlarni bajaradi va kadrga qarab savolingizga javob beradi; kelganlarni DentaCRM bilan solishtiradi." },
  tahlilchi: { name: 'Tahlilchi', role: 'Raqamlar · DentaCRM', icon: ChartLine, about: "Murojaatlar, qabul va tushum — kunlik va haftalik ko'rinishda." },
};
export const MEMBERS = Object.keys(TEAM) as Member[];
export const isMember = (a: Area): a is Member => (MEMBERS as string[]).includes(a);

/** on — ishlayapti (yashil nuqta); live — hozir faol ish ustida (qo'ng'iroqda, kamera kuzatyapti): nuqta yorqin halqa bilan */
export interface MemberState { status: string; detail: string; on: boolean; live: boolean; badge: number }

/** tick — biror ish bajarilganda (so'rov yopildi, vazifa qo'shildi) darhol yangilash uchun */
export function useTeam(status: LiveStatus, tick = 0): Record<Member, MemberState> | null {
  const [team, setTeam] = useState<Record<Member, MemberState> | null>(null);
  const crm = !!status.crm?.account;
  // Qabulxona navbatchilikda — mijoz yozadigan yoki qo'ng'iroq qiladigan kamida bitta kanal ulangan bo'lsa
  const reachable = !!(status.bot || status.telegramBusiness?.account || status.instagram?.account || status.instagramApi?.account);
  useEffect(() => {
    let stale = false;
    const load = async () => {
      const today = iso(new Date());
      const [requests, calls, tasks, cameras, day, att] = await Promise.all([
        api.requests('open').catch(() => null), api.calls().catch(() => null), api.tasks('open').catch(() => null),
        api.cameras().catch(() => null), crm ? api.crmDay().then(r => r.day).catch(() => null) : Promise.resolve(null),
        api.attention().catch(() => null),
      ]);
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
          detail: `Bugun ${callsToday.length} qo‘ng‘iroq${reception ? ` · ${reception} ta ish sizni kutyapti` : requests?.open ? ` · ${requests.open} so‘rov` : ''}`,
        },
        yordamchi: {
          on: true, live: false, badge: waiting('yordamchi'),
          status: late ? `${late} ta kechikkan ish` : todayLeft ? `Bugun ${todayLeft} ish` : 'Bugun ish yo‘q',
          detail: next ? `Keyingisi: ${next.title}` : 'Eslatma qo‘yish uchun ayting',
        },
        kuzatuvchi: {
          on: cams > 0, live: cams > 0, badge: waiting('kuzatuvchi'),
          status: cams ? `${cams} kamera kuzatyapti` : 'Kamera ulanmagan',
          detail: cams ? 'Kreslo va kassa — jadval bilan solishtiriladi' : 'Ulash — 2 daqiqa',
        },
        tahlilchi: {
          on: !!day, live: !!day, badge: waiting('tahlilchi'),
          status: day ? `Bugun ${day.total} qabul · ${day.came} keldi` : crm ? 'DentaCRM javob bermadi' : 'DentaCRM ulanmagan',
          detail: day ? `Tushum ${som(day.revenue.total)}` : 'Ulasangiz, qabul va tushumni aytadi',
        },
      });
    };
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    return () => { stale = true; clearInterval(t); };
  }, [crm, reachable, tick]);
  return team;
}
