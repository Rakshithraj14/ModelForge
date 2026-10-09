"use client";

import { useState } from "react";
import { type DayRecord, FEATURES, FEATURE_LABELS, PSI_ALERT, PSI_WATCH, fmtLongDay } from "@/lib/health";
import { xTicks } from "@/lib/ticks";
import { ChartCard, DataTable } from "./ChartCard";
import { TipRow, Tooltip } from "./Tooltip";
import { useWidth } from "./useWidth";

// PSI bands. The first recedes toward the surface (near zero means nothing to see);
// the alert threshold sits between the second and third bands.
const BANDS = [
  { max: PSI_WATCH, fill: "var(--seq-0)", label: "< 0.10" },
  { max: PSI_ALERT, fill: "var(--seq-1)", label: "0.10 to 0.25" },
  { max: 1, fill: "var(--seq-2)", label: "0.25 to 1" },
  { max: 3, fill: "var(--seq-3)", label: "1 to 3" },
  { max: Infinity, fill: "var(--seq-4)", label: "3 or more" },
];
const band = (psi: number) => BANDS.find((b) => psi < b.max)!;

const ROW_H = 26;
const LABEL_W = 168;
const AXIS_H = 22;

export function DriftHeatmap({ days, onSelect }: { days: DayRecord[]; onSelect: (day: string, origin: DOMRect) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ i: number; f: number } | null>(null);
  const n = days.length;
  const narrow = width < 560;
  const labelW = narrow ? 92 : LABEL_W;
  const plotW = Math.max(0, width - labelW);
  const col = n ? plotW / n : 0;
  const gap = col >= 6 ? 2 : col >= 3 ? 1 : 0;
  const height = FEATURES.length * ROW_H + AXIS_H;

  const hit = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - labelW) / (col || 1));
    const f = Math.floor((e.clientY - r.top) / ROW_H);
    return i >= 0 && i < n && f >= 0 && f < FEATURES.length ? { i, f } : null;
  };
  const a = active && days[active.i];

  const chart = (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Population stability index per input feature per day. Darker cells mean the feature has drifted further from training."
          className="block cursor-pointer"
          onPointerMove={(e) => setActive(hit(e))}
          onPointerLeave={() => setActive(null)}
          onClick={(e) => {
            const h = hit(e);
            if (!h) return;
            const r = e.currentTarget.getBoundingClientRect();
            onSelect(days[h.i].day, new DOMRect(r.left + labelW + h.i * col, r.top + h.f * ROW_H, Math.max(col, 6), ROW_H));
          }}
        >
          {FEATURES.map((feature, f) => (
            <g key={feature}>
              <text x={labelW - 10} y={f * ROW_H + ROW_H / 2} dy="0.32em" textAnchor="end" className="fill-[var(--ink-2)] text-[12px]">
                {narrow ? feature.replace("balance", "bal.") : FEATURE_LABELS[feature]}
              </text>
              {days.map((d, i) => {
                const psi = d.drift?.scores[feature];
                return (
                  <rect
                    key={d.day}
                    x={labelW + i * col}
                    y={f * ROW_H + 1}
                    width={Math.max(col - gap, 0.6)}
                    height={ROW_H - 2}
                    rx={col >= 8 ? 2 : 0}
                    fill={psi == null ? "var(--none)" : band(psi).fill}
                  />
                );
              })}
            </g>
          ))}
          {active && (
            <rect
              x={labelW + active.i * col - 1}
              y={active.f * ROW_H}
              width={col + 2}
              height={ROW_H}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={1.5}
              rx={2}
              pointerEvents="none"
            />
          )}
          {xTicks(days.map((d) => d.day), plotW).map((t) => (
            <text key={t.i} x={labelW + t.i * col} y={height - 6} className="fill-[var(--muted)] text-[11px]">
              {t.label}
            </text>
          ))}
        </svg>
      )}
      {a && active && (
        <Tooltip x={labelW + active.i * col} y={active.f * ROW_H + ROW_H} containerWidth={width}>
          <div className="mb-1 font-bold text-ink">{fmtLongDay(a.day)}</div>
          <div className="mb-1 text-ink-2">{FEATURE_LABELS[FEATURES[active.f]]}</div>
          {a.drift ? (
            <>
              <TipRow label="PSI" value={a.drift.scores[FEATURES[active.f]]?.toFixed(3) ?? "not measured"} />
              <TipRow label="Sample" value={`${a.drift.sample_size} predictions`} />
            </>
          ) : (
            <span className="text-ink-2">No drift report</span>
          )}
        </Tooltip>
      )}
    </div>
  );

  return (
    <ChartCard
      title="Feature drift"
      description="How far each input has moved from its training distribution (PSI). The model alerts when any feature reaches 0.25."
      legend={
        <>
          {BANDS.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[3px] border border-line" style={{ background: b.fill }} aria-hidden />
              <span className="tabular">{b.label}</span>
            </span>
          ))}
        </>
      }
      chart={chart}
      table={
        <DataTable
          head={["Day", ...FEATURES.map((f) => FEATURE_LABELS[f]), "Severity"]}
          rows={[...days]
            .reverse()
            .filter((d) => d.drift)
            .map((d) => [d.day, ...FEATURES.map((f) => d.drift!.scores[f]?.toFixed(3) ?? "n/a"), d.drift!.max_severity])}
        />
      }
    />
  );
}
