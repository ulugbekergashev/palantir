import type { ReactNode } from 'react';
import { alpha, deepen, mix, onColor } from '../lib/color';
import { fit } from '../lib/text';
import { BrandMark, Lines, Pill, Tooth, W, isStory, type TplProps } from './parts';

/**
 * Storislar 1080×1920 uchun chizilgan. Post o'lchamida so'ralsa (paketda bunday
 * holat yo'q, lekin shablon buzilmasin) — markazga kichraytirib joylanadi.
 */
function StoryFrame({ H, children, bg }: { H: number; children: ReactNode; bg: string }) {
  if (isStory(H)) return <>{children}</>;
  const k = H / 1920;
  return (
    <g>
      <rect width={W} height={H} fill={bg} />
      <g transform={`translate(${(W - W * k) / 2} 0) scale(${k})`}>{children}</g>
    </g>
  );
}

/** Bu haftaning bo'sh vaqtlari: kun — chapda, soat — o'ngda */
export function SlotsArt({ d, clinic, style, H, uid }: TplProps) {
  const { primary, accent } = clinic.brand;
  const pad = 80;
  const ink = '#0F172A';
  const band = style === 1;
  const bg = mix(primary, '#FFFFFF', 0.93);
  const slots = d.lines.map(l => l.split('|') as [string, string]);
  const cardH = 150;
  const gapY = 30;
  const listTop = 700;
  const ctaColor = band ? accent : primary;
  // "Свободное время" 120px'da sig'maydi — bitta qatorga kichraytiriladi
  const title = fit(d.title, W - pad * 2, [120, 108, 96, 86], 800, 1);
  return (
    <StoryFrame H={H} bg={bg}>
      <rect width={W} height={1920} fill={bg} />
      {band && <rect width={W} height={620} fill={primary} />}
      <circle cx={W + 60} cy={band ? 560 : 120} r={260} fill={alpha(accent, band ? 0.35 : 0.2)} />
      <BrandMark clinic={clinic} x={pad} y={140} size={96} uid={uid} nameFill={band ? onColor(primary) : ink} inverse={band} nameSize={38} />
      <Pill x={pad} y={330} h={72} text={d.kicker.toUpperCase()} size={30} padX={32} spacing={2}
        bg={band ? alpha('#FFFFFF', 0.2) : primary} fg={onColor(primary)} />
      <text x={pad} y={530} fontSize={title.size} fontWeight={800} fill={band ? onColor(primary) : deepen(primary)} letterSpacing={-2}>{title.lines[0]}</text>

      {slots.map(([day, time], i) => {
        const y = listTop + i * (cardH + gapY);
        return (
          <g key={i}>
            <rect x={pad} y={y} width={W - pad * 2} height={cardH} rx={44} fill="#FFFFFF" stroke={alpha(primary, 0.14)} strokeWidth={3} />
            <text x={pad + 56} y={y + cardH / 2 + 18} fontSize={50} fontWeight={700} fill={ink}>{day}</text>
            <rect x={W - pad - 56 - 250} y={y + 27} width={250} height={96} rx={48} fill={primary} />
            <text x={W - pad - 56 - 125} y={y + 27 + 66} textAnchor="middle" fontSize={52} fontWeight={800} fill={onColor(primary)}>{time}</text>
          </g>
        );
      })}

      <Tooth x={W / 2 - 60} y={listTop + slots.length * (cardH + gapY) + 30} size={120} fill={alpha(primary, 0.12)} />
      <rect x={pad} y={1920 - 340} width={W - pad * 2} height={170} rx={85} fill={ctaColor} />
      <text x={W / 2} y={1920 - 340 + 102} textAnchor="middle" fontSize={50} fontWeight={800} fill={onColor(ctaColor)}>{d.cta}</text>
      <text x={W / 2} y={1920 - 100} textAnchor="middle" fontSize={38} fontWeight={600} fill="#475569">{clinic.phone}</text>
    </StoryFrame>
  );
}

/** So'rovnoma: katta savol va ikki javob (Instagram'da ustiga so'rovnoma stikeri qo'yiladi) */
export function PollArt({ d, clinic, style, H, uid }: TplProps) {
  const { primary, accent } = clinic.brand;
  const pad = 80;
  const dark = style === 1;
  const bgId = `${uid}-bg`;
  const fg = dark ? '#FFFFFF' : onColor(primary);
  const q = fit(d.title, W - pad * 2, [112, 100, 88, 76], 800, 4);
  const qLH = q.size * 1.08;
  const cardH = 2 * 130 + 3 * 36;
  const blockH = 72 + 70 + q.lines.length * qLH + 90 + cardH;
  const top = Math.max(360, (1920 - 260 - blockH) / 2 + 40);
  const qY = top + 72 + 70 + q.size * 0.84;
  const cardY = qY + (q.lines.length - 1) * qLH + 110;
  return (
    <StoryFrame H={H} bg={primary}>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={dark ? '#0F172A' : primary} />
          <stop offset="1" stopColor={dark ? mix('#0F172A', primary, 0.35) : mix(primary, accent, 0.5)} />
        </linearGradient>
      </defs>
      <rect width={W} height={1920} fill={`url(#${bgId})`} />
      <circle cx={-80} cy={320} r={300} fill={alpha(dark ? primary : '#FFFFFF', dark ? 0.35 : 0.08)} />
      <circle cx={W + 100} cy={1500} r={360} fill={alpha(accent, 0.25)} />
      <BrandMark clinic={clinic} x={W / 2} y={140} size={92} uid={uid} nameFill={fg} inverse anchor="middle" nameSize={38} />
      <Pill x={W / 2} y={top} h={72} text={d.kicker.toUpperCase()} size={30} padX={34} bg={alpha('#FFFFFF', 0.18)} fg={fg} anchor="middle" spacing={2} />
      <Lines lines={q.lines} x={W / 2} y={qY} size={q.size} lh={1.08} weight={800} fill={fg} anchor="middle" spacing={-1} />
      <rect x={pad + 30} y={cardY} width={W - pad * 2 - 60} height={cardH} rx={52} fill="#FFFFFF" />
      {d.lines.slice(0, 2).map((opt, i) => (
        <g key={i}>
          <rect x={pad + 66} y={cardY + 36 + i * 166} width={W - pad * 2 - 132} height={130} rx={65} fill={i === 0 ? mix(primary, '#FFFFFF', 0.86) : '#F1F5F9'} />
          <text x={W / 2} y={cardY + 36 + i * 166 + 84} textAnchor="middle" fontSize={50} fontWeight={700} fill="#0F172A">{opt}</text>
        </g>
      ))}
      <text x={W / 2} y={cardY + cardH + 90} textAnchor="middle" fontSize={40} fontWeight={600} fill={alpha(fg, 0.85)}>{d.cta}</text>
      <text x={W / 2} y={1920 - 130} textAnchor="middle" fontSize={40} fontWeight={700} fill={alpha(fg, 0.9)}>{clinic.telegramBot || clinic.phone}</text>
    </StoryFrame>
  );
}
