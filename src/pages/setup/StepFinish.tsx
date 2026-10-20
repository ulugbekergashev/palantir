/** Ulash ustasining oxirgi ikki qadami: bo'shliqlar (egasidan Telegram'da so'rash) va yakuniy ko'rinish */
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, CircleMinus, CircleAlert, Loader2, Send } from 'lucide-react';
import { api, session } from '../../data/api';
import { Button, ButtonLink, Card } from '../../components/ui';
import type { SetupView } from '../../types';
import { stepState, visibleSteps, type StepState, type WizardFacts } from './wizard';

type Notify = (text: string, error?: boolean) => void;
const POLL_MS = 4_000;

export function StepGaps({ setup, onSetup, notify }: { setup: SetupView; onSetup: (s: SetupView) => void; notify: Notify }) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  // Egasi Telegram'da javob bergan sari ro'yxat qisqaradi
  useEffect(() => {
    if (!asked) return;
    const t = setInterval(() => { void api.setup().then(r => onSetup(r.setup)).catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [asked, onSetup]);

  const ask = async () => {
    setBusy(true);
    try { onSetup((await api.askOwner()).setup); setAsked(true); notify("Savollar egasining Telegram'iga yuborildi"); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const { gaps, pack } = setup;
  const left = pack.total - pack.answered;
  const allDone = !gaps.length && !left;
  return (
    <div className="space-y-4">
      <Card title={allDone ? "Bo'shliq yo'q" : `${gaps.length} ta bo'shliq${left ? `, ${left} ta javobsiz savol` : ''}`}
        description={allDone ? "Cerebro mijozlarga narx, manzil, ish vaqti va ko'p so'raladigan savollar bo'yicha o'zi javob bera oladi." : "Har biri qayerdan kelgani yozilgan. Egasi javob berishi bilan o'z joyiga yoziladi: narx — jadvalga, manzil va ish vaqti — «Biznes haqida» sahifasiga."}
        action={!allDone && <Button variant={asked ? 'secondary' : 'primary'} onClick={ask} disabled={busy || asked || !setup.status.ownerLinked}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {asked ? "So'raldi" : "Egasidan Telegram'da so'rash"}</Button>}>
        {!setup.status.ownerLinked && !allDone && <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Avval egasi Telegram'ni ulasin («Egasining Telegram'i» qadami) — savollar o'sha yerga boradi.</p>}
        {gaps.length > 0 && (
          <ul className="space-y-2.5">
            {gaps.map(g => (
              <li key={g.id} className="flex gap-3 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span><span className="font-semibold text-slate-900">{g.question}</span>{g.options && <span className="block text-xs text-slate-500">Tugmalar: {g.options.join(' · ')}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {left > 0 && <p className="mt-3 text-sm text-slate-600">Keyin — mijozlar eng ko'p so'raydigan {left} ta savol ({pack.answered}/{pack.total} tasiga javob bor).</p>}
        {asked && !allDone && <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Egasi javob bergan sari ro'yxat o'zi yangilanadi…</p>}
      </Card>
    </div>
  );
}

const ICON: Record<StepState, typeof CheckCircle2> = { ok: CheckCircle2, warn: CircleAlert, skip: CircleMinus, '': CircleDashed };
const TONE: Record<StepState, string> = { ok: 'text-emerald-600', warn: 'text-amber-600', skip: 'text-slate-400', '': 'text-slate-300' };
const WORD: Record<StepState, string> = { ok: 'tayyor', warn: 'chala', skip: 'kerak emas', '': 'qilinmagan' };

export function StepDone({ facts, elapsed, onGo }: { facts: WizardFacts; elapsed: string; onGo: (i: number) => void }) {
  // Ustaning o'zidagi tartib bilan bir xil: onGo indeksi o'sha ro'yxatga mos
  const rows = visibleSteps(facts.status).filter(s => s.key !== 'done');
  const states = rows.map(s => stepState(s.key, facts));
  const ready = states.filter(s => s === 'ok' || s === 'skip').length;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm text-slate-500">Klinikada o'tgan vaqt</p><p className="font-mono text-4xl font-medium tabular-nums">{elapsed}</p></div>
          <div className="text-right">
            <p className={`text-lg font-extrabold ${ready === rows.length ? 'text-emerald-700' : 'text-amber-700'}`}>{ready}/{rows.length} tayyor</p>
            <p className="text-sm text-slate-500">{ready === rows.length ? 'Ketishingiz mumkin.' : "Chala qolganlarini bosib, qaytib tugating."}</p>
          </div>
        </div>
      </Card>
      <Card>
        <ul className="divide-y divide-slate-100">
          {rows.map((s, i) => {
            const st = states[i], Icon = ICON[st];
            return (
              <li key={s.key}>
                <button type="button" onClick={() => onGo(i)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50">
                  <Icon className={`h-5 w-5 shrink-0 ${TONE[st]}`} aria-hidden="true" />
                  <span className="flex-1 font-semibold">{s.title}</span>
                  <span className="text-sm text-slate-500">{WORD[st]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex flex-wrap gap-2">
        {/* Admin kirishi shu kompyuterda qolmasin: klinika xodimi kalitlarni o'zgartira olmasin */}
        <ButtonLink variant="primary" href="#/" onClick={() => session.setAdmin(null)}>Kabinetga o'tish</ButtonLink>
        <ButtonLink href="#/admin">Admin sahifasi</ButtonLink>
      </div>
      <p className="text-sm text-slate-500">Ketishdan oldin: egasi botga «Bugun nechta qabul bor?» deb yozib ko'rsin, kompyuterni o'chirib-yoqib bot o'zi javob berishini tekshiring, kompyuter uxlamaydigan qilinsin.</p>
    </div>
  );
}
