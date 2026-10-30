/**
 * Ulash ustasi → Telefon: Zadarma kabinetidagi Key va Secret — raqam, Palantir uchun alohida SIP va yo'naltirishni server o'zi sozlaydi
 * (server/voice/zadarma.ts). Ulangach — klinika mobil telefonida bir marta teriladigan yo'naltirish kodlari.
 */
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { api, type PhoneLine } from '../../data/api';
import { Button, Card, Field, TextInput } from '../../components/ui';
import { forwardCodes } from '../../lib/forwarding';

type Notify = (text: string, error?: boolean) => void;

function Codes({ number, notify }: { number: string; notify: Notify }) {
  const codes = forwardCodes(number, 15);
  if (!codes) return null;
  const copy = (code: string) => { navigator.clipboard.writeText(code).then(() => notify('Nusxalandi'), () => notify(code)); };
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

export function StepPhone({ line, onLine, notify }: { line: PhoneLine | null; onLine: (l: PhoneLine) => void; notify: Notify }) {
  const [form, setForm] = useState({ key: '', secret: '' });
  const [busy, setBusy] = useState(false);
  const connected = line?.provider === 'zadarma' && line.trunk ? line.trunk : null;
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
      {line && !line.status.asterisk && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          Telefon xizmati bu kompyuterda ishlamayapti{line.status.note ? ` (${line.status.note})` : ''}. Kalitlarni hozir kiritsangiz ham bo'ladi — xizmat ishga tushganda raqam o'zi ulanadi.
        </p>
      )}
      {connected && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="font-bold">Raqam: +{connected.number}</p>
            <p className="mt-0.5 text-sm">{line?.status.trunk === 'registered' ? "Liniya ulangan — qo'ng'iroqlarga AI javob beradi." : "Liniya ulanmoqda — bir daqiqadan keyin holat yangilanadi."}</p>
          </div>
        </div>
      )}
      <Card title={connected ? 'Boshqa kalit bilan qayta ulash' : 'Zadarma kalitlari'} description="Zadarma kabineti → Настройки → API: «Key» va «Secret». Kalitlar shifrlangan holda faqat shu kompyuterda saqlanadi.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Key"><TextInput value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} autoComplete="off" spellCheck={false} required /></Field>
          <Field label="Secret"><TextInput type="password" value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))} autoComplete="new-password" required /></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {connected ? 'Qayta ulash' : 'Ulash'}</Button>
        </form>
      </Card>
      {connected && <Codes number={connected.number} notify={notify} />}
      <p className="text-xs text-slate-500">Uztelecom yoki boshqa operator SIP'i — keyin Sozlamalar → Telefon liniyasi → «Boshqa operator».</p>
    </div>
  );
}
