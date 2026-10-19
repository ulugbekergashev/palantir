/**
 * Sozlamalar → Rekvizitlar: korxonaning yuridik ma'lumotlari. Bir marta kiritiladi — shartnoma, hisob-varaq va dalolatnomada
 * o'zi to'ldiriladi (server/docs). Yordamchiga ham aytsa bo'ladi: «STIR raqamim …» — u saqlaydi (save_requisites).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Landmark, Loader2 } from 'lucide-react';
import type { Business, LegalDetails } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';

const input = 'h-11 w-full rounded-xl border border-glass/10 bg-glass/[0.03] px-3 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6b717c] focus:border-glass/25';
const Label = ({ text, hint, wide, children }: { text: string; hint?: string; wide?: boolean; children: ReactNode }) => (
  <label className={`flex flex-col gap-1.5 text-[12px] font-medium text-[#a3a9b5] ${wide ? 'sm:col-span-2' : ''}`}>
    {text}{children}{hint && <span className="font-normal text-[#6b717c]">{hint}</span>}
  </label>
);

type Field = { key: Exclude<keyof LegalDetails, 'vatRate'>; text: string; placeholder?: string; hint?: string; wide?: boolean; digits?: boolean };
const FIELDS: Field[] = [
  { key: 'name', text: 'Yuridik nomi', placeholder: '«Cerebro AI» MChJ', wide: true },
  { key: 'director', text: 'Rahbar (F.I.Sh.)', placeholder: 'Ergashev Ulug‘bek …' },
  { key: 'basis', text: 'Rahbar qaysi asosda ish yuritadi', placeholder: 'Ustav' },
  { key: 'stir', text: 'STIR (INN)', placeholder: '305 123 456', digits: true },
  { key: 'oked', text: 'OKED', placeholder: '62010', digits: true },
  { key: 'bank', text: 'Bank', placeholder: '«Kapitalbank» ATB Toshkent filiali', wide: true },
  { key: 'account', text: 'Hisob raqami (h/r)', placeholder: '2020 8000 …', digits: true },
  { key: 'mfo', text: 'MFO', placeholder: '01088', digits: true },
  { key: 'address', text: 'Yuridik manzil', placeholder: 'Bo‘sh qolsa — biznes manzili', wide: true },
  { key: 'email', text: 'E-mail' },
];

export function Requisites({ biz, offeringsRev, onSaved, notify }: { biz: Business; offeringsRev: string; onSaved: (b: Business, rev: string) => void; notify: Notify }) {
  const [legal, setLegal] = useState<LegalDetails>(biz.legal ?? {});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(legal) !== JSON.stringify(biz.legal ?? {});
  const vat = legal.vatRate === undefined ? 'unknown' : legal.vatRate === 0 ? 'no' : 'yes';
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Bo'sh maydonlar saqlanmaydi (hujjatda «noma'lum» deb turadi)
    const clean = Object.fromEntries(Object.entries(legal).filter(([, v]) => v !== '' && v !== undefined)) as LegalDetails;
    try {
      const r = await api.saveBusiness({ ...biz, legal: clean }, offeringsRev);
      onSaved(r.business, r.offeringsRev);
      setLegal(r.business.legal ?? {});
      notify('Saqlandi — endi shartnoma va hisob-varaqlarda o‘zi to‘ldiriladi');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#8b8cff]/12 text-[#c7c8ff]"><Landmark className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <div>
          <h3 className="text-[16px] font-semibold text-[#f2f0ea]">Korxona rekvizitlari</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">Bir marta kiriting — shartnoma, hisob-varaq va dalolatnomada o‘zi to‘ldiriladi. Bo‘sh qolgani hujjatda «________» bo‘lib turadi va Cerebro sizga aytadi. Yordamchiga yozsangiz ham bo‘ladi: «STIR raqamim …».</p>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(f => (
          <Label key={f.key} text={f.text} hint={f.hint} wide={f.wide}>
            <input className={input} value={legal[f.key] ?? ''} placeholder={f.placeholder} inputMode={f.digits ? 'numeric' : undefined}
              onChange={e => setLegal(l => ({ ...l, [f.key]: f.digits ? e.target.value.replace(/[^\d\s]/g, '') : e.target.value }))} />
          </Label>
        ))}
        <Label text="QQS (qo‘shilgan qiymat solig‘i)">
          <select className={input} value={vat} onChange={e => setLegal(l => ({ ...l, vatRate: e.target.value === 'unknown' ? undefined : e.target.value === 'no' ? 0 : (l.vatRate || 12) }))}>
            <option value="unknown">Ko‘rsatilmagan</option>
            <option value="no">QQS to‘lovchisi emas (QQSsiz)</option>
            <option value="yes">QQS to‘lovchisi</option>
          </select>
        </Label>
        {vat === 'yes' && (
          <Label text="QQS stavkasi, %" hint="Buxgalteringizdan aniqlang — hujjatda shu stavka ishlatiladi">
            <input className={input} type="number" min={1} max={30} value={legal.vatRate ?? ''} onChange={e => setLegal(l => ({ ...l, vatRate: Math.min(30, Math.max(1, Number(e.target.value) || 1)) }))} />
          </Label>
        )}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button type="submit" disabled={!dirty || busy} className="flex h-11 items-center gap-2 rounded-xl bg-[#f2f0ea] px-5 text-[14px] font-semibold text-[#07080b] disabled:opacity-40">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Saqlash
        </button>
        {!dirty && biz.legal?.stir && <span className="text-[13px] text-emerald-300">Saqlangan</span>}
      </div>
    </form>
  );
}
