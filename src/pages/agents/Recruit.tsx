/**
 * HR → Rekruter: vakansiyalar va nomzodlar. Egasi kim kerakligini o'z so'zi bilan yozadi → AI e'lon matni va 3–5 savol tuzadi,
 * botdagi havolani beradi (server/hr/recruit.ts). Nomzod havolani bosib savollarga javob beradi → AI baholaydi → shu yerda va
 * Telegram'da karta. Nomzodga xabar faqat egasi «Suhbatga chaqirish» yoki «Rad etish»ni bosganda ketadi.
 * Ko'rish — egasi va boshqaruvchi xodim; ochish, joylash, yopish va qaror — faqat egasi (owner): server ham shunday (asOwner).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Loader2, Lock, Phone, Send, Sparkles } from 'lucide-react';
import type { HrCandidate, HrVacancy, HrView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet, type Stat } from '../../components/agent';
import { copyText } from '../../lib/clipboard';

const ACCENT = HUE.rekruter.a;
export const field = 'w-full rounded-xl border border-glass/40 bg-glass/[0.03] px-3.5 py-2.5 text-[14.5px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f] focus:border-glass/60';
export const button = 'inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-opacity disabled:opacity-40';
export const ghost = `${button} border border-glass/10 text-[#c9cbd2] hover:bg-glass/5`;
export const spin = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
/** Server bilan bir xil (server/hr/routes.ts TaskSchema) */
const TASK_MIN = 10, TASK_MAX = 2000;

const CANDIDATE: Record<HrCandidate['status'], { label: string; cls: string }> = {
  scoring: { label: 'Baholanmoqda…', cls: 'bg-[#3fb6ff]/15 text-[#bfe6ff]' },
  new: { label: 'Qaroringizni kutyapti', cls: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  invited: { label: 'Suhbatga chaqirildi', cls: 'bg-emerald-400/15 text-[#a7f3d0]' },
  rejected: { label: 'Rad etildi', cls: 'bg-glass/10 text-[#a3a9b5]' },
};

/** Baho rangi: 8+ — mos, 5–7 — o'ylab ko'rish kerak, undan past — mos emas */
const scoreCls = (s: number) => (s >= 8 ? 'bg-emerald-400/20 text-[#a7f3d0]' : s >= 5 ? 'bg-[#f5b454]/20 text-[#fde2b0]' : 'bg-glass/10 text-[#a3a9b5]');
export const day = (at: string) => new Date(at).toLocaleDateString('uz', { day: '2-digit', month: '2-digit' });
/** Eng yuqori baho tepada; bahosizlar (baholanmoqda yoki AI baholay olmadi) — oxirida, yangisi oldin */
const byScore = (a: HrCandidate, b: HrCandidate) => (b.score ?? -1) - (a.score ?? -1) || (a.createdAt < b.createdAt ? 1 : -1);

export function useHr(notify: Notify, tick: number): [HrView | null, (v: HrView) => void] {
  const [view, setView] = useState<HrView | null>(null);
  useEffect(() => {
    let stale = false;
    api.hr().then(v => { if (!stale) setView(v); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [view, setView];
}

/** Bitta amal: tugmadagi aylanma, javob kelsa — yangi ko'rinish; xato — xabar (Rekruter va Murabbiy — HR bo'limi umumiy) */
export function useHrRun(notify: Notify, setView: (v: HrView) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T extends HrView>(what: string, fn: () => Promise<T>, done?: (v: T) => string): Promise<boolean> => {
    setBusy(what);
    try { const v = await fn(); setView(v); if (done) notify(done(v)); return true; } catch (e) { notify((e as Error).message, true); return false; } finally { setBusy(null); }
  };
  return [busy, run] as const;
}

export function hrStats(v: HrView | null): Stat[] {
  if (!v) return [];
  const all = v.vacancies.flatMap(x => x.candidates);
  const waiting = all.filter(c => c.status === 'new').length;
  return [
    { label: 'Ochiq vakansiya', value: v.vacancies.filter(x => x.status === 'open').length },
    { label: 'Javob beryapti', value: v.vacancies.reduce((n, x) => n + (x.status === 'open' ? x.inProgress : 0), 0), hint: 'savollar o‘rtasida' },
    { label: 'Qaroringizni kutyapti', value: waiting, tone: waiting ? 'warn' : undefined },
    { label: 'Suhbatga chaqirildi', value: all.filter(c => c.status === 'invited').length, tone: all.some(c => c.status === 'invited') ? 'good' : undefined },
  ];
}

// ─── Nomzod ───────────────────────────────────────────────────────────────────

function CandidateCard({ c, questions, owner, setView, notify }: { c: HrCandidate; questions: string[]; owner: boolean; setView: (v: HrView) => void; notify: Notify }) {
  const [busy, run] = useHrRun(notify, setView);
  const s = CANDIDATE[c.status];
  const who = [c.name, c.username ? `@${c.username}` : ''].filter(Boolean).join(' · ') || 'Nomzod';
  const decide = (invite: boolean) => {
    if (!invite && !window.confirm(`${who}ga xushmuomala rad javobi yuboriladi. Davom etilsinmi?`)) return;
    void run(invite ? 'invite' : 'reject', () => api.hrDecide(c.id, invite), v => v.said);
  };
  return (
    <li className="space-y-2.5 rounded-xl border border-glass/[0.06] bg-glass/[0.02] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {c.score !== null && <span className={`rounded-lg px-2 py-0.5 text-[13px] font-bold tabular-nums ${scoreCls(c.score)}`} aria-label={`Baho ${c.score} / 10`}>{c.score}/10</span>}
        <span className="text-[15px] font-semibold text-[#f2f0ea]">{who}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
        <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{day(c.createdAt)}</span>
      </div>
      {c.summary && <p className="text-[13.5px] leading-relaxed text-[#c9cbd2]">{c.summary}</p>}
      {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold tabular-nums text-[#f2f0ea] no-underline hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{c.phone}</a>}
      <details className="group">
        <summary className="cursor-pointer text-[13px] font-semibold text-[#a3a9b5] hover:text-[#f2f0ea]">Javoblari ({c.answers.length})</summary>
        <dl className="mt-2 space-y-2">
          {questions.map((q, i) => (
            <div key={q} className="rounded-lg bg-glass/[0.03] p-2.5">
              <dt className="text-[12.5px] font-semibold text-[#a3a9b5]">{i + 1}. {q}</dt>
              <dd className="m-0 mt-1 whitespace-pre-line text-[13.5px] text-[#e4e3de]">{c.answers[i] || '—'}</dd>
            </div>
          ))}
        </dl>
      </details>
      {owner && c.status === 'new' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => decide(true)} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'invite' && spin} 📞 Suhbatga chaqirish</button>
          <button type="button" disabled={!!busy} onClick={() => decide(false)} className={ghost}>{busy === 'reject' && spin} ✖️ Rad etish</button>
        </div>
      )}
    </li>
  );
}

// ─── Vakansiya ────────────────────────────────────────────────────────────────

function VacancyLink({ link, notify }: { link: string | null; notify: Notify }) {
  const [copied, setCopied] = useState(false);
  if (!link) return <p className="text-[13px] text-[#fde2b0]">Havola yo'q — Telegram bot ulanmagan (Sozlamalar → Telegram). Bot ulangach nomzodlar shu havola orqali keladi.</p>;
  const copy = () => copyText(link).then(() => { setCopied(true); notify("Havola nusxalandi — kanal yoki guruhga qo'ying"); setTimeout(() => setCopied(false), 2000); }).catch(() => notify(link));
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-glass/10 bg-glass/[0.03] py-1 pl-3 pr-1">
      <a href={link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[13.5px] text-[#bae6fd] no-underline hover:underline">{link}</a>
      <button type="button" onClick={() => void copy()} aria-label="Havolani nusxalash" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#c9cbd2] hover:bg-glass/5">
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

function VacancyCard({ v, owner, setView, notify }: { v: HrVacancy; owner: boolean; setView: (v: HrView) => void; notify: Notify }) {
  const [busy, run] = useHrRun(notify, setView);
  const open = v.status === 'open';
  const list = [...v.candidates].sort(byScore);
  const close = () => {
    if (!window.confirm(`«${v.title}» yopilsinmi? Yangi nomzodlar qabul qilinmaydi (kelganlari qoladi).`)) return;
    void run('close', () => api.hrClose(v.id), () => 'Vakansiya yopildi');
  };
  return (
    <li className="space-y-4 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[17px] font-semibold text-[#f2f0ea]">{v.title}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${open ? 'bg-emerald-400/15 text-[#a7f3d0]' : 'bg-glass/10 text-[#a3a9b5]'}`}>{open ? 'Ochiq' : 'Yopilgan'}</span>
        <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{day(v.createdAt)}{v.closedAt ? ` → ${day(v.closedAt)}` : ''}</span>
      </div>
      {open && <VacancyLink link={v.link} notify={notify} />}
      <div className="space-y-1.5">
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-[#a3a9b5] hover:text-[#f2f0ea]">E'lon matni</summary>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-glass/[0.04] p-3 text-[13.5px] leading-relaxed text-[#e4e3de]">{v.text}</p>
        </details>
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-[#a3a9b5] hover:text-[#f2f0ea]">Nomzodga savollar ({v.questions.length})</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13.5px] text-[#e4e3de]">{v.questions.map(q => <li key={q}>{q}</li>)}</ol>
        </details>
      </div>
      {owner && open && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy || !v.link} onClick={() => void run('post', () => api.hrPost(v.id), () => "Kanalga joylandi — havola post ostida")} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'post' ? spin : <Send className="h-4 w-4" aria-hidden="true" />} Kanalga joylash</button>
          <button type="button" disabled={!!busy} onClick={close} className={ghost}>{busy === 'close' ? spin : <Lock className="h-4 w-4" aria-hidden="true" />} Yopish</button>
        </div>
      )}
      <div className="space-y-2 border-t border-glass/[0.06] pt-3">
        <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-[#a3a9b5]">
          <span className="font-semibold uppercase tracking-[0.12em]">Nomzodlar · {v.candidates.length}</span>
          {open && v.inProgress > 0 && <span className="inline-flex items-center gap-1.5 text-[#bae6fd]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#38bdf8]" aria-hidden="true" />{v.inProgress} kishi javob beryapti</span>}
        </p>
        {list.length ? <ul className="flex flex-col gap-2.5">{list.map(c => <CandidateCard key={`${c.id}-${c.status}`} c={c} questions={v.questions} owner={owner} setView={setView} notify={notify} />)}</ul>
          : <p className="text-[13px] text-[#7d838f]">{open ? 'Hali hech kim javob bermadi — havolani kanal yoki guruhlarga qo‘ying.' : 'Nomzod bo‘lmadi.'}</p>}
      </div>
    </li>
  );
}

// ─── Vakansiyalar varag'i ─────────────────────────────────────────────────────

function NewVacancy({ setView, notify }: { setView: (v: HrView) => void; notify: Notify }) {
  const [task, setTask] = useState('');
  const [busy, run] = useHrRun(notify, setView);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('create', () => api.hrVacancy(task.trim()), () => "Vakansiya tayyor — Telegram'ga ham yuborildi").then(ok => { if (ok) setTask(''); });
  };
  return (
    <Panel title="Yangi vakansiya">
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="hr-task" className="sr-only">Kim kerak</label>
        <textarea id="hr-task" value={task} onChange={e => setTask(e.target.value)} rows={3} maxLength={TASK_MAX} disabled={!!busy} className={field}
          placeholder="Kim kerak? Vazifalari, oyligi, ish vaqti — o'z so'zingiz bilan" />
        <button type="submit" disabled={task.trim().length < TASK_MIN || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>
          {busy ? spin : <Sparkles className="h-4 w-4" aria-hidden="true" />} {busy ? 'Matn va savollarni yozyapti… (bir daqiqagacha)' : 'Vakansiya ochish'}
        </button>
        <p className="text-[12.5px] text-[#7d838f]">Oylik va sharoitni o'zingiz yozing — Rekruter o'ylab topmaydi. Yosh, jins va millat so'ralmaydi.</p>
      </form>
    </Panel>
  );
}

export function HrVacancies({ view, setView, notify, owner }: { view: HrView | null; setView: (v: HrView) => void; notify: Notify; owner: boolean }) {
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const list = [...view.vacancies].sort((a, b) => (a.status === b.status ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === 'open' ? -1 : 1));
  return (
    <div className="space-y-5">
      {owner ? <NewVacancy setView={setView} notify={notify} />
        : <p className="flex items-center gap-2 rounded-2xl bg-glass/[0.04] p-4 text-[13.5px] text-[#c9cbd2]"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />Vakansiya ochish va nomzod bo'yicha qaror — klinika egasida. Siz ko'rib turasiz.</p>}
      <Panel title="Vakansiyalar">
        {!list.length ? <Quiet>Kim kerakligini yozing — Rekruter e'lon matni va nomzodga 3–5 savol tuzadi va botdagi havolani beradi. Nomzodlar havolani bosib savollarga javob beradi, u har birini baholab eng mosini sizga yuboradi.</Quiet>
          : <ul className="flex flex-col gap-4">{list.map(v => <VacancyCard key={`${v.id}-${v.status}`} v={v} owner={owner} setView={setView} notify={notify} />)}</ul>}
      </Panel>
    </div>
  );
}
