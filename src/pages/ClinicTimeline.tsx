import { useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { ClinicAppointment, ClinicDay, ClinicDoctorDay } from '../types';
import { apptLook, dayRange, minutesOf, nowIndex, visitMinutes, type ApptTone } from '../lib/clinic';

/** Shifokor qatorida birdaniga ko'rinadigan qabullar; qolgani «Hammasi» tugmasi ortida */
const VISIBLE_ROWS = 7;
/** Yig'ilgan ko'rinishda «hozir» chizig'idan oldin shuncha o'tgan qabul qoladi */
const PAST_KEPT = 2;
const HOUR = 60;

/** Kun chizig'idagi bo'lak rangi: yashil — keldi, kulrang — kutilmoqda, qizil — kelmadi, bo'sh ramka — bekor */
const BLOCK: Record<ApptTone, string> = {
  came: 'bg-emerald-500',
  wait: 'bg-slate-300',
  bad: 'bg-rose-500',
  off: 'border border-dashed border-slate-300',
};
const LABEL: Record<ApptTone, string> = { came: 'text-emerald-700', wait: 'text-slate-500', bad: 'text-rose-700', off: 'text-slate-500' };

/** Holat belgisi: rangdan tashqari shakli ham farq qiladi (rangni ajrata olmaydiganlar uchun) */
function Mark({ status }: { status: string }) {
  const { tone } = apptLook(status);
  const base = 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full';
  if (tone === 'bad') return <span className={`${base} bg-rose-100 text-rose-700`}><X className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (tone === 'off') return <span className={`${base} bg-slate-100 text-slate-500`}><Minus className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (status === 'Completed') return <span className={`${base} bg-emerald-100 text-emerald-700`}><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></span>;
  if (tone === 'came') return <span className={`${base} bg-emerald-100`}><span className="h-2 w-2 rounded-full bg-emerald-600" /></span>;
  // Kutilmoqda — bo'sh halqa; tasdiqlangan — ichida nuqta
  return <span className={`${base} border-2 border-slate-300`}>{status === 'Confirmed' && <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}</span>;
}

/** Kunning shakli bir qarashda: har qabul o'z vaqtida va davomiyligicha joy oladi, tik chiziq — hozir */
function Strip({ rows, from, to, nowMin }: { rows: ClinicAppointment[]; from: number; to: number; nowMin: number | null }) {
  const span = to - from;
  const left = (min: number) => `${((min - from) / span) * 100}%`;
  const hours = Array.from({ length: span / HOUR + 1 }, (_, i) => from + i * HOUR);
  // Tor joyda soat yozuvlari ustma-ust tushmasin: ko'pi bilan ~6 ta belgi, oxirgisi doim bor
  const every = Math.ceil(hours.length / 6), last = hours.length - 1;
  const ticks = hours.map((h, i) => ({ h, i })).filter(({ i }) => i === last || (i % every === 0 && last - i >= every));
  return (
    <div aria-hidden="true" className="mt-3">
      <div className="relative h-3 rounded-full bg-slate-100">
        {rows.map((a, i) => {
          const at = minutesOf(a.time);
          if (at === null) return null;
          return <span key={i} className={`absolute inset-y-0 rounded-full ${BLOCK[apptLook(a.status).tone]}`} style={{ left: left(at), width: `max(6px, calc(${(visitMinutes(a) / span) * 100}% - 2px))` }} />;
        })}
        {nowMin !== null && <span className="absolute -inset-y-1 w-0.5 rounded-full bg-indigo-600" style={{ left: left(nowMin) }} />}
      </div>
      <div className="relative mt-1 h-4 text-[10px] font-semibold tabular-nums text-slate-500">
        {ticks.map(({ h, i }) => (
          <span key={h} className={`absolute top-0 ${i === 0 ? '' : i === last ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: left(h) }}>{String(h / HOUR).padStart(2, '0')}</span>
        ))}
      </div>
    </div>
  );
}

function Lane({ doctor, from, to, nowMin }: { doctor: ClinicDoctorDay; from: number; to: number; nowMin: number | null }) {
  const [all, setAll] = useState(false);
  const rows = doctor.appointments;
  // «Hozir» chizig'i qatorlar orasida turadi: undan yuqorisi o'tdi, pasti — oldinda
  const split = nowMin === null ? null : nowIndex(rows, nowMin);
  const folded = rows.length > VISIBLE_ROWS;
  const start = !folded || all ? 0 : Math.max(0, Math.min((split ?? 0) - PAST_KEPT, rows.length - VISIBLE_ROWS));
  const shown = folded && !all ? rows.slice(start, start + VISIBLE_ROWS) : rows;
  const nowLine = nowMin === null ? null : `${String(Math.floor(nowMin / HOUR)).padStart(2, '0')}:${String(nowMin % HOUR).padStart(2, '0')}`;

  return (
    <section className="min-w-0 bg-white p-5 sm:p-6 lg:last:odd:col-span-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-sm font-bold">{doctor.doctor}</h3>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{doctor.count} ta qabul</span>
      </div>
      <Strip rows={rows} from={from} to={to} nowMin={nowMin} />
      <ol className="mt-2">
        {shown.map((a, i) => {
          const index = start + i;
          const look = apptLook(a.status);
          return (
            <li key={index}>
              {split === index && nowLine && <NowLine time={nowLine} />}
              <div className={`flex items-center gap-3 py-1.5 text-sm ${look.tone === 'off' ? 'text-slate-500' : ''}`}>
                <span className="w-11 shrink-0 font-semibold tabular-nums">{a.time}</span>
                <Mark status={a.status} />
                <span className={`min-w-0 flex-1 truncate ${look.tone === 'off' ? 'line-through decoration-slate-300' : 'font-medium'}`}>
                  {a.patient}{a.type && <span className="font-normal text-slate-500"> · {a.type}</span>}
                </span>
                <span className={`shrink-0 text-xs font-semibold ${LABEL[look.tone]}`}>{look.label}</span>
              </div>
            </li>
          );
        })}
        {split === rows.length && nowLine && <li><NowLine time={nowLine} /></li>}
      </ol>
      {(folded || !!doctor.more) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          {folded && <button type="button" onClick={() => setAll(v => !v)} aria-expanded={all} className="rounded font-semibold text-indigo-700 hover:text-indigo-900 hover:underline">{all ? 'Qisqartirish' : `Hammasi (${rows.length})`}</button>}
          {!!doctor.more && <span>yana {doctor.more} ta qabul DentaCRM'da</span>}
        </div>
      )}
    </section>
  );
}

function NowLine({ time }: { time: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
      <span className="tabular-nums">hozir {time}</span>
      <span className="h-px flex-1 bg-indigo-600/40" aria-hidden="true" />
    </div>
  );
}

/** Kun jadvali shifokorlar bo'yicha: tepada kun chizig'i, ostida vaqt tartibidagi qabullar. nowMin — bugun ko'rilayotgan bo'lsa hozirgi daqiqa */
export function ClinicTimeline({ day, nowMin }: { day: ClinicDay; nowMin: number | null }) {
  const { from, to } = dayRange(day);
  // «Hozir» chizig'i faqat ish kuni ichida chiziladi: tunda yoki kun tugagach u hech narsani ajratmaydi
  const live = nowMin !== null && nowMin >= from && nowMin <= to ? nowMin : null;
  return (
    <div className="grid gap-px border-t border-slate-200 bg-slate-200 lg:grid-cols-2">
      {day.doctors.map(d => <Lane key={d.doctor_id} doctor={d} from={from} to={to} nowMin={live} />)}
    </div>
  );
}
