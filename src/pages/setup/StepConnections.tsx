/** Ulash ustasining kanal qadamlari: egasining Telegram'i, DentaCRM, shaxsiy Telegram, Instagram — mavjud kabinet yo'llari orqali */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import type { LiveStatus, SetupView } from '../../types';
import { InstagramOfficial } from '../TelegramPage';
import type { Routed } from './StepKeys';

type Notify = (text: string, error?: boolean) => void;
/** Holat tashqarida o'zgaradi (egasi telefonda bosadi, Instagram oynasida kiradi) — shuncha vaqtda bir yangilanadi */
const POLL_MS = 3_000;

function usePoll(active: boolean, refresh: () => Promise<void>): void {
  useEffect(() => {
    if (!active) return;
    // Bir martalik tarmoq uzilishi — keyingi urinishda o'tadi
    const t = setInterval(() => { refresh().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);
}

function Done({ title, children }: { title: string; children?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
      <div><p className="font-bold">{title}</p>{children && <p className="mt-0.5 text-sm">{children}</p>}</div>
    </div>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-600">{children}</p>;

// ─── Egasining Telegram'i ────────────────────────────────────────────────────

export function StepOwner({ status, refresh, notify }: { status: LiveStatus; refresh: () => Promise<void>; notify: Notify }) {
  usePoll(!status.ownerLinked && !!status.linkUrl, refresh);
  if (!status.bot) return <Note>Avval «Kalitlar» qadamida Telegram bot tokenini kiriting — keyin egasi uchun ulash havolasi shu yerda chiqadi.</Note>;
  if (status.ownerLinked) return <Done title={`Egasi @${status.bot} bilan ulangan`}>Eslatmalar, ertalabki xulosa va mijozlarga javob takliflari egasining Telegram'iga keladi.</Done>;
  const copy = () => { void navigator.clipboard?.writeText(status.linkUrl ?? '').then(() => notify('Havola nusxalandi'), () => {}); };
  return (
    <Card title="Egasi o'z telefonida shu havolani ochsin" description="Havolani Telegram'da ochib «Start» bosadi — bot «Ulandi» deb javob beradi va bu sahifa o'zi yangilanadi. Havola bir martalik: boshqa odamga bermang.">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm">{status.linkUrl}</code>
        <Button onClick={copy}><Copy className="h-4 w-4" /> Nusxalash</Button>
        {status.linkUrl && <a href={status.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"><ExternalLink className="h-4 w-4" /> Ochish</a>}
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Egasi «Start» bosishini kutyapman…</p>
    </Card>
  );
}

// ─── DentaCRM ────────────────────────────────────────────────────────────────

export function StepCrm({ status, setup, routed, onStatus, notify }: { status: LiveStatus; setup: SetupView | null; routed: Routed; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const [form, setForm] = useState({ url: routed.crmUrl, username: '', password: routed.crmPassword });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(f => ({ ...f, url: f.url || routed.crmUrl, password: f.password || routed.crmPassword })); }, [routed.crmUrl, routed.crmPassword]);
  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { onStatus((await api.crmConnect(form)).status); notify('DentaCRM ulandi'); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {setup?.has.crm === 'none' && <Note>Anketada egasi «DentaCRM yo'q» deb yozgan — bu qadamni o'tkazib yuborish mumkin.</Note>}
      {status.crm.account && (status.crm.problem ? <Note>{status.crm.problem}</Note> : <Done title={`Ulandi: ${status.crm.account}`}>Qabullar, kelgan-kelmaganlar va tushum bosh sahifada ko'rinadi; yordamchi bemorni qabulga yoza oladi.</Done>)}
      <Card title={status.crm.account ? 'Boshqa akkaunt bilan qayta ulash' : 'DentaCRM akkaunti'}>
        <form onSubmit={connect} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="sm:col-span-3"><Field label="DentaCRM manzili"><TextInput value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://klinika.dentacrm.uz" required /></Field></div>
          <Field label="Login"><TextInput value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" required /></Field>
          <Field label="Parol" hint={routed.crmPassword ? 'Kalitlar maydonidan olindi' : undefined}><TextInput type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="off" required /></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ulash va tekshirish</Button>
        </form>
      </Card>
    </div>
  );
}

// ─── Shaxsiy Telegram ────────────────────────────────────────────────────────

export function StepTelegram({ status, setup, routed, refresh, notify }: { status: LiveStatus; setup: SetupView | null; routed: Routed; refresh: () => Promise<void>; notify: Notify }) {
  const [phone, setPhone] = useState(routed.phone || setup?.has.telegramPhone || '');
  const [stage, setStage] = useState<'phone' | 'code' | 'password'>('phone');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!status.telegramUser.available) return <Note>Shaxsiy Telegram uchun «Kalitlar» qadamida Telegram API ID va API hash kerak (my.telegram.org → API development tools; bir marta, hamma klinikalarga bitta).</Note>;
  if (status.telegramUser.account) return <Done title={`Ulandi: ${status.telegramUser.account}`}>Shu raqamga yozgan mijozlarga Cerebro javob tayyorlaydi; egasi tasdiqlamaguncha yuborilmaydi.</Done>;
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (stage === 'phone') { await api.tgStart(phone); setStage('code'); setValue(''); notify("Kod Telegram ilovasiga yuborildi"); }
      else if (stage === 'code') { const r = await api.tgCode(value); if (r.password) { setStage('password'); setValue(''); } else await refresh(); }
      else { await api.tgPassword(value); await refresh(); }
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Card title={stage === 'phone' ? 'Klinika Telegram raqami' : stage === 'code' ? 'Telegram ilovasiga kelgan kod' : 'Ikki bosqichli parol'}
      description={stage === 'code' ? `${phone} dagi Telegram'ni oching: «Telegram» nomidan 5 xonali kod keladi.` : stage === 'password' ? "Bu akkauntda qo'shimcha parol bor — egasi o'zi kiritadi." : undefined}>
      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          {stage === 'phone'
            ? <Field label="Raqam"><TextInput type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90 123 45 67" required /></Field>
            : <Field label={stage === 'code' ? 'Kod' : 'Parol'}><TextInput type={stage === 'password' ? 'password' : 'text'} inputMode={stage === 'code' ? 'numeric' : undefined} value={value} onChange={e => setValue(e.target.value)} className={stage === 'code' ? 'font-mono tracking-[0.3em]' : ''} required autoFocus /></Field>}
        </div>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {stage === 'phone' ? 'Kod yuborish' : 'Tasdiqlash'}</Button>
      </form>
    </Card>
  );
}

// ─── Instagram ───────────────────────────────────────────────────────────────

export function StepInstagram({ status, routed, setup, refresh, onStatus, notify }: { status: LiveStatus; routed: Routed; setup: SetupView | null; refresh: () => Promise<void>; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const ig = status.instagram;
  const [busy, setBusy] = useState(false);
  usePoll(ig.waiting, refresh);
  const handle = routed.instagram.replace(/^.*instagram\.com\//i, '').replace(/[/?].*$/, '') || setup?.has.instagram;
  // Asosiy yo'l — rasmiy (Meta, Cerebro Hub orqali); brauzer orqali faqat serverda yoqilgan bo'lsa (IG_VIA_BROWSER)
  if (!ig.enabled) return <Card title={handle ? `@${handle}` : "Klinikaning Instagram'i"}><InstagramOfficial status={status} onStatus={onStatus} notify={notify} /></Card>;
  if (!ig.available) return <Note>Bu kompyuterda Chrome yoki Edge topilmadi — Instagram uchun bittasini o'rnating.</Note>;
  if (ig.account && !ig.problem) return <Done title={`Ulandi: @${ig.account}`}>Direct'dagi yozishmalar «Mijozlar» bo'limiga tushadi. Birinchi hafta — faqat egasining tasdig'i bilan.</Done>;
  const login = async () => {
    setBusy(true);
    try { onStatus((await api.igLogin()).status); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Card title={handle ? `@${handle} — egasi kiradi` : "Egasining Instagram'i"} description="Tugmani bosing: shu kompyuterda brauzer oynasi ochiladi. Login va parolni egasi o'zi kiritadi — ular Cerebro'da saqlanmaydi.">
      {ig.problem && <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">{ig.problem}</p>}
      {ig.waiting
        ? <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Ochilgan oynada egasi kirishini kutyapman… <Button size="sm" variant="ghost" onClick={() => void api.igCancel().then(refresh)}>Bekor qilish</Button></p>
        : <Button variant="primary" onClick={login} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Instagram oynasini ochish</Button>}
    </Card>
  );
}
