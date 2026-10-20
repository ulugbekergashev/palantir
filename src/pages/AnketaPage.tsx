import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, ShieldAlert } from 'lucide-react';
import { anketaApi } from '../data/api';
import { packFor } from '../data/industries';
import { Logo } from '../components/Sidebar';
import { Button, Card, Field, TextInput, inputClass } from '../components/ui';
import { useFontsReady } from '../lib/hooks';
import { CLOSED, DAYS, cleanCode, hoursText, type AnketaData, type AnketaStatus } from '../lib/anketa';
import { parsePrices, splitConflicts } from '../lib/prices';
import { containsSecret } from '../lib/secrets';

/** Egasi yozib turganda shuncha kutib saqlanadi (har harfda emas) */
const SAVE_DELAY_MS = 1500;
const areaClass = `${inputClass} h-auto min-h-24 py-2.5 leading-relaxed`;
const codeFromHash = () => {
  const raw = window.location.hash.replace(/^#\/anketa\/?/, '');
  try { return cleanCode(decodeURIComponent(raw)); } catch { return cleanCode(raw); }
};
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

function Area({ value, onChange, rows = 4, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={areaClass} />;
}

/** Ochiq anketa: egasi o'rnatuvchi kelishidan oldin telefonidan to'ldiradi. Kirish yo'q — kod o'zi kalit */
export function AnketaPage() {
  useFontsReady();
  const code = codeFromHash();
  const [data, setData] = useState<AnketaData | null>(null);
  const [status, setStatus] = useState<AnketaStatus>('new');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = 'Anketa · Palantir';
    anketaApi.get(code).then(r => { setData(r.anketa.data); setStatus(r.anketa.status); }).catch(e => setError((e as Error).message));
  }, [code]);

  const save = async (d: AnketaData, submit = false) => {
    setSaved('saving');
    try {
      const r = await anketaApi.save(code, d, submit);
      setStatus(r.anketa.status);
      setSaved('saved');
      setSaveError('');
    } catch (e) {
      setSaved('failed');
      setSaveError((e as Error).message);
    }
  };
  const change = (patch: Partial<AnketaData>) => {
    if (!data) return;
    const next = { ...data, ...patch };
    setData(next);
    if (timer.current) clearTimeout(timer.current);
    if (!strings(next).some(containsSecret)) timer.current = setTimeout(() => { void save(next); }, SAVE_DELAY_MS);
  };
  // Sahifa yopilsa yoki boshqasiga o'tilsa: kutayotgan saqlash darhol yuboriladi (oxirgi yozgani yo'qolmasin)
  const latest = useRef<AnketaData | null>(null);
  latest.current = data;
  useEffect(() => {
    const flush = () => {
      if (!timer.current || !latest.current || strings(latest.current).some(containsSecret)) return;
      clearTimeout(timer.current);
      timer.current = null;
      void fetch(`/api/anketa/${encodeURIComponent(code)}`, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: latest.current }) }).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [code]);

  if (error) return <div className="flex min-h-screen items-center justify-center p-6 text-center"><div><Logo subtitle="Anketa" /><p className="mt-4 text-sm text-rose-700">{error}</p></div></div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  const leaked = strings(data).some(containsSecret);
  const parsed = parsePrices(data.prices);
  const { conflicts } = splitConflicts(parsed.items);
  const pack = packFor(data.industry, data.crm === 'dentacrm');
  const answered = pack.filter(q => (data.answers[q.id] ?? '').trim()).length;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `anketa-${code}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const setDay = (k: typeof DAYS[number][0], v: string) => change({ hours: { ...data.hours, [k]: v } });

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:py-10">
      <header className="space-y-3">
        <Logo subtitle="Anketa" />
        <h1 className="text-[1.6rem] font-extrabold leading-tight tracking-tight">{data.name || 'Biznesingiz'} — Palantir uchun ma'lumot</h1>
        <p className="text-sm leading-relaxed text-slate-600">Shu yerga yozganingizdan Palantir mijozlarga javob beradi: manzil, ish vaqti, narxlar va ko'p so'raladigan savollar. Bilganingizni yozing — qolganini o'rnatish kuni so'raymiz. Har o'zgarish o'zi saqlanadi.</p>
        <p className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Bu yerga parol, bot tokeni yoki kalit yozmang — ular o'rnatish kuni klinika kompyuterida kiritiladi.</p>
      </header>

      <Card title="Klinika">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nomi"><TextInput value={data.name} onChange={e => change({ name: e.target.value })} maxLength={60} /></Field>
          <Field label="Egasining ismi" hint="Palantir sizga shunday murojaat qiladi"><TextInput value={data.ownerName} onChange={e => change({ ownerName: e.target.value })} maxLength={60} /></Field>
          <Field label="Qabulxona telefoni"><TextInput type="tel" value={data.phone} onChange={e => change({ phone: e.target.value })} placeholder="+998 71 200 45 67" maxLength={40} /></Field>
          <Field label="Soha"><TextInput value={data.industry} onChange={e => change({ industry: e.target.value })} placeholder="stomatologiya" maxLength={80} /></Field>
          <div className="sm:col-span-2"><Field label="Manzil"><TextInput value={data.address} onChange={e => change({ address: e.target.value })} placeholder="Chilonzor 9-kvartal, 14-uy" maxLength={160} /></Field></div>
          <div className="sm:col-span-2"><Field label="Mo'ljal" hint="Mijoz qanday topadi"><TextInput value={data.landmark} onChange={e => change({ landmark: e.target.value })} placeholder="Chilonzor metrosi yonida, «Korzinka» ro'parasida" maxLength={160} /></Field></div>
        </div>
      </Card>

      <Card title="Ish vaqti" description={hoursText(data.hours) || "Har kun uchun vaqtni yozing yoki «dam olish»ni belgilang"}>
        <div className="space-y-2">
          {DAYS.map(([k, name]) => {
            const off = data.hours[k].trim().toLowerCase() === CLOSED;
            return (
              <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2">
                <span className="text-sm font-semibold">{name}</span>
                <TextInput aria-label={`${name} ish vaqti`} value={off ? '' : data.hours[k]} disabled={off} onChange={e => setDay(k, e.target.value)} placeholder={off ? 'dam olish' : '09:00–19:00'} maxLength={40} />
                <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={off} onChange={e => setDay(k, e.target.checked ? CLOSED : '')} className="h-4 w-4 accent-indigo-600" /> dam</label>
              </div>
            );
          })}
        </div>
        {data.hours.mon.trim() && data.hours.mon.trim().toLowerCase() !== CLOSED && (
          <Button size="sm" className="mt-3" onClick={() => change({ hours: { ...data.hours, tue: data.hours.mon, wed: data.hours.mon, thu: data.hours.mon, fri: data.hours.mon } })}>Dushanbadagini juma'gacha qo'yish</Button>
        )}
      </Card>

      <Card title="Biz haqimizda">
        <div className="space-y-3">
          <Field label="Bir-ikki gap: nima qilasiz, nimangiz bilan farq qilasiz"><Area value={data.about} onChange={v => change({ about: v })} rows={3} placeholder="Oilaviy stomatologiya, 2015 yildan. Bolalar shifokori bor." /></Field>
          <Field label="Kimlar ishlaydi — har qatorda bittadan"><Area value={data.team} onChange={v => change({ team: v })} rows={3} placeholder={"Dr. Rahimova — terapevt, 12 yil\nDr. Aliyev — jarroh"} /></Field>
        </div>
      </Card>

      <Card title="Narxlar" description="Har qatorda: xizmat — narx. Excel yoki Telegram'dan nusxalab qo'ysangiz ham bo'ladi.">
        <Area value={data.prices} onChange={v => change({ prices: v })} rows={8} placeholder={"Konsultatsiya — bepul\nPlomba — 350 000\nTish olish — 200 000\nImplant — 4,5 mln"} />
        {data.prices.trim() && (
          <p className="mt-2 text-sm text-slate-600">
            {parsed.items.length} ta narx tanildi{parsed.unclear.length ? `, ${parsed.unclear.length} ta qatorda narx topilmadi` : ''}.
            {conflicts.length > 0 && <span className="block text-amber-800">{conflicts.map(c => `«${c.name}»`).join(', ')} — ikki xil narx yozilgan. Qaysi biri to'g'riligini o'rnatish kuni so'raymiz.</span>}
          </p>
        )}
      </Card>

      <Card title="Mijozlar ko'p so'raydigan savollar" description={`${answered}/${pack.length} tasiga javob yozildi. Bilmaganingizni bo'sh qoldiring.`}>
        <div className="space-y-4">
          {pack.map(q => (
            <Field key={q.id} label={q.question} hint={q.hint}>
              <Area value={data.answers[q.id] ?? ''} onChange={v => change({ answers: { ...data.answers, [q.id]: v } })} rows={2} />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Nimalaringiz bor" description="O'rnatuvchi nimani ulashni oldindan biladi">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instagram sahifasi"><TextInput value={data.instagram} onChange={e => change({ instagram: e.target.value })} placeholder="@klinika yoki instagram.com/klinika" maxLength={80} /></Field>
          <Field label="Mijozlar yozadigan Telegram raqami"><TextInput type="tel" value={data.telegramPhone} onChange={e => change({ telegramPhone: e.target.value })} placeholder="+998 90 123 45 67" maxLength={40} /></Field>
          <Field label="Bemorlar dasturi">
            <select value={data.crm} onChange={e => change({ crm: e.target.value as AnketaData['crm'] })} className={inputClass}>
              <option value="">Tanlang…</option><option value="dentacrm">DentaCRM</option><option value="other">Boshqa dastur</option><option value="none">Yo'q</option>
            </select>
          </Field>
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
            <Field label="Kameralar"><TextInput type="number" min={0} max={64} value={String(data.cameras)} onChange={e => change({ cameras: Math.max(0, Math.min(64, Number(e.target.value) || 0)) })} /></Field>
            <Field label="Markasi"><TextInput value={data.cameraBrand} onChange={e => change({ cameraBrand: e.target.value })} placeholder="Hikvision" maxLength={60} /></Field>
          </div>
          <div className="sm:col-span-2"><Field label="O'rnatuvchiga yana nima demoqchisiz"><Area value={data.notes} onChange={v => change({ notes: v })} rows={2} /></Field></div>
        </div>
      </Card>

      {leaked && <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">Anketada parol yoki kalitga o'xshash narsa bor — o'sha qatorni o'chiring. Bu holatda anketa saqlanmaydi.</p>}
      {saved === 'failed' && <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{saveError}</p>}

      <Card>
        {status === 'done' ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />
            <div>
              <p className="font-bold">Rahmat, anketa yuborildi</p>
              <p className="mt-1 text-sm text-slate-600">O'rnatuvchi kelganda shu kodni ayting: <span className="font-mono text-base font-bold tracking-widest">{code}</span>. O'zgartirish kerak bo'lsa — shu sahifada tuzating, o'zi saqlanadi.</p>
              <Button size="sm" className="mt-3" onClick={download}><Download className="h-3.5 w-3.5" /> Faylni yuklab olish</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">{saved === 'saving' ? 'Saqlanmoqda…' : saved === 'saved' ? 'Qoralama saqlandi' : "Yozganingiz o'zi saqlanadi"}</p>
            <Button variant="primary" onClick={() => void save(data, true)} disabled={leaked || saved === 'saving'}>Anketani yuborish</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
