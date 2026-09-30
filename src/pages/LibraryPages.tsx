import { useEffect, useState } from 'react';
import { FileText, Image, Loader2 } from 'lucide-react';
import type { Business, Doc, LiveStatus, Post } from '../types';
import { api } from '../data/api';
import { DocCard, PostCard, type Notify } from '../components/Artifacts';
import { Card } from '../components/ui';
import { shortDate } from '../lib/week';

export function DocumentsPage({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Doc[] | null>(null);
  useEffect(() => { api.documents().then(r => setList(r.documents)).catch(e => notify((e as Error).message, true)); }, []);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Hujjatlar</h1>
        <p className="text-sm text-slate-500">Yordamchi tayyorlagan shartnoma, taklif, hisob va xatlar. Word faylini yuklab olib, kerak bo'lsa tahrirlang.</p>
      </header>
      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !list.length ? (
        <Card><p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-slate-500"><FileText className="h-5 w-5 shrink-0" /> Hali hujjat yo'q. Yordamchiga ayting: «Aliyevga 20 ta stol uchun tijorat taklifi tayyorla».</p></Card>
      ) : (
        <div className="space-y-3">
          {list.map(d => (
            <div key={d.id}>
              <div className="mb-1 text-xs text-slate-400">{shortDate(d.createdAt)}</div>
              <DocCard doc={d} notify={notify} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PostsPage({ biz, status, notify }: { biz: Business; status: LiveStatus; notify: Notify }) {
  const [list, setList] = useState<Post[] | null>(null);
  useEffect(() => { api.posts().then(r => setList(r.posts)).catch(e => notify((e as Error).message, true)); }, []);
  const shown = (list ?? []).filter(p => p.status !== 'deleted');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Postlar</h1>
        <p className="text-sm text-slate-500">Brendingiz rangida tayyorlangan rasm va matn. Kanalga bir tugma bilan joylanadi; Instagram uchun PNG yuklab oling.</p>
      </header>
      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !shown.length ? (
        <Card><p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-slate-500"><Image className="h-5 w-5 shrink-0" /> Hali post yo'q. Yordamchiga ayting: «Yangi mahsulotimiz haqida post qil».</p></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(p => (
            <PostCard key={p.id} post={p} biz={biz} channel={status.channel?.title ?? null} notify={notify}
              onChange={u => setList(prev => prev?.map(x => (x.id === u.id ? u : x)) ?? prev)} />
          ))}
        </div>
      )}
    </div>
  );
}
