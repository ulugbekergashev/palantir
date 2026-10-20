export function Logo({ subtitle = 'AI yordamchi', tone = 'paper' }: { subtitle?: string; tone?: 'paper' | 'ink' }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0" />
      <div className="leading-tight">
        <div className={`text-[17px] font-extrabold tracking-tight ${tone === 'ink' ? 'text-white' : ''}`}>Palantir</div>
        <div className={`text-[11px] font-medium ${tone === 'ink' ? 'text-ink-400' : 'text-slate-500'}`}>{subtitle}</div>
      </div>
    </div>
  );
}
