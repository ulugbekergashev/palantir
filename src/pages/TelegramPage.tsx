/** Sozlamalar bo'limlarining qismlari (settings/SettingsHub.tsx yig'adi): Telegram, Instagram, javob rejimi, asosiy sozlamalar, mijozlar havolasi */
import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Loader2, Unlink } from 'lucide-react';
import type { AutoReply, Business, LiveStatus, ReplyMode } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, ButtonLink, Card, Field, TextInput, controlClass } from '../components/ui';

/** Shaxsiy Telegram: raqam → kod → (bo'lsa) ikki bosqichli parol */
export function TelegramLogin({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
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
        <p className="text-sm text-slate-600">Ulangan: <b>{account}</b>. Mijozlar sizga yozsa, Palantir ko'radi va javob beradi.</p>
        <Button size="sm" variant="ghost" onClick={async () => {
          if (!window.confirm("Shaxsiy Telegram uzilsinmi? Palantir mijozlaringizga javob berishni to'xtatadi.")) return;
          onStatus((await api.tgDisconnect()).status);
        }}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
      </div>
    );
  }
  const label = { phone: 'Telefon raqamingiz', code: "Telegram'ga kelgan kod", password: 'Ikki bosqichli tekshiruv paroli' }[step];
  return (
    <>
      <p className="text-sm text-slate-600">
        Palantir akkauntingizga Telegram Desktop kabi kiradi («Faol seanslar»da <b>Palantir</b> bo'lib ko'rinadi). Mijozlarga siz nomingizdan javob beradi, kerak bo'lsa birinchi bo'lib yozadi.
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

/**
 * Rasmiy Instagram (Instagram API with Instagram Login): egasi instagram.com'da kiradi va ruxsat beradi, Meta xabarlarni
 * Palantir Hub orqali yuboradi. Akkaunt bloklanmaydi, lekin javob — mijozning oxirgi xabaridan 24 soat ichida
 */
export function InstagramOfficial({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const ig = status.instagramApi;
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const s = (await api.me()).status;
        if (s.instagramApi.account) { setWaiting(false); notify(`Instagram ${s.instagramApi.account} ulandi`); }
        onStatus(s);
      } catch { /* keyingi safar */ }
    }, 2500);
    const stop = setTimeout(() => setWaiting(false), 10 * 60_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting]);
  const connect = () => api.igOfficialUrl().then(r => { window.open(r.url, '_blank', 'noopener'); setWaiting(true); }).catch(e => notify((e as Error).message, true));
  if (!ig.hub) {
    return <p className="text-sm text-slate-600">Rasmiy ulanish uchun <b>Palantir Hub kodi</b> kerak (ulash ustasi → kalitlar). Hub Meta xabarlarini shu kompyuterga yetkazadi — kompyuterda port ochish shart emas.</p>;
  }
  if (ig.account) {
    return (
      <div className="space-y-2">
        <p className="text-sm"><span className="font-semibold text-emerald-700">✓ {ig.account}</span> — rasmiy ulanish{ig.expiresAt ? ` · token ${new Date(ig.expiresAt).toLocaleDateString('uz')} gacha (o'zi yangilanadi)` : ''}</p>
        {ig.problem && <p className="text-sm text-amber-700">{ig.problem}</p>}
        <p className="text-xs text-slate-500">Instagram mijozning oxirgi xabaridan {ig.humanAgent ? '7 kun (Human Agent ruxsati bilan)' : '24 soat'} ichida javob berishga ruxsat beradi. Undan keyin — qo'ng'iroq qiling.</p>
        <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Rasmiy Instagram uzilsinmi?')) api.igOfficialDisconnect().then(r => onStatus(r.status)).catch(e => notify((e as Error).message, true)); }}>Uzish</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Instagram professional (Business yoki Creator) akkaunt kerak. «Ulash»ni bosing — Instagram oynasi ochiladi, akkauntingizga kiring va ruxsat bering.</p>
      <Button variant="primary" onClick={connect}>{waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} {waiting ? 'Instagram oynasida ruxsat bering…' : "Instagram'ni rasmiy ulash"}</Button>
    </div>
  );
}

/** Instagram: shu kompyuterda brauzer oynasi ochiladi — egasi o'zi kiradi, keyin Palantir fonda ishlaydi */
export function Instagram({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const ig = status.instagram;
  const [busy, setBusy] = useState(false);

  // Egasi oynada kirguncha holat kuzatiladi
  useEffect(() => {
    if (!ig.waiting) return;
    const t = setInterval(async () => {
      try {
        const s = (await api.me()).status;
        if (!s.instagram.waiting) {
          if (s.instagram.problem) notify(`Instagram ulanmadi: ${s.instagram.problem}`, true);
          else if (s.instagram.account) notify('Instagram ulandi');
        }
        onStatus(s);
      } catch { /* keyingi safar */ }
    }, 2000);
    return () => clearInterval(t);
  }, [ig.waiting]);

  const login = async () => {
    setBusy(true);
    try { onStatus((await api.igLogin()).status); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const loginButton = (label: string) => (
    <Button size={ig.account ? 'sm' : undefined} variant="primary" disabled={busy} onClick={login}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} {label}
    </Button>
  );

  if (!ig.available) {
    return <p className="text-sm text-slate-500">Bu kompyuterda Google Chrome yoki Microsoft Edge topilmadi. Birini o'rnating — Palantir Instagram'ga shu brauzer orqali kiradi.</p>;
  }
  if (ig.waiting) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Loader2 className="h-4 w-4 animate-spin" /> Instagram oynasi ochildi — o'sha oynada akkauntingizga kiring</p>
        <p className="text-xs text-slate-500">Oyna Palantir o'rnatilgan kompyuterda ochiladi. Instagram kod so'rasa — o'sha oynaga yozing. Kirganingizdan keyin oyna o'zi yopiladi.</p>
        <Button size="sm" variant="ghost" onClick={() => void api.igCancel().catch(() => {})}>Bekor qilish</Button>
      </div>
    );
  }
  if (ig.account) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600">Ulangan: <b>{ig.account}</b>.{!ig.problem && " Direct'ga yozganlarga Palantir javob beradi."}</p>
          {ig.relogin && loginButton('Qayta kirish')}
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!window.confirm("Instagram uzilsinmi? Palantir Direct'dagi mijozlarga javob berishni to'xtatadi.")) return;
            onStatus((await api.igDisconnect()).status);
          }}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
        </div>
        {ig.problem && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">⚠️ {ig.problem}</p>}
      </div>
    );
  }
  return (
    <>
      <p className="text-sm text-slate-600">
        Palantir shu kompyuterda alohida brauzer oynasini ochadi — Instagram'ga o'zingiz kirasiz, parolingiz Palantir'ga berilmaydi.
        Keyin u fonda ishlaydi: Direct'ga va «So'rovlar»ga yozganlarga javob beradi, hech kimga birinchi bo'lib yozmaydi.
      </p>
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
        Bu Instagram'ning rasmiy yo'li emas: haddan tashqari faol ishlatilsa, Instagram akkauntni vaqtincha cheklashi mumkin.
        Shuning uchun Palantir kuniga belgilangan sondan ko'p yozmaydi va cheklov sezsa — to'xtab, sizga aytadi. Avval «Men tasdiqlayman» rejimida sinab ko'ring.
      </p>
      {ig.problem && <p className="text-sm text-rose-600">{ig.problem}</p>}
      {loginButton("Instagram'ga kirish")}
    </>
  );
}

const MODES: { value: ReplyMode; title: string; text: string }[] = [
  { value: 'draft', title: 'Men tasdiqlayman', text: "Palantir javob yozib, Telegram'da sizga ko'rsatadi. «Yuborish» ni bossangiz ketadi." },
  { value: 'auto', title: "O'zi javob bersin", text: "Siz belgilangan vaqt ichida o'zingiz yozmasangiz, Palantir yuboradi. Narx yo'q, chegirma, buyurtma kabi savollarda baribir sizdan so'raydi." },
  { value: 'off', title: "O'chiq", text: "Palantir mijozlarga javob tayyorlamaydi (bot xabarlari sizga shunchaki yetkaziladi)." },
];

export function ReplyModeCard({ biz, onBiz, notify }: { biz: Business; onBiz: (b: Business) => void; notify: Notify }) {
  const v: AutoReply = { mode: 'draft', contacts: false, delayMin: 2, ...biz.autoReply };
  const save = async (patch: Partial<AutoReply>) => {
    try { onBiz((await api.setAutoReply({ ...v, ...patch })).business); notify('Saqlandi'); } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <Card title="Mijozlarga javob" description="Bot, shaxsiy Telegram va Instagram'da yozgan mijozlarga Palantir qanday javob beradi">
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
          Tanishlarimga ham javob bersin (Telegram kontaktlarim, Instagram'da kuzatadiganlarim)
        </label>
      </div>
    </Card>
  );
}

/** Forma emas, bir nechta sozlama: qolgan hamma narsa (manzil, ish vaqti, narxlar) — ikkinchi miyada */
export function SettingsCard({ biz, offeringsRev, onSaved, notify }: { biz: Business; offeringsRev: string; onSaved: (b: Business, offeringsRev: string) => void; notify: Notify }) {
  const saved = { name: biz.name, ownerName: biz.ownerName, industry: biz.industry, contentLang: biz.contentLang ?? 'uz', morningBrief: biz.morningBrief ?? true };
  const [draft, setDraft] = useState(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async () => {
    try {
      const r = await api.saveBusiness({ ...biz, ...draft }, offeringsRev);
      onSaved(r.business, r.offeringsRev);
      notify('Saqlandi');
    } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <Card title="Sozlamalar" description="Palantir sizga qanday murojaat qiladi va qaysi tilda yozadi. Manzil, ish vaqti, narxlar va boshqa bilimlar — «Ikkinchi miya»da.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Biznes nomi"><TextInput value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={60} /></Field>
        <Field label="Egasi (yordamchi shunday murojaat qiladi)"><TextInput value={draft.ownerName} onChange={e => setDraft({ ...draft, ownerName: e.target.value })} maxLength={60} /></Field>
        <Field label="Soha" hint="Masalan: stomatologiya, restoran, o'quv markazi"><TextInput value={draft.industry} onChange={e => setDraft({ ...draft, industry: e.target.value })} maxLength={80} /></Field>
        <Field label="Yozish tili">
          <select className={`${controlClass} w-full`} value={draft.contentLang} onChange={e => setDraft({ ...draft, contentLang: e.target.value === 'ru' ? 'ru' : 'uz' })}>
            <option value="uz">O'zbekcha</option><option value="ru">Ruscha</option>
          </select>
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={draft.morningBrief} onChange={e => setDraft({ ...draft, morningBrief: e.target.checked })} />
        Har kuni ertalab Telegram'ga qisqa xulosa yuborsin
      </label>
      <Button className="mt-3" variant="primary" disabled={!dirty || !draft.name.trim()} onClick={() => { void save(); }}>Saqlash</Button>
    </Card>
  );
}

/** Egasining Telegram'i (bot): eslatmalar, xulosa va mijozlarga javob takliflari shu yerga keladi */
export function OwnerBot({ status }: { status: LiveStatus }) {
  if (!status.bot) return <p className="text-sm text-slate-500">Serverda BOT_TOKEN berilmagan — ulash ustasida (#/ulash) bot tokenini kiriting.</p>;
  return (
    <div className="space-y-3">
      {status.ownerLinked
        ? <p className="text-sm text-slate-600">Ulangan. Bot: <a className="font-semibold text-indigo-700" href={`https://t.me/${status.bot}`} target="_blank" rel="noreferrer">@{status.bot}</a> — yozing yoki ovozli xabar yuboring.</p>
        : <p className="text-sm text-slate-600">Tugmani bosing — Telegram ochiladi, «Start» ni bosing. Eslatmalar, xulosa va mijozlarga javob takliflari shu yerga keladi.</p>}
      {status.linkUrl && (
        <ButtonLink href={status.linkUrl} target="_blank" rel="noreferrer" variant="primary">
          <ExternalLink className="h-4 w-4" /> {status.ownerLinked ? 'Boshqa telefondan ulash' : "Telegram'da ochish"}
        </ButtonLink>
      )}
    </div>
  );
}

/** Mijozlar uchun havola: bosgan odam botga tushadi */
export function ClientLink({ status, notify }: { status: LiveStatus; notify: Notify }) {
  if (!status.generalLink) return null;
  const copy = async () => { await navigator.clipboard.writeText(status.generalLink!).catch(() => {}); notify('Nusxalandi'); };
  return (
    <Card title="Mijozlar uchun havola" description="Instagram bio, reklama yoki vizitkaga qo'ying: bosgan odam botga tushadi, raqam yoki savol qoldiradi">
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate text-sm">{status.generalLink}</code>
        <Button size="sm" onClick={() => { void copy(); }}><Copy className="h-3.5 w-3.5" /> Nusxalash</Button>
      </div>
    </Card>
  );
}
