/**
 * Brend-buk — to'liq brend-tizim ko'rinishida: muqova (brend ranglarida, video muqovasi namunasi bilan) va 6 bo'lim:
 * 01 Mohiyat · 02 Auditoriya · 03 Xabarlar · 04 Ovoz (diktor tanlovi shu yerda) · 05 Vizual · 06 Kontent.
 * Eski (qisqa) kitobda yangi bo'limlar bo'sh — tepada «qayta yarating» degan ogohlantirish chiqadi.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Check, Copy, Mic, Quote, X } from 'lucide-react';
import type { BrandBook } from '../../types';
import { api, type ContentView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { NARRATORS } from '../../lib/narrators';
import { H, W, drawFrame, loadFonts } from '../../lib/videoRender';
import { ACCENT, spin, useRun } from './Content';

type Props = { b: BrandBook; setView: (v: ContentView) => void; notify: Notify };
const head = (b: BrandBook) => ({ fontFamily: `"${b.font}", Manrope, sans-serif` });
const isFull = (b: BrandBook) => !!(b.essence || b.personas.length || b.hooks.length);

/** WCAG kontrasti (brend-buk bo'limida juftliklarni tekshirish uchun) */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function copy(text: string, notify: Notify) {
  try { await navigator.clipboard.writeText(text); notify('Nusxa olindi'); } catch { notify("Nusxa olib bo'lmadi — matnni belgilab oling", true); }
}

// ─── Qurilish bloklari ────────────────────────────────────────────────────────

function Section({ n, title, lead, children }: { n: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="border-t border-glass/[0.07] pt-6" aria-labelledby={`bb-${n}`}>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-[12px] tabular-nums text-[#7d838f]">{n}</span>
        <h3 id={`bb-${n}`} className="text-[19px] font-bold tracking-tight text-[#f2f0ea]">{title}</h3>
        {lead && <p className="hidden text-[13px] text-[#8a909c] md:block">— {lead}</p>}
      </div>
      {children}
    </section>
  );
}

const Label = ({ children }: { children: ReactNode }) => <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8a909c]">{children}</h4>;

function Bullets({ items, tone = 'plain' }: { items: string[]; tone?: 'plain' | 'quote' }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-[#e4e3de]">
      {items.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#7d838f]" aria-hidden="true" />{tone === 'quote' ? <span className="italic text-[#d6d4cd]">«{x}»</span> : x}</li>)}
    </ul>
  );
}

const Chips = ({ items, strike }: { items: string[]; strike?: boolean }) => (
  <p className="flex flex-wrap gap-1.5">{items.map((x, i) => <span key={i} className={`rounded-full px-2.5 py-1 text-[12.5px] ${strike ? 'bg-[#f87171]/10 text-[#fecaca] line-through decoration-[#f87171]/60' : 'bg-glass/[0.06] text-[#e4e3de]'}`}>{x}</span>)}</p>
);

// ─── Muqova ───────────────────────────────────────────────────────────────────

/** Video muqovasi namunasi — haqiqiy video chizgichi bilan (brend ranglari, shrift, plitka) */
function CoverSample({ b }: { b: BrandBook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hook = b.hooks.find(h => h.length <= 48) ?? b.tagline;
  useEffect(() => {
    let live = true;
    void loadFonts().catch(() => undefined).then(() => {
      const ctx = ref.current?.getContext('2d');
      if (live && ctx) drawFrame(ctx, { book: b, scenes: [{ kind: 'hook', text: hook, voice: '' }], starts: [0], duration: 3 }, 0);
    });
    return () => { live = false; };
  }, [b, hook]);
  return <canvas ref={ref} width={W} height={H} className="w-full rounded-xl shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]" style={{ aspectRatio: `${W} / ${H}` }} aria-label={`Video muqovasi namunasi: ${hook}`} />;
}

function Cover({ b }: { b: BrandBook }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 sm:p-7" style={{ background: `radial-gradient(120% 90% at 85% 0%, ${b.colors.bg} 0%, ${b.colors.deep} 100%)` }}>
      <div className="grid items-center gap-6 md:grid-cols-[1fr_200px]">
        <div className="rounded-2xl p-6" style={{ background: b.colors.surface, boxShadow: `0 10px 0 ${b.colors.deep}` }}>
          <p className="text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: b.colors.ink, opacity: 0.55 }}>{b.name}{b.archetype.name ? ` · ${b.archetype.name}` : ''}</p>
          {b.essence && <p className="mt-2 text-[34px] font-extrabold leading-[1.05] sm:text-[42px]" style={{ ...head(b), color: b.colors.ink }}>{b.essence}</p>}
          <p className={`${b.essence ? 'mt-3 text-[16px] font-semibold' : 'mt-2 text-[24px] font-extrabold'} leading-snug`} style={{ ...(b.essence ? {} : head(b)), color: b.colors.ink }}>{b.positioning}</p>
          <p className="mt-4 inline-block rounded-md px-2.5 py-1 text-[13px] font-bold" style={{ background: b.colors.accent, color: '#111' }}>{b.tagline}</p>
        </div>
        <div className="mx-auto w-[160px] md:w-full"><CoverSample b={b} /></div>
      </div>
    </div>
  );
}

// ─── Bo'limlar ────────────────────────────────────────────────────────────────

function Essence({ b }: { b: BrandBook }) {
  return (
    <Section n="01" title="Mohiyat" lead="nima va'da qilamiz, nega bizga ishonishadi">
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {b.promise && <p className="flex gap-3 text-[20px] font-semibold leading-snug text-[#f2f0ea]"><Quote className="mt-1 h-5 w-5 shrink-0" style={{ color: ACCENT }} aria-hidden="true" />{b.promise}</p>}
          {b.story && <p className="text-[14px] leading-relaxed text-[#c9cbd2]">{b.story}</p>}
          {b.archetype.why && <p className="text-[13px] text-[#a3a9b5]"><span className="font-semibold text-[#e4e3de]">{b.archetype.name}:</span> {b.archetype.why}</p>}
        </div>
        <div className="space-y-4">
          {!!b.values.length && <div><Label>Qadriyatlar</Label><ol className="space-y-1.5">{b.values.map((v, i) => <li key={i} className="flex gap-2.5 text-[13.5px] text-[#e4e3de]"><span className="font-mono text-[12px] text-[#7d838f]">{String(i + 1).padStart(2, '0')}</span>{v}</li>)}</ol></div>}
          {!!b.difference.length && <div><Label>Nimasi bilan boshqacha</Label><Bullets items={b.difference} /></div>}
        </div>
      </div>
    </Section>
  );
}

function Audience({ b }: { b: BrandBook }) {
  if (!b.personas.length) return null;
  return (
    <Section n="02" title="Auditoriya" lead="kimga gapiramiz va ular qanday gapiradi">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {b.personas.map((p, i) => (
          <article key={i} className="space-y-3 rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4">
            <div><p className="text-[15px] font-bold text-[#f2f0ea]">{p.name}</p><p className="mt-0.5 text-[13px] leading-snug text-[#a3a9b5]">{p.who}</p></div>
            {!!p.pains.length && <div><Label>Og'riq — o'z so'zi bilan</Label><Bullets items={p.pains} tone="quote" /></div>}
            {!!p.wants.length && <div><Label>Istaydi</Label><Bullets items={p.wants} /></div>}
            {!!p.objections.length && <div><Label>To'xtatadigan e'tiroz</Label><Bullets items={p.objections} /></div>}
          </article>
        ))}
      </div>
    </Section>
  );
}

function Messages({ b }: { b: BrandBook }) {
  if (!b.messages.length) return null;
  return (
    <Section n="03" title="Xabarlar" lead="nimani takrorlaymiz va nima bilan isbotlaymiz">
      <ol className="divide-y divide-glass/[0.06] rounded-2xl border border-glass/[0.07]">
        {b.messages.map((m, i) => (
          <li key={i} className="grid gap-1 p-4 md:grid-cols-[28px_1.2fr_1fr] md:gap-4">
            <span className="font-mono text-[12px] text-[#7d838f]">{i + 1}</span>
            <p className="text-[14.5px] font-semibold text-[#f2f0ea]">{m.message}</p>
            {m.proof && <p className="text-[13px] text-[#a3a9b5]"><span className="font-semibold text-[#c9cbd2]">Dalil: </span>{m.proof}</p>}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function NarratorPick({ b, setView, notify }: Props) {
  const [busy, run] = useRun(notify, setView);
  return (
    <div className="rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4">
      <Label>Video diktori</Label>
      <div role="radiogroup" aria-label="Video diktori" className="flex flex-wrap gap-2">
        {NARRATORS.map(n => {
          const on = b.narrator === n.id;
          return (
            <button key={n.id} type="button" role="radio" aria-checked={on} disabled={!!busy}
              onClick={() => { if (!on) void run('narrator', () => api.contentNarrator(n.id), `Diktor: ${n.id}`); }}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-left text-[13px] transition-colors disabled:opacity-60 ${on ? 'border-transparent text-[#07080b]' : 'border-glass/10 text-[#c9cbd2] hover:bg-glass/5'}`}
              style={on ? { background: ACCENT } : undefined}>
              {on ? (busy ? spin : <Mic className="h-4 w-4" aria-hidden="true" />) : null}
              <span><span className="font-semibold">{n.id}</span> <span className={on ? 'opacity-70' : 'text-[#8a909c]'}>· {n.who}, {n.about}</span></span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12.5px] text-[#7d838f]">Keyingi ovoz yozdirishda shu ovoz o'qiydi (Gemini). Tayyor videolar eski ovozda qoladi — Video varag'ida «Qayta ovoz»ni bosing.</p>
    </div>
  );
}

function Voice(props: Props) {
  const { b } = props;
  return (
    <Section n="04" title="Ovoz" lead="qanday gapiramiz — tekshirsa bo'ladigan qoidalar">
      <div className="space-y-5">
        {!!b.traits.length && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {b.traits.map((t, i) => (
              <div key={i} className="rounded-2xl border border-glass/[0.07] p-4">
                <p className="text-[16px] font-bold text-[#f2f0ea]" style={head(b)}>{t.trait}</p>
                <p className="mt-2 flex gap-1.5 text-[13px] text-[#d6d4cd]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label="Biz" />{t.is}</p>
                {t.isNot && <p className="mt-1 flex gap-1.5 text-[13px] text-[#a3a9b5]"><X className="mt-0.5 h-4 w-4 shrink-0 text-[#f87171]" aria-label="Emas" />{t.isNot}</p>}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <div><Label>Qoidalar</Label><Bullets items={b.voice} /></div>
          {!!b.examples.length && (
            <div>
              <Label>Bunday emas → bunday</Label>
              <ul className="space-y-2.5">
                {b.examples.map((e, i) => (
                  <li key={i} className="overflow-hidden rounded-xl border border-glass/[0.07] text-[13.5px]">
                    {e.bad && <p className="flex gap-2 bg-[#f87171]/[0.07] px-3 py-2 text-[#c9a3a3] line-through decoration-[#f87171]/40"><X className="mt-0.5 h-4 w-4 shrink-0 text-[#f87171] no-underline" aria-hidden="true" />{e.bad}</p>}
                    <p className="flex gap-2 bg-emerald-400/[0.06] px-3 py-2 text-[#e4f5ec]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />{e.good}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {!!b.words.length && <div><Label>Ishlatamiz</Label><Chips items={b.words} /></div>}
          {!!b.banned.length && <div><Label>Ishlatmaymiz</Label><Chips items={b.banned} strike /></div>}
          {!!b.dont.length && <div><Label>Qilinmaydi</Label><Bullets items={b.dont} /></div>}
        </div>
        <NarratorPick {...props} />
      </div>
    </Section>
  );
}

const COLOR_ROLE: Record<keyof BrandBook['colors'], { name: string; use: string }> = {
  bg: { name: 'Fon', use: 'video foni' }, deep: { name: "Fonning to'qi", use: 'soya, chuqurlik' }, surface: { name: 'Plitka', use: 'kartochkalar' },
  ink: { name: 'Matn', use: 'plitkadagi yozuv' }, accent: { name: "Urg'u", use: 'bitta muhim narsa' }, muted: { name: 'Ikkinchi matn', use: 'izohlar' },
};

function Pair({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const c = contrast(fg, bg);
  const good = c >= 4.5;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-glass/[0.07] p-2">
      <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg text-[15px] font-bold" style={{ background: bg, color: fg }} aria-hidden="true">Aa</span>
      <span className="text-[12.5px] leading-tight text-[#c9cbd2]">{label}<br /><span className={`tabular-nums ${good ? 'text-emerald-300' : 'text-[#fbbf77]'}`}>{c.toFixed(1)}:1 {good ? "o'qiladi" : 'faqat katta matn'}</span></span>
    </div>
  );
}

function Visual({ b }: { b: BrandBook }) {
  const keys = Object.keys(COLOR_ROLE) as (keyof BrandBook['colors'])[];
  return (
    <Section n="05" title="Vizual" lead="ranglar, shrift, kompozitsiya va harakat">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {keys.map(k => (
            <div key={k} className="overflow-hidden rounded-xl border border-glass/[0.07]">
              <div className="h-16" style={{ background: b.colors[k] }} />
              <p className="px-2.5 pt-2 text-[13px] font-semibold text-[#e4e3de]">{COLOR_ROLE[k].name}</p>
              <p className="px-2.5 pb-2 text-[12px] text-[#7d838f]"><span className="tabular-nums">{b.colors[k]}</span> · {COLOR_ROLE[k].use}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Pair fg={b.colors.ink} bg={b.colors.surface} label="Matn plitkada" />
          <Pair fg={b.colors.surface} bg={b.colors.bg} label="Yozuv fonda" />
          <Pair fg={b.colors.accent} bg={b.colors.bg} label="Urg'u fonda" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-glass/[0.07] p-4">
            <Label>Shriftlar</Label>
            <p className="text-[40px] font-extrabold leading-none text-[#f2f0ea]" style={head(b)}>Aa Qq 24</p>
            <p className="mt-1 text-[12.5px] text-[#8a909c]">{b.font} — sarlavhalar, plitkadagi yozuv</p>
            <p className="mt-3 text-[15px] leading-relaxed text-[#e4e3de]" style={{ fontFamily: 'Manrope, sans-serif' }}>Manrope — matn va subtitrlar: o'qilishi oson, o'zbek harflari to'liq.</p>
          </div>
          <div className="space-y-4">
            {b.motif && <div><Label>Ko'rinish g'oyasi</Label><p className="text-[13.5px] leading-relaxed text-[#e4e3de]">{b.motif}</p></div>}
            {b.motion && <div><Label>Videoda harakat</Label><p className="text-[13.5px] leading-relaxed text-[#e4e3de]">{b.motion}</p></div>}
          </div>
        </div>
        {!!b.visualRules.length && <div><Label>Kompozitsiya qoidalari</Label><Bullets items={b.visualRules} /></div>}
      </div>
    </Section>
  );
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'ʻ’-]/gu, '').split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

function Content({ b, notify }: { b: BrandBook; notify: Notify }) {
  return (
    <Section n="06" title="Kontent" lead="nima haqida, qaysi formatda, qanday boshlab qanday tugatamiz">
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          {!!b.pillars.length && (
            <div>
              <Label>Ustunlar</Label>
              <ul className="space-y-2.5">{b.pillars.map((p, i) => (
                <li key={i}>
                  <div className="flex justify-between text-[13.5px] text-[#e4e3de]"><span className="font-semibold">{p.name}</span><span className="tabular-nums text-[#8a909c]">{p.share}%</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-glass/10"><div className="h-1.5 rounded-full" style={{ width: `${p.share}%`, background: ACCENT }} /></div>
                  {p.about && <p className="mt-1 text-[12.5px] text-[#8a909c]">{p.about}</p>}
                </li>
              ))}</ul>
            </div>
          )}
          {!!b.formats.length && (
            <div>
              <Label>Formatlar</Label>
              <ul className="grid gap-2 sm:grid-cols-2">{b.formats.map((f, i) => <li key={i} className="rounded-xl border border-glass/[0.07] p-3"><p className="text-[13.5px] font-semibold text-[#f2f0ea]">{f.name}</p><p className="mt-0.5 text-[12.5px] leading-snug text-[#a3a9b5]">{f.how}</p></li>)}</ul>
            </div>
          )}
        </div>
        {!!b.hooks.length && (
          <div>
            <Label>Tayyor ilgaklar</Label>
            <ol className="grid gap-1.5 md:grid-cols-2">
              {b.hooks.map((h, i) => (
                <li key={i} className="group flex items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-glass/[0.03]">
                  <span className="mt-0.5 font-mono text-[12px] text-[#7d838f]">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-[13.5px] text-[#e4e3de]">{h}</span>
                  <button type="button" onClick={() => void copy(h, notify)} aria-label={`${i + 1}-ilgakdan nusxa olish`} className="rounded-md p-1 text-[#7d838f] opacity-60 hover:bg-glass/5 hover:text-[#f2f0ea] group-hover:opacity-100"><Copy className="h-3.5 w-3.5" aria-hidden="true" /></button>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {!!b.ctas.length && <div><Label>Harakatga chaqiriq</Label><Bullets items={b.ctas} /></div>}
          {b.bio && (
            <div>
              <Label>Profil bio</Label>
              <div className="flex items-start gap-3 rounded-2xl border border-glass/[0.07] p-3.5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[15px] font-extrabold" style={{ background: b.colors.bg, color: b.colors.surface, ...head(b) }} aria-hidden="true">{initials(b.name)}</span>
                <div className="min-w-0 flex-1"><p className="text-[14px] font-bold text-[#f2f0ea]">{b.name}</p><p className="mt-0.5 whitespace-pre-line text-[13px] leading-snug text-[#c9cbd2]">{b.bio}</p></div>
                <button type="button" onClick={() => void copy(b.bio, notify)} aria-label="Bio'dan nusxa olish" className="rounded-md p-1.5 text-[#7d838f] hover:bg-glass/5 hover:text-[#f2f0ea]"><Copy className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

export function BrandBookView(props: Props) {
  const { b } = props;
  return (
    <div className="space-y-7">
      {!isFull(b) && <p className="rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">Bu brend-buk qisqa (eski) andozada. To'liq versiya — auditoriya, xabarlar, ovoz namunalari, ilgaklar va formatlar — uchun «Qayta yaratish»ni bosing: anketangiz saqlangan.</p>}
      <Cover b={b} />
      <Essence b={b} />
      <Audience b={b} />
      <Messages b={b} />
      <Voice {...props} />
      <Visual b={b} />
      <Content b={b} notify={props.notify} />
    </div>
  );
}
