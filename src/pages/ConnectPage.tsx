import { useState, type ReactNode } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, Megaphone, Send, Sparkles, Unplug } from 'lucide-react';
import type { LiveStatus } from '../types';
import { api } from '../data/api';
import { Button, Card, TextInput } from '../components/ui';

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
        {done ? <CheckCircle2 className="h-5 w-5" /> : n}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <h3 className="font-bold">{title}</h3>
        <div className="mt-1.5 space-y-2 text-sm text-slate-600">{children}</div>
      </div>
    </div>
  );
}

/** To'liq versiya: egasining Telegrami va kanalni ulash */
export function ConnectPage({ status, onStatus, phone, onToast, onError }: {
  status: LiveStatus; onStatus: (s: LiveStatus) => void; phone: ReactNode;
  onToast: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState<'channel' | 'resend' | null>(null);

  const connect = async () => {
    setBusy('channel');
    try {
      onStatus((await api.connectChannel(channel)).status);
      setChannel('');
      onToast('Kanal ulandi');
    } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!window.confirm('Kanal uzilsinmi? Postlar kanalga chiqmaydi, rasm va matn sizga yuboriladi.')) return;
    try { onStatus((await api.disconnectChannel()).status); } catch (e) { onError((e as Error).message); }
  };
  const resend = async () => {
    setBusy('resend');
    try { await api.resendPackage(); onToast('Paket Telegramingizga yuborildi'); } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); onToast('Nusxa olindi'); } catch { onError("Nusxa olinmadi — qo'lda belgilang"); }
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-extrabold tracking-tight">Telegram bot</h1>
          <p className="text-sm text-slate-500">Paket, tasdiqlash va murojaatlar — hammasi Telegramingizda</p>
        </header>

        {!status.bot ? (
          <Card><p className="text-sm text-slate-600">Bot hali sozlanmagan (serverda <code>BOT_TOKEN</code> yo'q). Panel ishlaydi, lekin paket Telegramga kelmaydi va postlar avtomatik joylanmaydi.</p></Card>
        ) : (
          <Card>
            <div className="space-y-5">
              <Step n={1} done={status.ownerLinked} title="Telegramingizni ulang">
                {status.ownerLinked ? (
                  <>
                    <p>Ulangan. Har dushanba soat 09:00 da haftalik paket keladi.</p>
                    <Button size="sm" onClick={resend} disabled={busy === 'resend'}>
                      {busy === 'resend' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Shu haftaning paketini hozir yuborish
                    </Button>
                  </>
                ) : (
                  <>
                    <p>Tugmani bosing — Telegram ochiladi, «Start» ni bosing. Bot sizni klinikangizga bog'laydi.</p>
                    {status.linkUrl && (
                      <a href={status.linkUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
                        <ExternalLink className="h-4 w-4" /> Telegramni ulash
                      </a>
                    )}
                    <p className="text-xs text-slate-400">Havolani boshqa hech kimga bermang — u orqali paketingizni boshqarish mumkin.</p>
                  </>
                )}
              </Step>

              <Step n={2} done={!!status.channel} title="Telegram kanalni ulang (ixtiyoriy)">
                {status.channel ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-900">{status.channel.title}</span>
                    <Button size="sm" variant="ghost" onClick={disconnect}><Unplug className="h-3.5 w-3.5" /> Uzish</Button>
                  </div>
                ) : (
                  <>
                    <p>Kanalingiz sozlamalarida <b>@{status.bot}</b> ni admin qiling («xabar joylash» ruxsati bilan), keyin kanal manzilini kiriting.</p>
                    <div className="flex max-w-md gap-2">
                      <TextInput value={channel} onChange={e => setChannel(e.target.value)} placeholder="@klinika_kanali" aria-label="Kanal manzili" />
                      <Button variant="primary" disabled={!channel.trim() || busy === 'channel'} onClick={connect}>
                        {busy === 'channel' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Ulash
                      </Button>
                    </div>
                    <p className="text-xs text-slate-400">Ulanmasa ham ishlaydi: vaqti kelganda rasm va matnni sizga yuboraman, o'zingiz joylaysiz.</p>
                  </>
                )}
              </Step>

              <Step n={3} done={false} title="Instagram">
                <p>Instagram'ga avtomatik joylash Meta ruxsatidan keyin qo'shiladi. Hozircha: post chiqqan zahoti rasm (asl sifatda) va matn Telegramingizga keladi — nusxa olib joylaysiz.</p>
                {status.generalLink && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Instagram bio uchun yozilish havolasi:</span>
                    <code className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{status.generalLink}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(status.generalLink!)}><Copy className="h-3.5 w-3.5" /> Nusxa</Button>
                  </div>
                )}
              </Step>
            </div>
          </Card>
        )}

        <Card>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><Sparkles className="h-5 w-5 shrink-0 text-violet-600" />
              <span>{status.ai ? 'Matnni AI (Claude) yozadi — faqat siz kiritgan faktlardan, tibbiy reklama qoidalari tekshiriladi.' : "AI o'chiq — matnlar tayyor namunalardan. Yoqish: serverda ANTHROPIC_API_KEY."}</span></li>
            <li className="flex gap-3"><Megaphone className="h-5 w-5 shrink-0 text-teal-700" />
              <span>Postdagi yozilish havolasi Cerebro boti orqali: kim qaysi postdan yozilgani «Natijalar» va «Murojaatlar» da ko'rinadi.</span></li>
          </ul>
        </Card>
      </div>
      {phone}
    </div>
  );
}
