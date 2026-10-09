"use client";

import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";

type Delta = { text: string; direction: "up" | "down" | "flat"; good?: boolean | null };

/** Stat tile: label, value, optional delta vs a named period, optional sparkline. */
export function StatTile({
  label,
  value,
  sub,
  delta,
  trend,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  delta?: Delta | null;
  trend?: (number | null)[];
}) {
  const Arrow = delta?.direction === "up" ? ArrowUpRightIcon : delta?.direction === "down" ? ArrowDownRightIcon : ArrowRightIcon;
  const deltaColor = delta?.good == null ? "var(--ink-2)" : delta.good ? "var(--delta-good)" : "var(--delta-bad)";
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow)]">
      <span className="text-sm text-ink-2">{label}</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="font-sans text-[28px] font-bold leading-none tracking-tight text-ink">{value}</span>
        {trend && <Sparkline values={trend} />}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 text-xs text-ink-2">
        {delta && (
          <span className="tabular inline-flex items-center gap-0.5 font-medium" style={{ color: deltaColor }}>
            <Arrow size={13} weight="bold" aria-hidden />
            {delta.text}
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

function Sparkline({ values, w = 84, h = 28 }: { values: (number | null)[]; w?: number; h?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 2 + (i * (w - 6)) / (values.length - 1);
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <path d={pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join("")} fill="none" stroke="var(--series-context)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
