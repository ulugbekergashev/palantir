/**
 * Ruxsatlar jadvali (src/lib/permissions.ts): AI jamoa nima qila oladi — har amal uchun «Ruxsat / So'rasin / Hech qachon».
 * Tepada — egasining javobini kutayotgan so'rovlar (Telegram'dagi «✅ Ha / ✖️ Yo'q» bilan bir xil), pastda — kodda qattiq qoidalar
 * (pul zonasi va boshqalar) va «Mijozlarga javob» rejimi: u Asosiy bo'limida o'zgartiriladi (bilim yetishmasa ogohlantirish o'sha yerda).
 * O'zgartirish — faqat egasi (server 403 qaytarsa — tushuntiriladi).
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { api, type PermissionApproval, type PermissionsView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import type { Business, ReplyMode } from '../../types';
import { PERM_LABEL, PERM_LEVELS, type PermLevel } from '../../lib/permissions';
import { CREW } from '../../lib/crew';
import { TEAM } from '../../components/team';
import { hrefOf } from '../../lib/nav';

const TONE: Record<PermLevel, string> = {
  allow: 'border-emerald-400/50 bg-emerald-400/[0.12] text-emerald-700',
  ask: 'border-[#ff9a3c]/50 bg-[#ff9a3c]/[0.12] text-[#ffd7ad]',
  never: 'border-rose-500/50 bg-rose-500/[0.12] text-rose-700',
};
const REPLY_LEVEL: Record<ReplyMode, PermLevel> = { auto: 'allow', draft: 'ask', off: 'never' };
const REPLY_TEXT: Record<ReplyMode, string> = { auto: "O'zi javob beradi", draft: 'Javobni siz tasdiqlaysiz', off: "Javob tayyorlamaydi" };

function Badge({ level, text }: { level: PermLevel; text?: string }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${TONE[level]}`}>{text ?? PERM_LABEL[level]}</span>;
}

function Pending({ items, busy, onDecide }: { items: PermissionApproval[]; busy: string | null; onDecide: (id: string, yes: boolean) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-5 rounded-2xl border border-[#ff9a3c]/30 bg-[#ff9a3c]/[0.06] p-4">
      <h4 className="text-[14px] font-semibold text-[#ffd7ad]">Javobingizni kutyapti — {items.length} ta</h4>
      <ul className="mt-3 flex flex-col gap-2.5">
        {items.map(a => (
          <li key={a.id} className="rounded-xl border border-glass/[0.07] bg-[#0b0c10] p-3.5">
            <p className="text-[13.5px] font-semibold text-[#f2f0ea]">{TEAM[a.member].name}: {a.title}</p>
            {a.details.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-snug text-[#a3a9b5]">{a.details.map(d => <li key={d} className="break-words">{d}</li>)}</ul>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => onDecide(a.id, true)} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-[#3fd6c3] px-3.5 text-[13px] font-semibold text-[#07080b] disabled:opacity-50">
                {busy === `${a.id}:yes` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}Ha, bajarsin
              </button>
              <button type="button" disabled={!!busy} onClick={() => onDecide(a.id, false)} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-glass/10 px-3.5 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">
                <X className="h-4 w-4" aria-hidden="true" />Yo'q
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Permissions({ biz, notify }: { biz: Business; notify: Notify }) {
  const [view, setView] = useState<PermissionsView | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.permissions().then(setView).catch(e => setClosed((e as Error).message)); }, []);
  if (closed) return <p className="text-[13px] text-[#8a909c]">{closed}</p>;
  if (!view) return <p className="text-[13px] text-[#8a909c]">Yuklanmoqda…</p>;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const choose = (action: string, level: PermLevel) => run(`${action}:${level}`, async () => { setView(await api.setPermission(action, level)); });
  const decide = (id: string, yes: boolean) => run(`${id}:${yes ? 'yes' : 'no'}`, async () => {
    const r = await api.decidePermission(id, yes);
    setView(r);
    notify(r.text, !r.ok);
  });
  const groups = CREW.map(m => ({ member: m, rows: view.actions.filter(a => a.member === m) })).filter(g => g.rows.length);
  const reply = biz.autoReply?.mode ?? 'draft';

  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <h3 className="flex items-center gap-2 text-[16px] font-semibold text-[#f2f0ea]"><ShieldCheck className="h-[18px] w-[18px] text-[#3fd6c3]" aria-hidden="true" />AI nima qila oladi</h3>
      <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">
        Har ish uchun tanlang: <b className="text-emerald-700">Ruxsat</b> — o'zi bajaradi, <b className="text-[#ffd7ad]">So'rasin</b> — oldin Telegram'da sizdan so'raydi, <b className="text-rose-700">Hech qachon</b> — bajarmaydi.
      </p>

      <div className="mt-4">
        <Pending items={view.pending} busy={busy} onDecide={(id, yes) => { void decide(id, yes); }} />
      </div>

      <div className="flex flex-col gap-5">
        {groups.map(g => {
          const Icon = TEAM[g.member].icon;
          return (
            <div key={g.member}>
              <h4 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[#8a909c]"><Icon className="h-4 w-4" aria-hidden="true" />{TEAM[g.member].name}</h4>
              <ul className="mt-2 divide-y divide-glass/[0.06] rounded-2xl border border-glass/[0.07]">
                {g.rows.map(r => (
                  <li key={r.id} className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-[#f2f0ea]">{r.title}</span>
                      {r.hint && <span className="block text-[12px] leading-snug text-[#7d838f]">{r.hint}</span>}
                    </span>
                    <span role="radiogroup" aria-label={r.title} className="flex shrink-0 gap-1.5">
                      {PERM_LEVELS.filter(l => r.levels.includes(l)).map(l => {
                        const on = r.level === l;
                        return (
                          <button key={l} type="button" role="radio" aria-checked={on} disabled={!!busy}
                            onClick={() => { if (!on) void choose(r.id, l); }}
                            className={`flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-default ${on ? TONE[l] : 'border-glass/[0.08] text-[#a3a9b5] enabled:hover:bg-glass/[0.04]'}`}>
                            {busy === `${r.id}:${l}` && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{PERM_LABEL[l]}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <div>
          <h4 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[#8a909c]"><Lock className="h-4 w-4" aria-hidden="true" />Doimiy qoidalar</h4>
          <ul className="mt-2 divide-y divide-glass/[0.06] rounded-2xl border border-glass/[0.07]">
            <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block text-[13.5px] text-[#f2f0ea]">AI administrator: mijozlarga javob</span>
                <span className="block text-[12px] leading-snug text-[#7d838f]">{REPLY_TEXT[reply]} — <a href={hrefOf('sozlamalar', 'asosiy')} className="text-[#3fd6c3] underline-offset-2 hover:underline">Asosiy bo'limida o'zgartiriladi</a></span>
              </span>
              <Badge level={REPLY_LEVEL[reply]} />
            </li>
            {view.fixed.map(f => (
              <li key={f.title} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block text-[13.5px] text-[#f2f0ea]">{f.title}</span>
                  <span className="block text-[12px] leading-snug text-[#7d838f]">{f.why}</span>
                </span>
                <Badge level={f.level} text={f.level === 'ask' ? "Doim so'raydi" : f.level === 'allow' ? 'Doim ochiq' : 'Hech qachon'} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
