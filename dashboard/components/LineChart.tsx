"use client";

import { useState } from "react";
import { xTicks } from "@/lib/ticks";
import { Tooltip } from "./Tooltip";
import { useWidth } from "./useWidth";

export type Series = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** The series the story is about: drawn last, end-labelled. */
  emphasis?: boolean;
};

type Props = {
  days: string[];
  series: Series[];
  yMax: number;
  yTicks: number[];
  formatY: (v: number) => string;
  area?: boolean;
  threshold?: { value: number; label: string };
  height?: number;
  ariaLabel: string;
  tooltip: (i: number) => React.ReactNode;
  onSelect?: (i: number, origin: DOMRect) => void;
};

const M = { top: 14, right: 52, bottom: 26, left: 40 };

/** Splits a series at nulls so a missing day reads as a gap, never as an interpolated line. */
function segments(values: (number | null)[]) {
  const out: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push({ i, v });
  });
  if (run.length) out.push(run);
  return out;
}

export function LineChart({ days, series, yMax, yTicks, formatY, area, threshold, height = 240, ariaLabel, tooltip, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = (i: number) => M.left + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => M.top + plotH * (1 - Math.min(v, yMax) / yMax);
  const nearest = (clientX: number, rect: DOMRect) =>
    Math.max(0, Math.min(n - 1, Math.round(((clientX - rect.left - M.left) / (plotW || 1)) * (n - 1))));

  const ordered = [...series].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis));
  const lead = series.find((s) => s.emphasis) ?? series[0];
  const lastIdx = lead.values.findLastIndex((v) => v != null);

  const originAt = (i: number, svg: Element) => {
    const r = svg.getBoundingClientRect();
    const v = lead.values[i];
    return new DOMRect(r.left + x(i) - 4, r.top + (v == null ? M.top + plotH / 2 : y(v)) - 4, 8, 8);
  };

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className="block touch-pan-y rounded-[var(--radius-control)]"
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onClick={(e) => {
            const i = nearest(e.clientX, e.currentTarget.getBoundingClientRect());
            onSelect?.(i, originAt(i, e.currentTarget));
          }}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
            else if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
            else if ((e.key === "Enter" || e.key === " ") && active != null) onSelect?.(active, originAt(active, e.currentTarget));
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
          style={{ cursor: onSelect ? "pointer" : undefined }}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--line)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--muted)] text-[11px]">
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks(days, plotW).map((t) => (
            <text key={t.i} x={x(t.i)} y={height - 6} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
              {t.label}
            </text>
          ))}
          {threshold && (
            <g>
              <line x1={M.left} x2={M.left + plotW} y1={y(threshold.value)} y2={y(threshold.value)} stroke="var(--ink-2)" strokeWidth={1} />
              {/* right-aligned, below the rule, with a surface halo so crossing lines never cut it */}
              <text
                x={M.left + plotW - 4}
                y={y(threshold.value) + 14}
                textAnchor="end"
                stroke="var(--surface)"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="fill-[var(--ink-2)] text-[11px] font-medium"
              >
                {threshold.label}
              </text>
            </g>
          )}
          {ordered.map((s) => {
            const segs = segments(s.values);
            const line = segs.map((seg) => seg.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join("")).join("");
            return (
              <g key={s.key}>
                {area &&
                  segs.map((seg, k) => (
                    <path
                      key={k}
                      d={`${seg.map((p, j) => `${j ? "L" : "M"}${x(p.i)},${y(p.v)}`).join("")}L${x(seg[seg.length - 1].i)},${y(0)}L${x(seg[0].i)},${y(0)}Z`}
                      fill={s.color}
                      opacity={0.1}
                    />
                  ))}
                <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {lastIdx >= 0 && active == null && (
            <g>
              <circle cx={x(lastIdx)} cy={y(lead.values[lastIdx]!)} r={4} fill={lead.color} stroke="var(--surface)" strokeWidth={2} />
              <text x={x(lastIdx) + 8} y={y(lead.values[lastIdx]!)} dy="0.32em" className="tabular fill-[var(--ink)] text-[12px] font-bold">
                {formatY(lead.values[lastIdx]!)}
              </text>
            </g>
          )}
          {active != null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--baseline)" strokeWidth={1} />
              {series.map((s) =>
                s.values[active] == null ? null : (
                  <circle key={s.key} cx={x(active)} cy={y(s.values[active]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                )
              )}
            </g>
          )}
        </svg>
      )}
      {active != null && (
        <Tooltip x={x(active)} y={M.top} containerWidth={width}>
          {tooltip(active)}
        </Tooltip>
      )}
    </div>
  );
}
