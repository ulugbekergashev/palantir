import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, PageHeader, TextInput, inputClass } from '../components/ui';
import { MAX_OFFERINGS, MIN_FILE_PRICES, parsePrices } from '../lib/prices';
import type { BrainView, Knowledge } from '../types';
import { DocumentsCard } from './DocumentsCard';

/** So'rovni bajaradi va sahifani javobdagi holat bilan yangilaydi. Xato bo'lsa — null (xabar ko'rsatilgan) */
type Save = <T extends { brain: BrainView }>(work: Promise<T>, saved?: string) => Promise<T | null>;
const money = (n: number) => (n ? `${n.toLocaleString('ru')} so'm` : 'bepul');

/** Ikkinchi miya: Palantir biznes haqida bilgan hamma narsa bitta joyda. Mijozlarga javobda faqat shu yerdagi tasdiqlangan ma'lumot ishlatiladi */
export function BrainPage({ notify }: { notify: Notify }) {
  const [brain, setBrain] = useState<BrainView | null>(null);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const saves = useRef(0);
  const save: Save = (work, saved) => {
    saves.current += 1;
    return work.then(r => { saves.current += 1; setBrain(r.brain); if (saved) notify(saved); return r; }).catch(e => { fail(e); return null; });
  };
  useEffect(() => {
    // Davriy so'rov yo'lda ekan egasi nimadir saqlagan bo'lsa, eski javob yangi holatni bosib ketmaydi
    const load = () => { const at = saves.current; return api.brain().then(r => { if (saves.current === at) setBrain(r.brain); }).catch(fail); };
    void load();
    // Taklif Telegram'dan ham keladi (egasi mijozga javob berganda) — sahifa o'zi yangilanib turadi
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader title="Ikkinchi miya" description={<>
        <p>Palantir biznesingiz haqida bilgan hamma narsa. Mijozlarga faqat shu yerdagi ma'lumot bilan javob beradi; bilmaganini sizdan so'raydi.</p>
        {brain && <p>Hammasi oddiy fayllarda turadi: <code className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[13px] text-slate-700">{brain.vault}</code>. Shu papkani Obsidian'da ochsangiz («Open folder as vault»), u yerda o'zgartirganingiz bu yerda ham o'zgaradi.</p>}
      </>} />
      {!brain ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
        <>
          {brain.suggested.length > 0 && <Suggested items={brain.suggested} save={save} notify={notify} />}
          <Pack brain={brain} save={save} onInterview={() => { api.interview('start').then(() => { window.location.hash = '#/chat'; }).catch(fail); }} />
          <Answers items={brain.qa} save={save} />
          {brain.pages.length > 0 && <Pages items={brain.pages} left={brain.pagesLeftOut} />}
          <Facts brain={brain} reload={() => save(api.brain())} fail={fail} />
          <Prices brain={brain} save={save} notify={notify} />
          <Style value={brain.style} save={save} />
          <Fixes items={brain.fixes} save={save} />
          <Samples items={brain.samples} save={save} />
          <DocumentsCard notify={notify} />
        </>
      )}
    </div>
  );
}

function Row({ children, onRemove, label }: { children: ReactNode; onRemove?: () => void; label?: string }) {
  return (
    <li className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">{children}</div>
      {onRemove && <button type="button" aria-label={`O'chirish: ${label ?? ''}`} className="text-slate-400 hover:text-rose-600" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>}
    </li>
  );
}

function Suggested({ items, save, notify }: { items: Knowledge[]; save: Save; notify: Notify }) {
  /** Fayldagi narxlar jadvalga: nechta qo'shilgani aytiladi; jadval to'lib sig'magani bo'lsa — taklif joyida qoladi */
  const importPrices = async (id: string) => {
    const r = await save(api.pricesFromFile(id));
    if (!r) return;
    const moved = `${r.added} ta yangi, ${r.updated} tasi yangilandi${r.free ? `, ${r.free} ta bepul xizmat faktlarga yozildi` : ''}`;
    notify(r.dropped ? `Jadval to'ldi: ${moved}, ${r.dropped} tasi sig'madi — keraksiz xizmatlarni o'chirib, yana bosing` : `Narxlar jadvalga tushdi: ${moved}`, r.dropped > 0);
  };
  return (
    <Card title="Eslab qolaymi?" description="Mijozga bergan javobingiz yoki suhbatga tashlagan faylingiz. Tasdiqlasangiz — bilimga aylanadi va mijozlarga shundan javob beraman. Faqat bir mijozga atalgan gap yoki keraksiz fayl bo'lsa — «Kerak emas».">
      <ul className="space-y-2">
        {items.map(k => {
          // Fayldan kelgan taklif — sahifa: uzun matnning boshi ko'rsatiladi, qolgani papkadagi faylda
          const file = k.kind === 'page';
          return (
            <li key={k.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{file ? <>📎 {k.question} <span className="font-normal text-slate-500">— fayldan</span></> : k.question}</p>
              <p className={`mt-1 whitespace-pre-wrap text-slate-700 ${file ? 'max-h-48 overflow-y-auto' : ''}`}>{k.answer}</p>
              {k.warning && <p className="mt-1 text-xs text-amber-800">⚠️ {k.warning}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => { void save(api.editKnowledge(k.id, { remember: true }), file ? "Bilimga qo'shildi" : 'Eslab qoldim'); }}><Check className="h-4 w-4" /> {file ? "Bilimga qo'sh" : 'Eslab qol'}</Button>
                {file && (k.prices ?? 0) >= MIN_FILE_PRICES && <Button size="sm" onClick={() => { void importPrices(k.id); }}>Narxlar jadvaliga ({k.prices})</Button>}
                {file && <Button size="sm" onClick={() => { void save(api.sampleFromFile(k.id), 'Hujjat namunasi saqlandi'); }}>Hujjat namunasi</Button>}
                <Button size="sm" onClick={() => { void save(api.removeKnowledge(k.id)); }}>Kerak emas</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Pack({ brain, save, onInterview }: { brain: BrainView; save: Save; /** Palantir javobsiz savollarni suhbatda birma-bir so'raydi */ onInterview: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const done = brain.pack.filter(q => q.answer).length;
  const submit = async (e: FormEvent, packId: string) => {
    e.preventDefault();
    if (text.trim() && await save(api.answer({ packId, answer: text.trim() }), 'Saqlandi')) setOpen(null);
  };
  return (
    <Card title={`Mijozlar eng ko'p so'raydigan savollar · ${done}/${brain.pack.length}`} description="Har biriga bir marta javob yozing — keyin Palantir o'zi javob beradi. Javob yozilmagan savolni mijoz so'rasa, sizdan so'raydi."
      action={done < brain.pack.length ? <Button size="sm" onClick={onInterview}>Suhbatda so'rab chiq</Button> : undefined}>
      <ul className="divide-y divide-slate-100">
        {brain.pack.map(q => (
          <li key={q.id} className="py-2.5 text-sm">
            {open === q.id ? (
              <form onSubmit={e => { void submit(e, q.id); }} className="space-y-2">
                <label className="block font-semibold" htmlFor={`pack-${q.id}`}>{q.question}</label>
                <textarea id={`pack-${q.id}`} className={inputClass} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={q.hint} maxLength={800} autoFocus />
                <div className="flex gap-2"><Button size="sm" variant="primary" type="submit" disabled={!text.trim()}>Saqlash</Button><Button size="sm" type="button" onClick={() => setOpen(null)}>Bekor</Button></div>
              </form>
            ) : (
              <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => { setOpen(q.id); setText(q.answer?.answer ?? ''); }}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${q.answer ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="font-semibold">{q.question}</span><span className={`block ${q.answer ? 'text-slate-600' : 'text-slate-400'}`}>{q.answer?.answer ?? 'Javob yozilmagan'}</span>{q.answer?.warning && <span className="block text-xs text-amber-700">⚠️ {q.answer.warning}</span>}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Answers({ items, save }: { items: Knowledge[]; save: Save }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await save(api.answer({ question: question.trim(), answer: answer.trim() }), 'Saqlandi')) { setQuestion(''); setAnswer(''); }
  };
  return (
    <Card title="Boshqa savol-javoblar" description="O'zingiz qo'shgan va mijozlarga bergan javoblaringizdan eslab qolinganlar.">
      <ul className="mb-3 space-y-1.5">
        {items.map(k => <Row key={k.id} label={k.question} onRemove={() => { void save(api.removeKnowledge(k.id)); }}><p className="font-semibold">{k.question}</p><p className="whitespace-pre-wrap text-slate-600">{k.answer}</p>{k.warning && <p className="text-xs text-amber-700">⚠️ {k.warning}</p>}</Row>)}
        {!items.length && <li className="text-sm text-slate-400">Hali yo'q.</li>}
      </ul>
      <form onSubmit={e => { void add(e); }} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <TextInput value={question} onChange={e => setQuestion(e.target.value)} placeholder="Savol" aria-label="Yangi savol" maxLength={300} />
        <TextInput value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Javob" aria-label="Javobi" maxLength={800} />
        <Button type="submit" disabled={question.trim().length < 3 || !answer.trim()} aria-label="Savol-javob qo'shish"><Plus className="h-4 w-4" /></Button>
      </form>
    </Card>
  );
}

function Pages({ items, left }: { items: Knowledge[]; left: number }) {
  return (
    <Card title="Sizning sahifalaringiz" description="Papkada (Obsidian'da) o'zingiz yozgan sahifalar. Palantir ularni ham o'qiydi. Tahrirlash va o'chirish — papkaning o'zida.">
      <ul className="space-y-1.5">
        {items.map(k => <Row key={k.id}><p className="font-semibold">{k.question}</p><p className="line-clamp-2 text-slate-500">{k.answer}</p>{k.warning && <p className="text-xs text-amber-700">⚠️ {k.warning}</p>}</Row>)}
      </ul>
      {left > 0 && <p className="mt-2 text-sm text-amber-700">Sahifalar ko'payib ketdi: {left} tasi hajmga sig'may, mijozlarga javobda ishlatilmayapti. Eng muhimlarini qisqartiring yoki savol-javob qilib yozing.</p>}
    </Card>
  );
}

function Facts({ brain, reload, fail }: { brain: BrainView; reload: () => unknown; fail: (e: unknown) => void }) {
  const [text, setText] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) api.addNote(text.trim()).then(() => { setText(''); return reload(); }).catch(fail);
  };
  return (
    <Card title="Faktlar" description="Doimiy narsalar: yetkazib berish shartlari, rekvizitlar, ish tartibi. Yordamchiga «eslab qol: …» deb aytsangiz ham shu yerga tushadi.">
      <ul className="mb-3 space-y-1.5">
        {brain.facts.map(n => <Row key={n.id} label={n.text} onRemove={() => { api.deleteNote(n.id).then(reload).catch(fail); }}>{n.text}</Row>)}
        {!brain.facts.length && <li className="text-sm text-slate-400">Hali yo'q.</li>}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <TextInput value={text} onChange={e => setText(e.target.value)} placeholder="Masalan: 500 ming so'mdan yuqori buyurtmaga yetkazish bepul" aria-label="Yangi fakt" maxLength={500} />
        <Button type="submit" disabled={!text.trim()} aria-label="Fakt qo'shish"><Plus className="h-4 w-4" /></Button>
      </form>
    </Card>
  );
}

function Prices({ brain, save, notify }: { brain: BrainView; save: Save; notify: Notify }) {
  const [text, setText] = useState('');
  const parsed = parsePrices(text);
  const submit = async () => {
    const sending = parsed.items.slice(0, MAX_OFFERINGS);
    const r = await save(api.importPrices(sending));
    if (!r) return;
    // Chegaraga sig'magani ochiq aytiladi va matn o'chirilmaydi — egasi nima qolganini ko'radi
    const left = parsed.items.length - sending.length + r.dropped;
    if (left) return notify(`${left} ta qator qo'shilmadi: profilda ko'pi bilan ${MAX_OFFERINGS} ta xizmat bo'ladi. Qolgani saqlandi.`, true);
    notify('Narxlar saqlandi');
    setText('');
  };
  return (
    <Card title={`Narxlar · ${brain.priced}`} description="Palantir narxni faqat shu ro'yxatdan aytadi — bo'lmasa sizdan so'raydi. Narxni o'zgartirish uchun shu nom bilan yangi qator tashlang (yoki yordamchiga ayting).">
      {brain.prices.length > 0 && (
        <ul className="mb-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-sm">
          {brain.prices.map(o => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="shrink-0 tabular-nums text-slate-600">{o.price ? money(o.price) : "narxi yo'q"}</span>
              <button type="button" aria-label={`Narxni o'chirish: ${o.name}`} className="text-slate-400 hover:text-rose-600" onClick={() => { void save(api.removePrice(o.id)); }}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="mb-1 block text-sm font-semibold" htmlFor="price-list">Narx ro'yxatini shu yerga tashlang</label>
      <textarea id="price-list" className={inputClass} rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={"Excel, Word yoki Telegram'dan nusxalang. Har qatorda — nom va narx:\nPlomba — 350 000\nImplant 4,5 mln\nKonsultatsiya — bepul"} />
      {parsed.items.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold">Shunday tushundim — tekshiring:</p>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-sm">
            {parsed.items.map((i, n) => <li key={n} className="flex justify-between gap-3 px-3 py-1.5"><span className="min-w-0 truncate">{i.name}</span><span className="shrink-0 tabular-nums text-slate-600">{money(i.price)}</span></li>)}
          </ul>
        </div>
      )}
      {parsed.items.some(i => !i.price) && <p className="mt-2 text-sm text-slate-500">Bepul xizmatlar narx emas, fakt bo'lib saqlanadi («… — bepul»).</p>}
      {parsed.unclear.length > 0 && <p className="mt-2 text-sm text-amber-700">Bu qatorlarni tushunmadim, ular saqlanmaydi: {parsed.unclear.slice(0, 5).map(l => `«${l}»`).join(', ')}{parsed.unclear.length > 5 ? ` va yana ${parsed.unclear.length - 5} ta` : ''}</p>}
      {parsed.items.length > 0 && <Button className="mt-3" variant="primary" onClick={() => { void submit(); }}>{parsed.items.length} ta narxni saqlash</Button>}
    </Card>
  );
}

function Style({ value, save }: { value: string; save: Save }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <Card title="Mijozlarga qanday yozay" description="O'z so'zingiz bilan: murojaat, uzunlik, nimani aytmaslik kerak.">
      <textarea className={inputClass} rows={2} value={text} onChange={e => setText(e.target.value)} aria-label="Yozish uslubi" maxLength={600} placeholder="Masalan: qisqa yoz, «siz»lab, emoji ishlatma. Narxni aytgach, qabulga taklif qil." />
      <Button className="mt-2" size="sm" disabled={text.trim() === value.trim()} onClick={() => { void save(api.setStyle(text.trim()), 'Saqlandi'); }}>Saqlash</Button>
    </Card>
  );
}

function Fixes({ items, save }: { items: Knowledge[]; save: Save }) {
  const waiting = items.filter(k => k.status === 'suggested');
  const learned = items.filter(k => k.status === 'active');
  return (
    <Card title="Tuzatishlaringiz" description="Men tayyorlagan javob o'rniga o'zingiz boshqacha yozgan holatlar. «O'rgan» desangiz, keyingi javoblarda hisobga olaman. Ichida shu mijozning ismi yoki unga atalgan va'da bo'lsa — «Kerak emas».">
      <ul className="space-y-1.5">
        {waiting.map(k => (
          <li key={k.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="text-slate-400 line-through decoration-slate-300">{k.question}</p>
            <p className="mt-1 whitespace-pre-wrap">{k.answer}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => { void save(api.editKnowledge(k.id, { remember: true }), "O'rgandim"); }}><Check className="h-4 w-4" /> O'rgan</Button>
              <Button size="sm" onClick={() => { void save(api.removeKnowledge(k.id)); }}>Kerak emas</Button>
            </div>
          </li>
        ))}
        {[...learned].reverse().map(k => (
          <Row key={k.id} label="tuzatish" onRemove={() => { void save(api.removeKnowledge(k.id)); }}>
            <p className="text-slate-400 line-through decoration-slate-300">{k.question}</p>
            <p className="whitespace-pre-wrap">{k.answer}</p>
          </Row>
        ))}
        {!items.length && <li className="text-sm text-slate-400">Hali yo'q. Tayyor javobni yubormasdan o'zingiz yozsangiz, farqi shu yerga tushadi.</li>}
      </ul>
    </Card>
  );
}

function Samples({ items, save }: { items: Knowledge[]; save: Save }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await save(api.addSample(title.trim(), text.trim()), 'Namuna saqlandi')) { setTitle(''); setText(''); }
  };
  return (
    <Card title="Hujjat namunalari" description="Shartnoma, tijorat taklifi, kafolat xati — o'zingiznikini tashlang. Hujjat so'rasangiz, Palantir shu namunaning tuzilishi va so'zlari bilan yozadi.">
      <ul className="mb-3 space-y-1.5">
        {items.map(k => <Row key={k.id} label={k.question} onRemove={() => { void save(api.removeKnowledge(k.id)); }}><p className="font-semibold">{k.question}</p><p className="truncate text-slate-500">{k.answer.slice(0, 140)}</p></Row>)}
        {!items.length && <li className="text-sm text-slate-400">Hali yo'q.</li>}
      </ul>
      <form onSubmit={e => { void add(e); }} className="space-y-2">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Nomi: masalan, Davolash shartnomasi" aria-label="Namuna nomi" maxLength={80} />
        <textarea className={inputClass} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Hujjat matnini shu yerga tashlang" aria-label="Namuna matni" maxLength={6000} />
        <Button type="submit" size="sm" disabled={title.trim().length < 2 || text.trim().length < 20}>Namunani saqlash</Button>
      </form>
    </Card>
  );
}
