// The ModelForge mark: a forge-navy tile carrying an ember pulse (a model's vital sign).
// Colours are fixed, not themed, so the mark reads the same in light and dark.
export const MARK_TILE = "#1d2f5e";
export const MARK_PULSE = "#f06a2c";
export const PULSE_PATH = "M5 17h6l2.5-7 4 13 3-10 2 4H27";

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill={MARK_TILE} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="none" stroke="rgb(255 255 255 / 0.14)" />
      <path d={PULSE_PATH} fill="none" stroke={MARK_PULSE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display text-[19px] font-bold tracking-tight text-ink">ModelForge</span>
    </span>
  );
}
