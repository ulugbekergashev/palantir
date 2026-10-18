import { useEffect, useRef, useState } from 'react';

/** Kartadagi kichik chiziq: davr ichidagi o'zgarish shakli (o'qlar va yozuvlarsiz) */
export function Sparkline({ values, color, className = '' }: { values: number[]; color: string; className?: string }) {
  const w = 120, h = 36, max = Math.max(1, ...values);
  if (values.length < 2) return null;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `sp-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-9 w-28 ${className}`} aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface Series { key: string; label: string; color: string; values: number[] }

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (p / 2)) * (p / 2);
};

/**
 * Dinamika grafigi: bir nechta chiziq, gorizontal to'r, pastda vaqt yozuvlari. Sichqoncha (yoki barmoq) bilan —
 * tik chiziq va o'sha bo'lakdagi hamma qiymatlar (tooltip). Legendadagi qatorni bosib chiziqni yashirish mumkin
 */
export function LineChart({ labels, series, height = 260, formatLabel = (l: string) => l }: { labels: string[]; series: Series[]; height?: number; formatLabel?: (l: string) => string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Chizma haqiqiy enida chiziladi: telefonda ham yozuvlar 11px bo'lib qoladi (kichraytirilgan rasm emas)
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = width, H = width < 500 ? Math.min(height, 200) : height, L = 30, R = 10, T = 12, B = 28;
  const shown = series.filter(s => !hidden.has(s.key));
  const max = niceMax(Math.max(1, ...shown.flatMap(s => s.values)));
  const n = labels.length;
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(t * max));
  // Yozuvlar orasida kamida ~56px: ustma-ust tushmasin; oxirgisi oldingisiga yaqin bo'lsa — chiqarilmaydi
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 56))));
  const showLabel = (i: number) => i % every === 0 || (i === n - 1 && (n - 1) % every >= every / 2);
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || n < 1) return;
    const px = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <div ref={wrap} className="relative">
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full touch-none select-none" role="img" aria-label="Murojaatlar dinamikasi"
        onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e4e0d8" strokeDasharray={t ? '3 4' : undefined} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#646a79">{t}</text>
          </g>
        ))}
        {labels.map((l, i) => showLabel(i) && (
          <text key={l} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" fill="#646a79">{formatLabel(l)}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#13161d" strokeOpacity="0.35" strokeDasharray="3 3" />}
        {shown.map(s => (
          <g key={s.key}>
            <path d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur"
          style={{ left: `${tipLeft}%`, transform: `translateX(${tipLeft > 60 ? 'calc(-100% - 12px)' : '12px'})` }}>
          <p className="mb-1 font-bold text-slate-900">{formatLabel(labels[hover])}</p>
          {shown.map(s => (
            <p key={s.key} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="font-bold tabular-nums text-slate-900">{s.values[hover] ?? 0}</span>
            </p>
          ))}
        </div>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="Chiziqlar">
        {series.map(s => {
          const off = hidden.has(s.key);
          const total = s.values.reduce((a, b) => a + b, 0);
          return (
            <li key={s.key}>
              <button type="button" aria-pressed={!off} onClick={() => setHidden(h => { const nx = new Set(h); if (nx.has(s.key)) nx.delete(s.key); else nx.add(s.key); return nx; })}
                className={`flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-xs font-semibold transition-colors hover:bg-slate-100 ${off ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? '#cdc8be' : s.color }} />{s.label} <span className="tabular-nums text-slate-500">{total}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
