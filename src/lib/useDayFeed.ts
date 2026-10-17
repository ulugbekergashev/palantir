import { useEffect, useState } from 'react';
import type { Notify } from '../components/Artifacts';
import { api } from '../data/api';
import type { BrainView, Call, CameraSummary, InboxThread } from '../types';
import { buildJournal, type Journal } from './journal';
import { iso } from './week';

/** Kunning manbalari: jurnal (kutayotgan ishlar va bugungi voqealar) va u yig'ilgan xom ma'lumot */
export interface DayFeed { journal: Journal; calls: Call[]; summary: CameraSummary | null; brain: BrainView | null }

/** Manbalarning oxirgi muvaffaqiyatli javoblari */
interface Sources { calls: Call[]; summary: CameraSummary | null; threads: InboxThread[]; brain: BrainView | null; followups: number }

const FEED_POLL_MS = 15_000;
const NOTHING: Sources = { calls: [], summary: null, threads: [], brain: null, followups: 0 };

/**
 * Jurnal va bosh sahifa bitta manbadan o'qiydi: qo'ng'iroqlar, kamera hisobi, yozishmalar, ikkinchi miya va tayyor xabarlar.
 * Bitta manba javob bermasa ham qolgani ko'rsatiladi va o'sha manbaning oxirgi ma'lum holati joyida qoladi
 * (bir marta uzilgan so'rov «sizdan hech narsa kutilmayapti» degan yolg'on xotirjamlikni bermasin); xato bir marta aytiladi. Yuklanguncha — null.
 */
export function useDayFeed(notify: Notify): DayFeed | null {
  const [feed, setFeed] = useState<DayFeed | null>(null);
  useEffect(() => {
    let shown = false, gone = false, loading = false, last = NOTHING;
    const part = <T,>(p: Promise<T>) => p.catch(e => { if (!shown && !gone) { shown = true; notify((e as Error).message, true); } return null; });
    const load = async () => {
      // Oldingi so'rov hali yo'lda bo'lsa yangisi boshlanmaydi: kechikkan eski javob yangisini bosib ketmasin
      if (loading) return;
      loading = true;
      const [calls, summary, threads, brain, followups] = await Promise.all([
        part(api.calls().then(r => r.calls)),
        part(api.cameraSummary().then(r => r.summary)),
        part(api.inbox().then(r => r.threads)),
        part(api.brain().then(r => r.brain)),
        part(api.followups().then(r => r.followups.filter(f => f.status === 'draft').length)),
      ]);
      loading = false;
      if (gone) return;
      last = { calls: calls ?? last.calls, summary: summary ?? last.summary, threads: threads ?? last.threads, brain: brain ?? last.brain, followups: followups ?? last.followups };
      const toRemember = last.brain ? last.brain.suggested.length + last.brain.fixes.filter(f => f.status === 'suggested').length : 0;
      setFeed({ journal: buildJournal(last.calls, last.summary, last.threads, iso(new Date()), toRemember, last.followups), calls: last.calls, summary: last.summary, brain: last.brain });
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, FEED_POLL_MS);
    return () => { gone = true; clearInterval(t); };
  }, []);
  return feed;
}
