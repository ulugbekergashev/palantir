/**
 * Palantir jamoasidan yordam (server/help.ts). Egasi yoki boshqaruvchi muammoni o'z so'zi bilan yozadi. Standart holatda so'rov bilan
 * kompyuter holati va texnik jurnallar ham boradi (parol va kalitlarsiz). Jamoa /admin da javob yozadi: javob shu ro'yxatda va
 * egasining Telegramida ko'rinadi. Hub ulanmagan bo'lsa so'rov yuborib bo'lmaydi — nima qilish aytiladi.
 * Palantir jamoasi panelga kirgan bo'lsa forma ko'rinmaydi (so'rov egasining nomidan ketadi).
 */
import { useState } from 'react';
import { Clock, Loader2, Send } from 'lucide-react';
import { api, type HelpRequestView, type HelpView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Button, Field, inputClass } from '../../components/ui';
import { when } from '../../lib/text';

const TEXT_MIN = 5, TEXT_MAX = 2000;

function Asked({ r }: { r: HelpRequestView }) {
  return (
    <li className="rounded-xl bg-slate-50 p-3">
      <p className="whitespace-pre-wrap break-words text-slate-800">{r.text}</p>
      <p className="mt-1 text-xs text-slate-500">{r.by ? `${r.by} · ` : ''}{when(r.createdAt)}{r.withDiag ? ' · diagnostika bilan' : ''}</p>
      {r.answer ? (
        <div className="mt-2 border-l-2 border-emerald-500 pl-3">
          <p className="text-xs font-semibold text-slate-600">{r.answeredBy ? `Palantir jamoasidan ${r.answeredBy}` : 'Palantir jamoasi'}{r.answeredAt ? ` · ${when(r.answeredAt)}` : ''}</p>
          <p className="whitespace-pre-wrap break-words text-slate-800">{r.answer}</p>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> Javob kutilmoqda — kelganda shu yerda va Telegram'ingizda ko'rinadi</p>
      )}
    </li>
  );
}

export function HelpRequest({ view, onAsked, notify }: { view: HelpView; onAsked: (r: HelpRequestView) => void; notify: Notify }) {
  const [text, setText] = useState('');
  const [diag, setDiag] = useState(true);
  const [busy, setBusy] = useState(false);

  if (view.support) return <p className="text-sm text-slate-500">Siz Palantir jamoasi sifatida kirgansiz — yordam so'rovlarini Hub'dagi /admin sahifasida ko'rasiz.</p>;
  if (!view.hub) {
    return <p className="text-sm text-slate-500">Palantir Hub ulanmagan — so'rovni bu yerdan yuborib bo'lmaydi. Palantir'ni o'rnatgan odamga Telegram'da yozing; u so'rasa, botga /diagnostika yuboring.</p>;
  }

  const ready = text.trim().length >= TEXT_MIN && !busy;
  const send = async () => {
    setBusy(true);
    try {
      const { request } = await api.askHelp(text.trim(), diag);
      onAsked(request);
      setText('');
      notify("Palantir jamoasiga yuborildi — javob shu yerga va Telegram'ingizga keladi");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 text-sm text-slate-600">
      <Field label="Muammo nima?" hint="Nima bo'ldi, qachondan beri, qaysi bo'limda — shunda tezroq tuzatiladi">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={TEXT_MAX}
          placeholder="Masalan: kechadan beri Instagram'dagi xabarlarga javob ketmayapti" className={`${inputClass} h-auto resize-y py-2 leading-relaxed`} />
      </Field>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" checked={diag} onChange={e => setDiag(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
        <span>Diagnostikani qo'shish — kompyuter holati va texnik jurnallar (parol va kalitlarsiz). Jamoa muammoni tezroq topadi.</span>
      </label>
      <Button variant="primary" onClick={() => { void send(); }} disabled={!ready}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} Yuborish
      </Button>
      {view.requests.length > 0 && (
        <section aria-label="Yuborilgan so'rovlar" className="space-y-2 border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-600">Yuborilgan so'rovlar</h4>
          <ul className="space-y-2">{view.requests.map(r => <Asked key={r.id} r={r} />)}</ul>
        </section>
      )}
    </div>
  );
}
