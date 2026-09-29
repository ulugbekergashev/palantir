import { alpha, deepen, mix, onColor } from '../lib/color';
import { fit, wrap } from '../lib/text';
import { BrandMark, Lines, Pill, Tooth, W, isStory, type TplProps } from './parts';

/** Foydali maslahat: yorliq, savol-sarlavha va 3 ta raqamlangan band */
export function TipArt({ d, clinic, style, H, uid }: TplProps) {
  const { primary, accent } = clinic.brand;
  const story = isStory(H);
  const pad = 80;
  const ink = '#0F172A';
  const x0 = style === 1 ? pad + 24 : pad;

  const title = fit(d.title, W - x0 - pad, story ? [100, 88, 78, 70] : [76, 68, 60, 54], 800, story ? 4 : 3);
  const tLH = title.size * 1.1;
  const r = story ? 42 : 32;
  const size = story ? 46 : 36;
  const textX = x0 + r * 2 + (story ? 36 : 28);
  const items = d.lines.map(l => wrap(l, W - textX - pad, size, 600, 2));
  const rowH = (lines: string[]) => Math.max(r * 2, lines.length * size * 1.28);
  const gap = story ? 44 : 30;

  const kickerH = story ? 72 : 56;
  const listH = items.reduce((s, l) => s + rowH(l) + gap, -gap);
  const blockH = kickerH + (story ? 60 : 40) + title.lines.length * tLH + (story ? 70 : 44) + listH;
  const footY = H - (story ? 230 : 140);
  const top = story ? 300 + Math.max(0, (footY - 80 - 300 - blockH) / 2) : 76;

  const titleY = top + kickerH + (story ? 60 : 40) + title.size * 0.84;
  let y = titleY + (title.lines.length - 1) * tLH + (story ? 70 : 44);

  return (
    <g>
      <rect width={W} height={H} fill={style === 1 ? '#FFFFFF' : mix(primary, '#FFFFFF', 0.94)} />
      {style === 1 && <rect width={24} height={H} fill={primary} />}
      <circle cx={W + 30} cy={story ? 180 : 60} r={story ? 260 : 190} fill={alpha(accent, 0.18)} />
      <Tooth x={W - (story ? 300 : 230)} y={story ? 60 : 30} size={story ? 220 : 160} fill={alpha(primary, 0.1)} />

      {story && <BrandMark clinic={clinic} x={x0} y={140} size={96} uid={uid} nameFill={ink} />}
      <Pill x={x0} y={top} h={kickerH} text={d.kicker.toUpperCase()} size={story ? 30 : 24} padX={story ? 32 : 26} bg={primary} fg={onColor(primary)} spacing={2} />
      <Lines lines={title.lines} x={x0} y={titleY} size={title.size} lh={1.1} weight={800} fill={ink} spacing={-0.5} />

      {items.map((lines, i) => {
        const rowTop = y;
        y += rowH(lines) + gap;
        const textTop = rowTop + (rowH(lines) - lines.length * size * 1.28) / 2;
        return (
          <g key={i}>
            <circle cx={x0 + r} cy={rowTop + rowH(lines) / 2} r={r} fill={i === 0 ? primary : mix(primary, '#FFFFFF', 0.8)} />
            <text x={x0 + r} y={rowTop + rowH(lines) / 2 + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight={800} fill={i === 0 ? onColor(primary) : deepen(primary)}>{i + 1}</text>
            <Lines lines={lines} x={textX} y={textTop + size * 0.95} size={size} lh={1.28} weight={600} fill="#1E293B" />
          </g>
        );
      })}

      <line x1={x0} x2={W - pad} y1={footY} y2={footY} stroke={alpha(primary, 0.2)} strokeWidth={2} />
      {story ? (
        <text x={W / 2} y={footY + 110} textAnchor="middle" fontSize={44} fontWeight={800} fill={deepen(primary)}>{d.cta}</text>
      ) : (
        <>
          <BrandMark clinic={clinic} x={x0} y={footY + 30} size={60} uid={uid} nameFill={ink} nameSize={28} />
          <text x={W - pad} y={footY + 70} textAnchor="end" fontSize={28} fontWeight={700} fill={deepen(primary)}>{d.cta}</text>
        </>
      )}
    </g>
  );
}
