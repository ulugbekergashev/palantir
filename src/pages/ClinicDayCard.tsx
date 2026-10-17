import { useEffect, useState } from 'react';
import { CalendarX2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ClinicDay, LiveStatus } from '../types';
import { ApiError, api } from '../data/api';
import { Button, EmptyState } from '../components/ui';
import { nextVisit, revenueLines } from '../lib/clinic';
import { money } from '../lib/text';
import { iso } from '../lib/week';
import { ClinicTimeline } from './ClinicTimeline';

const CLINIC_POLL_MS = 60_000;
const CRM_NOT_CONNECTED = 409;
const EYEBROW = 'text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500';
const clock = (d: Date) => d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });

/** day — oxirgi kelgan ma'lumot; problem — oxirgi so'rov nega o'tmadi; off — server CRM ulanmagan dedi */
interface Loaded { day: ClinicDay | null; at: Date | null; problem: string | null; off: boolean }

function Figure({ n, label, tone = 'text-slate-900' }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col-reverse gap-1.5">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${n ? tone : 'text-slate-400'}`}>{n}</dd>
    </div>
  );
}

/** Kunning ulushlari bitta chiziqda: keldi (yashil), kutilmoqda (kulrang), kelmadi (qizil). Bekor qilinganlar hisobga kirmaydi */
function Share({ day }: { day: ClinicDay }) {
  const live = day.came + day.expected + day.no_show;
  if (!live) return null;
  const parts = [{ n: day.came, cls: 'bg-emerald-500' }, { n: day.expected, cls: 'bg-slate-300' }, { n: day.no_show, cls: 'bg-rose-500' }].filter(p => p.n);
  return (
    <div aria-hidden="true" className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full">
      {parts.map(p => <span key={p.cls} className={p.cls} style={{ flexGrow: p.n }} />)}
    </div>
  );
}

function Figures({ day, nowMin }: { day: ClinicDay; nowMin: number | null }) {
  const lines = revenueLines(day.revenue.by_method);
  const next = nowMin === null ? null : nextVisit(day, nowMin);
  return (
    <div className="grid @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex flex-col p-5 sm:p-6">
        <h3 className={EYEBROW}>Qabullar</h3>
        <dl className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-4 sm:gap-x-8">
          {/* Yozuv tartibi: avval nom, keyin son (ekran o'quvchi uchun); ko'rinishda son oldinda */}
          <div className="mr-2 flex flex-row-reverse items-baseline gap-2">
            <dt className="text-sm font-semibold text-slate-500">jami</dt>
            <dd className="text-5xl font-extrabold leading-none tracking-tighter tabular-nums sm:text-6xl">{day.total}</dd>
          </div>
          <Figure n={day.came} label="keldi" tone="text-emerald-700" />
          <Figure n={day.expected} label="kutilmoqda" />
          <Figure n={day.no_show} label="kelmadi" tone="text-rose-700" />
        </dl>
        <Share day={day} />
        {day.cancelled > 0 && <p className="mt-2 text-xs text-slate-500">Yana {day.cancelled} ta qabul bekor qilingan.</p>}
        {/* Ustunning pastida, o'ngdagi «To'lanmagan» qatori bilan bir chiziqda: kim navbatda */}
        {next && (
          <div className="mt-auto pt-5">
            <p className="flex flex-wrap items-baseline gap-x-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
              <span className="font-semibold text-slate-900">Navbatdagi qabul</span>
              <span className="font-bold tabular-nums text-slate-900">{next.time}</span>
              <span className="min-w-0 truncate">{next.patient} · {next.doctor}</span>
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-5 sm:p-6 @3xl:border-l @3xl:border-t-0">
        <h3 className={EYEBROW}>Tushum</h3>
        <p className="mt-3 whitespace-nowrap text-3xl font-extrabold leading-none tracking-tight tabular-nums sm:text-4xl">
          {money(day.revenue.total)} <span className="text-sm font-semibold tracking-normal text-slate-500">so'm</span>
        </p>
        {/* Daftar qatorlari: chapda usul, o'ngda summa, orasida nuqtali chiziq */}
        {lines.length > 0 ? (
          <dl className="mt-4 space-y-1.5 text-sm">
            {lines.map(l => (
              <div key={l.label} className="flex items-baseline gap-2">
                <dt className="flex flex-1 items-baseline gap-2 text-slate-600 after:flex-1 after:border-b after:border-dotted after:border-slate-300">{l.label}</dt>
                <dd className="whitespace-nowrap font-semibold tabular-nums">{money(l.amount)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-3 text-sm text-slate-500">Bugun hali to'lov kiritilmagan.</p>}
        {(day.revenue.advance > 0 || day.revenue.from_balance > 0) && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {[day.revenue.advance > 0 && `shundan avans — ${money(day.revenue.advance)}`, day.revenue.from_balance > 0 && `balansdan to'landi — ${money(day.revenue.from_balance)} (tushumga kirmaydi)`].filter(Boolean).join(' · ')}
          </p>
        )}
        {day.unpaid.count > 0 && (
          <p className="mt-4 flex items-baseline gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <span className="font-semibold">To'lanmagan</span>
            <span className="text-amber-800">{day.unpaid.count} ta</span>
            <span className="ml-auto whitespace-nowrap font-extrabold tabular-nums">{money(day.unpaid.total)} so'm</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Klinika kuni (DentaCRM ulangan bo'lsa): bugungi qabullar, kelgan/kelmagan, tushum va shifokorlar bo'yicha kun jadvali.
 * Har daqiqada yangilanadi. CRM javob bermasa — sahifa buzilmaydi: oxirgi ma'lumot qoladi va sokin ogohlantirish chiqadi.
 */
export function ClinicDayCard({ status, now }: { status: LiveStatus; now: Date }) {
  const [state, setState] = useState<Loaded>({ day: null, at: null, problem: null, off: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false, loading = false;
    const load = () => {
      // CRM sekin javob berayotgan bo'lsa, ustiga yangi so'rov yuborilmaydi
      if (loading) return;
      loading = true;
      return api.crmDay().then(r => { if (!gone) setState({ day: r.day, at: new Date(), problem: null, off: false }); }).catch(e => {
        if (gone) return;
        // CRM shu orada uzilgan (boshqa oynada) — bo'lim yashiriladi; boshqa xato — CRM javob bermayapti, oxirgi ma'lumot joyida qoladi
        if (e instanceof ApiError && e.status === CRM_NOT_CONNECTED) setState({ day: null, at: null, problem: null, off: true });
        else setState(s => ({ ...s, problem: (e as Error).message }));
      }).finally(() => { loading = false; });
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, CLINIC_POLL_MS);
    return () => { gone = true; clearInterval(t); };
  }, [attempt]);

  const { day, at, problem, off } = state;
  if (off) return null;
  const clinic = status.crm.account?.split(' · ')[0];
  // «Hozir» chizig'i faqat bugungi kun ko'rilayotganda chiziladi
  const nowMin = day?.date === iso(now) ? now.getHours() * 60 + now.getMinutes() : null;
  // Sabab matni nuqta bilan tugaydi: undan keyin yana jumla keladi
  const trouble = (problem ?? status.crm.problem)?.replace(/[.!…]*$/, '.');

  return (
    <section aria-labelledby="clinic-day" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="clinic-day" className="text-lg font-extrabold tracking-tight">Klinika kuni</h2>
        {clinic && <span className="text-sm font-medium text-slate-500">{clinic}</span>}
        {at && <span className="ml-auto text-xs tabular-nums text-slate-500">DentaCRM · {clock(at)} da yangilandi</span>}
      </div>

      {trouble && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{problem ? "Klinika ma'lumoti yangilanmadi." : 'DentaCRM bilan muammo bor.'}</span> {trouble}
            {problem ? `${day && at ? ` Quyida — ${clock(at)} dagi ma'lumot.` : ''} O'zi qayta urinib turadi.` : ''}
          </p>
          {problem
            ? <Button size="sm" onClick={() => setAttempt(n => n + 1)}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Qayta urinish</Button>
            : <a href="#/telegram" className="rounded text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">Ulanishlar</a>}
        </div>
      )}

      {day ? (
        <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sheet">
          <Figures day={day} nowMin={nowMin} />
          {day.doctors.length > 0
            ? <ClinicTimeline day={day} nowMin={nowMin} />
            : <div className="border-t border-slate-200"><EmptyState compact icon={CalendarX2} title="Bugunga qabul yozilmagan">DentaCRM'da qabul paydo bo'lishi bilan shu yerda shifokorlar bo'yicha ko'rinadi.</EmptyState></div>}
        </div>
      ) : !trouble && <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sheet"><Loader2 className="h-6 w-6 animate-spin" aria-label="Yuklanmoqda" /></div>}
    </section>
  );
}
