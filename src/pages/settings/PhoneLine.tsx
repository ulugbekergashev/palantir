/**
 * Sozlamalar → Telefon liniyasi: shahar raqami (Uztelecom SIP), kim javob beradi (har doim AI yoki ish vaqtida avval administrator)
 * va administrator telefoni uchun akkaunt (Zoiper). Kiritilgan ma'lumotdan Asterisk sozlamasi o'zi yoziladi (server/voice/line.ts) —
 * parol chatga yoki faylga qo'lda yozilmaydi.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2, Phone, RefreshCw, Smartphone, Waypoints } from 'lucide-react';
import { api, type PhoneLine as Line } from '../../data/api';
import type { Notify } from '../../components/Artifacts';

const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
const RINGS = [10, 15, 20, 30];
const input = 'h-11 w-full rounded-xl border border-glass/10 bg-glass/[0.03] px-3 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6b717c] focus:border-glass/25';

function Block({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#3fd6c3]/12 text-[#8ff0e2]">{icon}</span>
        <div><h3 className="text-[16px] font-semibold text-[#f2f0ea]">{title}</h3><p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">{hint}</p></div>
      </header>
      {children}
    </section>
  );
}

const Label = ({ text, children }: { text: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1.5 text-[12px] font-medium text-[#a3a9b5]">{text}{children}</label>
);

function Status({ line }: { line: Line }) {
  const s = line.status;
  const items = [
    { name: 'Asterisk', on: s.asterisk, text: s.asterisk ? 'ishlayapti' : "ishlamayapti" },
    { name: 'Shahar raqami', on: s.trunk === 'registered', text: s.trunk === 'registered' ? `ulangan${line.trunk?.number ? ` · ${line.trunk.number}` : ''}` : s.trunk === 'failed' ? "ulanmadi — login yoki parolni tekshiring" : line.trunk ? 'tekshirilmoqda' : 'kiritilmagan' },
    { name: 'Egasi telefoni', on: s.phones.includes('egasi'), text: s.phones.includes('egasi') ? 'ulangan' : 'ulanmagan' },
    { name: 'Administrator telefoni', on: s.phones.includes('admin'), text: s.phones.includes('admin') ? 'ulangan' : 'ulanmagan' },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(i => (
        <div key={i.name} className="flex items-center gap-2.5 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] px-3.5 py-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i.on ? 'bg-emerald-400' : 'bg-glass/25'}`} aria-hidden="true" />
          <span className="min-w-0"><span className="block text-[13px] font-medium text-[#f2f0ea]">{i.name}</span><span className="block truncate text-[12px] text-[#8a909c]">{i.text}</span></span>
        </div>
      ))}
      {s.note && <p className="text-[12px] text-[#fde2b0] sm:col-span-2 xl:col-span-4">{s.note}</p>}
    </div>
  );
}

function Trunk({ line, onLine, notify }: { line: Line; onLine: (l: Line) => void; notify: Notify }) {
  const t = line.trunk;
  const [form, setForm] = useState({ host: t?.host ?? '', port: String(t?.port ?? 5060), login: t?.login ?? '', number: t?.number ?? '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.savePhoneTrunk({ host: form.host.trim(), port: Number(form.port) || 5060, login: form.login.trim(), number: form.number.trim(), ...(form.password ? { password: form.password } : {}) });
      onLine(r.line);
      setForm(f => ({ ...f, password: '' }));
      notify(r.warning ? `Saqlandi, lekin Asterisk'ka o'rnatilmadi: ${r.warning}` : 'Saqlandi — raqam bir daqiqada ulanadi', !!r.warning);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Block icon={<Phone className="h-[18px] w-[18px]" aria-hidden="true" />} title="Shahar raqami (Uztelecom)" hint="Uztelecom bergan ma'lumotlar: server manzili, login, parol va raqam. Mijoz shu raqamga qo'ng'iroq qiladi — AI qabulxona javob beradi.">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_110px]">
        <Label text="Server manzili"><input className={input} value={form.host} onChange={set('host')} placeholder="sip.uztelecom.uz yoki IP" required /></Label>
        <Label text="Port"><input className={input} value={form.port} onChange={set('port')} inputMode="numeric" /></Label>
        <Label text="Login"><input className={input} value={form.login} onChange={set('login')} autoComplete="off" required /></Label>
        <Label text="Raqam"><input className={input} value={form.number} onChange={set('number')} placeholder="712000000" inputMode="tel" /></Label>
        <div className="sm:col-span-2">
          <Label text="Parol"><input className={input} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder={t ? "O'zgarmasa — bo'sh qoldiring" : ''} required={!t} /></Label>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={busy} className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-[#3fd6c3] px-5 text-[14px] font-semibold text-[#07080b] disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Saqlash va ulash
          </button>
          <p className="text-[12px] text-[#7d838f]">Parol shifrlangan holda saqlanadi, faqat shu kompyuterdagi Asterisk'ka beriladi.</p>
        </div>
      </form>
    </Block>
  );
}

function Routing({ line, onLine, notify }: { line: Line; onLine: (l: Line) => void; notify: Notify }) {
  const [r, setR] = useState(line.routing);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(r) !== JSON.stringify(line.routing);
  const save = async () => {
    setBusy(true);
    try { onLine((await api.savePhoneRouting(r)).line); notify('Saqlandi — keyingi qo‘ng‘iroqdan kuchga kiradi'); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const option = (mode: Line['routing']['mode'], title: string, hint: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${r.mode === mode ? 'border-[#3fd6c3]/40 bg-[#3fd6c3]/[0.06]' : 'border-glass/[0.06] hover:bg-glass/[0.03]'}`}>
      <input type="radio" name="line-mode" checked={r.mode === mode} onChange={() => setR(x => ({ ...x, mode }))} className="mt-1 accent-[#3fd6c3]" />
      <span><span className="block text-[14px] font-medium text-[#f2f0ea]">{title}</span><span className="block text-[12.5px] leading-snug text-[#8a909c]">{hint}</span></span>
    </label>
  );
  return (
    <Block icon={<Waypoints className="h-[18px] w-[18px]" aria-hidden="true" />} title="Kim javob beradi" hint="Shahar raqamiga kelgan qo'ng'iroq kimga boradi. Kechasi va administrator ko'tarmasa — har doim AI, mijoz javobsiz qolmaydi.">
      <div className="flex flex-col gap-2">
        {option('ai', 'Har doim AI qabulxona', 'Kunu tun AI javob beradi, qabulga yozadi, bilmaganini sizga so‘rov qilib qoldiradi.')}
        {option('ai_transfer', 'AI javob beradi, ish vaqtida kerak bo‘lsa — administratorga o‘tkazadi', 'AI javob bera olmasa yoki mijoz odam bilan gaplashmoqchi bo‘lsa, ish vaqtida qo‘ng‘iroqni administrator telefoniga o‘tkazadi; u ko‘tarmasa — AI so‘rov qoldiradi. Kechasi — faqat AI.')}
        {option('day_admin', 'Ish vaqtida — administrator, qolgan paytda — AI', 'Ish vaqtida avval administrator telefoni jiringlaydi; ko‘tarmasa yoki band bo‘lsa — AI javob beradi.')}
      </div>
      {r.mode !== 'ai' && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-glass/[0.06] p-4">
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="mb-2 text-[12px] font-medium text-[#a3a9b5]">Ish kunlari</legend>
            {DAYS.map((d, i) => {
              const on = r.days.includes(i + 1);
              return <button key={d} type="button" aria-pressed={on} onClick={() => setR(x => ({ ...x, days: on ? x.days.filter(n => n !== i + 1) : [...x.days, i + 1].sort() }))}
                className={`h-10 w-11 rounded-xl text-[13px] font-semibold transition-colors ${on ? 'bg-[#3fd6c3] text-[#07080b]' : 'border border-glass/10 text-[#a3a9b5] hover:bg-glass/5'}`}>{d}</button>;
            })}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text="Boshlanadi"><input type="time" className={input} value={r.from} onChange={e => setR(x => ({ ...x, from: e.target.value }))} /></Label>
            <Label text="Tugaydi"><input type="time" className={input} value={r.to} onChange={e => setR(x => ({ ...x, to: e.target.value }))} /></Label>
            <Label text={r.mode === 'ai_transfer' ? "Administrator ko'tarmasa, AI ga qaytadi" : "Administrator ko'tarmasa, AI ga"}>
              <select className={input} value={r.ring} onChange={e => setR(x => ({ ...x, ring: Number(e.target.value) }))}>
                {RINGS.map(s => <option key={s} value={s}>{s} soniyadan keyin</option>)}
              </select>
            </Label>
          </div>
        </div>
      )}
      <button type="button" disabled={!dirty || busy} onClick={() => { void save(); }} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl bg-[#3fd6c3] px-5 text-[14px] font-semibold text-[#07080b] disabled:opacity-40">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Saqlash
      </button>
    </Block>
  );
}

function AdminPhone({ line, onLine, notify }: { line: Line; onLine: (l: Line) => void; notify: Notify }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = line.admin;
  const make = async () => {
    setBusy(true);
    try {
      const r = await api.newAdminPhone();
      onLine(r.line);
      setShow(true);
      notify(r.warning ? `Parol yaratildi, lekin Asterisk'ka o'rnatilmadi: ${r.warning}` : 'Akkaunt tayyor', !!r.warning);
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const row = (k: string, v: ReactNode) => <div className="flex items-center justify-between gap-3 border-b border-glass/[0.05] py-2.5 text-[14px] last:border-0"><span className="text-[#8a909c]">{k}</span><span className="tabular-nums font-medium text-[#f2f0ea]">{v}</span></div>;
  return (
    <Block icon={<Smartphone className="h-[18px] w-[18px]" aria-hidden="true" />} title="Administrator telefoni" hint="Qabulxonadagi telefonga Zoiper o'rnating va shu akkauntni qo'shing. Telefon klinika Wi-Fi'siga ulangan bo'lsin.">
      {a.password ? (
        <>
          <div className="rounded-2xl border border-glass/[0.06] px-4">
            {row('Server', a.server)}
            {row('Login', a.login)}
            {row('Parol', <span className="flex items-center gap-2">{show ? a.password : '••••••••••••'}
              <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Parolni yashirish' : "Parolni ko'rsatish"} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#a3a9b5] hover:bg-glass/5">
                {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button></span>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => { void make(); }} className="flex min-h-10 items-center gap-2 rounded-xl border border-glass/10 px-4 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}Yangi parol
            </button>
            <p className="text-[12px] text-[#7d838f]">Sinash: shu telefondan «2» ni tering — qabulxona mijozdek javob beradi.</p>
          </div>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => { void make(); }} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#3fd6c3] px-5 text-[14px] font-semibold text-[#07080b] disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Akkaunt yaratish
        </button>
      )}
    </Block>
  );
}

export function PhoneLineSettings({ notify }: { notify: Notify }) {
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    let stale = false;
    api.phoneLine().then(r => { if (!stale) setLine(r.line); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!line) return <Loader2 className="h-6 w-6 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  return (
    <div className="flex flex-col gap-5">
      <Status line={line} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Trunk line={line} onLine={setLine} notify={notify} />
        <div className="flex flex-col gap-5">
          <Routing key={JSON.stringify(line.routing)} line={line} onLine={setLine} notify={notify} />
          <AdminPhone line={line} onLine={setLine} notify={notify} />
        </div>
      </div>
    </div>
  );
}
