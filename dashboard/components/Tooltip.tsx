"use client";

/** Positioned inside a relative container; flips left near the right edge so it never clips. */
export function Tooltip({ x, y, containerWidth, children }: { x: number; y: number; containerWidth: number; children: React.ReactNode }) {
  const flip = x > containerWidth - 200;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs text-ink shadow-[var(--shadow)]"
      style={{ left: flip ? undefined : x + 14, right: flip ? containerWidth - x + 14 : undefined, top: Math.max(0, y - 8) }}
    >
      {children}
    </div>
  );
}

/** Tooltip row: value leads, the series name follows, keyed by a short line in the series colour. */
export function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-2 text-ink-2">
        {color && <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />}
        {label}
      </span>
      <span className="tabular font-bold text-ink">{value}</span>
    </div>
  );
}
