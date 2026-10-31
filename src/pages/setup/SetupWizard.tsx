/**
 * Ulash ustasi (#/ulash). Ikki rejim (server aytadi: /api/profile/phase):
 *   - bitta kompyuter, bitta profil (klinika kompyuteri, server/profile.ts): admin paroli yo'q. Egasiga topshirilguncha Palantir xodimi
 *     shu kompyuterdan parolsiz yoki Hub'dagi «Sozlash» bilan masofadan kiradi; keyin — egasi (login-parol) yoki ruxsat bilan jamoa.
 *     Kalitlar — klinikaniki; oxirgi qadamda «Egasiga topshirish»;
 *   - bir nechta biznesli server (dasturchi nusxasi, stend): eskicha — admin paroli, klinikani tanlash, umumiy kalitlar.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut } from 'lucide-react';
import { adminApi, api, session, type AdminBusiness, type PhoneLine, type ProfilePhase } from '../../data/api';
import { Logo } from '../../components/Logo';
import { Button, ButtonLink, Field, TextInput } from '../../components/ui';
import { useFontsReady, useToast } from '../../lib/hooks';
import type { KeyView, LiveStatus, SetupView } from '../../types';
import { StepCameras } from './StepCameras';
import { StepClinic } from './StepClinic';
import { StepCrm, StepInstagram, StepOwner, StepTelegram } from './StepConnections';
import { StepDone, StepGaps } from './StepFinish';
import { StepKeys, emptyRouted, type Routed } from './StepKeys';
import { StepPhone } from './StepPhone';
import { StepProfile } from './StepProfile';
import { clock, stepState, visibleSteps, type StepKey, type StepState, type WizardFacts } from './wizard';

const BIZ_KEY = 'palantir_setup_biz', T0_KEY = 'palantir_setup_t0';
/** O'rnatish o'zi yaratgan profilning nomi (server/profile.ts DEFAULT_NAME): o'zgartirilmagan bo'lsa «Klinika» qadami tayyor emas */
const DEFAULT_NAME = 'Yangi klinika';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* yopiq xotira */ } };

const DOT: Record<StepState, string> = {
  ok: 'border-emerald-500 bg-emerald-500 text-white', warn: 'border-amber-500 bg-amber-500 text-white', skip: 'border-ink-600 bg-ink-700 text-ink-300', '': 'border-ink-600 text-ink-400',
};

type Notify = (text: string, error?: boolean) => void;

export function SetupWizard() {
  useFontsReady();
  const [phase, setPhase] = useState<ProfilePhase | null>(null);
  const [phaseError, setPhaseError] = useState('');
  const loadPhase = useCallback(async () => {
    try { setPhase(await api.profilePhase()); setPhaseError(''); } catch (e) { setPhaseError((e as Error).message); }
  }, []);
  useEffect(() => {
    let gone = false;
    api.profilePhase().then(p => { if (!gone) setPhase(p); }).catch(e => { if (!gone) setPhaseError((e as Error).message); });
    return () => { gone = true; };
  }, []);
  if (phaseError && !phase) return <Centered><p role="alert" className="text-sm text-rose-700">{phaseError}</p></Centered>;
  if (!phase) return <Centered><Loader2 className="h-7 w-7 animate-spin text-slate-400" aria-label="yuklanmoqda" /></Centered>;
  return phase.oneProfile ? <ProfileWizard phase={phase} onPhase={loadPhase} /> : <AdminWizard />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-4">{children}</div>;
}

/** Ustaning ko'rinishi: chapda qadamlar va vaqt, o'ngda joriy qadam, pastda «Orqaga / Davom etish» */
function Shell({ label, facts, stepKey, onStep, onLogout, children, toast }: {
  label: string | null; facts: WizardFacts; stepKey: StepKey; onStep: (k: StepKey) => void; onLogout: () => void;
  children: (current: StepKey, go: (i: number) => void, elapsed: string) => ReactNode; toast: { text: string; error?: boolean } | null;
}) {
  const [t0] = useState(() => Number(read(T0_KEY)) || (write(T0_KEY, String(Date.now())), Date.now()));
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const steps = visibleSteps(facts.status);
  const step = Math.max(0, steps.findIndex(s => s.key === stepKey));
  const current = steps[step];
  const go = (i: number) => { onStep(steps[Math.max(0, Math.min(steps.length - 1, i))].key); window.scrollTo(0, 0); };
  const st = stepState(current.key, facts);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="bg-ink-950 text-ink-200 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-5 lg:overflow-y-auto lg:p-5" aria-label="Qadamlar">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 lg:p-0"><Logo subtitle="Ulash ustasi" tone="ink" /></div>
        {label && <p className="mx-4 mt-3 rounded-xl bg-ink-800 px-3 py-2 text-sm lg:mx-0 lg:mt-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-400">Klinika</span>{label}</p>}
        <ol className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:p-0">
          {steps.map((s, i) => {
            const state = stepState(s.key, facts), cur = i === step;
            return (
              <li key={s.key} className="shrink-0">
                <button type="button" onClick={() => go(i)} aria-current={cur ? 'step' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${cur ? 'bg-ink-800 font-bold text-white' : 'hover:bg-ink-900'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-extrabold tabular-nums ${DOT[state]} ${cur && !state ? 'border-brand-400 text-white' : ''}`} aria-hidden="true">
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
          <button type="button" onClick={onLogout} className="mt-4 flex items-center gap-1.5 rounded text-xs text-ink-400 hover:text-white"><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Chiqish</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{step + 1}-qadam / {steps.length}</p>
          <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-tight">{current.title}</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-500">{facts.profile && current.key === 'clinic' ? PROFILE_LEAD : current.lead}</p>
          <div key={current.key} className="animate-rise mt-6">{children(current.key, go, clock(now - t0))}</div>
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

const PROFILE_LEAD = "Palantir ulanish kodi va klinikaning asosiy ma'lumotlari. Kod qo'yilgach, sozlashni Palantir masofadan davom ettira oladi.";

/** Klinika kabineti holati: kanallar, bo'shliqlar, kameralar soni, telefon liniyasi — ikkala rejimda bir xil (kabinet yo'llari orqali) */
function useCabinet(notify: Notify) {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [setup, setSetup] = useState<SetupView | null>(null);
  const [cameras, setCameras] = useState(0);
  const [phone, setPhone] = useState<PhoneLine | null>(null);
  const [routed, setRouted] = useState<Routed>(emptyRouted);
  const refresh = useCallback(async () => {
    // Telefon liniyasi holati (Asterisk) sekinroq bo'lishi mumkin — boshqa qadamlarni kutdirmaydi
    api.phoneLine().then(r => setPhone(r.line)).catch(() => {});
    const [me, s, cams] = await Promise.all([api.me(), api.setup(), api.cameras()]);
    setStatus(me.status);
    setSetup(s.setup);
    setCameras(cams.cameras.filter(c => c.ip).length);
  }, []);
  return { status, setStatus, setup, setSetup, cameras, setCameras, phone, setPhone, routed, setRouted, refresh, notify };
}
type Cabinet = ReturnType<typeof useCabinet>;

/** Kabinet qadamlari (klinika tanlangandan keyin): ikkala rejimda bir xil */
function cabinetStep(key: StepKey, c: Cabinet): ReactNode {
  const { status, setup, routed, refresh, notify } = c;
  switch (key) {
    case 'owner': return <StepOwner status={status!} refresh={refresh} notify={notify} />;
    case 'crm': return <StepCrm status={status!} setup={setup} routed={routed} onStatus={c.setStatus} notify={notify} />;
    case 'cams': return <StepCameras setup={setup} routed={routed} onCount={c.setCameras} notify={notify} />;
    case 'tg': return <StepTelegram status={status!} setup={setup} routed={routed} refresh={refresh} notify={notify} />;
    case 'ig': return <StepInstagram status={status!} routed={routed} setup={setup} refresh={refresh} onStatus={c.setStatus} notify={notify} />;
    case 'phone': return <StepPhone line={c.phone} onLine={c.setPhone} notify={notify} />;
    case 'gaps': return <StepGaps setup={setup!} onSetup={c.setSetup} notify={notify} />;
    default: return null;
  }
}

const loading = <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-400" aria-label="yuklanmoqda" />;

// ─── Bitta kompyuter — bitta profil ───────────────────────────────────────────

function ProfileWizard({ phase, onPhase }: { phase: ProfilePhase; onPhase: () => Promise<void> }) {
  const [toast, setToast] = useToast();
  const notify = useCallback<Notify>((text, error = false) => setToast({ text, error }), [setToast]);
  const [authed, setAuthed] = useState(() => !!session.token());
  const [authError, setAuthError] = useState('');
  const [stepKey, setStepKey] = useState<StepKey>('clinic');
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [ready, setReady] = useState(false);
  const cab = useCabinet(notify);
  const { refresh } = cab;

  // Sozlash bosqichida shu kompyuterdan — parolsiz (server tekshiradi: faqat shu kompyuterning o'zidan)
  useEffect(() => {
    if (authed || !phase.setup) return;
    let gone = false;
    api.setupLogin().then(r => { if (!gone) { session.set(r.token); setAuthed(true); } }).catch(e => { if (!gone) setAuthError((e as Error).message); });
    return () => { gone = true; };
  }, [authed, phase.setup]);

  useEffect(() => {
    if (!authed) return;
    let gone = false;
    Promise.all([api.keys(), refresh()])
      .then(([k]) => { if (!gone) { setKeys(k.keys); setReady(true); } })
      .catch(e => { if (!gone) notify((e as Error).message, true); });
    return () => { gone = true; };
  }, [authed, refresh, notify]);

  if (!authed) {
    return (
      <Centered>
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lift sm:p-7">
          <Logo subtitle="Ulash ustasi" />
          {phase.setup && !authError ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Ochilmoqda…</p> : <>
            <p className="text-sm text-slate-600">{phase.setup ? authError : "Klinika egasiga topshirilgan. Sozlash uchun egasining login va paroli bilan kiring — keyin shu sahifaga qayting."}</p>
            <ButtonLink variant="primary" href="#/" className="w-full">Kirish sahifasi</ButtonLink>
          </>}
        </div>
      </Centered>
    );
  }

  const facts: WizardFacts = { hasBiz: !!phase.name && phase.name !== DEFAULT_NAME, status: cab.status, setup: cab.setup, keys, cameras: cab.cameras, phone: cab.phone, profile: true };
  const logout = () => { session.set(null); window.location.hash = '#/'; window.location.reload(); };
  return (
    <Shell label={phase.name} facts={facts} stepKey={stepKey} onStep={setStepKey} onLogout={logout} toast={toast}>
      {(key, go, elapsed) => !ready || !cab.status || !cab.setup ? loading
        : key === 'clinic' ? <StepProfile phase={phase} onPhase={onPhase} setup={cab.setup} onSetup={cab.setSetup} notify={notify} />
        : key === 'keys' ? <StepKeys profile keys={keys} onKeys={k => { setKeys(k); refresh().catch(() => {}); }} onRouted={cab.setRouted} />
        : key === 'done' ? <StepDone facts={facts} elapsed={elapsed} onGo={go} handover={phase.setup} name={phase.name ?? ''} />
        : cabinetStep(key, cab)}
    </Shell>
  );
}

// ─── Bir nechta biznesli server: admin paroli bilan ──────────────────────────

/** Admin kirishi: ulash ustasi server kalitlarini o'zgartiradi — faqat admin paroli bilan */
function AdminGate({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { session.setAdmin((await adminApi.login(password)).token); onIn(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <Centered>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lift sm:p-7">
        <Logo subtitle="Klinikani ulash ustasi" />
        <p className="text-sm text-slate-500">O'rnatuvchi uchun. O'rnatgich oxirida ko'rsatilgan admin parolini kiriting.</p>
        <Field label="Admin paroli"><TextInput type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus required /></Field>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" variant="primary" className="w-full">Kirish</Button>
      </form>
    </Centered>
  );
}

function AdminWizard() {
  const [authed, setAuthed] = useState(!!session.adminToken());
  const [toast, setToast] = useToast();
  const notify = useCallback<Notify>((text, error = false) => setToast({ text, error }), [setToast]);
  // Qadam kaliti bilan: serverda o'chiq qadam ro'yxatdan chiqsa ham joriy qadam siljimaydi
  const [stepKey, setStepKey] = useState<StepKey>('clinic');
  const [list, setList] = useState<AdminBusiness[] | null>(null);
  const [bizId, setBizId] = useState<string | null>(() => read(BIZ_KEY));
  /** Qaysi klinika kabinetiga kirilgan: boshqasi tanlansa, kirish tugaguncha «kirilmagan» */
  const [enteredBiz, setEnteredBiz] = useState<string | null>(null);
  const entered = !!bizId && enteredBiz === bizId;
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const cab = useCabinet(notify);
  const { refresh } = cab;

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
  // Kirgach ro'yxat yuklanadi (javob kelgach holat yoziladi — effekt ichida darhol emas)
  useEffect(() => {
    if (!authed) return;
    let gone = false;
    Promise.all([adminApi.businesses(), adminApi.keys()])
      .then(([b, k]) => { if (!gone) { setList(b.businesses); setKeys(k.keys); } })
      .catch(e => { if (!gone) adminFail(e); });
    return () => { gone = true; };
  }, [authed, adminFail]);

  // Tanlangan klinika kabinetiga admin nomidan kirish: CRM, kameralar, Telegram — kabinet yo'llari orqali
  useEffect(() => {
    if (!authed || !bizId) return;
    let stale = false;
    adminApi.enter(bizId).then(async r => {
      if (stale) return;
      session.set(r.token);
      write(BIZ_KEY, bizId);
      // Holatni olib bo'lmasa (tarmoq) ham klinika tanlovi qoladi — qadamlar qayta urinadi
      await refresh().catch(e => notify((e as Error).message, true));
      if (!stale) setEnteredBiz(bizId);
    }).catch(e => { if (!stale) { write(BIZ_KEY, null); setBizId(null); setEnteredBiz(null); adminFail(e); } });
    return () => { stale = true; };
  }, [authed, bizId, refresh, adminFail, notify]);

  if (!authed) return <AdminGate onIn={() => setAuthed(true)} />;

  const facts: WizardFacts = { hasBiz: !!bizId && entered, status: cab.status, setup: cab.setup, keys, cameras: cab.cameras, phone: cab.phone };
  const ready = entered && cab.status && cab.setup;
  const label = list && bizId ? list.find(b => b.id === bizId)?.name ?? '…' : null;
  return (
    <Shell label={label} facts={facts} stepKey={stepKey} onStep={setStepKey} onLogout={() => { session.setAdmin(null); setAuthed(false); }} toast={toast}>
      {(key, go, elapsed) => {
        const needsBiz = key !== 'clinic' && key !== 'keys' && key !== 'done';
        if (needsBiz && !bizId) return <p className="rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-600">Avval «Klinika» qadamida klinikani tanlang yoki qo'shing.</p>;
        if (needsBiz && !ready) return loading;
        if (key === 'clinic') return <StepClinic list={list} selected={bizId} onSelect={setBizId} onCreated={loadAdmin} setup={cab.setup} onSetup={cab.setSetup} notify={notify} />;
        if (key === 'keys') return <StepKeys profile={false} keys={keys} onKeys={k => { setKeys(k); if (entered) refresh().catch(() => {}); }} onRouted={cab.setRouted} />;
        if (key === 'done') return <StepDone facts={facts} elapsed={elapsed} onGo={go} />;
        return cabinetStep(key, cab);
      }}
    </Shell>
  );
}
