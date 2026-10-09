"use client";

import { ChartLineIcon, TableIcon } from "@phosphor-icons/react";
import { useState } from "react";

/** Every chart ships with a table twin, so no value is reachable only by hovering. */
export function ChartCard({
  title,
  description,
  legend,
  chart,
  table,
  className = "",
}: {
  title: string;
  description: string;
  legend?: React.ReactNode;
  chart: React.ReactNode;
  table: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={`rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h2>
          <p className="mt-0.5 max-w-[60ch] text-sm text-ink-2">{description}</p>
        </div>
        <div role="group" aria-label={`${title} view`} className="flex rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
              }`}
            >
              {v === "chart" ? <ChartLineIcon size={14} aria-hidden /> : <TableIcon size={14} aria-hidden />}
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {legend && view === "chart" && <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">{legend}</div>}
      {view === "chart" ? chart : <div className="max-h-[360px] overflow-auto rounded-[var(--radius-control)] border border-line">{table}</div>}
    </section>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead className="sticky top-0 bg-surface-2">
        <tr>
          {head.map((h) => (
            <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-ink-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular">
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">
            {r.map((cell, j) => (
              <td key={j} className="whitespace-nowrap px-3 py-1.5 text-ink">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
