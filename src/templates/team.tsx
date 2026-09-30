import { alpha, deepen, mix, onColor } from '../lib/color';
import { fit, initials, wrap } from '../lib/text';
import { BrandMark, Lines, Pill, Mark, W, isStory, type TplProps } from './parts';

/** Jamoa a'zosining surati yoki (surat yo'q bo'lsa) bosh harflari */
function Portrait({ x, y, w, h, round, photo, name, primary, uid }: {
  x: number; y: number; w: number; h: number; round: boolean; photo?: string; name: string; primary: string; uid: string;
}) {
  const clip = `${uid}-photo`;
  const letters = initials(name.replace(/^dr\.?\s*/i, ''));
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          {round ? <circle cx={x + w / 2} cy={y + h / 2} r={w / 2} /> : <rect x={x} y={y} width={w} height={h} />}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={x} y={y} width={w} height={h} fill={mix(primary, '#FFFFFF', 0.78)} />
        {photo ? (
          <image href={photo} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <>
            <Mark x={x + w * 0.18} y={y + h * 0.5 - w * 0.34} size={w * 0.64} fill={alpha(primary, 0.1)} />
            <text x={x + w / 2} y={y + h / 2 + w * 0.12} textAnchor="middle" fontSize={w * 0.32} fontWeight={800} fill={deepen(primary)}>{letters}</text>
          </>
        )}
      </g>
    </g>
  );
}

/**
 * Jamoa a'zosi bilan tanishuv. Uslub 0 — surat yarim ekran (post: chapda, storis: tepada),
 * uslub 1 — dumaloq surat markazda.
 */
export function TeamArt({ d, biz, style, H, uid, member }: TplProps) {
  const { primary, accent } = biz.brand;
  const story = isStory(H);
  const pad = 80;
  const ink = '#0F172A';
  const [specialty = '', exp = '', intro = ''] = d.lines;
  const photo = member?.photo;

  if (style === 0 && !story) {
    const x0 = 500;
    const colW = W - x0 - pad;
    const name = fit(d.title, colW, [64, 58, 52, 46], 800, 3);
    const introLines = wrap(intro, colW, 30, 500, 3);
    const nameY = 250 + name.size * 0.84;
    const specY = nameY + (name.lines.length - 1) * name.size * 1.08 + 66;
    return (
      <g>
        <rect width={W} height={H} fill="#FFFFFF" />
        <Portrait x={0} y={0} w={440} h={H} round={false} photo={photo} name={d.title} primary={primary} uid={uid} />
        <rect x={440} width={8} height={H} fill={accent} />
        <Pill x={x0} y={120} h={56} text={d.kicker.toUpperCase()} size={24} padX={26} bg={primary} fg={onColor(primary)} spacing={2} />
        <Lines lines={name.lines} x={x0} y={nameY} size={name.size} lh={1.08} weight={800} fill={ink} spacing={-0.5} />
        <text x={x0} y={specY} fontSize={36} fontWeight={700} fill={deepen(primary)}>{specialty}</text>
        {exp && <Pill x={x0} y={specY + 30} h={58} text={exp} size={26} padX={24} bg={mix(accent, '#FFFFFF', 0.72)} fg={mix(accent, ink, 0.7)} weight={700} />}
        <Lines lines={introLines} x={x0} y={specY + (exp ? 150 : 70)} size={30} lh={1.35} fill="#475569" />
        <BrandMark biz={biz} x={x0} y={H - 170} size={58} uid={uid} nameFill={ink} nameSize={26} />
        <text x={x0} y={H - 64} fontSize={28} fontWeight={800} fill={deepen(primary)}>{d.cta}</text>
      </g>
    );
  }

  // Dumaloq surat (post) yoki storis
  const photoTop = story ? (style === 0 ? 0 : 300) : 150;
  const round = !(story && style === 0);
  const pw = story ? (round ? 560 : W) : 360;
  const ph = story ? (round ? 560 : 980) : 360;
  const px = round ? (W - pw) / 2 : 0;
  const name = fit(d.title, W - pad * 2, story ? [92, 80, 72] : [60, 54, 48], 800, 2);
  const nameY = photoTop + ph + (story ? 130 : 96);
  const specY = nameY + (name.lines.length - 1) * name.size * 1.08 + (story ? 76 : 58);
  const introLines = wrap(intro, W - pad * 2 - 40, story ? 40 : 28, 500, 2);
  const bgId = `${uid}-fade`;
  return (
    <g>
      <rect width={W} height={H} fill={mix(primary, '#FFFFFF', 0.94)} />
      <circle cx={W / 2} cy={photoTop + ph / 2} r={(round ? pw / 2 : 0) + 60} fill={alpha(accent, 0.2)} />
      <Portrait x={px} y={photoTop} w={pw} h={ph} round={round} photo={photo} name={d.title} primary={primary} uid={uid} />
      {!round && (
        <>
          <defs>
            <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.55" stopColor={mix(primary, '#FFFFFF', 0.94)} stopOpacity={0} />
              <stop offset="1" stopColor={mix(primary, '#FFFFFF', 0.94)} />
            </linearGradient>
          </defs>
          <rect y={0} width={W} height={ph} fill={`url(#${bgId})`} />
        </>
      )}
      {(story || style === 1) && <BrandMark biz={biz} x={W / 2} y={story ? (round ? 120 : 1040) : 56} size={story ? 84 : 60} uid={uid} nameFill={ink} anchor="middle" nameSize={story ? 36 : 26} />}
      <Pill x={W / 2} y={photoTop + ph - (story ? 36 : 28)} h={story ? 72 : 56} text={d.kicker.toUpperCase()} size={story ? 30 : 24} padX={story ? 32 : 26} bg={primary} fg={onColor(primary)} anchor="middle" spacing={2} />
      <Lines lines={name.lines} x={W / 2} y={nameY} size={name.size} lh={1.08} weight={800} fill={ink} anchor="middle" />
      <text x={W / 2} y={specY} textAnchor="middle" fontSize={story ? 48 : 34} fontWeight={700} fill={deepen(primary)}>
        {exp ? `${specialty} · ${exp}` : specialty}
      </text>
      <Lines lines={introLines} x={W / 2} y={specY + (story ? 90 : 60)} size={story ? 40 : 28} lh={1.35} fill="#475569" anchor="middle" />
      {(d.cta || biz.phone) && <Pill x={W / 2} y={H - (story ? 280 : 116)} h={story ? 120 : 70} text={d.cta || biz.phone} size={story ? 44 : 28} padX={story ? 60 : 36} bg={primary} fg={onColor(primary)} anchor="middle" />}
    </g>
  );
}
