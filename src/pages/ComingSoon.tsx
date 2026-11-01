/**
 * Tez kunda keladigan AI xodimlar: menyuda va bosh ekranda qulf bilan ko'rinadi — egasi jamoa qayerga qarab o'sayotganini ko'radi,
 * lekin hali ishlamaydigan narsani bosib, bo'sh sahifaga tushmaydi. Yangi xodim qo'shish — UPCOMING ga bitta qator.
 */
import { BookUser, Lock, UserSearch, UsersRound, type LucideIcon } from 'lucide-react';

export interface Upcoming { id: string; name: string; role: string; about: string; icon: LucideIcon; department: Department }
export type Department = 'hr';

export const DEPARTMENTS: Record<Department, { name: string; title: string; about: string; icon: LucideIcon }> = {
  hr: { name: 'HR', title: "HR bo'limi", about: "Xodimlar bilan ish: ishga olish va jamoaning ishini ko'rish. Bu xodimlar tayyorlanmoqda.", icon: UsersRound },
};

export const UPCOMING: Upcoming[] = [
  {
    id: 'rekruter', department: 'hr', name: 'Rekruter', role: 'HR · ishga olish', icon: UserSearch,
    about: "Vakansiya matnini yozadi va joylaydi, kelgan rezyumelarni saralaydi, nomzodlarga savol beradi va eng mosini suhbatga chaqiradi.",
  },
  {
    id: 'xodimlar', department: 'hr', name: 'Xodimlar tahlilchisi', role: 'HR · jamoa', icon: BookUser,
    about: "Har xodimning ishini qo'ng'iroq, yozishma, kamera va CRM bo'yicha ko'rsatadi: kim ko'p mijoz qabul qildi, kim kechikdi, kimga yordam kerak.",
  },
];

/** Qulfli karta: nima qilishi va «Tez kunda» */
export function UpcomingCard({ u, compact = false }: { u: Upcoming; compact?: boolean }) {
  return (
    <article aria-label={`${u.name} — tez kunda`} className={`relative flex flex-col gap-3 rounded-2xl border border-dashed border-glass/12 bg-glass/[0.015] ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-glass/[0.05] text-[#8a909c]">
          <u.icon className="h-5 w-5" aria-hidden="true" />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#07080b] bg-[#1a1c22] text-[#c9cbd2]"><Lock className="h-3 w-3" aria-hidden="true" /></span>
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold text-[#c9cbd2]">{u.name}</span>
          <span className="truncate text-xs text-[#8a909c]">{u.role}</span>
        </div>
        <span className="ml-auto shrink-0 rounded-full bg-glass/[0.06] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c9cbd2]">Tez kunda</span>
      </div>
      <p className={`m-0 leading-relaxed text-[#8a909c] ${compact ? 'text-xs' : 'text-[14px]'}`}>{u.about}</p>
    </article>
  );
}

/** Bo'lim sahifasi: hali ishlamaydigan xodimlar qulf bilan */
export function ComingSoonArea({ department }: { department: Department }) {
  const d = DEPARTMENTS[department];
  const list = UPCOMING.filter(u => u.department === department);
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center gap-4 border-b border-glass/[0.06] pb-6">
        <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-glass/[0.06] text-[#d9dbe1]">
          <d.icon className="h-7 w-7" aria-hidden="true" />
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#07080b] bg-[#1a1c22] text-[#d9dbe1]"><Lock className="h-3.5 w-3.5" aria-hidden="true" /></span>
        </span>
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#f2f0ea]">{d.title}</h1>
          <p className="mt-0.5 text-sm text-[#a3a9b5]">{d.about}</p>
        </div>
        <span className="ml-auto rounded-full bg-glass/[0.06] px-3 py-1 text-[13px] font-semibold text-[#d9dbe1]">🔒 Tez kunda</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{list.map(u => <UpcomingCard key={u.id} u={u} />)}</div>
    </div>
  );
}
