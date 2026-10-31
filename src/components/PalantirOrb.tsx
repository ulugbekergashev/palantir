/**
 * Palantir — ko'ruvchi tosh: qora shisha shar, ichida sekin aylanayotgan tutun va chuqurda cho'g' (logo bilan bir rasm: scripts/stone-art.ts).
 * Uslublar — index.css (.palantir). Ota element o'lchamini to'ldiradi.
 * Ovoz: ota elementdagi --mic (siz gapiryapsiz) va --ai (Palantir gapiryapti) ichki olovni yoqadi (useVoice).
 * tone — xodim tusi (sukut — palantir cho'g'i); live — suhbat ketyapti, tutun tezroq aylanadi.
 */
import type { CSSProperties } from 'react';

export interface StoneTone { hot: string; warm: string; deep: string }

export function PalantirOrb({ className = '', tone, live = false }: { className?: string; tone?: StoneTone; live?: boolean }) {
  const style = tone ? ({ '--hot': tone.hot, '--warm': tone.warm, '--deep': tone.deep } as CSSProperties) : undefined;
  return (
    <span aria-hidden="true" style={style} className={`palantir h-full w-full ${live ? 'live' : ''} ${className}`}>
      <i className="halo" />
      <i className="glass">
        <i className="glow" />
        <i className="fog" />
        <i className="wisp" />
        <i className="core" />
        <i className="depth" />
        <i className="caustic" />
        <i className="shine" />
      </i>
    </span>
  );
}
