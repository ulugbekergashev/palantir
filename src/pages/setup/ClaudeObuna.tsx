import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../../data/api';
import { Button, ButtonLink, Card, Field, TextInput } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import type { ObunaStatus } from '../../types';

const PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', ultra: 'Ultra' };
const planName = (plan: string | null): string => `Claude ${plan ? PLANS[plan.toLowerCase()] ?? plan : ''}`.trim();
/** Kirish davom etayotganda holat shu oraliqda so'raladi: server kompyuterida brauzerda kirilsa — o'zi yangilanadi */
const POLL_MS = 2000;
const ALERT = 'rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700';

/**
 * Klinikaning o'z Claude obunasi (server/subscription/login.ts): kirish — server kompyuterida brauzer ochiladi yoki boshqa
 * qurilmada havolani ochib, ko'rsatilgan kod shu yerga qo'yiladi. Kirilgach AI o'zi obunaga o'tadi. onChange — kalitlar ro'yxati
 * yangilansin (obunada Claude kaliti majburiy emas)
 */
export function ClaudeObuna({ onChange }: { onChange: () => void }) {
  const [s, setS] = useState<ObunaStatus | null>(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (fresh = false) => {
    try {
      setS(await api.obuna(fresh));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let gone = false;
    api.obuna(true).then(r => { if (!gone) setS(r); }, (e: Error) => { if (!gone) setError(e.message); });
    return () => { gone = true; };
  }, []);

  const running = !!s?.login?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);
  // Kirish tugadi (kirildi yoki xato) — kalitlar ro'yxati ham yangilanadi
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onChange();
    wasRunning.current = running;
  }, [running, onChange]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load(true);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sendCode = () => act(async () => { await api.obunaCode(code.trim()); setCode(''); });
  const copyLink = (url: string) => copyText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => setError(`Nusxalanmadi — havolani qo'lda oling: ${url}`));

  return (
    <Card title="Claude obunasi" description="AI klinikaning o'z Claude obunasida ishlaydi (Pro, Max yoki Team) — API kalit shart emas. Obuna claude.ai saytida olinadi.">
      <div data-testid="claude-obuna" className="space-y-3">
        {error && <p role="alert" className={ALERT}>{error}</p>}
        {!s ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Yuklanmoqda" />
          : !s.available ? <p role="alert" className={ALERT}>Claude dasturi topilmadi — Palantir'ni qayta o'rnating.</p>
          : running ? (
            <div className="space-y-3" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> Server kompyuterida brauzer ochildi — o'sha yerda klinikaning Claude akkauntiga kiring.
              </p>
              {s.login?.url && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-sm text-slate-700">Boshqa kompyuter yoki telefondan: havolani oching, kirgach sahifa ko'rsatgan kodni shu yerga qo'ying.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ButtonLink size="sm" href={s.login.url} target="_blank" rel="noopener noreferrer">Havolani ochish <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></ButtonLink>
                    <Button size="sm" onClick={() => s.login?.url && copyLink(s.login.url)}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? 'Nusxalandi' : 'Havolani nusxalash'}</Button>
                  </div>
                  <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={e => { e.preventDefault(); void sendCode(); }}>
                    <Field label="Sahifa ko'rsatgan kod"><TextInput value={code} onChange={e => setCode(e.target.value)} spellCheck={false} autoComplete="off" /></Field>
                    <Button type="submit" variant="primary" disabled={busy || !code.trim()}>Kodni yuborish</Button>
                  </form>
                </div>
              )}
              <Button size="sm" variant="ghost" onClick={() => act(api.obunaCancel)} disabled={busy}>Bekor qilish</Button>
            </div>
          ) : s.loggedIn ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Kirilgan: {planName(s.plan)}{s.email ? ` · ${s.email}` : ''}
              </p>
              {!s.plan && <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Bu akkauntda pullik obuna ko'rinmadi — Pro, Max yoki Team kerak, aks holda AI javob bermaydi.</p>}
              <p className="text-sm text-slate-700">{s.engine === 'subscription' ? 'AI shu obuna orqali ishlayapti.' : 'AI hozir API kalit bilan ishlayapti.'}</p>
              <div className="flex flex-wrap gap-2">
                {s.engine === 'api' && <Button variant="primary" onClick={() => act(() => api.setAiEngine('subscription'))} disabled={busy}>Obuna orqali ishlasin</Button>}
                {s.engine === 'subscription' && s.apiKey && <Button onClick={() => act(() => api.setAiEngine('api'))} disabled={busy}>API kalitga o'tish</Button>}
                <Button variant="ghost" onClick={() => act(api.obunaLogin)} disabled={busy}>Boshqa akkauntga kirish</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {s.login?.error && <p role="alert" className={ALERT}>Kirilmadi: {s.login.error}</p>}
              <p className="text-sm text-slate-600">Klinika claude.ai saytida obuna oladi, keyin shu tugma bilan kiradi — server kompyuterida brauzer ochiladi.</p>
              <Button variant="primary" onClick={() => act(api.obunaLogin)} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Claude obunasiga kirish
              </Button>
            </div>
          )}
      </div>
    </Card>
  );
}
