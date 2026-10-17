import { useEffect, useState } from 'react';
import type { Doc } from '../types';
import { api } from '../data/api';
import { DocCard, type Notify } from '../components/Artifacts';
import { Card } from '../components/ui';
import { shortDate } from '../lib/week';

/** Yordamchi tayyorlagan hujjatlar — Ikkinchi miya ichida. Word fayli shu yerdan yuklanadi; matni papkaning «Hujjatlar» bo'limida ham turadi */
export function DocumentsCard({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Doc[] | null>(null);
  useEffect(() => { api.documents().then(r => setList(r.documents)).catch(e => notify((e as Error).message, true)); }, []);
  if (!list) return null;
  return (
    <Card title={`Hujjatlar${list.length ? ` (${list.length})` : ''}`} description="Yordamchi tayyorlagan shartnoma, taklif, hisob va xatlar. Word faylini yuklab oling; matni papkaning «Hujjatlar» bo'limida ham turadi.">
      {!list.length ? <p className="text-sm text-slate-500">Hali hujjat yo'q. Yordamchiga ayting: «Aliyevga 20 ta stol uchun tijorat taklifi tayyorla».</p> : (
        <ul className="space-y-3">
          {list.map(d => (
            <li key={d.id}>
              <div className="mb-1 text-xs text-slate-400">{shortDate(d.createdAt)}</div>
              <DocCard doc={d} notify={notify} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
