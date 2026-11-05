/**
 * Marketolog: Meta AI (egasining o'z meta.ai akkaunti) orqali raqobatchilar, akkaunt va videolar tahlili, kontent-reja.
 * «So'rash» — savol Palantir yordamchisiga ketadi, u Meta AI asbobini chaqiradi; har javob «Hisobotlar»da to'liq turadi.
 * «Ulash» — shu kompyuterda alohida brauzer oynasi ochiladi, egasi meta.ai'ga o'zi kiradi (parol Palantir'ga berilmaydi).
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Unlink } from 'lucide-react';
import type { AgentEvent, LiveStatus } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { AgentAsk, HUE, Panel, Quiet, type Stat } from '../../components/agent';
import { Markdown } from '../../components/Markdown';
import { Button } from '../../components/ui';
import { iso } from '../../lib/week';

const CHIPS = [
  "Instagram'dagi asosiy raqobatchilarimizni tahlil qil",
  "Instagram akkauntimizni tahlil qil: nima yaxshi, nimani o'zgartirish kerak",
  "Bizning sohada hozir qanday Reels ko'p ko'rilyapti?",
  "Raqobatchilarimiz qaysi mavzularda ko'p izoh va layk olyapti?",
];

export function useMarketingReports(notify: Notify, tick: number): AgentEvent[] | null {
  const [list, setList] = useState<AgentEvent[] | null>(null);
  useEffect(() => {
    let stale = false;
    api.agentEvents('marketolog').then(r => { if (!stale) setList(r.events); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

export function marketingStats(status: LiveStatus, reports: AgentEvent[] | null): Stat[] {
  const m = status.metaAi;
  const today = iso(new Date());
  return [
    { label: 'Bugungi tahlil', value: reports ? reports.filter(e => iso(new Date(e.at)) === today).length : '—' },
    { label: 'Meta AI savollari', value: m.connected ? `${m.usedToday}/${m.dailyLimit}` : '—', hint: 'bugun · akkaunt xavfsizligi uchun chegara' },
    { label: 'Hisobotlar', value: reports?.length ?? '—', hint: 'oxirgilari' },
    // Qisqa belgi: telefonda to'rt raqam bir qatorga sig'sin; izohi — ostida
    { label: 'Meta AI', value: m.problem ? '!' : m.connected ? '✓' : '—', hint: m.problem ? 'qayta kiring' : m.connected ? 'ulangan' : 'ulanmagan', tone: m.problem || !m.connected ? 'warn' : 'good' },
  ];
}

const time = (at: string) => new Date(at).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Hisobotlar: sarlavha va boshlanishi; bosilsa — to'liq javob (Meta AI yozgan ko'rinishda) */
export function MarketingReports({ reports, limit }: { reports: AgentEvent[] | null; limit?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (reports === null) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  if (!reports.length) return <Quiet>Hali hisobot yo'q. Yuqoridan so'rang yoki «Topshiriqlar»da jadval bering — masalan, har dushanba raqobatchilar tahlili.</Quiet>;
  return (
    <ul className="flex flex-col gap-2">
      {reports.slice(0, limit).map(e => {
        const expanded = open === e.id;
        return (
          <li key={e.id} className="rounded-2xl border border-glass/[0.06] bg-glass/[0.02]">
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : e.id)} className="flex w-full items-start gap-3 p-4 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium leading-snug text-[#f2f0ea]">{e.title}</span>
                {!expanded && <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-[#a3a9b5]">{e.body}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-[12px] text-[#7d838f]">{time(e.at)}</span>
              <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[#7d838f] transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {expanded && (
              <div className="border-t border-glass/[0.06] px-4 pb-4 pt-3">
                <Markdown text={e.body} className="text-[14.5px] leading-relaxed text-[#e4e3de]" />
                <p className="mt-3 text-[12px] text-[#7d838f]">Meta AI javobi — xato bo'lishi mumkin; muhim raqam va akkauntlarni o'zingiz tekshiring.</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Meta AI'ni ulash: shu kompyuterda oyna ochiladi — egasi meta.ai'ga o'zi kiradi, keyin Palantir fonda ishlaydi */
export function MetaAiConnect({ status, onStatus, notify }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify }) {
  const m = status.metaAi;
  const [busy, setBusy] = useState(false);

  // Egasi oynada kirguncha holat kuzatiladi
  useEffect(() => {
    if (!m.waiting) return;
    const t = setInterval(async () => {
      try {
        const s = (await api.me()).status;
        if (!s.metaAi.waiting) {
          if (s.metaAi.problem) notify(`Meta AI ulanmadi: ${s.metaAi.problem}`, true);
          else if (s.metaAi.connected) notify('Meta AI ulandi');
        }
        onStatus(s);
      } catch { /* keyingi safar */ }
    }, 2000);
    return () => clearInterval(t);
  }, [m.waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    setBusy(true);
    try { onStatus((await api.metaAiLogin()).status); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const loginButton = (label: string) => (
    <Button variant="primary" disabled={busy} onClick={login} style={{ background: HUE.marketolog.a, color: '#07080b' }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} {label}
    </Button>
  );

  if (!m.available) {
    return <Quiet>Bu kompyuterda Google Chrome yoki Microsoft Edge topilmadi. Birini o'rnating — Marketolog Meta AI'ga shu brauzer orqali kiradi.</Quiet>;
  }
  if (m.waiting) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-[#f2f0ea]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Meta AI oynasi ochildi — o'sha oynada akkauntingizga kiring</p>
        <p className="text-[13px] text-[#a3a9b5]">Oyna Palantir o'rnatilgan kompyuterda ochiladi. «Войти» ni bosing va Facebook yoki Instagram akkauntingiz bilan kiring. Kirganingizdan keyin oyna o'zi yopiladi.</p>
        <Button size="sm" variant="ghost" onClick={() => void api.metaAiCancel().catch(() => {})}>Bekor qilish</Button>
      </div>
    );
  }
  if (m.connected) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px] text-[#e4e3de]">{m.problem ? 'Meta AI ulangan, lekin qayta kirish kerak.' : <>✓ Meta AI ulangan. Bugun {m.usedToday} ta savol berildi (kuniga {m.dailyLimit} tagacha).</>}</p>
          {m.relogin && loginButton('Qayta kirish')}
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!window.confirm('Meta AI uzilsinmi? Marketolog tahlillarni to\'xtatadi; brauzerdagi kirish ma\'lumotlari o\'chiriladi.')) return;
            try { onStatus((await api.metaAiDisconnect()).status); } catch (e) { notify((e as Error).message, true); }
          }}><Unlink className="h-3.5 w-3.5" /> Uzish</Button>
        </div>
        {m.problem && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">⚠️ {m.problem}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[14.5px] leading-relaxed text-[#c9cbd2]">
        Marketolog Meta AI'ga sizning akkauntingiz orqali savol beradi: raqobatchilar, Instagram akkauntingiz, Reels nimani aytadi, kontent-reja.
        «Ulash»ni bosing — shu kompyuterda alohida oyna ochiladi, meta.ai'ga Facebook yoki Instagram akkauntingiz bilan o'zingiz kirasiz. Parolingiz Palantir'ga berilmaydi.
      </p>
      <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] leading-relaxed text-[#fde2b0]">
        Bu Meta'ning rasmiy yo'li emas: sayt o'zgarsa vaqtincha ishlamay qolishi mumkin. Akkaunt xavfsizligi uchun Marketolog kuniga {m.dailyLimit} tadan ko'p savol bermaydi.
      </p>
      {m.problem && <p className="text-[13px] text-[#fca5a5]">{m.problem}</p>}
      {loginButton("Meta AI'ga kirish")}
    </div>
  );
}

/** Asosiy varaq: so'rash (tez buyruqlar bilan) va oxirgi hisobotlar; ulanmagan bo'lsa — avval ulash */
export function MarketingDesk({ status, onStatus, notify, reports, onAsked }: { status: LiveStatus; onStatus: (s: LiveStatus) => void; notify: Notify; reports: AgentEvent[] | null; onAsked: () => void }) {
  if (!status.metaAi.connected) {
    return <Panel title="Avval Meta AI'ni ulang"><MetaAiConnect status={status} onStatus={onStatus} notify={notify} /></Panel>;
  }
  return (
    <div className="space-y-5">
      <Panel title="Marketologdan so'rang">
        <AgentAsk member="marketolog" placeholder="Masalan: «@raqobatchi akkauntini tahlil qil» yoki Reels havolasini tashlang" chips={CHIPS} onAnswered={onAsked} />
        <p className="mt-3 text-[12px] text-[#7d838f]">Javob Meta AI'dan keladi — bir necha daqiqa ketishi mumkin.</p>
      </Panel>
      <Panel title="Oxirgi hisobotlar"><MarketingReports reports={reports} limit={5} /></Panel>
    </div>
  );
}
