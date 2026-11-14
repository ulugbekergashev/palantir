/**
 * Ulash ustasining birinchi qadami — bitta kompyuter, bitta profil (server/profile.ts) rejimida.
 * Klinikani tanlash yo'q: shu kompyuterning profili bitta. Bu yerda faqat klinika ma'lumotlari (nomi, soha, egasi, telefon,
 * manzil, ish vaqti — masofadan ham to'ldiriladi) va ixtiyoriy anketa.
 *
 * Hub ulanish kodi bu yerda so'ralmaydi: kompyuter Hub'ga o'zi yoziladi (server/hubJoin.ts), sotuvchi uni Hub'da ekrandagi
 * kompyuter kodi bilan tasdiqlaydi va o'sha bosishda litsenziya beradi. O'zi ulana olmagan kamdan-kam holatda «palantirhub.» kodi
 * «Kalitlar» maydoniga qo'yiladi (src/lib/secrets.ts uni taniydi).
 */
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import type { Business, SetupView } from '../../types';
import { AnketaCard } from './StepClinic';
import { leaveGuard } from './wizard';

/** O'rnatish o'zi yaratgan profilning nomi (server/profile.ts DEFAULT_NAME) */
const DEFAULT_NAME = 'Yangi biznes';

type Notify = (text: string, error?: boolean) => void;

export function StepProfile({ onPhase, setup, onSetup, notify }: {
  onPhase: () => Promise<void>; setup: SetupView | null; onSetup: (s: SetupView) => void; notify: Notify;
}) {
  return (
    <div className="space-y-4">
      <ClinicCard notify={notify} onSaved={onPhase} />
      <AnketaCard setup={setup} onSetup={onSetup} notify={notify} />
    </div>
  );
}

/** Ma'lumotlar egasining profilidagi bilan bir joyda (PUT /api/business): panelda ham, botda ham shu */
function ClinicCard({ notify, onSaved }: { notify: Notify; onSaved: () => Promise<void> }) {
  const [biz, setBiz] = useState<Business | null>(null);
  const [saved, setSaved] = useState<Business | null>(null);
  const [rev, setRev] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    api.me().then(r => {
      if (gone) return;
      // O'rnatish o'zi qo'ygan «Yangi biznes» nomi maydonda ko'rinmaydi — o'rnatuvchi klinikaning haqiqiy nomini yozadi (I7)
      const b = r.business.name === DEFAULT_NAME ? { ...r.business, name: '' } : r.business;
      setBiz(b); setSaved(b); setRev(r.offeringsRev);
    }).catch(e => notify((e as Error).message, true));
    return () => { gone = true; };
  }, [notify]);

  const persist = async (): Promise<boolean> => {
    if (!biz) return true;
    if (!biz.name.trim() || !biz.industry.trim()) { notify('Klinika nomi va sohasini yozing — keyin davom etamiz', true); return false; }
    setBusy(true);
    try {
      const r = await api.saveBusiness(biz, rev);
      setBiz(r.business); setSaved(r.business); setRev(r.offeringsRev);
      await onSaved();
      notify('Saqlandi');
      return true;
    } catch (err) { notify((err as Error).message, true); return false; } finally { setBusy(false); }
  };
  const save = async (e: FormEvent) => { e.preventDefault(); await persist(); };
  // «Saqlash»ni bosmay keyingi qadamga o'tilsa — o'zgargani saqlanadi (jim yo'qolmaydi)
  const dirty = !!biz && JSON.stringify(biz) !== JSON.stringify(saved);
  const flush = useEffectEvent(persist);
  useEffect(() => {
    leaveGuard.current = dirty ? () => flush() : null;
    return () => { leaveGuard.current = null; };
  }, [dirty]);
  const field = (k: 'name' | 'industry' | 'ownerName' | 'phone' | 'address' | 'hours') => ({
    value: biz?.[k] ?? '', onChange: (e: { target: { value: string } }) => setBiz(b => (b ? { ...b, [k]: e.target.value } : b)),
  });

  return (
    <Card title="Biznes" description="Mijozlar va egasi ko'radigan asosiy ma'lumot. Qolganini (narxlar, ko'p so'raladigan savollar) egasi Telegram'ni ulagach bot o'zi so'raydi.">
      {!biz ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nomi"><TextInput id="p-name" {...field('name')} required maxLength={60} placeholder="Shifo Dent" /></Field>
          <Field label="Soha" hint="AI shunga qarab gapiradi: stomatologiya, ko'z, ginekologiya, kosmetologiya…"><TextInput id="p-industry" {...field('industry')} required maxLength={80} placeholder="stomatologiya" /></Field>
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
