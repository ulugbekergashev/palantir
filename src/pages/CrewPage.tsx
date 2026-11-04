/**
 * «AI xodimlar» (#/xodimlar): hamma AI xodim bitta joyda, bo'lim-bo'lim — jamoadagilari, ishga olinadiganlari va tez kunda keladiganlari.
 * Standart jamoa — Direktor va Yordamchi; qolganini egasi shu yerda «+ Ishga olish» bilan qo'shadi va u menyu hamda bosh ekranda paydo bo'ladi.
 * Olib tashlangan xodim menyudan chiqadi va fonda ishlamaydi; ma'lumotlari o'chmaydi (qaytib olinsa — joyida).
 * Tez kunda keladigan xodim — UPCOMING ga bitta qator (o'z bo'limi bilan); ishlay boshlaganda bu yerdan olinib, jamoaga (components/team.tsx) o'tadi.
 */
import { useState } from 'react';
import {
  ArrowRight, BadgeCheck, Calculator, Check, GraduationCap, Handshake, Loader2, Lock, MessageSquareHeart, PackageSearch, Plus, Repeat, Scale,
  ShoppingCart, Star, UserSearch, Users, type LucideIcon,
} from 'lucide-react';
import { api } from '../data/api';
import { DEPARTMENTS, MEMBERS, TEAM, isCore, memberHref, type Department, type Member } from '../components/team';
import { HUE } from '../components/agent';
import type { Notify } from '../components/Artifacts';

export interface Upcoming { id: string; name: string; role: string; about: string; icon: LucideIcon; department: Department }

/**
 * Tez kunda keladiganlar. Ishdagi xodimning ishini takrorlaydigani qo'shilmaydi: haftalik xulosa — Direktor va Tahlilchida,
 * video — Kontent-meykerda; xodimlar ishini baholash — bitta Sifat nazoratchisida.
 */
export const UPCOMING: Upcoming[] = [
  { id: 'sotuvchi', department: 'sotuv', name: 'Sotuvchi', role: 'Sotuv · yangi mijozlar', icon: Handshake,
    about: "Ehtimoliy mijozlarni topadi, birinchi xabarni yozadi, tijorat taklifini tayyorlaydi va javob kelguncha kuzatib boradi." },
  { id: 'qaytaruvchi', department: 'sotuv', name: 'Mijozlarni qaytaruvchi', role: 'Sotuv · qayta kelish', icon: Repeat,
    about: "Ko'pdan beri kelmagan mijozlarni topadi, ularga o'z vaqtida eslatma va shaxsiy taklif yuboradi." },
  { id: 'sharhlar', department: 'sotuv', name: 'Sharh menejeri', role: "Sotuv · obro'", icon: Star,
    about: "Google, 2GIS va Yandex'dagi sharhlarga javob yozadi, mamnun mijozlardan sharh so'raydi, yomon sharhni darhol aytadi." },
  { id: 'hamkorlik', department: 'marketing', name: 'Hamkorlik menejeri', role: 'Marketing · blogerlar', icon: MessageSquareHeart,
    about: "Mos blogerlar va hamkorlarni topadi, taklif yozadi, kelishuv va natijani kuzatadi." },
  { id: 'sifat', department: 'sifat', name: 'Sifat nazoratchisi', role: 'Sifat · xodimlar ishi', icon: BadgeCheck,
    about: "Qo'ng'iroq, yozishma va kamera bo'yicha har xodimning ishini baholaydi: skriptga rioya, xushmuomalalik, kim ko'p mijoz qabul qildi, yo'qotilgan mijozlar sababi." },
  { id: 'rekruter', department: 'hr', name: 'Rekruter', role: 'HR · ishga olish', icon: UserSearch,
    about: "Vakansiya matnini yozadi va joylaydi, kelgan rezyumelarni saralaydi, nomzodlarga savol beradi va eng mosini suhbatga chaqiradi." },
  { id: 'murabbiy', department: 'hr', name: 'Murabbiy', role: "HR · o'rgatish", icon: GraduationCap,
    about: "Yangi xodimni o'rgatadi: qoidalar, javob skriptlari, test savollari; xatolardan qisqa darslar tayyorlaydi." },
  { id: 'buxgalter', department: 'moliya', name: 'Buxgalter', role: 'Moliya · hisob', icon: Calculator,
    about: "Kirim-chiqimni yuritadi, xarajatlarni toifalaydi, oylik va soliq hisobotlari uchun ma'lumotni tayyorlaydi." },
  { id: 'kassa', department: 'moliya', name: 'Kassa nazoratchisi', role: 'Moliya · kassa va qarzlar', icon: Calculator,
    about: "Kassa, CRM va kamera ma'lumotini solishtiradi; qarzdor mijozlarga eslatadi va to'lovlarni kuzatadi." },
  { id: 'xaridor', department: 'taminot', name: 'Xaridor', role: "Ta'minot · xarid", icon: ShoppingCart,
    about: "Ta'minotchilardan narx so'raydi va solishtiradi, buyurtma qoralamasini tayyorlaydi, yetkazib berishni kuzatadi." },
  { id: 'omborchi', department: 'taminot', name: 'Omborchi', role: "Ta'minot · zaxira", icon: PackageSearch,
    about: "Materiallar qoldig'ini kuzatadi, tugayotganini oldindan aytadi va xaridorga buyurtma beradi." },
  { id: 'yurist', department: 'huquq', name: 'Yurist', role: 'Huquq · hujjatlar', icon: Scale,
    about: "Shartnomalarni tekshiradi va xavfli bandlarni ko'rsatadi, namunaviy hujjatlar tayyorlaydi, muddatlarni eslatadi." },
];

/** Olib tashlansa nima to'xtaydi — egasi bilib qaror qilsin */
const STOPS: Partial<Record<Member, string>> = {
  qabulxona: 'mijozlarga javob tayyorlamaydi va yubormaydi (xabarlar saqlanaveradi)',
  kuzatuvchi: "kamera xabarlari, topshiriqlari va kechki hisoboti to'xtaydi",
  tahlilchi: "topshiriqlari to'xtaydi",
  marketolog: "topshiriqlari to'xtaydi",
  kontent: "ertalabki qoralamalar yozilmaydi",
  target: 'yangi kampaniya tuzmaydi',
};

const CARD = 'relative flex min-w-0 flex-col gap-3 rounded-2xl border p-5';

function MemberCard({ m, hired, canChange, onChange, notify }: { m: Member; hired: boolean; canChange: boolean; onChange: (crew: Member[]) => void; notify: Notify }) {
  const meta = TEAM[m], h = HUE[m], core = isCore(m);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      const r = await api.setCrew(m, on);
      onChange(r.crew);
      setAsking(false);
      notify(on ? `${meta.name} jamoaga qo'shildi — menyuda va bosh ekranda` : `${meta.name} jamoadan olib tashlandi`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article aria-label={meta.name} className={`${CARD} ${hired ? 'border-glass/12 bg-glass/[0.04]' : 'border-glass/10 bg-glass/[0.02]'}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${h.a}1f`, color: h.text }}>
          <meta.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-semibold text-[#f2f0ea]">{meta.name}</span>
          <span className="truncate text-xs text-[#9ba1ad]">{meta.role}</span>
        </div>
        {hired && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-300">
            <Check className="h-3 w-3" aria-hidden="true" />{core ? 'Asosiy' : 'Jamoada'}
          </span>
        )}
      </div>
      <p className="m-0 text-[14px] leading-relaxed text-[#a3a9b5]">{meta.about}</p>
      {asking ? (
        <div role="alertdialog" aria-label={`${meta.name}ni olib tashlash`} className="mt-auto space-y-2.5 rounded-xl border border-[#f5b454]/25 bg-[#f5b454]/[0.06] p-3">
          <p className="m-0 text-[13px] leading-relaxed text-[#e9dcc4]">
            {meta.name} menyudan chiqadi va fonda ishlamaydi{STOPS[m] ? `: ${STOPS[m]}` : ''}. Ma'lumotlari o'chmaydi — qaytib olsangiz, joyida.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => { void change(false); }}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-[#f5b454] px-3.5 text-[13px] font-semibold text-[#1a0f05] disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Ha, olib tashlash
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-10 rounded-lg px-3.5 text-[13px] font-semibold text-[#c9cbd2] hover:bg-glass/5">Qolsin</button>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {hired ? (
            <>
              <a href={memberHref(m)} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-glass/12 px-3.5 text-[13px] font-semibold text-[#e4e3de] no-underline hover:bg-glass/5">
                Ochish <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              {!core && canChange && <button type="button" onClick={() => setAsking(true)} className="min-h-10 rounded-lg px-3 text-[13px] text-[#8a909c] hover:bg-glass/5 hover:text-[#d9dbe1]">Olib tashlash</button>}
            </>
          ) : canChange && (
            <button type="button" disabled={busy} onClick={() => { void change(true); }}
              className="flex min-h-10 items-center gap-1.5 rounded-lg bg-[#ff9a3c] px-3.5 text-[13px] font-semibold text-[#1a0f05] transition-colors hover:bg-[#ffb062] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Ishga olish
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** Qulfli karta: nima qiladi va «Tez kunda» */
function UpcomingCard({ u }: { u: Upcoming }) {
  return (
    <article aria-label={`${u.name} — tez kunda`} className={`${CARD} border-dashed border-glass/12 bg-glass/[0.015]`}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-glass/[0.05] text-[#8a909c]">
          <u.icon className="h-5 w-5" aria-hidden="true" />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#07080b] bg-[#1a1c22] text-[#c9cbd2]"><Lock className="h-3 w-3" aria-hidden="true" /></span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-semibold text-[#c9cbd2]">{u.name}</span>
          <span className="truncate text-xs text-[#8a909c]">{u.role}</span>
        </div>
        <span className="ml-auto shrink-0 rounded-full bg-glass/[0.06] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c9cbd2]">Tez kunda</span>
      </div>
      <p className="m-0 text-[14px] leading-relaxed text-[#8a909c]">{u.about}</p>
    </article>
  );
}

/** owner — faqat egasi (va o'rnatuvchi) xodim qo'sha oladi; klinika xodimi faqat ko'radi */
export function CrewArea({ crew, onCrew, notify, owner }: { crew: Member[]; onCrew: (crew: Member[]) => void; notify: Notify; owner: boolean }) {
  const groups = (Object.keys(DEPARTMENTS) as Department[]).map(d => ({
    d, members: MEMBERS.filter(m => TEAM[m].department === d), soon: UPCOMING.filter(u => u.department === d),
  })).filter(g => g.members.length || g.soon.length);
  const free = MEMBERS.filter(m => !crew.includes(m)).length;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-4 border-b border-glass/[0.06] pb-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff9a3c]/15 text-[#ffd9a0]"><Users className="h-7 w-7" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#f2f0ea]">AI xodimlar</h1>
          <p className="mt-0.5 text-sm text-[#a3a9b5]">
            Jamoangizda {crew.length} ta xodim{free ? ` · yana ${free} tasini olish mumkin` : ''} · {UPCOMING.length} tasi tez kunda.
            {' '}Kerakli xodimni ishga oling — u menyu va bosh ekranda paydo bo'ladi. Direktor va Yordamchi doim jamoada.
          </p>
        </div>
      </header>
      {groups.map(({ d, members, soon }) => (
        <section key={d} aria-label={DEPARTMENTS[d].name} className="space-y-3">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">
            {DEPARTMENTS[d].name}<span className="font-normal normal-case tracking-normal text-[#7d838f]">· {DEPARTMENTS[d].about}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map(m => <MemberCard key={m} m={m} hired={crew.includes(m)} canChange={owner} onChange={onCrew} notify={notify} />)}
            {soon.map(u => <UpcomingCard key={u.id} u={u} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
