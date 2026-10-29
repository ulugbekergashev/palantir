/**
 * AI bosh ekran (#/ai): egasi qo'l bilan emas, ovoz bilan ishlaydi. Markazda Palantir — bosing va gapiring: jonli suhbat
 * (Gemini Live, telefondagi yordamchining o'zi), javob ovozda va ekranda; asbob natijasi (vazifalar, Palantir javobi) karta bo'lib chiqadi.
 * Pastda AI jamoa — Qabulxona, Yordamchi, Kuzatuvchi, Tahlilchi: har biri hozir nima qilayotgani haqiqiy ma'lumotdan.
 * Kartani bosish — o'sha xodimning sahifasi (qobiq: LiveApp, chap ustun — Rail). O'rtada «Sizni kutyapti» — hamma xodimdan egasining qarorini
 * kutayotganlar (components/Attention.tsx).
 */
import { useState, type FormEvent } from 'react';
import { ArrowUp, Mic, Sparkles, Square } from 'lucide-react';
import type { Business, LiveStatus } from '../types';
import { MEMBERS, TEAM, type Member, type MemberState } from '../components/team';
import { hrefOf } from '../lib/nav';
import { api } from '../data/api';
import { Markdown } from '../components/Markdown';
import { useVoice, type VoiceMode } from '../lib/useVoice';
import { Attention } from '../components/Attention';
import { dotClass } from '../components/agent';
import { TeamDay } from '../components/TeamDay';
import type { Notify } from '../components/Artifacts';

const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const SUGGESTIONS = ['Bugun nima ishlarim bor?', 'Ertaga kim yozilgan?', 'Kecha nechta qo‘ng‘iroq bo‘ldi?', 'Ertaga 10 da eslat'];
const STATE_TEXT: Record<VoiceMode, string> = {
  idle: 'Bosing va gapiring',
  connecting: 'Ulanmoqda…',
  listening: 'Eshityapman',
  thinking: 'Bajaryapman…',
  speaking: 'Palantir gapiryapti',
};

const greeting = (h: number) => (h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech');

export function AiPage({ biz, now, team, notify, tick, onChanged }: { biz: Business; status: LiveStatus; now: Date; team: Record<Member, MemberState> | null; notify: Notify; tick: number; onChanged: () => void }) {
  const { mode, active, you, ai, cards, error, toggle, orb, push, setYou, setAi, setError, nextId } = useVoice('owner');
  const [typed, setTyped] = useState('');
  const [busyText, setBusyText] = useState(false);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busyText) return;
    setBusyText(true);
    setYou(q);
    setAi('');
    try {
      const r = await api.say(q);
      const answer = [...r.entries].reverse().find(x => x.role === 'assistant');
      if (answer) { setAi(''); push({ id: nextId(), kind: 'answer', title: 'Palantir', body: answer.text }); }
      setTyped('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyText(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(typed); };

  const owner = (biz.ownerName || '').split(' ')[0];

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#06070a] text-[#f2f0ea] lg:min-h-dvh">
      {/* Fon: sfera atrofidagi juda yumshoq nur */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[38%] h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,127,255,0.16),transparent)]" />

      <header className="relative z-10 flex items-center justify-end px-5 py-4 sm:px-8">
        <span className="tabular-nums text-xs tracking-wider text-[#9ba1ad]">{WEEKDAYS[now.getDay()].toUpperCase()} · {now.getDate()} {MONTHS[now.getMonth()].toUpperCase()}</span>
      </header>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-5 pb-10 sm:px-8">
        <p className="mt-1 text-center text-sm text-[#9ba1ad] sm:mt-8">{greeting(now.getHours())}{owner ? `, ${owner}` : ''}</p>

        {/* Sfera — Palantir'ning o'zi. Bosish: suhbatni boshlash / tugatish */}
        <button
          type="button"
          onClick={() => { void toggle(); }}
          aria-pressed={active}
          aria-label={active ? 'Suhbatni tugatish' : 'Palantir bilan gaplashish'}
          className="group relative mt-4 flex h-40 w-40 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#a9aaff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#06070a] sm:mt-6 sm:h-64 sm:w-64"
        >
          <div
            ref={orb}
            aria-hidden="true"
            style={{ transform: 'scale(calc(1 + var(--mic, 0) * 0.16 + var(--ai, 0) * 0.08))', filter: 'brightness(calc(1 + var(--ai, 0) * 0.5))' }}
            className={`absolute inset-0 rounded-full transition-transform duration-100 ${active ? '' : 'opacity-80 group-hover:opacity-100'}`}
          >
            <div className="absolute inset-0 animate-[spin_14s_linear_infinite] motion-reduce:animate-none rounded-full bg-[conic-gradient(from_0deg,#6f73ff,#b38cff,#3fd6c3,#6f73ff)] blur-2xl opacity-60" />
            <div className="absolute inset-3 animate-[spin_22s_linear_infinite_reverse] motion-reduce:animate-none rounded-full bg-[radial-gradient(circle_at_30%_30%,#c9caff,#6f73ff_45%,#24205a_80%)]" />
            <div className="absolute inset-3 rounded-full bg-[radial-gradient(circle_at_70%_75%,rgba(63,214,195,0.55),transparent_55%)] mix-blend-screen" />
            <div className="absolute inset-3 rounded-full ring-1 ring-glass/15" />
          </div>
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(0_0_0/0.25)] backdrop-blur-sm">
            {mode === 'idle' ? <Mic className="h-6 w-6" aria-hidden="true" /> : <Square className="h-5 w-5 fill-current" aria-hidden="true" />}
          </span>
        </button>

        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#c9cbd2] sm:mt-6" aria-live="polite">
          {active && <span className={`h-2 w-2 rounded-full ${mode === 'thinking' ? 'bg-amber-400' : mode === 'connecting' ? 'bg-glass/40' : 'bg-emerald-400'} shadow-[0_0_0_4px_rgba(52,211,153,0.15)]`} aria-hidden="true" />}
          {busyText ? 'Bajaryapman…' : STATE_TEXT[mode]}
        </p>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-4 py-2 text-sm text-rose-700">{error}</p>}

        {/* Jonli matn: siz nima dedingiz — Palantir nima deyapti */}
        <section aria-live="polite" className="mt-5 flex w-full max-w-3xl flex-col items-center gap-3 text-center sm:mt-8 sm:min-h-28">
          {you && <p className="text-base text-[#9ba1ad]">«{you}»</p>}
          {ai && <p className="text-2xl font-semibold leading-snug tracking-tight sm:text-[28px]">{ai}</p>}
          {!you && !ai && (
            // Telefonda bitta suriladigan qator: to'rt qator bo'lib «Sizni kutyapti»ni ekrandan siqib chiqarmasin
            <div className="-mx-5 flex w-[calc(100%+2.5rem)] gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => { void ask(s); }} className="min-h-11 shrink-0 whitespace-nowrap rounded-full border border-glass/10 px-4 text-sm text-[#c9cbd2] transition-colors hover:bg-glass/5">{s}</button>
              ))}
            </div>
          )}
        </section>

        {/* Natijalar: asbob nima qildi — ro'yxat, eslatma, Palantir javobi */}
        {cards.length > 0 && (
          <section aria-label="Natijalar" className="mt-6 grid w-full max-w-3xl gap-3">
            {cards.map(c => (
              <article key={c.id} className={`animate-rise rounded-2xl border px-5 py-4 text-left ${c.kind === 'working' ? 'border-amber-300/20 bg-amber-300/[0.06]' : 'border-glass/10 bg-glass/[0.04]'}`}>
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#9ba1ad]">
                  {c.kind === 'working' && <Sparkles className="h-3.5 w-3.5 animate-pulse text-amber-700" aria-hidden="true" />}{c.title}
                </h3>
                {c.items && (
                  <ul className="mt-3 flex flex-col divide-y divide-glass/5">
                    {c.items.map((it, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-4 py-2 text-[15px]">
                        <span>{it.title}</span>{it.when && <span className="shrink-0 tabular-nums text-xs text-[#9ba1ad]">{it.when}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {c.body && (c.kind === 'answer' ? <Markdown text={c.body} className="mt-2 text-[15px] leading-relaxed text-[#e4e3de]" /> : <p className="mt-2 text-[15px] text-[#e4e3de]">{c.body}</p>)}
              </article>
            ))}
          </section>
        )}

        {/* Ovoz noqulay bo'lsa — yozib so'rash */}
        <form onSubmit={submit} className="mt-5 flex w-full max-w-2xl sm:mt-8 items-center gap-2 rounded-2xl border border-glass/10 bg-glass/[0.03] p-1.5 pl-4 focus-within:border-glass/25">
          <label htmlFor="ai-ask" className="sr-only">Palantir'ga yozing</label>
          <input id="ai-ask" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Yoki yozing: «Akmalga ertaga qo‘ng‘iroq qilishni eslat»" className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f]" />
          <button type="submit" disabled={!typed.trim() || busyText} aria-label="Yuborish" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8b8cff] text-[#06070a] transition-opacity disabled:opacity-40">
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
          </button>
        </form>

        {/* Hamma xodimdan sizning qaroringizni kutayotganlar — bitta joyda */}
        <Attention notify={notify} tick={tick} onChanged={onChanged} />

        {/* AI jamoa — har biri o'z ishida */}
        <section aria-label="AI jamoa" className="mt-14 w-full">
          <h2 className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[#9ba1ad]">Sizning AI jamoangiz</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MEMBERS.map(m => {
              const meta = TEAM[m], st = team?.[m];
              return st ? (
                <a key={m} href={hrefOf(m)} className="group flex flex-col gap-3 rounded-2xl border border-glass/10 bg-glass/[0.03] p-4 text-left no-underline transition-colors hover:border-glass/20 hover:bg-glass/[0.06]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#8b8cff]/15 text-[#c7c8ff]"><meta.icon className="h-5 w-5" aria-hidden="true" /></span>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[15px] font-semibold text-[#f2f0ea]">{meta.name}</span>
                      <span className="truncate text-xs text-[#9ba1ad]">{meta.role}</span>
                    </div>
                    {st.badge > 0 && <span className="ml-auto rounded-full bg-[#f5b454] px-2 py-0.5 text-xs font-bold text-[#06070a]">{st.badge}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[#e4e3de]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(st)}`} aria-hidden="true" />{st.status}
                  </div>
                  <p className="m-0 text-xs leading-relaxed text-[#9ba1ad]">{st.detail}</p>
                </a>
              ) : <div key={m} className="h-[132px] animate-pulse rounded-2xl border border-glass/5 bg-glass/[0.02]" />;
            })}
          </div>
        </section>

        {/* Har xodimning bugungi ishi va bugungi jurnal */}
        <TeamDay tick={tick} />
      </main>
    </div>
  );
}
