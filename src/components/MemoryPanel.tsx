/**
 * «Xotira» — Palantir nimani eslab qolgani, egasi ko'rib turishi uchun. Ikki xil eslash bor:
 * suhbat (yozishma, ovoz, Telegram — bitta, bazada; 6 soat jim tursa yangi mavzu, oxirgi gaplar qisqa eslatma bo'lib o'tadi) va
 * doimiy xotira — Miya'dagi faktlar va sahifalar (har suhbatda, ovozda ham, esda turadi). Fakt shu yerda qo'shiladi va o'chiriladi.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Brain, Loader2, Plus, X } from 'lucide-react';
import type { Note } from '../types';
import { api } from '../data/api';
import type { Notify } from './Artifacts';
import { hrefOf } from '../lib/nav';

const MAX_FACT = 300;

export function MemoryPanel({ notify, tick = 0 }: { notify: Notify; tick?: number }) {
  const [facts, setFacts] = useState<Note[] | null>(null);
  const [pages, setPages] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api.brain().then(r => { if (!stale) { setFacts(r.brain.facts); setPages(r.brain.pages.length); } }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy('add');
    try {
      const r = await api.addNote(clean);
      setFacts(list => [...(list ?? []), r.note]);
      setText('');
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(null); }
  };
  const forget = async (id: string) => {
    setBusy(id);
    try {
      await api.deleteNote(id);
      setFacts(list => list?.filter(f => f.id !== id) ?? list);
    } catch (err) { notify((err as Error).message, true); } finally { setBusy(null); }
  };

  return (
    <section aria-labelledby="xotira" className="flex flex-col gap-4 rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <header className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#8b8cff]/15 text-[#c7c8ff]"><Brain className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <h2 id="xotira" className="text-[16px] font-semibold text-[#f2f0ea]">Xotira</h2>
        {facts && <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{facts.length} ta fakt</span>}
      </header>
      <ul className="flex flex-col gap-2 text-[13px] leading-snug text-[#a3a9b5]">
        <li><span className="text-[#d9dbe1]">Suhbat</span> — shu yerda, Telegram'da va ovozda bitta. Bazada saqlanadi; 6 soat jim tursa yangi mavzu boshlanadi, oxirgi gaplar eslatma bo'lib o'tadi.</li>
        <li><span className="text-[#d9dbe1]">Doimiy xotira</span> — Miya. «Eslab qol» desangiz shu ro'yxatga yoziladi va har suhbatda esda turadi.</li>
      </ul>
      {facts === null ? <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />
        : facts.length ? (
          <ul className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto pr-1">
            {facts.map(f => (
              <li key={f.id} className="group flex items-start gap-2 rounded-xl border border-glass/[0.06] bg-glass/[0.02] px-3 py-2 text-[13.5px] leading-snug text-[#e4e3de]">
                <span className="min-w-0 flex-1">{f.text}</span>
                <button type="button" onClick={() => { void forget(f.id); }} disabled={busy === f.id} aria-label={`Unutsin: ${f.text}`}
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#7d838f] opacity-60 transition hover:bg-glass/5 hover:text-rose-300 group-hover:opacity-100 disabled:opacity-30">
                  {busy === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-glass/10 px-3 py-3 text-[13px] text-[#8a909c]">Hali fakt yo'q. Masalan: «Bosh shifokor — Dilshod aka», «Shanba kuni 15:00 gacha ishlaymiz».</p>}
      <form onSubmit={add} className="flex items-center gap-2 rounded-xl border border-glass/10 bg-glass/[0.03] p-1 pl-3 focus-within:border-glass/25">
        <label htmlFor="new-fact" className="sr-only">Eslab qolsin</label>
        <input id="new-fact" value={text} maxLength={MAX_FACT} onChange={e => setText(e.target.value)} placeholder="Eslab qolsin…" className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
        <button type="submit" disabled={!text.trim() || busy === 'add'} aria-label="Xotiraga qo'shish" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#8b8cff] text-[#07080b] disabled:opacity-40">
          {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        </button>
      </form>
      <a href={hrefOf('miya')} className="text-[13px] text-[#a3a9b5] no-underline hover:text-[#f2f0ea]">Miya'da: {pages} ta sahifa, qo'ng'iroqlar va hujjatlar →</a>
    </section>
  );
}
