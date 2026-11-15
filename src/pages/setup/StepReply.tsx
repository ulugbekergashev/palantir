/**
 * Ulash ustasi: javob rejimi (B2). Egasi bilan birga aniq tanlanadi — hech biri oldindan belgilanmagan: standart «tasdiqlayman»
 * kechasi bemorni «tez orada javob beramiz» bilan qoldiradi, buni egasi bilmasdan tanlab qo'ymasin. Tanlov serverda chosenAt bilan
 * yoziladi; eski o'rnatishda rejim o'zgarmaydi (faqat qadam «tayyor» bo'lmaydi). «O'chiq» rejimi — faqat Sozlamalarda
 */
import { useEffect, useState } from 'react';
import { api } from '../../data/api';
import { Card, controlClass } from '../../components/ui';
import type { AutoReply, Business, ReplyMode } from '../../types';

type Notify = (text: string, error?: boolean) => void;

const CHOICES: { value: ReplyMode; title: string; text: string }[] = [
  { value: 'auto', title: "AI o'zi javob bersin", text: "Bemorga kechasi ham, dam olish kunida ham darhol javob boradi. Egasi belgilangan vaqtda o'zi yozmasa, AI administrator yuboradi; narx yo'q, chegirma, shikoyat kabi savollarda baribir egasidan so'raydi." },
  { value: 'draft', title: 'Men tasdiqlayman', text: "AI administrator javob yozib, egasiga Telegram'da ko'rsatadi — egasi «Yuborish»ni bosgandagina ketadi. Egasi band bo'lsa yoki kechasi bemor faqat «yetkazildi, tez orada javob beramiz» oladi." },
];

export function StepReply({ biz, onBiz, notify }: { biz: Business | null; onBiz: (b: Business) => void; notify: Notify }) {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => { api.knowledgeGaps().then(r => setMissing(r.missing)).catch(() => {}); }, []);
  if (!biz) return null;
  const v: AutoReply = { mode: 'draft', contacts: false, delayMin: 2, ...biz.autoReply };
  const chosen = v.chosenAt ? v.mode : null;
  const save = async (patch: Partial<AutoReply>) => {
    try {
      const r = await api.setAutoReply({ ...v, ...patch });
      onBiz(r.business);
      setMissing(r.missing);
      notify('Saqlandi');
    } catch (e) { notify((e as Error).message, true); }
  };
  return (
    <div className="space-y-4">
      <Card title="Bemorlarga kim javob beradi" description="Bot, egasining shaxsiy Telegram'i va Instagram'da yozgan bemorlarga">
        <div role="radiogroup" aria-label="Javob rejimi" className="grid gap-3 sm:grid-cols-2">
          {CHOICES.map(c => (
            <button key={c.value} type="button" role="radio" aria-checked={chosen === c.value} onClick={() => void save({ mode: c.value })}
              className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${chosen === c.value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="text-sm font-bold">{c.title}</span>
              <span className="mt-1 text-xs leading-relaxed text-slate-500">{c.text}</span>
            </button>
          ))}
        </div>
        {!chosen && (
          <p className="mt-3 text-sm text-slate-500">
            {biz.autoReply?.mode === 'off' ? 'Hozir javob o\'chiq.' : biz.autoReply?.mode === 'auto' ? "Hozir AI o'zi javob beradi." : 'Hozir standart holat — javoblarni egasi tasdiqlaydi.'} Egasi bilan gaplashib, birini tanlang.
          </p>
        )}
        {chosen === 'auto' && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-600">AI egasini shuncha kutadi:</span>
            <select aria-label="Kutish vaqti" className={`${controlClass} h-9`} value={v.delayMin} onChange={e => void save({ delayMin: Number(e.target.value) })}>
              {[0, 1, 2, 5, 10, 30].map(n => <option key={n} value={n}>{n ? `${n} daqiqa` : 'kutmasin'}</option>)}
            </select>
          </label>
        )}
        {chosen === 'auto' && missing.length > 0 && (
          <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            AI administrator hali bilmaydi: <b>{missing.join(', ')}</b>. Bemor shularni so'rasa, o'zi javob bera olmaydi — egasiga uzatadi.
            «Bo'shliqlar» qadamida egasidan so'rang.
          </p>
        )}
      </Card>
    </div>
  );
}
