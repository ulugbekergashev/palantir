/**
 * Tez kunda keladigan AI xodimlar: menyuda («Tez kunda») va bosh ekranda qulf bilan ko'rinadi — egasi jamoa qayerga qarab
 * o'sayotganini ko'radi, lekin hali ishlamaydigan narsani bosib, bo'sh sahifaga tushmaydi.
 * Yangi xodim — UPCOMING ga bitta qator; ishlay boshlaganda bu yerdan olinib, jamoaga (components/team.tsx) o'tadi.
 */
import {
  BadgeCheck, BookUser, Briefcase, Calculator, GraduationCap, Handshake, Hourglass, Landmark, Lock, Megaphone, MessageSquareHeart,
  PackageSearch, Repeat, Scale, ShieldCheck, ShoppingCart, Sparkles, Star, UserSearch, UsersRound, Warehouse, type LucideIcon,
} from 'lucide-react';

export type Department = 'sotuv' | 'marketing' | 'hr' | 'moliya' | 'taminot' | 'sifat' | 'huquq' | 'boshqaruv';

export const DEPARTMENTS: Record<Department, { name: string; about: string; icon: LucideIcon }> = {
  sotuv: { name: 'Sotuv', about: 'Yangi mijoz topish, qaytarish va obro\'', icon: Handshake },
  marketing: { name: 'Marketing', about: 'Blogerlar va hamkorliklar', icon: Megaphone },
  hr: { name: 'HR', about: 'Ishga olish, o\'rgatish va jamoaning ishi', icon: UsersRound },
  moliya: { name: 'Moliya', about: 'Hisob, kassa va qarzlar', icon: Landmark },
  taminot: { name: "Ta'minot", about: 'Xarid va ombor', icon: Warehouse },
  sifat: { name: 'Sifat', about: 'Xizmat sifati va standartlar', icon: ShieldCheck },
  huquq: { name: 'Huquq', about: 'Shartnoma va hujjatlar', icon: Scale },
  boshqaruv: { name: 'Boshqaruv', about: 'Strategiya va rahbarga maslahat', icon: Briefcase },
};

export interface Upcoming { id: string; name: string; role: string; about: string; icon: LucideIcon; department: Department }

export const UPCOMING: Upcoming[] = [
  // Sotuv
  { id: 'sotuvchi', department: 'sotuv', name: 'Sotuvchi', role: 'Sotuv · yangi mijozlar', icon: Handshake,
    about: "Ehtimoliy mijozlarni topadi, birinchi xabarni yozadi, tijorat taklifini tayyorlaydi va javob kelguncha kuzatib boradi." },
  { id: 'qaytaruvchi', department: 'sotuv', name: 'Mijozlarni qaytaruvchi', role: 'Sotuv · qayta kelish', icon: Repeat,
    about: "Ko'pdan beri kelmagan mijozlarni topadi, ularga o'z vaqtida eslatma va shaxsiy taklif yuboradi." },
  { id: 'sharhlar', department: 'sotuv', name: 'Sharh menejeri', role: "Sotuv · obro'", icon: Star,
    about: "Google, 2GIS va Yandex'dagi sharhlarga javob yozadi, mamnun mijozlardan sharh so'raydi, yomon sharhni darhol aytadi." },
  // Marketing
  // Video alohida xodim emas — Kontent-meykerning formati (ssenariy, ovoz, mp4 uning «Video» varag'ida)
  { id: 'hamkorlik', department: 'marketing', name: 'Hamkorlik menejeri', role: 'Marketing · blogerlar', icon: MessageSquareHeart,
    about: "Mos blogerlar va hamkorlarni topadi, taklif yozadi, kelishuv va natijani kuzatadi." },
  // HR
  { id: 'rekruter', department: 'hr', name: 'Rekruter', role: 'HR · ishga olish', icon: UserSearch,
    about: "Vakansiya matnini yozadi va joylaydi, kelgan rezyumelarni saralaydi, nomzodlarga savol beradi va eng mosini suhbatga chaqiradi." },
  { id: 'xodimlar', department: 'hr', name: 'Xodimlar tahlilchisi', role: 'HR · jamoa', icon: BookUser,
    about: "Har xodimning ishini qo'ng'iroq, yozishma, kamera va CRM bo'yicha ko'rsatadi: kim ko'p mijoz qabul qildi, kim kechikdi, kimga yordam kerak." },
  { id: 'murabbiy', department: 'hr', name: 'Murabbiy', role: "HR · o'rgatish", icon: GraduationCap,
    about: "Yangi xodimni o'rgatadi: qoidalar, javob skriptlari, test savollari; xatolardan qisqa darslar tayyorlaydi." },
  // Moliya
  { id: 'buxgalter', department: 'moliya', name: 'Buxgalter', role: 'Moliya · hisob', icon: Calculator,
    about: "Kirim-chiqimni yuritadi, xarajatlarni toifalaydi, oylik va soliq hisobotlari uchun ma'lumotni tayyorlaydi." },
  { id: 'kassa', department: 'moliya', name: 'Kassa nazoratchisi', role: 'Moliya · kassa va qarzlar', icon: Landmark,
    about: "Kassa, CRM va kamera ma'lumotini solishtiradi; qarzdor mijozlarga eslatadi va to'lovlarni kuzatadi." },
  // Ta'minot
  { id: 'xaridor', department: 'taminot', name: 'Xaridor', role: "Ta'minot · xarid", icon: ShoppingCart,
    about: "Ta'minotchilardan narx so'raydi va solishtiradi, buyurtma qoralamasini tayyorlaydi, yetkazib berishni kuzatadi." },
  { id: 'omborchi', department: 'taminot', name: 'Omborchi', role: "Ta'minot · zaxira", icon: PackageSearch,
    about: "Materiallar qoldig'ini kuzatadi, tugayotganini oldindan aytadi va xaridorga buyurtma beradi." },
  // Sifat
  { id: 'sifat', department: 'sifat', name: 'Sifat nazoratchisi', role: 'Sifat · xizmat', icon: BadgeCheck,
    about: "Qo'ng'iroq va yozishmalarni tinglab baholaydi: skriptga rioya, xushmuomalalik, yo'qotilgan mijozlar sababi." },
  // Huquq
  { id: 'yurist', department: 'huquq', name: 'Yurist', role: 'Huquq · hujjatlar', icon: Scale,
    about: "Shartnomalarni tekshiradi va xavfli bandlarni ko'rsatadi, namunaviy hujjatlar tayyorlaydi, muddatlarni eslatadi." },
  // Boshqaruv
  { id: 'strateg', department: 'boshqaruv', name: 'Strateg', role: 'Boshqaruv · maslahat', icon: Sparkles,
    about: "Hamma xodimlar ma'lumotidan haftalik xulosa chiqaradi: nima o'smoqda, nima tushmoqda, keyingi hafta nimaga e'tibor berish kerak." },
];

/** Qulfli karta: nima qilishi va «Tez kunda» */
export function UpcomingCard({ u, compact = false }: { u: Upcoming; compact?: boolean }) {
  return (
    <article aria-label={`${u.name} — tez kunda`} className={`relative flex flex-col gap-3 rounded-2xl border border-dashed border-glass/12 bg-glass/[0.015] ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-glass/[0.05] text-[#8a909c]">
          <u.icon className="h-5 w-5" aria-hidden="true" />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#07080b] bg-[#1a1c22] text-[#c9cbd2]"><Lock className="h-3 w-3" aria-hidden="true" /></span>
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold text-[#c9cbd2]">{u.name}</span>
          <span className="truncate text-xs text-[#8a909c]">{u.role}</span>
        </div>
        <span className="ml-auto shrink-0 rounded-full bg-glass/[0.06] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c9cbd2]">Tez kunda</span>
      </div>
      {!compact && <p className="m-0 text-[14px] leading-relaxed text-[#8a909c]">{u.about}</p>}
    </article>
  );
}

/** «Tez kunda» bo'limi: hali ishlamaydigan xodimlar bo'lim-bo'lim, qulf bilan */
export function ComingSoonArea() {
  const groups = (Object.keys(DEPARTMENTS) as Department[]).map(d => ({ d, list: UPCOMING.filter(u => u.department === d) })).filter(g => g.list.length);
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-4 border-b border-glass/[0.06] pb-6">
        <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-glass/[0.06] text-[#d9dbe1]">
          <Hourglass className="h-7 w-7" aria-hidden="true" />
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#07080b] bg-[#1a1c22] text-[#d9dbe1]"><Lock className="h-3.5 w-3.5" aria-hidden="true" /></span>
        </span>
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#f2f0ea]">Tez kunda</h1>
          <p className="mt-0.5 text-sm text-[#a3a9b5]">Jamoaga qo'shilayotgan {UPCOMING.length} ta AI xodim. Hozir tayyorlanmoqda — tayyor bo'lgani shu yerdan jamoaga o'tadi.</p>
        </div>
      </header>
      {groups.map(({ d, list }) => {
        const D = DEPARTMENTS[d];
        return (
          <section key={d} aria-label={`${D.name} — tez kunda`} className="space-y-3">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a3a9b5]">
              <D.icon className="h-4 w-4" aria-hidden="true" />{D.name}<span className="font-normal normal-case tracking-normal text-[#7d838f]">· {D.about}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(u => <UpcomingCard key={u.id} u={u} />)}</div>
          </section>
        );
      })}
    </div>
  );
}
