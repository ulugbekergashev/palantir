/**
 * Kompyuterda ishlash: egasi Palantir'ga brauzerda ishlashga ruxsat beradi — saytga kirib ma'lumot topish, forma to'ldirish, fayl yuklab
 * olish, sozlamani o'zgartirish (masalan, Meta Business'dagi nom). Yordamchi alohida Chrome oynasida ishlaydi, yuborish/saqlash/o'chirishdan
 * oldin Telegram'da so'raydi; pul (bank, to'lov, xarid) kodda yopiq. Saytlarga kirishni egasi o'zi qiladi — «Saytlarga kirish» oynasida,
 * parolni AI ko'rmaydi. Yoqish/o'chirish — faqat egasi; .env da o'rnatuvchi sozlagan bo'lsa — faqat ko'rsatiladi.
 */
import { useEffect, useState } from 'react';
import { Globe, KeyRound, Loader2, MonitorCog, ShieldCheck } from 'lucide-react';
import { api, type ComputerView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';

const POINTS = [
  { icon: Globe, text: "Alohida Chrome oynasida ishlaydi: saytga kiradi, qidiradi, forma to'ldiradi, fayl yuklab oladi" },
  { icon: ShieldCheck, text: "Saqlash, yuborish yoki o'chirishdan oldin Telegram'da sizdan so'raydi. Bank, to'lov va xarid — butunlay yopiq" },
  { icon: KeyRound, text: "Parolni AI ko'rmaydi: saytlarga bir marta o'zingiz kirasiz, kirish eslab qolinadi" },
];

export function ComputerUse({ notify, onChange }: { notify: Notify; onChange?: (v: ComputerView) => void }) {
  const [view, setView] = useState<ComputerView | null>(null);
  const [busy, setBusy] = useState<'toggle' | 'login' | null>(null);
  const [url, setUrl] = useState('');
  const [closed, setClosed] = useState<string | null>(null);
  // Xodimga hisob sozlamalari yopiq (403) — xato emas, tushuntiriladi
  useEffect(() => { api.computer().then(setView).catch(e => setClosed((e as Error).message)); }, []);
  if (closed) return <p className="text-[13px] text-[#8a909c]">{closed}</p>;
  if (!view) return <p className="text-[13px] text-[#8a909c]">Yuklanmoqda…</p>;

  const on = view.browser;
  const canChange = view.owner && !view.fixed;
  const toggle = async () => {
    if (on && view.job && !window.confirm(`Hozir ish bajarilyapti: «${view.job.task}». O'chirilsa, u to'xtaydi. O'chirilsinmi?`)) return;
    setBusy('toggle');
    try {
      const next = await api.setComputer(!on);
      setView(next);
      onChange?.(next);
      notify(next.browser ? "Yoqildi — endi Palantir'ga brauzerdagi ishni ovozda yoki yozib aytsangiz bo'ladi" : "Kompyuterda ishlash o'chirildi");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const login = async () => {
    const target = url.trim();
    if (target && !/^https?:\/\//i.test(target)) return notify('Manzil https:// bilan boshlansin (masalan, https://business.facebook.com)', true);
    setBusy('login');
    try {
      const r = await api.computerLogin(target || undefined);
      setView({ ...view, loginOpen: true });
      notify(r.text);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const closeLogin = async () => {
    try {
      await api.closeComputerLogin();
      setView({ ...view, loginOpen: false });
      notify('Kirish oynasi yopildi — kirishlaringiz saqlandi');
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <header className="flex flex-wrap items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-emerald-400/12 text-emerald-300' : 'bg-glass/[0.05] text-[#a3a9b5]'}`}>
          <MonitorCog className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-56 flex-1">
          <h3 className="text-[16px] font-semibold text-[#f2f0ea]">Brauzerda ishlash</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">
            {on ? 'Yoqilgan — Palantir topshiriqni brauzerda o\'zi bajaradi, natija Telegram\'ga keladi.' : "O'chiq — Palantir saytlarda o'zi ishlamaydi, faqat qanday qilishni aytadi."}
          </p>
        </div>
        {canChange ? (
          <button type="button" role="switch" aria-checked={on} aria-label="Brauzerda ishlash" disabled={busy === 'toggle'} onClick={() => { void toggle(); }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-glass/15 hover:bg-glass/20'}`}>
            <span className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-[#f2f0ea] shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        ) : (
          <span className="text-[12px] text-[#7d838f]">{view.fixed ? "O'rnatuvchi sozlagan" : "Buni faqat egasi o'zgartiradi"}</span>
        )}
      </header>

      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {POINTS.map(p => (
          <li key={p.text} className="flex gap-2.5 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] px-3.5 py-3 text-[12.5px] leading-snug text-[#c3c7d0]">
            <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8a909c]" aria-hidden="true" />{p.text}
          </li>
        ))}
      </ul>

      {view.job && (
        <p role="status" className="mt-4 rounded-xl bg-[#ff9a3c]/10 px-3.5 py-2.5 text-[13px] text-[#ffd7ad]">
          Hozir bajarilyapti: «{view.job.task}» — {view.job.steps} qadam. To'xtatish: Telegram'da /toxta
        </p>
      )}

      {on && view.owner && (
        <div className="mt-5 border-t border-glass/[0.06] pt-4">
          <h4 className="text-[14px] font-semibold text-[#f2f0ea]">Saytlarga kirish</h4>
          <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">
            Palantir o'rnatilgan kompyuterda Chrome oynasi ochiladi. Kerakli saytlarga (Facebook, soliq.uz…) o'zingiz kiring va yoping — keyin Palantir o'sha saytlarda ishlay oladi.
          </p>
          {view.loginOpen ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-emerald-300">Oyna ochiq — kirib bo'lgach yoping</span>
              <button type="button" onClick={() => { void closeLogin(); }} className="flex min-h-10 items-center rounded-xl bg-[#3fd6c3] px-4 text-[13px] font-semibold text-[#07080b]">Kirdim, yopish</button>
            </div>
          ) : (
            <form className="mt-3 flex flex-wrap items-center gap-2.5" onSubmit={e => { e.preventDefault(); void login(); }}>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://business.facebook.com (ixtiyoriy)" aria-label="Qaysi sayt"
                className="h-10 min-w-0 flex-1 rounded-xl border border-glass/10 bg-glass/[0.03] px-3.5 text-[13px] text-[#f2f0ea] placeholder:text-[#6b717d] focus:border-[#3fd6c3]/50 focus:outline-none sm:max-w-sm" />
              <button type="submit" disabled={busy === 'login' || !!view.job} className="flex min-h-10 items-center gap-2 rounded-xl border border-glass/10 px-4 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">
                {busy === 'login' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Oynani ochish
              </button>
            </form>
          )}
        </div>
      )}
      {view.desktop && <p className="mt-4 text-[12px] text-[#7d838f]">Butun ekranda ishlash ham yoqilgan (o'rnatuvchi sozlagan): boshqa dasturlarda ham ishlaydi, har safar Telegram'da tasdiqlaysiz.</p>}
    </section>
  );
}
