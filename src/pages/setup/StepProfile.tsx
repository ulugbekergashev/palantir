/**
 * Ulash ustasining birinchi qadami — bitta kompyuter, bitta profil (server/profile.ts) rejimida.
 * Klinikani tanlash yo'q: shu kompyuterning profili bitta. Bu yerda:
 *   - Palantir ulanish kodi: sotuvchi Hub'da «Yangi klinika» bilan olgan kod — qo'yilgach, kompyuter shu yozuvga ulanadi va
 *     Palantir xodimi Hub'dagi «Sozlash» bilan masofadan kiradi;
 *   - klinika ma'lumotlari: nomi, egasi, telefon, manzil, ish vaqti (masofadan ham to'ldiriladi);
 *   - anketa (ixtiyoriy).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Plug } from 'lucide-react';
import { api, putKey, type ProfilePhase } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import type { Business, SetupView } from '../../types';
import { AnketaCard } from './StepClinic';

type Notify = (text: string, error?: boolean) => void;

export function StepProfile({ phase, onPhase, setup, onSetup, notify }: {
  phase: ProfilePhase; onPhase: () => Promise<void>; setup: SetupView | null; onSetup: (s: SetupView) => void; notify: Notify;
}) {
  return (
    <div className="space-y-4">
      <HubCodeCard phase={phase} onPhase={onPhase} notify={notify} />
      <ClinicCard notify={notify} onSaved={onPhase} />
      <AnketaCard setup={setup} onSetup={onSetup} notify={notify} />
    </div>
  );
}

function HubCodeCard({ phase, onPhase, notify }: { phase: ProfilePhase; onPhase: () => Promise<void>; notify: Notify }) {
  const linked = phase.hub === 'code';
  const [open, setOpen] = useState(!linked);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await putKey('PALANTIR_HUB', code.trim(), force, false);
      if (!r.ok) { setError(r.error); return; }
      setCode('');
      setOpen(false);
      await onPhase();
      notify('Palantir Hub\'ga ulandi');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card title="Palantir ulanish kodi"
      description="Palantir'dan olgan kodni qo'ying: kompyuter bizning ro'yxatimizga ulanadi va sozlashni masofadan davom ettira olamiz. Kod «phub.» bilan boshlanadi.">
      {linked && !open ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Ulangan — Palantir bu klinikani ko'radi</p>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Boshqa kod qo'yish</Button>
        </div>
      ) : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Ulanish kodi" hint={phase.hub === 'self' ? "Kompyuter Palantir'ga o'zi yozildi, lekin hali tasdiqlanmagan — kod qo'yilsa, darhol tasdiqlangan bo'ladi" : undefined}>
            <TextInput id="hub-code" value={code} onChange={e => setCode(e.target.value)} placeholder="phub.…" className="font-mono" autoComplete="off" spellCheck={false} required />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Ulash</Button>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
        </form>
      )}
    </Card>
  );
}

/** Ma'lumotlar egasining profilidagi bilan bir joyda (PUT /api/business): panelda ham, botda ham shu */
function ClinicCard({ notify, onSaved }: { notify: Notify; onSaved: () => Promise<void> }) {
  const [biz, setBiz] = useState<Business | null>(null);
  const [rev, setRev] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    api.me().then(r => { if (!gone) { setBiz(r.business); setRev(r.offeringsRev); } }).catch(e => notify((e as Error).message, true));
    return () => { gone = true; };
  }, [notify]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!biz) return;
    setBusy(true);
    try {
      const r = await api.saveBusiness(biz, rev);
      setBiz(r.business);
      setRev(r.offeringsRev);
      await onSaved();
      notify('Saqlandi');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  const field = (k: 'name' | 'industry' | 'ownerName' | 'phone' | 'address' | 'hours') => ({
    value: biz?.[k] ?? '', onChange: (e: { target: { value: string } }) => setBiz(b => (b ? { ...b, [k]: e.target.value } : b)),
  });

  return (
    <Card title="Biznes" description="Mijozlar va egasi ko'radigan asosiy ma'lumot. Qolganini (narxlar, ko'p so'raladigan savollar) egasi Telegram'ni ulagach bot o'zi so'raydi.">
      {!biz ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nomi"><TextInput id="p-name" {...field('name')} required maxLength={60} /></Field>
          <Field label="Soha" hint="AI shunga qarab gapiradi: klinika, o'quv markaz, IT xizmat, do'kon…"><TextInput id="p-industry" {...field('industry')} required maxLength={80} placeholder="stomatologiya, o'quv markaz, IT xizmatlar…" /></Field>
          <Field label="Egasining ismi"><TextInput id="p-owner" {...field('ownerName')} /></Field>
          <Field label="Telefon"><TextInput id="p-phone" {...field('phone')} placeholder="+998 90 123 45 67" /></Field>
          <Field label="Manzil"><TextInput id="p-address" {...field('address')} /></Field>
          <Field label="Ish vaqti"><TextInput id="p-hours" {...field('hours')} placeholder="Du–Sh 9:00–20:00" /></Field>
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Saqlash</Button></div>
        </form>
      )}
    </Card>
  );
}
