import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, Unlink } from 'lucide-react';
import type { AutoReply, Business, LiveStatus, ReplyMode } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, TextInput, controlClass } from '../components/ui';

function Section({ done, title, children, badge }: { done: boolean; title: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <Card>
      <div className="flex gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{title}</h2>{badge}</div>
          {children}
        </div>
      </div>
    </Card>
  );
}

/** Shaxsiy Telegram: raqam → kod → (bo'lsa) ikki bosqichli parol */
function TelegramLogin({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const account = status.telegramUser.account;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (step === 'phone') {
        await api.tgStart(value);
        setStep('code');
        setValue('');
        notify("Kod Telegram'ingizga yuborildi");
      } else {
        const r = step === 'code' ? await api.tgCode(value) : await api.tgPassword(value);
        if ('password' in r && r.password) { setStep('password'); setValue(''); return; }
        onStatus({ ...status, telegramUser: { ...status.telegramUser, account: r.account ?? null } });
        setStep('phone');
        setValue('');
        notify('Telegram ulandi');
      }
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!status.telegramUser.available) {
    return <p className="text-sm text-slate-500">Serverda sozlanmagan: administrator my.telegram.org'dan TG_API_ID va TG_API_HASH olib qo'yishi kerak.</p>;
  }
  if (account) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">Ulangan: <b>{account}</b>. Mijozlar sizga yozsa, Cerebro ko'radi va javob beradi.</p>
        <Button size="sm" variant="ghost" onClick={async () => {
          if (!window.confirm("Shaxsiy Telegram uzilsinmi? Cerebro mijozlaringizga javob berishni to'xtatadi.")) return;
          onStatus((await api.tgDisconnect()).status);
        }}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
      </div>
    );
  }
  const label = { phone: 'Telefon raqamingiz', code: "Telegram'ga kelgan kod", password: 'Ikki bosqichli tekshiruv paroli' }[step];
  return (
    <>
      <p className="text-sm text-slate-600">
        Cerebro akkauntingizga Telegram Desktop kabi kiradi («Faol seanslar»da <b>Cerebro</b> bo'lib ko'rinadi). Mijozlarga siz nomingizdan javob beradi, kerak bo'lsa birinchi bo'lib yozadi.
        Kontaktlaringizdagi tanishlaringizga tegmaydi. Istalgan vaqtda shu yerdan yoki Telegram → Qurilmalar'dan uzasiz.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
          <TextInput value={value} onChange={e => setValue(e.target.value)} type={step === 'password' ? 'password' : 'text'} autoComplete="off"
            inputMode={step === 'password' ? undefined : 'tel'} placeholder={step === 'phone' ? '+998 90 123 45 67' : step === 'code' ? '12345' : ''} aria-label={label} />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {step === 'phone' ? 'Kod olish' : 'Kirish'}</Button>
        {step !== 'phone' && <Button variant="ghost" onClick={() => { setStep('phone'); setValue(''); }}>Boshqa raqam</Button>}
      </form>
      {step === 'code' && <p className="text-xs text-slate-400">Kod Telegram ilovangizga «Telegram» nomidan keladi. Uni hech kimga bermang — faqat shu yerga yozing.</p>}
    </>
  );
}

function Instagram({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  if (!status.instagram.available) {
    return <p className="text-sm text-slate-500">Serverda sozlanmagan: administrator Meta ilovasi (IG_APP_ID, IG_APP_SECRET) va PUBLIC_URL qo'yishi kerak.</p>;
  }
  if (status.instagram.account) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">Ulangan: <b>{status.instagram.account}</b>. Direct'ga yozganlarga Cerebro javob beradi.</p>
        <Button size="sm" variant="ghost" onClick={async () => onStatus((await api.igDisconnect()).status)}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
      </div>
    );
  }
  return (
    <>
      <p className="text-sm text-slate-600">
        Instagram'ning rasmiy kirishi: tugmani bosing, Instagram sahifasida ruxsat bering. Parolingiz Cerebro'ga berilmaydi. Akkaunt professional (biznes yoki muallif) bo'lishi kerak.
        Instagram qoidasi: mijoz yozgandan keyin 24 soat ichida javob beriladi, birinchi bo'lib yozib bo'lmaydi.
      </p>
      <Button variant="primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { window.location.href = (await api.igConnectUrl()).url; } catch (e) { notify((e as Error).message, true); setBusy(false); }
      }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Instagram bilan kirish
      </Button>
    </>
  );
}

const MODES: { value: ReplyMode; title: string; text: string }[] = [
  { value: 'draft', title: 'Men tasdiqlayman', text: "Cerebro javob yozib, Telegram'da sizga ko'rsatadi. «Yuborish» ni bossangiz ketadi." },
  { value: 'auto', title: "O'zi javob bersin", text: "Siz belgilangan vaqt ichida o'zingiz yozmasangiz, Cerebro yuboradi. Narx yo'q, chegirma, buyurtma kabi savollarda baribir sizdan so'raydi." },
  { value: 'off', title: "O'chiq", text: "Cerebro mijozlarga javob tayyorlamaydi (bot xabarlari sizga shunchaki yetkaziladi)." },
];

function ReplyModeCard({ biz, onBiz, notify }: { biz: Business; onBiz: (b: Business) => void; notify: Notify }) {
  const v: AutoReply = { mode: 'draft', contacts: false, delayMin: 2, ...biz.autoReply };
  const save = async (patch: Partial<AutoReply>) => {
    try { onBiz((await api.setAutoReply({ ...v, ...patch })).business); notify('Saqlandi'); } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <Card title="Mijozlarga javob" description="Bot, shaxsiy Telegram va Instagram'da yozgan mijozlarga Cerebro qanday javob beradi">
      <div role="radiogroup" aria-label="Javob rejimi" className="grid gap-2 sm:grid-cols-3">
        {MODES.map(m => (
          <button key={m.value} type="button" role="radio" aria-checked={v.mode === m.value} onClick={() => void save({ mode: m.value })}
            className={`flex flex-col items-start justify-start rounded-xl border p-3 text-left transition ${v.mode === m.value ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="text-sm font-bold">{m.title}</div>
            <div className="mt-0.5 text-xs text-slate-500">{m.text}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        {v.mode === 'auto' && (
          <label className="flex items-center gap-2">
            <span className="text-slate-600">Sizni kutadi:</span>
            <select aria-label="Kutish vaqti" className={`${controlClass} h-9`} value={v.delayMin} onChange={e => void save({ delayMin: Number(e.target.value) })}>
              {[0, 1, 2, 5, 10, 30].map(n => <option key={n} value={n}>{n ? `${n} daqiqa` : 'kutmasin'}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={v.contacts} onChange={e => void save({ contacts: e.target.checked })} />
          Telegram kontaktlarimdagi odamlarga ham javob bersin
        </label>
      </div>
    </Card>
  );
}

export function TelegramPage({ status, onStatus, biz, onBiz, notify }: {
  status: LiveStatus; onStatus: (s: LiveStatus) => void; biz: Business; onBiz: (b: Business) => void; notify: Notify;
}) {
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = async (text: string) => { await navigator.clipboard.writeText(text).catch(() => {}); notify('Nusxalandi'); };

  // Instagram'dan qaytish: #/telegram?ig=ok
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const ig = q.get('ig');
    if (!ig) return;
    if (ig === 'ok') notify('Instagram ulandi');
    else if (ig === 'error') notify(`Instagram ulanmadi: ${q.get('why') ?? ''}`, true);
    history.replaceState(null, '', '#/telegram');
  }, []);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { onStatus((await api.connectChannel(channel)).status); setChannel(''); notify('Kanal ulandi'); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Ulanishlar</h1>
        <p className="text-sm text-slate-500">Cerebro bilan Telegram'da gaplashasiz; mijozlaringiz yozadigan joylarni ulasangiz, ularga ham javob beradi.</p>
      </header>

      <Section done={status.ownerLinked} title="1. Cerebro bilan Telegram'da gaplashish">
        {!status.bot ? <p className="text-sm text-slate-500">Serverda BOT_TOKEN berilmagan — administrator @BotFather'dan token olib qo'yishi kerak.</p> : (
          <>
            {status.ownerLinked
              ? <p className="text-sm text-slate-600">Ulangan. Bot: <a className="font-semibold text-indigo-700" href={`https://t.me/${status.bot}`} target="_blank" rel="noreferrer">@{status.bot}</a> — yozing yoki ovozli xabar yuboring.</p>
              : <p className="text-sm text-slate-600">Tugmani bosing — Telegram ochiladi, «Start» ni bosing. Eslatmalar, xulosa va mijozlarga javob takliflari shu yerga keladi.</p>}
            {status.linkUrl && (
              <a href={status.linkUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">
                <ExternalLink className="h-4 w-4" /> {status.ownerLinked ? 'Boshqa telefondan ulash' : "Telegram'da ochish"}
              </a>
            )}
          </>
        )}
      </Section>

      <Section done={!!status.telegramUser.account} title="2. Shaxsiy Telegram — mijozlaringiz yozadigan akkaunt">
        <TelegramLogin status={status} onStatus={onStatus} notify={notify} />
      </Section>

      <Section done={!!status.instagram.account} title="3. Instagram Direct">
        <Instagram status={status} onStatus={onStatus} notify={notify} />
      </Section>

      <ReplyModeCard biz={biz} onBiz={onBiz} notify={notify} />

      {status.bot && (
        <Section done={!!status.channel} title="Telegram kanal (postlar uchun, ixtiyoriy)">
          {status.channel ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-600">Ulangan: <b>{status.channel.title}</b>. Postlar «Kanalga joylash» tugmasi bilan chiqadi.</p>
              <Button size="sm" variant="ghost" onClick={async () => onStatus((await api.disconnectChannel()).status)}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">@{status.bot} ni kanalingizga <b>admin</b> qilib qo'shing («Xabar joylash» ruxsati bilan) — o'zi ulanadi. Yoki kanal manzilini yozing:</p>
              <form onSubmit={connect} className="flex gap-2">
                <TextInput value={channel} onChange={e => setChannel(e.target.value)} placeholder="@mening_kanalim" aria-label="Kanal manzili" />
                <Button type="submit" variant="primary" disabled={busy || !channel.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Ulash</Button>
              </form>
            </>
          )}
        </Section>
      )}

      {status.generalLink && (
        <Card title="Mijozlar uchun havola" description="Instagram bio, reklama yoki vizitkaga qo'ying: bosgan odam botga tushadi, raqam yoki savol qoldiradi">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 pl-3">
            <code className="min-w-0 flex-1 truncate text-sm">{status.generalLink}</code>
            <Button size="sm" onClick={() => copy(status.generalLink!)}><Copy className="h-3.5 w-3.5" /> Nusxalash</Button>
          </div>
        </Card>
      )}

      {!status.voice && <p className="text-xs text-slate-400">Ovozli xabarlar hozircha o'chiq: serverda GEMINI_API_KEY yoki GROQ_API_KEY yo'q.</p>}
    </div>
  );
}
