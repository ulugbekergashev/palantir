import { useRef, useState } from 'react';
import { AtSign, CheckCircle2, CircleAlert, CircleHelp, KeyRound, Link2, Loader2, Lock, Phone, Trash2, Video, type LucideIcon } from 'lucide-react';
import { adminApi, putKey } from '../../data/api';
import { Button, Card } from '../../components/ui';
import { KEYS, classifyText, maskSecret, type Classified, type KeyName } from '../../lib/secrets';
import type { KeyView } from '../../types';

/** Boshqa qadamga o'tkaziladigan narsalar: kalit emas, lekin o'rnatuvchi shu maydonga qo'ygan */
export interface Routed { crmUrl: string; crmPassword: string; phone: string; instagram: string; rtsp: string[] }
export const emptyRouted = (): Routed => ({ crmUrl: '', crmPassword: '', phone: '', instagram: '', rtsp: [] });

type LineResult = { state: 'checking' } | { state: 'ok'; text: string; warn?: string } | { state: 'bad'; text: string; canForce: boolean } | { state: 'routed'; text: string; label?: string } | { state: 'skipped' };

/** Tanilmagan qator: o'rnatuvchi nima ekanini o'zi ko'rsatadi */
const ASSIGN: { as: KeyName | 'crmPassword' | 'skip'; label: string }[] = [
  { as: 'crmPassword', label: 'DentaCRM paroli' },
  { as: 'TG_API_ID', label: 'Telegram API ID' },
  { as: 'VOICELAB_API_KEY', label: 'VoiceLab kaliti' },
  { as: 'SPEECHLAB_API_KEY', label: 'SpeechLab kaliti' },
  { as: 'skip', label: 'Kerak emas' },
];

const SAMPLE_HINT = "7412589630:AAH…        — Telegram bot tokeni\nsk-ant-…               — Claude kaliti\nrtsp://admin:…@192.168.1.64…   — kamera\nhttps://….dentacrm.uz  — DentaCRM";

export function StepKeys({ keys, onKeys, onRouted }: {
  keys: KeyView[] | null; onKeys: (k: KeyView[]) => void; onRouted: (change: (r: Routed) => Routed) => void;
}) {
  const [text, setText] = useState('');
  /** Tekshirilgan qatorlar: maydondan olinib, shu ro'yxatda (kalit — yashirin holda) qoladi */
  const [lines, setLines] = useState<Classified[]>([]);
  const [results, setResults] = useState<Record<string, LineResult>>({});
  const pasted = useRef(false);
  const set = (line: string, r: LineResult) => setResults(prev => ({ ...prev, [line]: r }));

  const saveKey = async (line: string, name: KeyName, force = false) => {
    set(line, { state: 'checking' });
    try {
      const r = await putKey(name, line, force);
      if (r.ok) {
        set(line, { state: 'ok', text: r.check.ok ? r.check.info : 'Saqlandi', warn: r.check.ok ? r.check.warn : r.check.error });
        onKeys((await adminApi.keys()).keys);
      } else set(line, { state: 'bad', text: r.error, canForce: r.canForce });
    } catch (e) {
      set(line, { state: 'bad', text: (e as Error).message, canForce: false });
    }
  };

  /** Kalit emas narsa — o'z qadamiga (DentaCRM, kamera, telefon, Instagram) */
  const route = (c: Classified): LineResult | null => {
    if (c.kind === 'crm') { onRouted(r => ({ ...r, crmUrl: c.line })); return { state: 'routed', text: "DentaCRM qadamiga o'tkazildi: login va parol o'sha yerda" }; }
    if (c.kind === 'rtsp') { onRouted(r => ({ ...r, rtsp: [...new Set([...r.rtsp, c.line])] })); return { state: 'routed', text: 'Kameralar qadamida ulanadi' }; }
    if (c.kind === 'phone') { onRouted(r => ({ ...r, phone: c.line })); return { state: 'routed', text: "Shaxsiy Telegram qadamiga o'tkazildi: kod shu raqamga keladi" }; }
    if (c.kind === 'instagram') { onRouted(r => ({ ...r, instagram: c.line })); return { state: 'routed', text: 'Instagram qadamida egasi kiradi' }; }
    return null;
  };

  /** Maydondagi qatorlar: kalit — serverda tekshiriladi, boshqasi — o'z qadamiga. Maydon bo'shatiladi: kalit ekranda ochiq turmasin */
  const checkAll = (source = text) => {
    // Xato bo'lgan qator qayta qo'yilsa (internet qaytdi) — yana tekshiriladi
    const fresh = classifyText(source).filter(c => !lines.some(l => l.line === c.line) || results[c.line]?.state === 'bad');
    setLines(prev => [...prev, ...fresh.filter(c => !prev.some(l => l.line === c.line))]);
    setText('');
    for (const c of fresh) {
      if (c.error) { set(c.line, { state: 'bad', text: c.error, canForce: false }); continue; }
      if (c.kind === 'key' && c.key) { void saveKey(c.line, c.key); continue; }
      const r = route(c);
      if (r) set(c.line, r);
    }
  };

  const assign = (line: string, as: KeyName | 'crmPassword' | 'skip') => {
    if (as === 'skip') return set(line, { state: 'skipped' });
    if (as === 'crmPassword') { onRouted(r => ({ ...r, crmPassword: line })); return set(line, { state: 'routed', label: 'DentaCRM paroli', text: "Ulash qadamida o'zi qo'yiladi (saqlanmaydi)" }); }
    void saveKey(line, as);
  };

  const [removeError, setRemoveError] = useState('');
  const remove = async (name: KeyName) => {
    try {
      await adminApi.removeKey(name);
      onKeys((await adminApi.keys()).keys);
      setRemoveError('');
    } catch (e) { setRemoveError((e as Error).message); }
  };

  const required = (keys ?? []).filter(k => k.required);
  return (
    <div className="space-y-4">
      <Card>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Nimani topgan bo'lsangiz, shu yerga qo'ying — har biri yangi qatorda</span>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); if (pasted.current) { pasted.current = false; checkAll(e.target.value); } }}
            onPaste={() => { pasted.current = true; }}
            spellCheck={false}
            rows={7}
            placeholder={SAMPLE_HINT}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-[13px] leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => checkAll()} disabled={!text.trim()}>Tekshirish</Button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Turi qolip bo'yicha aniqlanadi — kalit AI'ga yuborilmaydi. Saqlanganlari shifrlanib faqat shu kompyuterda turadi.</p>
        </div>
      </Card>

      {lines.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {lines.map(c => <LineRow key={c.line} c={c} r={results[c.line]} onForce={() => c.key && saveKey(c.line, c.key, true)} onAssign={as => assign(c.line, as)} />)}
        </ul>
      )}

      <Card title="Server kalitlari" description="Bitta kompyuter — bitta bot. Kalitni almashtirish uchun yangisini yuqoriga qo'ying: server to'xtamaydi.">
        {removeError && <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{removeError}</p>}
        {!keys ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Majburiy: {required.map(k => (
                <span key={k.name} className={`mr-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${k.source ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {k.source ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : null}{k.label}
                </span>
              ))}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {KEYS.map(info => {
                    const k = keys.find(x => x.name === info.name);
                    return (
                      <tr key={info.name}>
                        <td className="py-2.5 pr-3"><span className="font-semibold">{info.label}</span><span className="block text-xs text-slate-400">{info.where}</span></td>
                        <td className="pr-3 font-mono text-xs text-slate-600">{k?.masked ?? '—'}</td>
                        <td className="pr-3">{k?.source === 'panel' ? <Badge tone="ok">panelda</Badge> : k?.source === 'env' ? <Badge tone="info">.env faylida</Badge> : <Badge tone="none">berilmagan</Badge>}</td>
                        <td className="text-right">{k?.source === 'panel' && <Button size="sm" variant="danger" onClick={() => remove(info.name)} aria-label={`${info.label}ni o'chirish`}><Trash2 className="h-3.5 w-3.5" /> O'chirish</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Ekranda: kalit va parol yashirin, kamera manzilida — faqat paroli; havola, telefon va sahifa — o'zicha */
const shown = (c: Classified): string => (c.kind === 'unknown' ? '•'.repeat(Math.min(c.line.length, 12)) : c.kind === 'key' || c.kind === 'rtsp' ? maskSecret(c.line) : c.line);

const KIND_ICON: Record<Classified['kind'], LucideIcon> = { key: KeyRound, rtsp: Video, crm: Link2, phone: Phone, instagram: AtSign, unknown: KeyRound };

function Badge({ tone, children }: { tone: 'ok' | 'info' | 'none'; children: string }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : tone === 'info' ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-100 text-slate-500';
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{children}</span>;
}

function LineRow({ c, r, onForce, onAssign }: { c: Classified; r: LineResult | undefined; onForce: () => void; onAssign: (as: KeyName | 'crmPassword' | 'skip') => void }) {
  const unknown = c.kind === 'unknown' && !r;
  const bad = r?.state === 'bad';
  const tone = bad ? 'bg-rose-50 text-rose-700' : unknown ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700';
  const Icon = bad ? CircleAlert : unknown ? CircleHelp : KIND_ICON[c.kind];
  return (
    <li className="animate-rise grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sheet">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`} aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{r?.state === 'routed' && r.label ? r.label : c.label}</p>
        <p className="break-all font-mono text-xs text-slate-500">{shown(c)}</p>
        {r?.state === 'ok' && <p className="mt-0.5 text-sm text-slate-700">{r.text}{r.warn && <span className="block text-amber-700">{r.warn}</span>}</p>}
        {r?.state === 'routed' && <p className="mt-0.5 text-sm text-slate-700">{r.text}</p>}
        {r?.state === 'skipped' && <p className="mt-0.5 text-sm text-slate-500">Kerak emas deb belgilandi — saqlanmadi</p>}
        {bad && <p className="mt-0.5 text-sm text-rose-700">{r.text}</p>}
        {bad && r.canForce && <Button size="sm" className="mt-2" onClick={onForce}>Baribir saqlash</Button>}
        {unknown && (
          <div className="mt-1.5">
            <p className="text-sm text-slate-600">Bu qatorning turini tanimadim. Nima ekanini ko'rsating:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{ASSIGN.map(a => <Button key={a.as} size="sm" onClick={() => onAssign(a.as)}>{a.label}</Button>)}</div>
          </div>
        )}
      </div>
      <Status r={r} unknown={unknown} />
    </li>
  );
}

function Status({ r, unknown }: { r: LineResult | undefined; unknown: boolean }) {
  if (unknown) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">Bu nima?</span>;
  if (!r) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Tekshirilmagan</span>;
  if (r.state === 'checking') return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Tekshirilmoqda</span>;
  if (r.state === 'ok') return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">Ishlayapti</span>;
  if (r.state === 'bad') return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">Xato</span>;
  if (r.state === 'routed') return <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-800">O'tkazildi</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">O'tkazildi</span>;
}
