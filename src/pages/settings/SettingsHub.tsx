/**
 * Sozlamalar — jamoa qayerda ishlashi. Tepada har ulanishning holati (plitka: ulangan / ulanmagan / muammo), bosilgani pastda ochiladi:
 * Asosiy (ism, til, javob rejimi, mijozlar havolasi), Telegram, Instagram, DentaCRM, Telefon liniyasi; Kameralar — Kuzatuvchi'da.
 * Manzil: #/sozlamalar/<bo'lim>.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Camera as CameraIcon, MessageCircleHeart, Phone, Send, Settings, Sparkles, Stethoscope, type LucideIcon } from 'lucide-react';
import type { Business, LiveStatus } from '../../types';
import { api, type PhoneLine } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { isMedical } from '../../lib/compliance';
import { hrefOf } from '../../lib/nav';
import { DentaCrm } from '../DentaCrmSection';
import { ClientLink, Instagram, InstagramOfficial, OwnerBot, ReplyModeCard, SettingsCard, TelegramLogin } from '../TelegramPage';
import { PhoneLineSettings } from './PhoneLine';

type Tone = 'on' | 'off' | 'warn';
interface Tile { id: string; name: string; icon: LucideIcon; tone: Tone; state: string; href?: string }

const DOT: Record<Tone, string> = { on: 'bg-emerald-400', off: 'bg-glass/25', warn: 'bg-[#f5b454]' };

function Part({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <h3 className="text-[16px] font-semibold text-[#f2f0ea]">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-[#8a909c]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsHub({ tab, biz, status, notify, onStatus, onBiz, offeringsRev, onSaved }: {
  tab: string | null; biz: Business; status: LiveStatus; notify: Notify; onStatus: (s: LiveStatus) => void; onBiz: (b: Business) => void;
  offeringsRev: string; onSaved: (b: Business, rev: string) => void;
}) {
  const [line, setLine] = useState<PhoneLine | null>(null);
  const [cameras, setCameras] = useState<number | null>(null);
  useEffect(() => {
    let stale = false;
    api.phoneLine().then(r => { if (!stale) setLine(r.line); }).catch(() => {});
    api.cameras().then(r => { if (!stale) setCameras(r.cameras.length); }).catch(() => {});
    return () => { stale = true; };
  }, [tab]);

  const clinic = isMedical(biz.industry) || !!status.crm.account;
  const ig = status.instagramApi.account ?? status.instagram.account;
  const igProblem = status.instagramApi.problem ?? status.instagram.problem;
  const tiles: Tile[] = [
    { id: 'asosiy', name: 'Asosiy', icon: Settings, tone: 'on', state: `${biz.name}${biz.ownerName ? ` · ${biz.ownerName}` : ''}` },
    { id: 'telegram', name: 'Telegram', icon: Send, tone: status.ownerLinked ? 'on' : 'off', state: status.ownerLinked ? (status.telegramUser.account ? 'bot va shaxsiy akkaunt' : 'bot ulangan') : 'ulanmagan' },
    { id: 'instagram', name: 'Instagram', icon: MessageCircleHeart, tone: ig ? (igProblem ? 'warn' : 'on') : 'off', state: ig ? (igProblem ? 'muammo bor' : 'ulangan') : 'ulanmagan' },
    ...(clinic ? [{ id: 'dentacrm', name: 'DentaCRM', icon: Stethoscope, tone: (status.crm.account ? (status.crm.problem ? 'warn' : 'on') : 'off') as Tone, state: status.crm.account ? (status.crm.problem ? 'muammo bor' : 'ulangan') : 'ulanmagan' }] : []),
    { id: 'telefon', name: 'Telefon liniyasi', icon: Phone, tone: line?.status.trunk === 'registered' ? 'on' : line?.status.trunk === 'failed' ? 'warn' : 'off', state: line ? (line.status.trunk === 'registered' ? 'shahar raqami ulangan' : line.status.trunk === 'failed' ? 'raqam ulanmadi' : line.status.asterisk ? 'raqam kiritilmagan' : 'Asterisk ishlamayapti') : '…' },
    { id: 'kameralar', name: 'Kameralar', icon: CameraIcon, tone: cameras ? 'on' : 'off', state: cameras == null ? '…' : cameras ? `${cameras} ta kamera` : "kamera yo'q", href: hrefOf('kuzatuvchi', 'ulash') },
    { id: 'ai', name: 'AI va ovoz', icon: Sparkles, tone: status.ai ? (status.voice ? 'on' : 'warn') : 'warn', state: status.ai ? (status.voice ? 'ishlayapti' : 'ovozli xabar o‘chiq') : 'AI kaliti yo‘q', href: '#/ulash' },
  ];
  const active = tiles.some(t => t.id === tab && !t.href) ? tab! : 'asosiy';

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Ulanishlar" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(t => (
          <a key={t.id} href={t.href ?? hrefOf('sozlamalar', t.id)} aria-current={t.id === active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 no-underline transition-colors ${t.id === active ? 'border-[#8b8cff]/40 bg-[#8b8cff]/[0.08]' : 'border-glass/[0.07] bg-[#0b0c10] hover:bg-glass/[0.03]'}`}>
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-glass/[0.05] text-[#d9dbe1]">
              <t.icon className="h-[19px] w-[19px]" aria-hidden="true" />
              <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0b0c10] ${DOT[t.tone]}`} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-[#f2f0ea]">{t.name}{t.href && <span className="ml-1 text-[#7d838f]">→</span>}</span>
              <span className="block truncate text-[12px] text-[#8a909c]">{t.state}</span>
            </span>
          </a>
        ))}
      </nav>

      {active === 'asosiy' && (
        <div className="agent-body grid items-start gap-5 xl:grid-cols-2">
          <SettingsCard key={`${biz.name}|${biz.ownerName}|${biz.industry}|${biz.contentLang}|${biz.morningBrief}`} biz={biz} offeringsRev={offeringsRev} onSaved={onSaved} notify={notify} />
          <div className="flex flex-col gap-5">
            <ReplyModeCard biz={biz} onBiz={onBiz} notify={notify} />
            <ClientLink status={status} notify={notify} />
          </div>
        </div>
      )}
      {active === 'telegram' && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <Part title="Cerebro bilan Telegram'da" hint="Eslatmalar, ertalabki reja va mijozlarga javob takliflari shu yerga keladi."><OwnerBot status={status} /></Part>
          <Part title="Shaxsiy Telegram" hint="Mijozlaringiz yozadigan akkaunt — ularga Cerebro javob beradi (siz tanlagan rejimda)."><TelegramLogin status={status} onStatus={onStatus} notify={notify} /></Part>
        </div>
      )}
      {active === 'instagram' && (
        <Part title="Instagram Direct" hint="Mijozlar Instagram'da yozsa — Qabulxona javob beradi.">
          <InstagramOfficial status={status} onStatus={onStatus} notify={notify} />
          {!status.instagramApi.account && (
            <details className="mt-4 border-t border-glass/[0.06] pt-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-[#a3a9b5]">Meta ilovasisiz — shu kompyuterdagi brauzer orqali (zaxira yo'l)</summary>
              <div className="mt-3"><Instagram status={status} onStatus={onStatus} notify={notify} /></div>
            </details>
          )}
        </Part>
      )}
      {active === 'dentacrm' && (
        <Part title="DentaCRM — qabullar va tushum" hint="Ulansa: Qabulxona qabulga yozadi, Tahlilchi tushumni ko'rsatadi, Kuzatuvchi kamerani qabullar bilan solishtiradi.">
          <DentaCrm status={status} onStatus={onStatus} notify={notify} />
        </Part>
      )}
      {active === 'telefon' && <PhoneLineSettings notify={notify} />}
      {!status.voice && <p className="text-[12px] text-[#7d838f]">Ovozli xabarlar hozircha o'chiq: serverda GEMINI_API_KEY yoki GROQ_API_KEY yo'q.</p>}
    </div>
  );
}
