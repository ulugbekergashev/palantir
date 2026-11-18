/**
 * Ulash ustasi → Telefon: Uztelecom (shartnomadagi server, raqam, parol yoki parolsiz — IP bo'yicha), SkyLine (faqat raqam va parol) yoki Zadarma (kabinetdagi Key va
 * Secret — raqam, alohida SIP va yo'naltirishni server o'zi sozlaydi, server/voice/zadarma.ts). Zadarma ulangach — klinika mobil
 * telefonida bir marta teriladigan yo'naltirish kodlari. Gemini kaliti yo'q bo'lsa — ogohlantirish (telefondagi AI shu orqali gapiradi).
 */
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { api, type PhoneLine } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import { forwardCodes } from '../../lib/forwarding';
import { copyText } from '../../lib/clipboard';
import { installStartedText, installStateText } from '../../lib/phoneInstall';

type Notify = (text: string, error?: boolean) => void;

function Codes({ number, notify }: { number: string; notify: Notify }) {
  const codes = forwardCodes(number, 15);
  if (!codes) return null;
  const copy = (code: string) => { copyText(code).then(() => notify('Nusxalandi'), () => notify(code)); };
  return (
    <Card title="Klinika telefonidan yo'naltirish" description="Klinikaning mobil telefonida shu kodlarni bir marta tering va qo'ng'iroq tugmasini bosing. Mijozlar eski raqamga qo'ng'iroq qilaveradi: administrator 15 soniyada ko'tarmasa, band yoki o'chiq bo'lsa — AI javob beradi.">
      <ul className="divide-y divide-slate-100">
        {codes.on.map(c => (
          <li key={c.code} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{c.title}</span><span className="block text-xs text-slate-500">{c.hint}</span></span>
            <Button size="sm" onClick={() => copy(c.code)} aria-label={`${c.title}: ${c.code} — nusxalash`}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> <span className="font-mono tabular-nums">{c.code}</span></Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Bekor qilish: <span className="font-mono">{codes.off.code}</span></p>
    </Card>
  );
}

type StepProps = { line: PhoneLine | null; onLine: (l: PhoneLine) => void; notify: Notify };
type StepTab = 'uztelecom' | 'skyline' | 'zadarma';

/** Uztelecom: shartnomadagi softswitch manzili, raqam va parol (login — raqamning o'zi) yoki parolsiz — ajratilgan IP bo'yicha */
function UztelecomForm({ line, onLine, notify }: StepProps) {
  const saved = line?.provider === 'manual' && line.trunk?.operator === 'uztelecom' ? line.trunk : null;
  const [form, setForm] = useState({ host: saved?.host ?? '', number: saved?.number ?? '', password: '' });
  const [ipOnly, setIpOnly] = useState(saved?.auth === 'ip');
  const [busy, setBusy] = useState(false);
  const hadPassword = saved?.auth === 'password';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const number = form.number.trim();
      const r = await api.savePhoneTrunk({ host: form.host.trim(), port: 5060, login: number, number, auth: ipOnly ? 'ip' : 'password', operator: 'uztelecom', ...(!ipOnly && form.password ? { password: form.password } : {}) });
      onLine(r.line);
      setForm(f => ({ ...f, password: '' }));
      notify(r.warning ? `Saqlandi, lekin telefon xizmatiga o'rnatilmadi: ${r.warning}` : 'Saqlandi — raqam bir daqiqada ulanadi', !!r.warning);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Card title="Uztelecom raqami" description="Uztelecom shartnomasidagi SIP ma'lumotlari. Uztelecom raqami faqat Uztelecom internetida ishlaydi — klinika interneti boshqa provayderdan bo'lsa, raqam ulanmaydi.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Softswitch manzili (server)"><TextInput value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="Operator bergan manzil yoki IP" required /></Field>
        <Field label="Raqam"><TextInput value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} placeholder="712000000" inputMode="tel" required /></Field>
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={ipOnly} onChange={e => setIpOnly(e.target.checked)} className="mt-0.5" />
          <span>Parolsiz — operator klinikaning IP manzili bo'yicha ulaydi
            <span className="block text-xs text-slate-500">Operator «ajratilgan IP» bergan va parol bermagan bo'lsa. Routerda 5060 portini shu kompyuterga oching.</span>
          </span>
        </label>
        {!ipOnly && <Field label="Parol"><TextInput type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" placeholder={hadPassword ? "Saqlangan — o'zgarmasa bo'sh qoldiring" : ''} required={!hadPassword} /></Field>}
        <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Saqlash va ulash</Button>
      </form>
    </Card>
  );
}

/** SkyLine: faqat raqam va parol — server (pbx.skyline.uz), port va loginni server o'zi qo'yadi (server/voice/trunk.ts skylineTrunk) */
function SkylineForm({ line, onLine, notify }: StepProps) {
  const saved = line?.provider === 'manual' && line.trunk?.operator === 'skyline' ? line.trunk : null;
  const [form, setForm] = useState({ number: saved?.number ?? '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const number = form.number.replace(/\D/g, '');
      const r = await api.savePhoneTrunk({ host: 'pbx.skyline.uz', port: 5060, login: number, number, auth: 'password', operator: 'skyline', ...(form.password ? { password: form.password } : {}) });
      onLine(r.line);
      setForm(f => ({ ...f, password: '' }));
      notify(r.warning ? `Saqlandi, lekin telefon xizmatiga o'rnatilmadi: ${r.warning}` : 'Saqlandi — raqam bir daqiqada ulanadi', !!r.warning);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Card title="SkyLine raqami" description="SkyLine to'lovdan keyin bergan raqam va parol — boshqasini dastur o'zi qo'yadi. O'zbekistondagi istalgan internetda ishlaydi; kompyuterda VPN yoqiq bo'lsa, o'chiring.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Raqam"><TextInput value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} placeholder="781131234" inputMode="tel" required /></Field>
        <Field label="Parol"><TextInput type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" placeholder={saved ? "Saqlangan — o'zgarmasa bo'sh qoldiring" : ''} required={!saved} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Saqlash va ulash</Button>
      </form>
    </Card>
  );
}

function LineState({ line }: { line: PhoneLine }) {
  const t = line.trunk;
  if (!t) return null;
  const ok = line.status.trunk === 'registered';
  const failed = line.status.trunk === 'failed';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${ok ? 'text-emerald-600' : 'text-amber-500'}`} aria-hidden="true" />
      <div>
        <p className="font-bold">{t.number ? `Raqam: ${t.number.startsWith('998') ? '+' : ''}${t.number}` : `SIP: ${t.login}`}</p>
        <p className="mt-0.5 text-sm">{ok ? "Liniya ulangan — qo'ng'iroqlarga AI javob beradi."
          : failed ? `Raqam ulanmadi${line.status.reason ? `: ${line.status.reason}` : ''}` : "Liniya ulanmoqda — bir daqiqadan keyin holat yangilanadi."}</p>
      </div>
    </div>
  );
}

export function StepPhone({ line, onLine, notify }: StepProps) {
  // Ko'pchilik klinika Uztelecom'da; Zadarma yoki SkyLine ulangan bo'lsa — o'sha yorliq
  const [tab, setTab] = useState<StepTab>(line?.provider === 'zadarma' ? 'zadarma' : line?.trunk?.operator === 'skyline' ? 'skyline' : 'uztelecom');
  const tabBtn = (id: StepTab, text: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${tab === id ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{text}</button>
  );
  return (
    <div className="space-y-4">
      {line && !line.geminiKey && (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          Telefonda AI Gemini orqali gapiradi — Gemini kaliti kiritilmagan. Kalitsiz qo'ng'iroqlarga AI javob bermaydi, ular administratorga o'tadi. Kalitni «Kalitlar» qadamida kiriting.
        </p>
      )}
      {line && !line.status.asterisk && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          Telefon xizmati bu kompyuterda ishlamayapti{line.status.note ? ` (${line.status.note})` : ''}. Raqamni hozir kiritsangiz ham bo'ladi — xizmat ishga tushganda raqam o'zi ulanadi.
          {line.installable && (
            <span className="mt-2 flex flex-wrap items-center gap-3">
              <Button onClick={() => { api.installPhone().then(r => notify(installStartedText(r.remote)), e => notify((e as Error).message, true)); }}>Telefon xizmatini o'rnatish</Button>
              <span className="text-xs">Klinika kompyuterining o'zida — o'rnatish oynasi ochiladi, administrator huquqi so'raladi. Hub orqali — ekranda hech narsa ochilmaydi. Internet kerak (10–20 daqiqa). Birinchi marta kompyuterni qayta yoqish kerak bo'lishi mumkin — keyin o'rnatish o'zi davom etadi.</span>
            </span>
          )}
          {installStateText(line.install, line.status.asterisk) && <span className="mt-2 block font-medium">{installStateText(line.install, line.status.asterisk)}</span>}
        </p>
      )}
      {line && <LineState line={line} />}
      <div role="tablist" aria-label="Operator" className="flex flex-wrap gap-2">
        {tabBtn('uztelecom', 'Uztelecom')}
        {tabBtn('skyline', 'SkyLine')}
        {tabBtn('zadarma', 'Zadarma')}
      </div>
      {tab === 'uztelecom' ? <UztelecomForm line={line} onLine={onLine} notify={notify} />
        : tab === 'skyline' ? <SkylineForm line={line} onLine={onLine} notify={notify} />
        : <ZadarmaStep line={line} onLine={onLine} notify={notify} />}
      <p className="text-xs text-slate-500">Sarkor yoki boshqa operator SIP'i — keyin Sozlamalar → Telefon liniyasi → «Boshqa operator».</p>
    </div>
  );
}

function ZadarmaStep({ line, onLine, notify }: StepProps) {
  const [form, setForm] = useState({ key: '', secret: '' });
  const [busy, setBusy] = useState(false);
  // Raqamsiz (qo'lda kiritilgan Zadarma SIP) — «Raqam: +» va bo'sh yo'naltirish kodlari chiqmasin
  const connected = line?.provider === 'zadarma' && line.trunk?.number ? line.trunk : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.connectZadarma({ key: form.key.trim(), secret: form.secret.trim() });
      onLine(r.line);
      setForm({ key: '', secret: '' });
      notify(r.warning ? `Zadarma sozlandi, lekin telefon xizmatiga o'rnatilmadi: ${r.warning}` : `Ulandi: +${r.zadarma.number}`, !!r.warning);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card title={connected ? 'Boshqa kalit bilan qayta ulash' : 'Zadarma kalitlari'} description="Zadarma kabineti → Настройки → API: «Key» va «Secret». Kalitlar shifrlangan holda faqat shu kompyuterda saqlanadi.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Key"><TextInput value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} autoComplete="off" spellCheck={false} required /></Field>
          <Field label="Secret"><TextInput type="password" value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))} autoComplete="new-password" required /></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {connected ? 'Qayta ulash' : 'Ulash'}</Button>
        </form>
      </Card>
      {connected && <Codes number={connected.number} notify={notify} />}
    </div>
  );
}
