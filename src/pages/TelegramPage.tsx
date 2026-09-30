import { useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, Unlink } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, TextInput } from '../components/ui';

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${done ? 'bg-emerald-600 text-white' : 'bg-indigo-50 text-indigo-700'}`}>
          {done ? <CheckCircle2 className="h-5 w-5" /> : n}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-bold">{title}</h2>
          {children}
        </div>
      </div>
    </Card>
  );
}

export function TelegramPage({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = async (text: string) => { await navigator.clipboard.writeText(text).catch(() => {}); notify('Nusxalandi'); };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { onStatus((await api.connectChannel(channel)).status); setChannel(''); notify('Kanal ulandi'); } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };

  if (!status.bot) {
    return (
      <Card title="Telegram bot ulanmagan">
        <p className="text-sm text-slate-600">Serverda BOT_TOKEN berilmagan. Administrator @BotFather'dan token olib, serverga qo'shishi kerak — shundan keyin shu yerda ulash havolasi chiqadi.</p>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Telegram</h1>
        <p className="text-sm text-slate-500">Cerebro bilan asosiy aloqa — Telegram: yozasiz yoki ovozli xabar yuborasiz, eslatma va xulosalar shu yerga keladi.</p>
      </header>

      <Step n={1} done={status.ownerLinked} title="Telegram'ingizni ulang">
        {status.ownerLinked
          ? <p className="text-sm text-slate-600">Ulangan. Bot: <a className="font-semibold text-indigo-700" href={`https://t.me/${status.bot}`} target="_blank" rel="noreferrer">@{status.bot}</a></p>
          : <p className="text-sm text-slate-600">Tugmani bosing — Telegram ochiladi, «Start» ni bosing. Havolani boshqalarga bermang: u sizning kabinetingizga ulaydi.</p>}
        {status.linkUrl && (
          <a href={status.linkUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">
            <ExternalLink className="h-4 w-4" /> {status.ownerLinked ? 'Boshqa telefondan ulash' : "Telegram'da ochish"}
          </a>
        )}
      </Step>

      <Step n={2} done={!!status.channel} title="Kanalingizni ulang (ixtiyoriy)">
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
      </Step>

      <Step n={3} done={false} title="Mijozlar uchun havola">
        <p className="text-sm text-slate-600">Instagram bio, reklama yoki vizitkaga qo'ying. Bosgan odam botga tushadi, raqam yoki savol qoldiradi — sizga keladi va «Mijozlar»ga yoziladi. Unga javobni shu xabarga «Reply» qilib yozasiz.</p>
        {status.generalLink && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 pl-3">
            <code className="min-w-0 flex-1 truncate text-sm">{status.generalLink}</code>
            <Button size="sm" onClick={() => copy(status.generalLink!)}><Copy className="h-3.5 w-3.5" /> Nusxalash</Button>
          </div>
        )}
      </Step>

      {!status.voice && <p className="text-xs text-slate-400">Ovozli xabarlar hozircha o'chiq: serverda GEMINI_API_KEY yoki GROQ_API_KEY yo'q.</p>}
    </div>
  );
}
