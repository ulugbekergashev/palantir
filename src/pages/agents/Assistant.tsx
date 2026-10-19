/**
 * Yordamchi — «Ish stoli»: bugungi qisqacha holat (nima kechikdi, kim kutyapti), ovoz bilan gaplashish, tez buyruqlar,
 * kun rejasi (bir bosishda bajarildi / bir soatga / ertaga) va u tayyorlagan hujjatlar. Suhbat tarixi va jurnal — boshqa varaqlarda.
 */
import { useEffect, useState } from 'react';
import { Check, Clock3, Download, FileText, SunMedium } from 'lucide-react';
import type { Doc, Task } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentAsk, Panel, Quiet } from '../../components/agent';
import { VoicePanel } from '../../components/VoicePanel';
import { addDays, iso } from '../../lib/week';
import { hrefOf } from '../../lib/nav';

export interface AssistantData { tasks: Task[]; docs: Doc[]; requests: number; drafts: number }

export function useAssistantData(notify: Notify, tick: number): [AssistantData | null, () => void] {
  const [data, setData] = useState<AssistantData | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let stale = false;
    Promise.all([
      api.tasks('open').then(r => r.tasks), api.documents().then(r => r.documents).catch(() => []),
      api.requests('open').then(r => r.open).catch(() => 0), api.inbox().then(r => r.threads.reduce((s, t) => s + t.pending, 0)).catch(() => 0),
    ]).then(([tasks, docs, requests, drafts]) => { if (!stale) setData({ tasks, docs, requests, drafts }); })
      .catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setN(x => x + 1)];
}

const stampOf = (d: Date) => `${iso(d)}T${d.toTimeString().slice(0, 5)}`;
/** Ishning holati: muddati o'tgan, bugun, keyin, muddatsiz */
export function dueGroup(t: Task, now = new Date()): 'late' | 'today' | 'later' | 'none' {
  if (!t.dueAt) return 'none';
  if (t.dueAt < stampOf(now)) return 'late';
  return t.dueAt.slice(0, 10) === iso(now) ? 'today' : 'later';
}
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const dateName = (stamp: string) => {
  const d = new Date(`${stamp.slice(0, 10)}T12:00`);
  const today = iso(new Date()), tomorrow = iso(addDays(new Date(), 1));
  return stamp.slice(0, 10) === today ? 'bugun' : stamp.slice(0, 10) === tomorrow ? 'ertaga' : `${d.getDate()}-${MONTHS[d.getMonth()]}`;
};
const dayName = (due: string) => `${dateName(due)}, ${due.slice(11, 16)}`;

/** Bugungi qisqacha holat — ma'lumotdan yig'ilgan gaplar (AI chaqirilmaydi) */
function Brief({ data, owner }: { data: AssistantData; owner: string }) {
  const late = data.tasks.filter(t => dueGroup(t) === 'late').sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));
  const today = data.tasks.filter(t => dueGroup(t) === 'today');
  const lines: { tone: 'warn' | 'ok' | 'info'; text: string }[] = [];
  if (late.length) lines.push({ tone: 'warn', text: `${late.length} ta ish kechikdi — eng eskisi «${late[0].title.slice(0, 60)}» (${dayName(late[0].dueAt!)}).` });
  lines.push(today.length ? { tone: 'info', text: `Bugunga ${today.length} ta ish: ${today.slice(0, 2).map(t => `«${t.title.slice(0, 40)}»`).join(', ')}.` } : { tone: 'ok', text: "Bugunga yangi ish yo'q." });
  if (data.requests) lines.push({ tone: 'warn', text: `Qabulxonada ${data.requests} ta so'rov sizni kutyapti.` });
  if (data.drafts) lines.push({ tone: 'warn', text: `Mijozlarga ${data.drafts} ta javob tasdiqingizni kutyapti.` });
  if (data.docs[0]) lines.push({ tone: 'info', text: `Oxirgi hujjat: «${data.docs[0].title}».` });
  return (
    <section className="relative overflow-hidden rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(139,140,255,0.16),transparent)]" />
      <h2 className="relative flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#c7c8ff]"><SunMedium className="h-4 w-4" aria-hidden="true" />Bugun</h2>
      <p className="relative mt-3 text-[22px] font-semibold leading-snug tracking-tight text-[#f2f0ea]">{owner ? `${owner}, ` : ''}{late.length ? 'avval kechikkan ishlarni yopaylik.' : today.length ? 'bugungi reja tayyor.' : 'hammasi joyida.'}</p>
      <ul className="relative mt-4 flex flex-col gap-2">
        {lines.map(l => (
          <li key={l.text} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-[#c9cbd2]">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${l.tone === 'warn' ? 'bg-[#f5b454]' : l.tone === 'ok' ? 'bg-emerald-400' : 'bg-[#8b8cff]'}`} aria-hidden="true" />{l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Kun rejasi: guruhlar va har ishda — bajarildi, bir soatga surish, ertaga 9:00 */
function Agenda({ data, reload, notify, onChanged }: { data: AssistantData; reload: () => void; notify: Notify; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (t: Task, patch: Partial<Pick<Task, 'status' | 'dueAt'>>, done: string) => {
    setBusy(t.id);
    try { await api.updateTask(t.id, patch); notify(done); reload(); onChanged(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const hourLater = (t: Task) => {
    const base = t.dueAt && t.dueAt > stampOf(new Date()) ? new Date(t.dueAt) : new Date();
    return stampOf(new Date(base.getTime() + 3_600_000));
  };
  const tomorrow9 = `${iso(addDays(new Date(), 1))}T09:00`;
  const groups = [
    { id: 'late', title: 'Kechikkan', tone: 'text-[#f5b454]' }, { id: 'today', title: 'Bugun', tone: 'text-[#c7c8ff]' },
    { id: 'later', title: 'Keyinroq', tone: 'text-[#a3a9b5]' }, { id: 'none', title: 'Muddatsiz', tone: 'text-[#a3a9b5]' },
  ] as const;
  return (
    <Panel title="Kun rejasi" action={<a href={hrefOf('yordamchi', 'jurnal')} className="text-[13px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">Jurnal →</a>}>
      {!data.tasks.length ? <Quiet>Ochiq ish yo'q. Ayting yoki yozing: «ertaga 10 da Akmalga qo'ng'iroq qilishni eslat».</Quiet> : (
        <div className="flex flex-col gap-5">
          {groups.map(g => {
            const list = data.tasks.filter(t => dueGroup(t) === g.id).sort((a, b) => ((a.dueAt ?? '') < (b.dueAt ?? '') ? -1 : 1));
            return list.length ? (
              <div key={g.id}>
                <h3 className={`mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${g.tone}`}>{g.title} · {list.length}</h3>
                <ul className="flex flex-col gap-2">
                  {list.map(t => (
                    <li key={t.id} className={`group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 ${g.id === 'late' ? 'border-[#f5b454]/15 bg-[#f5b454]/[0.03]' : 'border-glass/[0.06] bg-glass/[0.02]'}`}>
                      <button type="button" disabled={busy === t.id} onClick={() => { void act(t, { status: 'done' }, `Bajarildi: ${t.title}`); }} aria-label={`Bajarildi: ${t.title}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-glass/25 text-transparent transition-colors hover:border-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300">
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="block text-[15px] leading-snug text-[#f2f0ea]">{t.title}</span>
                        {t.dueAt && <span className={`mt-0.5 flex items-center gap-1 text-[12px] ${g.id === 'late' ? 'text-[#f5b454]' : 'text-[#8a909c]'}`}><Clock3 className="h-3 w-3" aria-hidden="true" />{dayName(t.dueAt)}{t.spoken ? ' · qo‘ng‘iroq qilib eslatadi' : ''}</span>}
                      </span>
                      <span className="flex gap-1.5">
                        <button type="button" disabled={busy === t.id} onClick={() => { void act(t, { dueAt: hourLater(t) }, 'Bir soatga surildi'); }} className="min-h-9 rounded-lg border border-glass/10 px-3 text-[12px] text-[#d9dbe1] hover:bg-glass/5">+1 soat</button>
                        <button type="button" disabled={busy === t.id} onClick={() => { void act(t, { dueAt: tomorrow9 }, 'Ertaga 09:00 ga surildi'); }} className="min-h-9 rounded-lg border border-glass/10 px-3 text-[12px] text-[#d9dbe1] hover:bg-glass/5">Ertaga 9:00</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })}
        </div>
      )}
    </Panel>
  );
}

function Docs({ docs, notify }: { docs: Doc[]; notify: Notify }) {
  const download = async (d: Doc) => {
    try {
      const url = URL.createObjectURL(await api.documentFile(d.id));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${d.title}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const excerpt = (md: string) => md.replace(/[#*|_>`-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  return (
    <Panel title={`Hujjatlar${docs.length ? ` · ${docs.length}` : ''}`}>
      {docs.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {docs.slice(0, 4).map(d => (
            <li key={d.id} className="flex flex-col gap-2 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#8b8cff]/15 text-[#c7c8ff]"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold leading-snug text-[#f2f0ea]">{d.title}</span><span className="block text-[11px] text-[#7d838f]">{dateName(d.createdAt)}</span></span>
                <button type="button" onClick={() => { void download(d); }} aria-label={`Yuklab olish: ${d.title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#a3a9b5] hover:bg-glass/5 hover:text-[#f2f0ea]"><Download className="h-4 w-4" aria-hidden="true" /></button>
              </div>
              <p className="line-clamp-2 text-[13px] leading-relaxed text-[#8a909c]">{excerpt(d.markdown)}</p>
            </li>
          ))}
        </ul>
      ) : <Quiet>Hujjat hali yo'q. Ayting: «Aliyevga tijorat taklifi tayyorla».</Quiet>}
    </Panel>
  );
}

const COMMANDS = ['Bugungi rejamni ayt', 'Shartnoma tayyorla', 'Ertaga 10 da eslat', 'Kechagi natijalar qanday?'];

export function AssistantDesk({ data, reload, notify, onChanged, owner }: { data: AssistantData | null; reload: () => void; notify: Notify; onChanged: () => void; owner: string }) {
  if (!data) return <div className="h-64 animate-pulse rounded-[22px] bg-glass/[0.03]" />;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Brief data={data} owner={owner} />
        <VoicePanel kind="owner" member="yordamchi" title="Ovoz bilan ayting" hint="Bosing va gapiring: eslatma, hujjat, savol — hammasi."
          labels={{ start: 'Yordamchi bilan gaplashish', stop: 'Suhbatni tugatish', speaking: 'Yordamchi gapiryapti' }} />
      </div>
      <AgentAsk member="yordamchi" placeholder="Yoki yozing: «Aliyevga tijorat taklifi tayyorla»" chips={COMMANDS} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Agenda data={data} reload={reload} notify={notify} onChanged={onChanged} />
        <Docs docs={data.docs} notify={notify} />
      </div>
    </div>
  );
}
