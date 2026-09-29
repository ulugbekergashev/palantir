import type { Clinic, Design, Doctor } from '../types';
import { initials, textWidth } from '../lib/text';
import { alpha, onColor } from '../lib/color';

/** Rasm kengligi; balandligi — post 1080, storis 1920 */
export const W = 1080;

export interface TplProps {
  d: Design;
  clinic: Clinic;
  style: number;
  H: number;
  /** Shu rasm ichidagi gradient va kesish id'lari uchun (sahifada bir nechta nusxa bor) */
  uid: string;
  seed: number;
  doctor?: Doctor;
  solemn?: boolean;
}

export const isStory = (H: number) => H > W;

/** Bir nechta qatorli matn; y — birinchi qatorning asos chizig'i */
export function Lines({ lines, x, y, size, lh = 1.25, weight = 500, fill, anchor = 'start', spacing }: {
  lines: string[]; x: number; y: number; size: number; lh?: number; weight?: number; fill: string;
  anchor?: 'start' | 'middle' | 'end'; spacing?: number;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} letterSpacing={spacing}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={y + i * size * lh}>{l}</tspan>
      ))}
    </text>
  );
}

/** Dumaloq yorliq ("AKSIYA"). Qaytaradi: kengligi — yonidagi elementlar uchun */
export function Pill({ x, y, h, text, size, bg, fg, anchor = 'start', padX, weight = 800, spacing = 0 }: {
  x: number; y: number; h: number; text: string; size: number; bg: string; fg: string;
  anchor?: 'start' | 'middle'; padX: number; weight?: number; spacing?: number;
}) {
  const w = textWidth(text, size, weight) + spacing * Math.max(0, text.length - 1) + padX * 2;
  const left = anchor === 'middle' ? x - w / 2 : x;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={h / 2} fill={bg} />
      <text x={left + padX} y={y + h / 2 + size * 0.36} fontSize={size} fontWeight={weight} fill={fg} letterSpacing={spacing}>{text}</text>
    </g>
  );
}

/** 100×100 o'lchamdagi tish belgisi */
const TOOTH = 'M30 8C18 8 10 18 10 32c0 16 6 26 10 40 3 12 5 22 12 22s8-14 12-24c2-6 4-8 6-8s4 2 6 8c4 10 5 24 12 24s9-10 12-22c4-14 10-24 10-40 0-14-8-24-20-24-8 0-12 5-20 5S38 8 30 8z';

export function Tooth({ x, y, size, fill, stroke, strokeWidth = 0 }: { x: number; y: number; size: number; fill: string; stroke?: string; strokeWidth?: number }) {
  return <path d={TOOTH} transform={`translate(${x} ${y}) scale(${size / 100})`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

/** Belgi (✓) doira ichida */
export function Check({ cx, cy, r, bg, fg }: { cx: number; cy: number; r: number; bg: string; fg: string }) {
  const s = r / 10;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={bg} />
      <path d={`M${cx - 4.5 * s} ${cy + 0.2 * s} l${3 * s} ${3.2 * s} l${6.2 * s} ${-6.6 * s}`} fill="none" stroke={fg} strokeWidth={2.2 * s} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/**
 * Klinika belgisi: logo (yuklangan bo'lsa) yoki bosh harflar kvadrati, yonida nomi.
 * inverse — rangli fonda: kvadrat oq, harflar brend rangida.
 */
export function BrandMark({ clinic, x, y, size, uid, nameFill, inverse = false, showName = true, nameSize, anchor = 'start' }: {
  clinic: Clinic; x: number; y: number; size: number; uid: string; nameFill: string;
  inverse?: boolean; showName?: boolean; nameSize?: number; anchor?: 'start' | 'middle';
}) {
  const { primary, logo } = clinic.brand;
  const ns = nameSize ?? size * 0.4;
  const gap = size * 0.24;
  const total = showName ? size + gap + textWidth(clinic.name, ns, 800) : size;
  const left = anchor === 'middle' ? x - total / 2 : x;
  const r = size * 0.28;
  const clip = `${uid}-logo`;
  const box = inverse ? '#FFFFFF' : primary;
  return (
    <g>
      {logo ? (
        <>
          <defs>
            <clipPath id={clip}><rect x={left} y={y} width={size} height={size} rx={r} /></clipPath>
          </defs>
          <rect x={left} y={y} width={size} height={size} rx={r} fill="#FFFFFF" />
          <image href={logo} x={left} y={y} width={size} height={size} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid meet" />
        </>
      ) : (
        <>
          <rect x={left} y={y} width={size} height={size} rx={r} fill={box} />
          <text x={left + size / 2} y={y + size * 0.64} textAnchor="middle" fontSize={size * 0.42} fontWeight={800} fill={inverse ? primary : onColor(primary)}>
            {initials(clinic.name)}
          </text>
        </>
      )}
      {showName && (
        <text x={left + size + gap} y={y + size / 2 + ns * 0.36} fontSize={ns} fontWeight={800} fill={nameFill}>{clinic.name}</text>
      )}
    </g>
  );
}

/** Pastdagi aloqa paneli: yozilish (bot) va telefon */
export function ContactBar({ clinic, d, y, h, bg, fg, story }: { clinic: Clinic; d: Design; y: number; h: number; bg: string; fg: string; story: boolean }) {
  const pad = 80;
  const main = story ? 44 : 36;
  const sub = story ? 32 : 26;
  const inner = pad + (story ? 52 : 44);
  return (
    <g>
      <rect x={pad} y={y} width={W - pad * 2} height={h} rx={h * 0.3} fill={bg} />
      <text x={inner} y={y + h * 0.46} fontSize={main} fontWeight={800} fill={fg}>{d.cta || clinic.phone}</text>
      <text x={inner} y={y + h * 0.46 + sub * 1.45} fontSize={sub} fontWeight={600} fill={alpha(fg, 0.72)}>
        {clinic.phone}
      </text>
      <Tooth x={W - pad - h * 0.9} y={y + h * 0.2} size={h * 0.6} fill={alpha(fg, 0.16)} />
    </g>
  );
}
