"use client";

import { useEffect, useState } from "react";
import { type DayRecord, fmtLongDay, hasRecallSignal } from "@/lib/health";
import { xTicks } from "@/lib/ticks";
import { STATUS, StatusTag } from "./status";
import { Tooltip } from "./Tooltip";
import { useWidth } from "./useWidth";

const BAR_H = 64;
const AXIS_H = 22;
const MIN_COL = 2.4; // below this the strip scrolls instead of squeezing days into sub-pixels

export function VitalsStrip({ days, onSelect }: { days: DayRecord[]; onSelect: (day: string, origin: DOMRect) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [scroll, setScroll] = useState(0);
  const n = days.length;
  const stripW = Math.max(width, Math.ceil(n * MIN_COL));
  const col = n ? stripW / n : 0;
  const gap = col >= 4 ? 1 : 0;

  // On a scrolling (narrow) strip, start at the most recent day.
  useEffect(() => {
    const el = ref.current;
    if (el && stripW > width) {
      el.scrollLeft = el.scrollWidth;
      setScroll(el.scrollLeft);
    }
  }, [ref, stripW, width]);

  const indexAt = (clientX: number, rect: DOMRect) => Math.max(0, Math.min(n - 1, Math.floor((clientX - rect.left) / (col || 1))));
  const originAt = (i: number, svg: Element) => {
    const r = svg.getBoundingClientRect();
    return new DOMRect(r.left + i * col, r.top, Math.max(col, 6), BAR_H);
  };
  const d = active != null ? days[active] : null;

  return (
    <div className="relative">
      <div
        ref={ref}
        className="overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]"
        onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
      >
        {width > 0 && (
          <svg
            width={stripW}
            height={BAR_H + AXIS_H}
            role="img"
            aria-label={`Daily model health for the last ${n} days. Use arrow keys to move between days and Enter to open one.`}
            tabIndex={0}
            className="block cursor-pointer rounded-[var(--radius-control)]"
            onPointerMove={(e) => setActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
            onClick={(e) => {
              const i = indexAt(e.clientX, e.currentTarget.getBoundingClientRect());
              onSelect(days[i].day, originAt(i, e.currentTarget));
            }}
            onFocus={() => setActive((a) => a ?? n - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
              else if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
              else if ((e.key === "Enter" || e.key === " ") && active != null) onSelect(days[active].day, originAt(active, e.currentTarget));
              else return;
              e.preventDefault();
            }}
          >
            {days.map((day, i) => (
              <rect
                key={day.day}
                x={i * col}
                y={day.status === "none" ? BAR_H * 0.55 : 0}
                width={Math.max(col - gap, 0.6)}
                height={day.status === "none" ? BAR_H * 0.45 : BAR_H}
                rx={col >= 6 ? 2 : 0}
                fill={day.status === "none" ? "var(--none)" : STATUS[day.status].color}
                opacity={active == null || active === i ? 1 : 0.55}
              />
            ))}
            {active != null && (
              <rect x={active * col - 1} y={-0.5} width={col + 2} height={BAR_H + 1} fill="none" stroke="var(--ink)" strokeWidth={1.5} rx={2} pointerEvents="none" />
            )}
            {xTicks(days.map((x) => x.day), stripW, 44).map((t) => (
              <text key={t.i} x={t.i * col} y={BAR_H + 16} className="fill-[var(--muted)] text-[11px]">
                {t.label}
              </text>
            ))}
          </svg>
        )}
      </div>
      {d && active != null && (
        <Tooltip x={Math.max(0, Math.min(active * col - scroll, width))} y={BAR_H + 4} containerWidth={width}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="font-bold text-ink">{fmtLongDay(d.day)}</span>
          </div>
          <StatusTag status={d.status} />
          <ul className="mt-2 space-y-0.5 text-ink-2">
            {d.reasons.length ? d.reasons.map((r) => <li key={r}>{r}</li>) : <li>{d.status === "none" ? "No reports on this day" : "All checks within limits"}</li>}
            {hasRecallSignal(d.performance) && <li className="tabular">Recall {d.performance.recall.toFixed(2)}</li>}
          </ul>
        </Tooltip>
      )}
    </div>
  );
}
