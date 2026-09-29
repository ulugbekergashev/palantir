import { alpha, mix } from '../lib/color';
import { hash, rng } from '../lib/rng';
import { fit, wrap } from '../lib/text';
import { BrandMark, Lines, Pill, Tooth, W, isStory, type TplProps } from './parts';

/** Bayram tabrigi: gradient fon, konfetti, markazda sarlavha. Sokin sanalarda — bezaksiz, to'q fon */
export function HolidayArt({ d, clinic, style, H, uid, seed, solemn }: TplProps) {
  const { primary, accent } = clinic.brand;
  const story = isStory(H);
  const pad = 80;
  const fg = '#FFFFFF';
  const bgId = `${uid}-bg`;
  const [from, to] = solemn
    ? ['#1E293B', '#334155']
    : style === 1 ? [primary, mix(primary, '#000000', 0.35)] : [primary, mix(primary, accent, 0.7)];

  const title = fit(d.title, W - pad * 2, story ? [116, 100, 88, 76] : [92, 80, 72, 64], 800, story ? 4 : 3);
  const tLH = title.size * 1.08;
  const lineSize = story ? 46 : 36;
  const lines = d.lines.flatMap(l => wrap(l, W - pad * 2 - 40, lineSize, 500, 2));
  const kickerH = story ? 72 : 58;
  const blockH = kickerH + (story ? 70 : 50) + title.lines.length * tLH + (story ? 60 : 40) + lines.length * lineSize * 1.35;
  const brandY = H - (story ? 300 : 170);
  const top = Math.max(story ? 300 : 110, (brandY - 60 - blockH) / 2 + (story ? 60 : 30));
  const titleY = top + kickerH + (story ? 70 : 50) + title.size * 0.84;
  const linesY = titleY + (title.lines.length - 1) * tLH + (story ? 60 : 40) + lineSize;

  // Konfetti — tepada va pastda (matn ustiga tushmaydi); har variantda boshqacha
  const r = rng(hash(`${d.title}-${seed}`));
  const confetti = solemn ? [] : Array.from({ length: story ? 40 : 28 }, (_, i) => {
    const band = i % 2 === 0 ? [30, top - 40] : [brandY - (story ? 140 : 60), H - 30];
    return {
      x: 30 + r() * (W - 60),
      y: band[0] + r() * Math.max(10, band[1] - band[0]),
      s: 8 + r() * (story ? 22 : 16),
      rot: r() * 180,
      c: [fg, accent, mix(accent, '#FFFFFF', 0.5), mix(primary, '#FFFFFF', 0.6)][i % 4],
      round: r() > 0.5,
    };
  });

  return (
    <g>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${bgId})`} />
      <Tooth x={W / 2 - (story ? 380 : 300)} y={titleY - (story ? 420 : 330)} size={story ? 760 : 600} fill={alpha(fg, 0.06)} />
      {confetti.map((c, i) => c.round
        ? <circle key={i} cx={c.x} cy={c.y} r={c.s / 2} fill={c.c} opacity={0.85} />
        : <rect key={i} x={c.x} y={c.y} width={c.s} height={c.s * 0.45} rx={c.s * 0.2} fill={c.c} opacity={0.85} transform={`rotate(${c.rot} ${c.x} ${c.y})`} />)}
      {solemn && (
        <>
          <line x1={W / 2 - 120} x2={W / 2 + 120} y1={top - 50} y2={top - 50} stroke={alpha(fg, 0.3)} strokeWidth={2} />
          <line x1={W / 2 - 120} x2={W / 2 + 120} y1={brandY - 70} y2={brandY - 70} stroke={alpha(fg, 0.3)} strokeWidth={2} />
        </>
      )}

      <Pill x={W / 2} y={top} h={kickerH} text={d.kicker} size={story ? 34 : 28} padX={story ? 36 : 30} bg={alpha(fg, 0.18)} fg={fg} anchor="middle" weight={700} />
      <Lines lines={title.lines} x={W / 2} y={titleY} size={title.size} lh={1.08} weight={800} fill={fg} anchor="middle" spacing={-1} />
      <Lines lines={lines} x={W / 2} y={linesY} size={lineSize} lh={1.35} weight={500} fill={alpha(fg, 0.9)} anchor="middle" />

      <BrandMark clinic={clinic} x={W / 2} y={brandY} size={story ? 96 : 76} uid={uid} nameFill={fg} inverse anchor="middle" nameSize={story ? 40 : 32} />
    </g>
  );
}
