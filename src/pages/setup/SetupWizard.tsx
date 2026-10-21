import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut } from 'lucide-react';
import { adminApi, api, session, type AdminBusiness } from '../../data/api';
import { Logo } from '../../components/Logo';
import { Button, Field, TextInput } from '../../components/ui';
import { useFontsReady, useToast } from '../../lib/hooks';
import type { KeyView, LiveStatus, SetupView } from '../../types';
import { StepCameras } from './StepCameras';
import { StepClinic } from './StepClinic';
import { StepCrm, StepInstagram, StepOwner, StepTelegram } from './StepConnections';
import { StepDone, StepGaps } from './StepFinish';
import { StepKeys, emptyRouted, type Routed } from './StepKeys';
import { clock, stepState, visibleSteps, type StepKey, type StepState, type WizardFacts } from './wizard';

const BIZ_KEY = 'palantir_setup_biz', T0_KEY = 'palantir_setup_t0';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* yopiq xotira */ } };

const DOT: Record<StepState, string> = {
  ok: 'border-emerald-500 bg-emerald-500 text-white', warn: 'border-amber-500 bg-amber-500 text-white', skip: 'border-ink-600 bg-ink-700 text-ink-300', '': 'border-ink-600 text-ink-400',
};

/** Admin kirishi: ulash ustasi server kalitlarini o'zgartiradi — faqat admin paroli bilan */
function AdminGate({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { session.setAdmin((await adminApi.login(password)).token); onIn(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lift sm:p-7">
        <Logo subtitle="Klinikani ulash ustasi" />
        <p className="text-sm text-slate-500">O'rnatuvchi uchun. O'rnatgich oxirida ko'rsatilgan admin parolini kiriting.</p>
        <Field label="Admin paroli"><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus required /></Field>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" variant="primary" className="w-full">Kirish</Button>
      </form>
    </div>
  );
}

export function SetupWizard() {
  useFontsReady();
  const [authed, setAuthed] = useState(!!session.adminToken());
  const [toast, setToast] = useToast();
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), [setToast]);
  // Qadam kaliti bilan: serverda o'chiq qadam ro'yxatdan chiqsa ham joriy qadam siljimaydi
  const [stepKey, setStepKey] = useState<StepKey>('clinic');
  const [list, setList] = useState<AdminBusiness[] | null>(null);
  const [bizId, setBizId] = useState<string | null>(() => read(BIZ_KEY));
  const [entered, setEntered] = useState(false);
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [setup, setSetup] = useState<SetupView | null>(null);
  const [cameras, setCameras] = useState(0);
  const [routed, setRouted] = useState<Routed>(emptyRouted);
  const [t0] = useState(() => Number(read(T0_KEY)) || (write(T0_KEY, String(Date.now())), Date.now()));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const adminFail = useCallback((e: unknown) => {
    if ((e as { status?: number }).status === 401) { session.setAdmin(null); setAuthed(false); }
    notify((e as Error).message, true);
  }, [notify]);
  const loadAdmin = useCallback(async () => {
    try {
      const [b, k] = await Promise.all([adminApi.businesses(), adminApi.keys()]);
      setList(b.businesses);
      setKeys(k.keys);
    } catch (e) { adminFail(e); }
  }, [adminFail]);
  useEffect(() => { if (authed) void loadAdmin(); }, [authed, loadAdmin]);

  /** Kabinet holati: kanallar, bo'shliqlar, kameralar soni */
  const refresh = useCallback(async () => {
    const [me, s, cams] = await Promise.all([api.me(), api.setup(), api.cameras()]);
    setStatus(me.status);
    setSetup(s.setup);
    setCameras(cams.cameras.filter(c => c.ip).length);
  }, []);

  // Tanlangan klinika kabinetiga admin nomidan kirish: CRM, kameralar, Telegram — kabinet yo'llari orqali
  useEffect(() => {
    if (!authed || !bizId) return;
    let stale = false;
    setEntered(false);
    adminApi.enter(bizId).then(async r => {
      if (stale) return;
      session.set(r.token);
      write(BIZ_KEY, bizId);
      // Holatni olib bo'lmasa (tarmoq) ham klinika tanlovi qoladi — qadamlar qayta urinadi
      await refresh().catch(e => notify((e as Error).message, true));
      if (!stale) setEntered(true);
    }).catch(e => { if (!stale) { write(BIZ_KEY, null); setBizId(null); adminFail(e); } });
    return () => { stale = true; };
  }, [authed, bizId, refresh, adminFail, notify]);

  if (!authed) return <AdminGate onIn={() => setAuthed(true)} />;

  const facts: WizardFacts = { hasBiz: !!bizId && entered, status, setup, keys, cameras };
  const steps = visibleSteps(status);
  const step = Math.max(0, steps.findIndex(s => s.key === stepKey));
  const current = steps[step];
  const go = (i: number) => { setStepKey(steps[Math.max(0, Math.min(steps.length - 1, i))].key); window.scrollTo(0, 0); };
  const needsBiz = current.key !== 'clinic' && current.key !== 'keys' && current.key !== 'done';
  const ready = entered && status && setup;
  const st = stepState(current.key, facts);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="bg-ink-950 text-ink-200 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-5 lg:overflow-y-auto lg:p-5" aria-label="Qadamlar">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 lg:p-0"><Logo subtitle="Ulash ustasi" tone="ink" /></div>
        {list && bizId && <p className="mx-4 mt-3 rounded-xl bg-ink-800 px-3 py-2 text-sm lg:mx-0 lg:mt-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-400">Klinika</span>{list.find(b => b.id === bizId)?.name ?? '…'}</p>}
        <ol className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:p-0">
          {steps.map((s, i) => {
            const state = stepState(s.key, facts), cur = i === step;
            return (
              <li key={s.key} className="shrink-0">
                <button type="button" onClick={() => go(i)} aria-current={cur ? 'step' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${cur ? 'bg-ink-800 font-bold text-white' : 'hover:bg-ink-900'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-extrabold tabular-nums ${DOT[state]} ${cur && !state ? 'border-indigo-400 text-white' : ''}`} aria-hidden="true">
                    {state === 'ok' ? <Check className="h-3.5 w-3.5" /> : state === 'warn' ? '!' : state === 'skip' ? '–' : i + 1}
                  </span>
                  <span className={cur ? '' : 'hidden lg:inline'}>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="hidden lg:mt-auto lg:block">
          <p className="text-xs text-ink-400">Klinikada o'tgan vaqt</p>
          <p className="font-mono text-2xl tabular-nums text-white">{clock(now - t0)}</p>
          <button type="button" onClick={() => { write(T0_KEY, String(Date.now())); window.location.reload(); }} className="mt-1 rounded text-xs text-ink-400 hover:text-white">Vaqtni qaytadan boshlash</button>
          <button type="button" onClick={() => { session.setAdmin(null); setAuthed(false); }} className="mt-4 flex items-center gap-1.5 rounded text-xs text-ink-400 hover:text-white"><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Chiqish</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{step + 1}-qadam / {steps.length}</p>
          <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">{current.title}</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-500">{current.lead}</p>
          <div key={current.key} className="animate-rise mt-6">
            {needsBiz && !bizId ? <p className="rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-600">Avval «Klinika» qadamida klinikani tanlang yoki qo'shing.</p>
              : needsBiz && !ready ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-400" aria-label="yuklanmoqda" />
              : current.key === 'clinic' ? <StepClinic list={list} selected={bizId} onSelect={setBizId} onCreated={loadAdmin} setup={setup} onSetup={setSetup} notify={notify} />
              : current.key === 'keys' ? <StepKeys keys={keys} onKeys={k => { setKeys(k); if (entered) refresh().catch(() => {}); }} onRouted={setRouted} />
              : current.key === 'owner' ? <StepOwner status={status!} refresh={refresh} notify={notify} />
              : current.key === 'crm' ? <StepCrm status={status!} setup={setup} routed={routed} onStatus={setStatus} notify={notify} />
              : current.key === 'cams' ? <StepCameras setup={setup} routed={routed} onCount={setCameras} notify={notify} />
              : current.key === 'tg' ? <StepTelegram status={status!} setup={setup} routed={routed} refresh={refresh} notify={notify} />
              : current.key === 'ig' ? <StepInstagram status={status!} routed={routed} setup={setup} refresh={refresh} onStatus={setStatus} notify={notify} />
              : current.key === 'gaps' ? <StepGaps setup={setup!} onSetup={setSetup} notify={notify} />
              : <StepDone facts={facts} elapsed={clock(now - t0)} onGo={go} />}
          </div>
        </main>
        <footer className="sticky bottom-0 border-t border-slate-200 bg-paper/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <Button onClick={() => go(step - 1)} disabled={step === 0}><ArrowLeft className="h-4 w-4" /> Orqaga</Button>
            <span className="hidden text-sm text-slate-500 sm:inline">{st === 'ok' ? 'Bu qadam tayyor' : st === 'warn' ? "Chala — keyin qaytsa ham bo'ladi" : st === 'skip' ? 'Bu klinikaga kerak emas' : ''}</span>
            {step < steps.length - 1 && <Button variant="primary" onClick={() => go(step + 1)}>{step === steps.length - 2 ? 'Yakunlash' : 'Davom etish'} <ArrowRight className="h-4 w-4" /></Button>}
          </div>
        </footer>
      </div>
      {toast && (
        <div role="status" className={`animate-pop fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lift ${toast.error ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>{toast.text}</div>
      )}
    </div>
  );
}
