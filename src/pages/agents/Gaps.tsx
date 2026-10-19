/**
 * «AI bilmagan savollar»: mijozlar ko'p so'raydigan, lekin hali javobi yozilmagan savollar (ikkinchi miyadagi tayyor ro'yxat).
 * Bir marta javob yozasiz — keyin qabulxona o'zi aytadi. Javob shu yerning o'zida saqlanadi.
 */
import { useEffect, useState } from 'react';
import type { BrainView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';

export function Gaps({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const [brain, setBrain] = useState<BrainView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.brain().then(r => setBrain(r.brain)).catch(() => {}); }, []);
  const missing = brain?.pack.filter(p => !p.answer) ?? [];
  const total = brain?.pack.length ?? 0;
  const save = async (packId: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.answer({ packId, answer: text.trim() });
      setBrain(r.brain);
      setOpen(null);
      setText('');
      notify('Saqlandi — qabulxona endi shunday javob beradi');
      onChanged();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="AI bilmagan savollar" action={total ? <span className="tabular-nums text-[12px] text-[#7d838f]">{total - missing.length} / {total} javobli</span> : null}>
      {!brain ? <div className="h-24 animate-pulse rounded-xl bg-glass/[0.03]" /> : !missing.length ? <Quiet>Mijozlar ko'p so'raydigan hamma savolga javob bor.</Quiet> : (
        <>
          {total > 0 && <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-glass/[0.06]"><div className="h-full rounded-full bg-[#3fd6c3]" style={{ width: `${((total - missing.length) / total) * 100}%` }} /></div>}
          <ul className="flex flex-col gap-2">
            {missing.slice(0, 5).map(p => (
              <li key={p.id} className="rounded-xl border border-glass/[0.06] bg-glass/[0.02]">
                {open === p.id ? (
                  <form onSubmit={e => { e.preventDefault(); void save(p.id); }} className="flex flex-col gap-2 p-3">
                    <label htmlFor={`gap-${p.id}`} className="text-[14px] font-medium text-[#f2f0ea]">{p.question}</label>
                    <textarea id={`gap-${p.id}`} autoFocus rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={p.hint}
                      className="w-full resize-none rounded-lg border border-glass/10 bg-[#07080b] p-2.5 text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#6e7582] focus:border-[#3fd6c3]/50" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={!text.trim() || busy} className="min-h-9 rounded-lg bg-[#3fd6c3] px-4 text-[13px] font-semibold text-[#07080b] disabled:opacity-40">Saqlash</button>
                      <button type="button" onClick={() => { setOpen(null); setText(''); }} className="min-h-9 rounded-lg px-3 text-[13px] text-[#a3a9b5] hover:bg-glass/5">Bekor</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setOpen(p.id); setText(''); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                    <span className="min-w-0 flex-1 text-[14px] text-[#e4e3de]">{p.question}</span>
                    <span className="shrink-0 text-[12px] font-medium text-[#8ff0e2]">Javob yozish</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 5 && <a href={hrefOf('miya', 'savollar')} className="mt-3 block text-[13px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">Yana {missing.length - 5} ta savol →</a>}
        </>
      )}
    </Panel>
  );
}
