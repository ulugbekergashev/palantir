/**
 * «Bugun klinikada» — bosh ekranda, maqsadlar ostida: bugungi tushum (7 kunlik o'rtacha bilan), to'lovlar, kelganlar va to'lanmagan
 * qarz. DentaCRM'dan (server/crm/today.ts), AI'siz. DentaCRM ulanmagan bo'lsa yoki javob bermasa — ko'rinmaydi (bosh ekran buzilmasin).
 * Ekran ochiq tursa har 2 daqiqada va biror ish bajarilganda (tick) yangilanadi.
 */
import { useEffect, useState } from 'react';
import { Wallet, ChartLine } from 'lucide-react';
import { api } from '../data/api';
import { hrefOf } from '../lib/nav';
import type { ClinicMoney as Money } from '../types';

const POLL_MS = 120_000;
const som = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ')} so'm`;

/** Bugungi tushum o'rtachadan qanchaga farq qiladi (o'rtacha yo'q yoki nol — taqqoslanmaydi) */
function versus(m: Money): { text: string; tone: string } | null {
  if (!m.avgRevenue) return null;
  const pct = Math.round(((m.revenue - m.avgRevenue) / m.avgRevenue) * 100);
  const sign = pct > 0 ? '+' : '';
  return { text: `7 kunlik o'rtacha ${som(m.avgRevenue)} · ${sign}${pct}%`, tone: pct >= 0 ? 'text-emerald-400' : 'text-[#a3a9b5]' };
}

function Cell({ label, value, hint, tone = 'text-[#a3a9b5]', testId }: { label: string; value: string; hint?: string; tone?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[#7d838f]">{label}</dt>
      <dd className="mt-1 text-[19px] font-bold tabular-nums leading-tight text-[#f2f0ea]">{value}</dd>
      {hint && <dd className={`mt-0.5 text-[12px] leading-snug ${tone}`}>{hint}</dd>}
    </div>
  );
}

export function ClinicMoneyStrip({ tick = 0 }: { tick?: number }) {
  const [m, setM] = useState<Money | null>(null);
  useEffect(() => {
    let stale = false;
    const load = () => api.clinicMoney().then(r => { if (!stale) setM(r.money); }).catch(() => { if (!stale) setM(null); });
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { stale = true; clearInterval(t); };
  }, [tick]);
  if (!m) return null;
  const vs = versus(m);
  return (
    <section aria-label="Bugun klinikada" className="rounded-2xl border border-glass/[0.08] bg-glass/[0.03] px-5 py-4 text-left">
      <div className="mb-3 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-[#e8c37a]" aria-hidden="true" />
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a3a9b5]">Bugun klinikada · DentaCRM</h2>
        <a href={hrefOf('tahlilchi')} className="ml-auto flex items-center gap-1 text-[12.5px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]"><ChartLine className="h-3.5 w-3.5" aria-hidden="true" />Raqamlar</a>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Cell testId="money-revenue" label="Tushum" value={som(m.revenue)} hint={vs?.text} tone={vs?.tone} />
        <Cell testId="money-payments" label="To'lovlar" value={`${m.payments} ta`} />
        <Cell testId="money-came" label="Keldi" value={`${m.came} / ${m.total}`} hint={m.expected ? `yana ${m.expected} kishi kutilmoqda` : undefined} />
        <Cell testId="money-unpaid" label="To'lanmagan" value={som(m.unpaid.total)} hint={m.unpaid.count ? `${m.unpaid.count} ta to'lov` : undefined}
          tone={m.unpaid.count ? 'text-[#f5b454]' : undefined} />
      </dl>
    </section>
  );
}
