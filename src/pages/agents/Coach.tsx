/**
 * HR → Murabbiy: klinika xodimini Miya bilimidan (narxlar, qoidalar, savol-javoblar) o'qitish. Egasi xodimni tanlaydi → AI kurs yozadi
 * (server/hr/train.ts) → darslar va test tugmalari xodimning Telegram'iga boradi, javob saqlangan to'g'ri variant bilan tekshiriladi →
 * oxirida egasiga natija. Kurs faqat Telegram'ga ulangan xodimga (Qabulxona xodimlari: AI administrator → So'rovlar).
 * Ko'rish — egasi va boshqaruvchi xodim; boshlash va bekor qilish — faqat egasi (owner): server ham shunday (asOwner).
 */
import { useState, type FormEvent } from 'react';
import { GraduationCap, Lock, X } from 'lucide-react';
import type { HrTraining, HrView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet, type Stat } from '../../components/agent';
import { hrefOf } from '../../lib/nav';
import { button, day, field, ghost, spin, useHrRun } from './Recruit';

const ACCENT = HUE.murabbiy.a;
/** Xodimlar ro'yxati va Telegram havolasi shu yerda (RequestsPage «Qabulxona xodimlari») */
const STAFF_HREF = hrefOf('qabulxona', 'sorovlar');
/** Server bilan bir xil (server/hr/routes.ts TrainSchema) */
const FOCUS_MAX = 500;

const STATUS: Record<HrTraining['status'], { label: string; cls: string }> = {
  active: { label: 'Davom etyapti', cls: 'bg-[#a3e635]/15 text-[#d9f99d]' },
  done: { label: 'Tugadi', cls: 'bg-emerald-400/15 text-[#a7f3d0]' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-glass/10 text-[#a3a9b5]' },
};

/** Qaysi darsda: davom etayotganda — hozirgisi (lesson 0 dan), tugaganda — hammasi */
const progress = (t: HrTraining) => `${t.status === 'done' ? t.lessons.length : Math.min(t.lesson + 1, t.lessons.length)}/${t.lessons.length}-dars`;

export function coachStats(v: HrView | null): Stat[] {
  if (!v) return [];
  const done = v.trainings.filter(t => t.status === 'done');
  const right = done.reduce((n, t) => n + t.right, 0), total = done.reduce((n, t) => n + t.total, 0);
  const linked = v.staff.filter(s => s.linked).length;
  return [
    { label: 'Davom etyapti', value: v.trainings.filter(t => t.status === 'active').length },
    { label: 'Tugatgan kurs', value: done.length },
    { label: "To'g'ri javob", value: total ? `${Math.round((right / total) * 100)}%` : '—', hint: total ? `${right}/${total} · tugaganlarda` : undefined },
    { label: "Telegram'dagi xodim", value: linked, hint: `${v.staff.length} tadan`, tone: linked ? undefined : 'warn' },
  ];
}

function CourseCard({ t, owner, setView, notify }: { t: HrTraining; owner: boolean; setView: (v: HrView) => void; notify: Notify }) {
  const [busy, run] = useHrRun(notify, setView);
  const s = STATUS[t.status];
  const cancel = () => {
    if (!window.confirm(`${t.staffName ?? 'Xodim'}ning «${t.title}» kursi bekor qilinsinmi? Qolgan darslar yuborilmaydi.`)) return;
    void run('cancel', () => api.hrTrainCancel(t.id), () => 'Kurs bekor qilindi');
  };
  return (
    <li className="space-y-3 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-semibold text-[#f2f0ea]">{t.staffName ?? "Xodim o'chirilgan"}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
        <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{day(t.createdAt)}</span>
      </div>
      <p className="text-[14px] text-[#e4e3de]">{t.title}</p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] tabular-nums text-[#c9cbd2]">
        <span>{progress(t)}</span>
        {t.answered > 0 && <span><b className="text-[#f2f0ea]">{t.right}/{t.total}</b> to'g'ri{t.status === 'active' ? ` · ${t.answered} ta javob berdi` : ''}</span>}
      </p>
      {t.weak.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] text-[#a3a9b5]">Xato qilgan mavzular:</span>
          {t.weak.map(w => <span key={w} className="rounded-full bg-[#f5b454]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#fde2b0]">{w}</span>)}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-[13px] font-semibold text-[#a3a9b5] hover:text-[#f2f0ea]">Darslar ({t.lessons.length})</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13.5px] text-[#e4e3de]">
          {t.lessons.map(l => <li key={l.title}>{l.title} <span className="text-[#7d838f]">· {l.questions} savol</span></li>)}
        </ol>
      </details>
      {owner && t.status === 'active' && (
        <button type="button" disabled={!!busy} onClick={cancel} className={ghost}>{busy === 'cancel' ? spin : <X className="h-4 w-4" aria-hidden="true" />} Bekor qilish</button>
      )}
    </li>
  );
}

function StartCourse({ view, setView, notify }: { view: HrView; setView: (v: HrView) => void; notify: Notify }) {
  const firstLinked = view.staff.find(s => s.linked)?.id ?? '';
  const [staffId, setStaffId] = useState(firstLinked);
  const [focus, setFocus] = useState('');
  const [busy, run] = useHrRun(notify, setView);
  // Tanlangan xodim ro'yxatdan chiqib ketgan yoki Telegram'dan uzilgan bo'lsa — birinchi ulangani
  const chosen = view.staff.some(s => s.id === staffId && s.linked) ? staffId : firstLinked;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = view.staff.find(s => s.id === chosen)?.name ?? 'Xodim';
    void run('start', () => api.hrTrain(chosen, focus.trim() || undefined), () => `Kurs boshlandi — ${name}ga birinchi dars Telegram'da`).then(ok => { if (ok) setFocus(''); });
  };
  if (!view.staff.length) {
    return (
      <Panel title="Kurs boshlash">
        <p className="text-[14px] leading-relaxed text-[#c9cbd2]">Hali xodim yo'q. <a href={STAFF_HREF} className="font-semibold text-[#d9f99d] underline">AI administrator → So'rovlar → «Qabulxona xodimlari»</a>da xodimni qo'shing va havolasini unga yuboring — u Telegram'da ochgach, shu yerda kurs boshlaysiz.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Kurs boshlash">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-[#a3a9b5]">Kimni o'qitamiz</span>
            <select value={chosen} onChange={e => setStaffId(e.target.value)} disabled={!!busy} className={`${field} bg-[#0b0c10]`}>
              {!firstLinked && <option value="">— ulangan xodim yo'q —</option>}
              {view.staff.map(s => <option key={s.id} value={s.id} disabled={!s.linked}>{s.name}{s.linked ? '' : " — Telegram'ga ulanmagan"}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-[#a3a9b5]">Nimaga e'tibor bersin? (ixtiyoriy)</span>
            <input value={focus} onChange={e => setFocus(e.target.value)} maxLength={FOCUS_MAX} disabled={!!busy} className={field}
              placeholder="Nimaga e'tibor bersin? (masalan: narxlar, qabulga yozish)" />
          </label>
        </div>
        <button type="submit" disabled={!chosen || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>
          {busy ? spin : <GraduationCap className="h-4 w-4" aria-hidden="true" />} {busy ? 'Kursni yozyapti… (bir daqiqagacha)' : 'Kurs boshlash'}
        </button>
        {!firstLinked
          ? <p className="text-[12.5px] text-[#fde2b0]">Xodimlar hali Telegram'ga ulanmagan: <a href={STAFF_HREF} className="font-semibold text-[#fde2b0] underline">«Qabulxona xodimlari»</a>dan havolasini nusxalab unga yuboring.</p>
          : <p className="text-[12.5px] text-[#7d838f]">Kurs faqat Miya'dagi bilimdan yoziladi. Darslar va test xodimning Telegram'iga boradi, oxirida natija sizga keladi.</p>}
      </form>
    </Panel>
  );
}

export function CoachCourses({ view, setView, notify, owner }: { view: HrView | null; setView: (v: HrView) => void; notify: Notify; owner: boolean }) {
  if (!view) return <span role="status" aria-label="Yuklanmoqda">{spin}</span>;
  return (
    <div className="space-y-5">
      {owner ? <StartCourse view={view} setView={setView} notify={notify} />
        : <p className="flex items-center gap-2 rounded-2xl bg-glass/[0.04] p-4 text-[13.5px] text-[#c9cbd2]"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />Kurs boshlash va bekor qilish — klinika egasida. Siz natijalarni ko'rib turasiz.</p>}
      <Panel title="Kurslar">
        {!view.trainings.length
          ? <Quiet>Kurs Telegram'ga ulangan xodimga boradi — xodimni AI administrator → So'rovlar → «Qabulxona xodimlari»da qo'shib, havolasini unga yuboring. Kurs faqat Miya'dagi bilimdan (narxlar, qoidalar, savol-javoblar) yoziladi — Murabbiy o'zidan narx yoki qoida qo'shmaydi.</Quiet>
          : <ul className="flex flex-col gap-3">{view.trainings.map(t => <CourseCard key={`${t.id}-${t.status}`} t={t} owner={owner} setView={setView} notify={notify} />)}</ul>}
      </Panel>
    </div>
  );
}
