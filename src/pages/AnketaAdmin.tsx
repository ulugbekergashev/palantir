import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../data/api';
import { Button, Card, Field, TextInput } from '../components/ui';
import type { AnketaView } from '../types';

const STATUS: Record<AnketaView['status'], { text: string; cls: string }> = {
  new: { text: 'ochilmagan', cls: 'bg-slate-100 text-slate-600' },
  draft: { text: "to'ldirilmoqda", cls: 'bg-amber-50 text-amber-800' },
  done: { text: 'yuborilgan', cls: 'bg-emerald-50 text-emerald-800' },
};

/** Admin: o'rnatishdan oldin egasiga yuboriladigan anketalar (havola + kod). Klinika kompyuterida kod bilan yuklanadi */
export function AnketaAdmin({ onError, onInfo }: { onError: (e: unknown) => void; onInfo: (text: string) => void }) {
  const [list, setList] = useState<AnketaView[] | null>(null);
  const [form, setForm] = useState({ label: '', industry: 'stomatologiya' });
  const [busy, setBusy] = useState(false);
  const load = () => adminApi.anketas().then(r => setList(r.anketas)).catch(onError);
  useEffect(() => { void load(); }, []);

  const link = (code: string) => `${window.location.origin}/#/anketa/${code}`;
  const copy = (a: AnketaView) => {
    const text = `Assalomu alaykum! Cerebro'ni o'rnatishdan oldin shu anketani to'ldiring (10–15 daqiqa, telefondan ham bo'ladi):\n${link(a.code)}\nKod: ${a.code}`;
    void navigator.clipboard?.writeText(text).then(() => onInfo('Xabar nusxalandi — egasiga Telegram\'da yuboring'), () => onInfo(link(a.code)));
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { anketa } = await adminApi.newAnketa(form.label.trim(), form.industry.trim());
      setForm({ label: '', industry: form.industry });
      await load();
      copy(anketa);
    } catch (err) { onError(err); } finally { setBusy(false); }
  };
  const remove = async (code: string) => {
    try { await adminApi.removeAnketa(code); await load(); } catch (err) { onError(err); }
  };

  return (
    <Card title="Anketalar" description="O'rnatishdan oldin: anketa yarating va havolani egasiga yuboring. U manzil, ish vaqti, narxlar va savollarga javoblarni yozadi. Klinikada ulash ustasi kod bilan yuklaydi. Bu sahifa tashqaridan (internetdan) ochiladigan serverda bo'lishi kerak.">
      <form onSubmit={create} className="mb-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
        <Field label="Anketa: klinika nomi"><TextInput value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Shifo Dent" required /></Field>
        <Field label="Anketa: faoliyat turi"><TextInput value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Anketa yaratish</Button>
      </form>
      {!list ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : list.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">Hali anketa yo'q</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-400"><tr><th className="py-2 pr-3">Klinika</th><th className="pr-3">Kod</th><th className="pr-3">Holat</th><th className="pr-3">O'zgargan</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map(a => (
                <tr key={a.code}>
                  <td className="py-2.5 pr-3 font-semibold">{a.label}</td>
                  <td className="pr-3 font-mono tracking-wider">{a.code}</td>
                  <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[a.status].cls}`}>{STATUS[a.status].text}</span></td>
                  <td className="pr-3 text-slate-500">{new Date(a.updatedAt).toLocaleDateString('uz-UZ')}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => copy(a)}><Copy className="h-3.5 w-3.5" /> Havola</Button>
                    <Button size="sm" variant="danger" onClick={() => remove(a.code)} aria-label={`${a.label} anketasini o'chirish`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
