import { alpha, deepen, mix, onColor } from '../lib/color';
import { fit, textWidth, wrap } from '../lib/text';
import { BrandMark, Check, ContactBar, Lines, Pill, Tooth, W, isStory, type TplProps } from './parts';

/**
 * Aksiya / xizmat posti. Uslublar: 0 — brend rangidagi fon, 1 — och fon, 2 — gradient.
 * Joylashuv: yuqorida belgi, yorliq va (bo'lsa) "-20%" doirasi, katta sarlavha,
 * aksiya matni, 2 ta afzallik, pastda yozilish paneli.
 */
export function PromoArt({ d, clinic, style, H, uid }: TplProps) {
  const { primary, accent } = clinic.brand;
  const story = isStory(H);
  const light = style === 1;
  const pad = 80;
  const fg = light ? '#0F172A' : onColor(primary);
  const head = light ? deepen(primary) : fg;
  const soft = light ? '#334155' : alpha(fg, 0.88);
  const badgeBg = light ? primary : accent;

  const r = story ? 150 : 124;
  const titleW = d.badge ? W - pad * 2 - r * 2 + 20 : W - pad * 2;
  const title = fit(d.title, titleW, story ? [132, 116, 100, 88] : [120, 104, 92, 80, 68, 60], 800, story ? 3 : 2);
  const tLH = title.size * 1.04;
  const [first = '', ...rest] = d.lines;
  const firstSize = story ? 50 : 40;
  const firstLines = wrap(first, W - pad * 2, firstSize, 700, 2);
  const benSize = story ? 42 : 34;
  const benefits = rest.map(b => wrap(b, W - pad * 2 - benSize * 1.5, benSize, 600, 1)[0]);

  const kickerH = story ? 76 : 60;
  const blockH = kickerH + (story ? 56 : 40) + title.lines.length * tLH + (story ? 50 : 30)
    + firstLines.length * firstSize * 1.3 + (story ? 30 : 12) + benefits.length * benSize * 1.6;
  const barH = story ? 160 : 124;
  const barY = H - (story ? 170 : 80) - barH;
  // Matn bloki sarlavha bilan pastki panel orasidagi bo'sh joy o'rtasida
  const top = story ? 330 + Math.max(0, (barY - 110 - 330 - blockH) / 2) : 214 + Math.max(0, (barY - 70 - 214 - blockH) / 2);

  const titleY = top + kickerH + (story ? 56 : 40) + title.size * 0.84;
  const firstY = titleY + (title.lines.length - 1) * tLH + (story ? 50 : 30) + firstSize * 1.05;
  const benY = firstY + (firstLines.length - 1) * firstSize * 1.3 + (story ? 30 : 12) + benSize * 1.55;
  const badgeSize = d.badge ? Math.min(r * 0.62, (r * 1.55 * 100) / Math.max(1, textWidth(d.badge, 100, 800))) : 0;
  const bgId = `${uid}-bg`;

  return (
    <g>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={primary} />
          <stop offset="1" stopColor={mix(primary, accent, 0.55)} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={light ? mix(primary, '#FFFFFF', 0.93) : style === 2 ? `url(#${bgId})` : primary} />
      {light ? (
        <>
          <circle cx={W + 40} cy={-40} r={story ? 420 : 330} fill={alpha(primary, 0.08)} />
          <circle cx={W - 120} cy={H * 0.62} r={story ? 90 : 60} fill={alpha(accent, 0.22)} />
        </>
      ) : (
        <>
          <circle cx={W + 60} cy={-60} r={story ? 440 : 340} fill={alpha(accent, 0.3)} />
          <circle cx={-120} cy={H + 80} r={story ? 420 : 330} fill={alpha('#FFFFFF', 0.07)} />
        </>
      )}
      <Tooth x={W - (story ? 470 : 380)} y={barY - (story ? 560 : 330)} size={story ? 520 : 400} fill={alpha(light ? primary : fg, 0.07)} />

      <BrandMark clinic={clinic} x={pad} y={story ? 140 : 72} size={story ? 100 : 84} uid={uid} nameFill={light ? '#0F172A' : fg} inverse={!light} />

      <Pill x={pad} y={top} h={kickerH} text={d.kicker.toUpperCase()} size={story ? 32 : 26} padX={story ? 34 : 28}
        bg={light ? primary : alpha('#FFFFFF', 0.18)} fg={light ? onColor(primary) : fg} spacing={2} />

      {d.badge && (
        <g transform={`rotate(-8 ${W - pad - r + 20} ${top + r * 0.55})`}>
          <circle cx={W - pad - r + 20} cy={top + r * 0.55} r={r} fill={badgeBg} />
          <circle cx={W - pad - r + 20} cy={top + r * 0.55} r={r - 14} fill="none" stroke={alpha(onColor(badgeBg), 0.35)} strokeWidth={3} strokeDasharray="6 10" />
          <text x={W - pad - r + 20} y={top + r * 0.55 + badgeSize * 0.36} textAnchor="middle" fontSize={badgeSize} fontWeight={800} fill={onColor(badgeBg)}>{d.badge}</text>
        </g>
      )}

      <Lines lines={title.lines} x={pad} y={titleY} size={title.size} lh={1.04} weight={800} fill={head} spacing={-1} />
      <Lines lines={firstLines} x={pad} y={firstY} size={firstSize} lh={1.3} weight={700} fill={fg} />
      {benefits.map((b, i) => (
        <g key={i}>
          <Check cx={pad + benSize * 0.48} cy={benY + i * benSize * 1.6 - benSize * 0.34} r={benSize * 0.48} bg={light ? primary : alpha('#FFFFFF', 0.2)} fg={light ? onColor(primary) : fg} />
          <text x={pad + benSize * 1.4} y={benY + i * benSize * 1.6} fontSize={benSize} fontWeight={600} fill={soft}>{b}</text>
        </g>
      ))}

      {d.footnote && (
        <text x={pad} y={barY - (story ? 40 : 26)} fontSize={story ? 32 : 26} fontWeight={600} fill={alpha(light ? '#0F172A' : fg, 0.7)}>{d.footnote}</text>
      )}
      <ContactBar clinic={clinic} d={d} y={barY} h={barH} bg={light ? primary : '#FFFFFF'} fg={light ? onColor(primary) : deepen(primary)} story={story} />
    </g>
  );
}
