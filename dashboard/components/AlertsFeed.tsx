"use client";

import { ChartLineIcon, MagnifyingGlassIcon, TargetIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { fmtDay } from "@/lib/health";
import type { Alert } from "@/lib/schema";
import { StatusTag } from "./status";

const KINDS = [
  { key: "all", label: "All" },
  { key: "drift", label: "Drift" },
  { key: "performance", label: "Performance" },
] as const;
const PAGE = 6;

const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(ts: string, now: number) {
  const days = Math.round((Date.parse(ts) - now) / 86_400_000);
  if (days === 0) return "today";
  if (Math.abs(days) < 31) return rel.format(days, "day");
  return rel.format(Math.round(days / 30), "month");
}

export function AlertsFeed({ alerts, now, onSelect }: { alerts: Alert[]; now: number; onSelect: (day: string, origin: DOMRect) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("all");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter((a) => (kind === "all" || a.kind === kind) && (!q || a.message.toLowerCase().includes(q)));
  }, [alerts, query, kind]);
  const shown = expanded ? filtered : filtered.slice(0, PAGE);

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">Alerts</h2>
        <p className="mt-0.5 text-sm text-ink-2">Sent to Telegram and the webhook when a check crosses its threshold, at most once a day per kind.</p>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="alert-search" className="text-xs font-medium text-ink-2">
            Search messages
          </label>
          <div className="relative">
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="alert-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setExpanded(false);
              }}
              placeholder="amount, recall, type"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-focus focus:outline-none"
            />
          </div>
        </div>
        <div role="group" aria-label="Alert kind" className="flex h-9 rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
          {KINDS.map((k) => {
            const count = k.key === "all" ? alerts.length : alerts.filter((a) => a.kind === k.key).length;
            return (
              <button
                key={k.key}
                type="button"
                aria-pressed={kind === k.key}
                onClick={() => {
                  setKind(k.key);
                  setExpanded(false);
                }}
                className={`rounded-[8px] px-3 text-xs font-medium transition-colors ${kind === k.key ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
              >
                {k.label} <span className="tabular text-muted">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-8 text-center text-sm text-ink-2">
          {alerts.length === 0 ? (
            "No alerts in this range. Checks run every 15 minutes and alerts land here when one crosses its threshold."
          ) : (
            <>
              No alerts match {query ? <strong className="text-ink">&ldquo;{query}&rdquo;</strong> : "this filter"}.{" "}
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-4"
                onClick={() => {
                  setQuery("");
                  setKind("all");
                }}
              >
                <XIcon size={12} aria-hidden />
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => {
            const KindIcon = a.kind === "drift" ? ChartLineIcon : TargetIcon;
            const [headline, ...detail] = a.message.split("\n");
            return (
              <li key={`${a.ts}-${a.kind}`}>
                <button
                  type="button"
                  onClick={(e) => onSelect(a.ts.slice(0, 10), e.currentTarget.getBoundingClientRect())}
                  className="group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[8px] px-2 py-3 text-left transition-colors hover:bg-surface-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[8px] bg-surface-2 text-ink-2 group-hover:bg-surface">
                    <KindIcon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium capitalize text-ink">{a.kind}</span>
                      <StatusTag status="alert" />
                    </span>
                    <span className="mt-1 line-clamp-2 text-sm text-ink-2 sm:block sm:truncate">{headline}</span>
                    {detail[0] && <span className="block truncate text-xs text-muted">{detail.join(", ")}</span>}
                  </span>
                  <span className="col-start-2 text-xs text-muted sm:col-start-auto sm:text-right">
                    <span className="tabular block text-ink-2">{fmtDay(a.ts.slice(0, 10))}</span>
                    {ago(a.ts, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > PAGE && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-3 h-9 w-full rounded-[var(--radius-control)] border border-line text-sm font-medium text-ink transition-colors hover:bg-surface-2 active:scale-[0.99]"
        >
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </button>
      )}
    </section>
  );
}
