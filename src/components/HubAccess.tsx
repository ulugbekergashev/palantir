/**
 * Sotuvchi Hub'dan qo'ygan ishlash holati (server/hubAccess.ts): warn — sahifa tepasida ingichka eslatma (yopilmaydi: to'lov yoki
 * aloqa haqida, egasi bilishi shart); blocked — butun ekran: panel yopiq, nima ishlayveradi va nima qilish kerak. Palantir jamoasi
 * masofadan kirganda (support) ekran ko'rsatilmaydi — yordam bera olsin. Holat App.tsx da tez-tez so'raladi: sotuvchi ochsa, ekran o'zi yo'qoladi.
 */
import { Lock, TriangleAlert } from 'lucide-react';
import type { AccessView } from '../data/api';

export function AccessBanner({ access }: { access: AccessView }) {
  const text = access.reason === 'offline'
    ? `Palantir serveri bilan ${access.offlineDays} kundan beri aloqa yo'q — internetni tekshiring, 30 kun bo'lsa Palantir to'xtaydi`
    : access.message || "Sotuvchidan eslatma — sotuvchiga murojaat qiling";
  return (
    <div role="status" className="flex w-full items-center justify-center gap-2 border-b border-[#ff9a3c]/25 bg-[#1c1309] px-3.5 py-2 text-xs font-semibold text-[#ffd9a8] lg:pl-[var(--rail,224px)]">
      <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function AccessBlockedScreen({ access }: { access: AccessView }) {
  const offline = access.reason === 'offline';
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0c0d11] p-4 text-slate-200">
      <section role="alert" aria-labelledby="blocked-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#15171d] p-6 shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2a110d] text-[#ffb4a6]"><Lock className="h-6 w-6" aria-hidden="true" /></div>
        <div>
          <h1 id="blocked-title" className="text-lg font-bold text-white">{offline ? "Palantir to'xtadi — server bilan aloqa yo'q" : "Palantir to'xtatilgan"}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {offline
              ? `${access.offlineDays} kundan beri Palantir serveri bilan aloqa bo'lmadi. Internetni tekshiring — aloqa tiklanishi bilan panel o'zi ochiladi.`
              : 'Sotuvchi Palantir ishini to\'xtatdi. Qayta ochish uchun sotuvchiga murojaat qiling — u ochsa, panel bir necha daqiqada o\'zi ochiladi.'}
          </p>
        </div>
        {!offline && access.message && <blockquote className="rounded-xl bg-white/5 px-4 py-3 text-sm text-slate-200">«{access.message}»</blockquote>}
        <ul className="space-y-1.5 text-sm text-slate-400">
          <li>• Panel va AI xodimlar ishlamaydi.</li>
          <li>• Qo'ng'iroqlarni administrator telefoni oladi.</li>
          <li>• Bemorlarning xabarlari yo'qolmaydi — Telegram'da sizga keladi.</li>
        </ul>
      </section>
    </div>
  );
}
