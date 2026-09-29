import { useEffect, useState } from 'react';
import { Check, Loader2, Phone, RefreshCw } from 'lucide-react';
import type { Lead } from '../types';
import { api } from '../data/api';
import { Button, Card } from '../components/ui';

const when = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Postdagi havola orqali raqam qoldirganlar — administrator qo'ng'iroq qiladi */
export function LeadsPage({ onError }: { onError: (msg: string) => void }) {
  const [list, setList] = useState<Lead[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.leads().then(r => setList(r.leads)).catch(e => onError((e as Error).message));
  useEffect(() => { void load(); }, []);

  const mark = async (lead: Lead) => {
    setBusy(lead.id);
    const stage = lead.stage === 'called' ? 'contact' : 'called';
    try {
      await api.leadStage(lead.id, stage);
      setList(l => l?.map(x => (x.id === lead.id ? { ...x, stage } : x)) ?? null);
    } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };

  const waiting = list?.filter(l => l.stage === 'contact').length ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Murojaatlar</h1>
          <p className="text-sm text-slate-500">Postdagi havola orqali raqam qoldirganlar. Har biri Telegramingizga ham keladi.</p>
        </div>
        <Button onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Yangilash</Button>
      </header>

      {list === null ? (
        <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : list.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-700">Hali murojaat yo'q</p>
            <p className="mt-1">Post chiqqach, havolani bosib raqam qoldirganlar shu yerda paydo bo'ladi.</p>
          </div>
        </Card>
      ) : (
        <Card title={waiting ? `${waiting} ta murojaat qo'ng'iroq kutmoqda` : "Hammasiga qo'ng'iroq qilingan"}>
          <ul className="divide-y divide-slate-100">
            {list.map(l => (
              <li key={l.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${l.stage === 'called' ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{l.name || 'Ismi yo\'q'}{l.username && <span className="font-medium text-slate-400"> · @{l.username}</span>}</div>
                  <div className="text-xs text-slate-500">{when(l.createdAt)} · {l.source ? `«${l.source}» posti` : 'Umumiy havola'}</div>
                </div>
                {l.phone && (
                  <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 hover:bg-teal-100">
                    <Phone className="h-4 w-4" /> {l.phone}
                  </a>
                )}
                <Button size="sm" variant={l.stage === 'called' ? 'ghost' : 'secondary'} disabled={busy === l.id} onClick={() => mark(l)}>
                  {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {l.stage === 'called' ? "Qo'ng'iroq qilingan" : "Qo'ng'iroq qildim"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
