/**
 * Palantir — ko'ruvchi tosh (logotip bilan bir xil: scripts/logo.ts): qora tutunli shisha shar, ichida olov va sekin aylanayotgan
 * uyurma, chetida shisha aksi. Uslublar — index.css (.palantir). Ota element o'lchamini to'ldiradi.
 * Ovoz: ota elementdagi --mic (siz gapiryapsiz) va --ai (Palantir gapiryapti) ichki olovni yoqadi (useVoice).
 */
/** Logotipdagi uyurma va aks (koordinatalar: shar markazi 0,0, radiusi 44) */
const SWIRL = 'M3 6A3.6 3.6 0 0 1 10.2 6A7.2 7.2 0 0 1 -4.2 6A10.8 10.8 0 0 1 17.4 6A14.4 14.4 0 0 1 -11.4 6';
const GLINT = 'M-34.8 -12.7A37 37 0 0 1 -6.4 -36.4';

export function PalantirOrb({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`palantir block h-full w-full ${className}`}>
      <i className="halo" />
      <i className="glass">
        <i className="core" />
        <i className="smoke-a" />
        <i className="smoke-b" />
        <svg className="swirl" viewBox="-50 -50 100 100">
          <path d={SWIRL} fill="none" stroke="#FFD29A" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <i className="depth" />
        <svg className="glint" viewBox="-50 -50 100 100">
          <defs>
            <radialGradient id="palantir-glint" cx="-24" cy="-28" r="22" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.05" />
            </radialGradient>
          </defs>
          <path d={GLINT} fill="none" stroke="url(#palantir-glint)" strokeWidth="4.2" strokeLinecap="round" />
        </svg>
      </i>
    </span>
  );
}
