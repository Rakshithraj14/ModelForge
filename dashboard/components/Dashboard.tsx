"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import type { DashboardData } from "@/lib/data";
import {
  FEATURE_LABELS,
  PSI_ALERT,
  PSI_WATCH,
  RANGES,
  type RangeKey,
  alertsInRange,
  buildDays,
  fmtDay,
  fmtInt,
  fmtLongDay,
  fmtPct,
  hasRecallSignal,
  sliceRange,
  summarize,
} from "@/lib/health";
import { AlertsFeed } from "./AlertsFeed";
import { ChartCard, DataTable } from "./ChartCard";
import { DaySheet, type SheetState } from "./DaySheet";
import { DriftHeatmap } from "./DriftHeatmap";
import { LineChart } from "./LineChart";
import { Wordmark } from "./Logo";
import { StatTile } from "./StatTile";
import { STATUS, StatusTag } from "./status";
import { ThemeToggle } from "./ThemeToggle";
import { TipRow } from "./Tooltip";
import { VitalsStrip } from "./VitalsStrip";

function headline(status: string, reasons: string[]) {
  if (status === "alert") return reasons.some((r) => r.startsWith("Recall")) ? "Recall is below target" : "Inputs have drifted from training";
  if (status === "watch") return "Moderate drift, still within limits";
  if (status === "none") return "No reports yet";
  return "All checks within limits";
}

const niceCeil = (x: number, step: number) => Math.max(step, Math.ceil(x / step) * step);

export function Dashboard({ data }: { data: DashboardData }) {
  const reduce = useReducedMotion();
  const [range, setRange] = useState<RangeKey>("90d");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // "3 days ago" is relative to the snapshot, not the viewer's clock, so it never goes stale.
  const now = Date.parse(data.snapshotAt);

  const days = useMemo(() => buildDays(data.daily), [data.daily]);
  const span = RANGES.find((r) => r.key === range)!.days;
  const { current, previous } = useMemo(() => sliceRange(days, span), [days, span]);
  const cur = useMemo(() => summarize(current), [current]);
  const prev = useMemo(() => summarize(previous), [previous]);
  const year = useMemo(() => summarize(days.slice(-365)), [days]);
  const rangeAlerts = useMemo(
    () => (current.length ? alertsInRange(data.alerts, current[0].day, current[current.length - 1].day) : []),
    [data.alerts, current]
  );

  const openDay = useCallback((day: string, origin: DOMRect) => setSheet({ day, origin, phase: reduce ? "open" : "ghost" }), [reduce]);
  const onOpened = useCallback(() => setSheet((s) => s && { ...s, phase: "open" }), []);
  const onClose = useCallback(() => setSheet((s) => (!s || reduce ? null : { ...s, phase: "closing" })), [reduce]);
  const onClosed = useCallback(() => setSheet(null), []);
  const onNavigate = useCallback((day: string) => setSheet((s) => s && { ...s, day }), []);

  const latest = days.at(-1);
  // Always animate to the end state: the static HTML ships the initial (hidden) style, so
  // under reduced motion we jump there instantly instead of skipping the animation.
  const reveal = (i: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { delay: 0.05 * i, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  });

  const recallSeries = current.map((d) => (hasRecallSignal(d.performance) ? d.performance.recall : null));
  const precisionSeries = current.map((d) => (hasRecallSignal(d.performance) ? d.performance.precision : null));
  const flagSeries = current.map((d) => d.traffic?.flagged_rate ?? null);
  const flagMax = niceCeil(Math.max(0, ...flagSeries.map((v) => v ?? 0)), 0.05);
  const pctDelta = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6">
          <Wordmark />
          <div className="flex items-center gap-2 sm:gap-3">
            {latest && <span className="hidden text-xs text-ink-2 sm:inline">Snapshot through {fmtDay(latest.day)}</span>}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] space-y-6 px-4 pb-16 pt-6 sm:px-6">
        {!latest ? (
          <section className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface p-10 text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">No reports yet</h1>
            <p className="mx-auto mt-3 max-w-[52ch] text-ink-2">
              Send predictions through the model service. The Worker records each one, and its 15 minute checks start writing drift and performance reports
              here.
            </p>
          </section>
        ) : (
          <>
            <motion.section {...reveal(0)} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-7">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="min-w-0">
                  <p className="text-sm text-ink-2">
                    <span className="font-medium text-ink">{data.modelId}</span>, latest report {fmtLongDay(latest.day)}
                  </p>
                  <h1 className="mt-2 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink md:text-5xl">
                    {headline(latest.status, latest.reasons)}
                  </h1>
                  <p className="mt-3 max-w-[60ch] text-ink-2">
                    {latest.reasons.length ? `${latest.reasons.join(". ")}.` : "Drift, recall and data quality are inside their thresholds."} {year.counts.alert} alert
                    days in the last year.
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-5 sm:gap-8" aria-label="Days by health, last year">
                  {(["healthy", "watch", "alert"] as const).map((s) => {
                    const { Icon, color, label } = STATUS[s];
                    return (
                      <div key={s}>
                        <dt className="flex items-center gap-1.5 text-sm text-ink-2">
                          <Icon weight="fill" size={15} color={color} aria-hidden />
                          {label}
                        </dt>
                        <dd className="mt-1 text-2xl font-bold text-ink">
                          {year.counts[s]}
                          <span className="ml-1 text-sm font-medium text-muted">days</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
              <div className="mt-7">
                <VitalsStrip days={days.slice(-365)} onSelect={openDay} />
              </div>
            </motion.section>

            <motion.div {...reveal(1)} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="group" aria-label="Time range" className="flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5 shadow-[var(--shadow)]">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={range === r.key}
                    onClick={() => setRange(r.key)}
                    className={`h-8 rounded-[8px] px-3.5 text-sm font-medium transition-colors ${
                      range === r.key ? "bg-brand text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <span className="text-sm text-ink-2">
                {fmtDay(current[0].day)} to {fmtDay(current[current.length - 1].day)}
              </span>
            </motion.div>

            <motion.div {...reveal(2)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Predictions"
                value={fmtInt(cur.predictions)}
                trend={current.map((d) => d.traffic?.predictions ?? null)}
                delta={(() => {
                  const d = previous.length ? pctDelta(cur.predictions, prev.predictions) : null;
                  return d == null ? null : { text: `${Math.abs(d).toFixed(1)}% vs prior ${span}d`, direction: d > 0.05 ? "up" : d < -0.05 ? "down" : "flat", good: null };
                })()}
              />
              <StatTile
                label="Flagged as fraud"
                value={fmtPct(cur.flagRate)}
                trend={flagSeries}
                delta={
                  cur.flagRate != null && prev.flagRate != null
                    ? {
                        text: `${Math.abs((cur.flagRate - prev.flagRate) * 100).toFixed(1)} pts vs prior ${span}d`,
                        direction: cur.flagRate > prev.flagRate + 0.0005 ? "up" : cur.flagRate < prev.flagRate - 0.0005 ? "down" : "flat",
                        good: null,
                      }
                    : null
                }
              />
              <StatTile
                label="Recall, mean"
                value={cur.recall == null ? "n/a" : cur.recall.toFixed(2)}
                trend={recallSeries}
                sub={cur.recall == null ? "No labeled fraud in range" : undefined}
                delta={
                  cur.recall != null && prev.recall != null
                    ? {
                        text: `${Math.abs(cur.recall - prev.recall).toFixed(2)} vs prior ${span}d`,
                        direction: cur.recall > prev.recall + 0.005 ? "up" : cur.recall < prev.recall - 0.005 ? "down" : "flat",
                        good: cur.recall >= prev.recall,
                      }
                    : null
                }
              />
              <StatTile
                label="Largest drift"
                value={cur.worst ? cur.worst.psi.toFixed(2) : "n/a"}
                sub={
                  cur.worst ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusTag status={cur.worst.psi >= PSI_ALERT ? "alert" : cur.worst.psi >= PSI_WATCH ? "watch" : "healthy"} />
                      {FEATURE_LABELS[cur.worst.feature]}, {fmtDay(cur.worst.day)}
                    </span>
                  ) : undefined
                }
              />
            </motion.div>

            <motion.div {...reveal(3)}>
              <DriftHeatmap days={current} onSelect={openDay} />
            </motion.div>

            <motion.div {...reveal(4)} className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <ChartCard
                title="Recall and precision"
                description="Scored against fraud labels, which arrive about a week after each prediction. Recall below 0.80 raises an alert."
                legend={
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded-full bg-[var(--series-1)]" aria-hidden /> Recall
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 rounded-full bg-[var(--series-context)]" aria-hidden /> Precision
                    </span>
                  </>
                }
                chart={
                  <LineChart
                    days={current.map((d) => d.day)}
                    series={[
                      { key: "precision", label: "Precision", color: "var(--series-context)", values: precisionSeries },
                      { key: "recall", label: "Recall", color: "var(--series-1)", values: recallSeries, emphasis: true },
                    ]}
                    yMax={1}
                    yTicks={[0, 0.25, 0.5, 0.75, 1]}
                    formatY={(v) => v.toFixed(2)}
                    threshold={{ value: 0.8, label: "Alert below 0.80" }}
                    ariaLabel="Recall and precision per day. Use arrow keys to move between days and Enter to open one."
                    onSelect={(i, origin) => openDay(current[i].day, origin)}
                    tooltip={(i) => {
                      const d = current[i];
                      return (
                        <>
                          <div className="mb-1 font-bold">{fmtLongDay(d.day)}</div>
                          {hasRecallSignal(d.performance) ? (
                            <>
                              <TipRow color="var(--series-1)" label="Recall" value={d.performance.recall.toFixed(2)} />
                              <TipRow color="var(--series-context)" label="Precision" value={d.performance.precision.toFixed(2)} />
                              <TipRow label="F1" value={d.performance.f1.toFixed(2)} />
                              <TipRow label="Fraud cases" value={String(d.performance.fraud_cases)} />
                            </>
                          ) : (
                            <span className="text-ink-2">No labeled fraud, recall not measurable</span>
                          )}
                        </>
                      );
                    }}
                  />
                }
                table={
                  <DataTable
                    head={["Day", "Recall", "Precision", "F1", "Accuracy", "Fraud cases"]}
                    rows={[...current]
                      .reverse()
                      .filter((d) => d.performance)
                      .map((d) => {
                        const p = d.performance!;
                        const ok = hasRecallSignal(p);
                        return [d.day, ok ? p.recall.toFixed(3) : "n/a", ok ? p.precision.toFixed(3) : "n/a", ok ? p.f1.toFixed(3) : "n/a", p.accuracy.toFixed(3), p.fraud_cases ?? "unknown"];
                      })}
                  />
                }
              />
              <ChartCard
                title="Flagged as fraud"
                description="Share of transactions the model flags each day. A shift here, with no change in recall, means the inputs moved."
                chart={
                  <LineChart
                    days={current.map((d) => d.day)}
                    series={[{ key: "flagged", label: "Flagged", color: "var(--series-1)", values: flagSeries, emphasis: true }]}
                    area
                    yMax={flagMax}
                    yTicks={Array.from({ length: Math.round(flagMax / 0.05) + 1 }, (_, k) => k * 0.05).filter((_, k, a) => a.length <= 6 || k % 2 === 0)}
                    formatY={(v) => `${Math.round(v * 100)}%`}
                    ariaLabel="Share of transactions flagged as fraud per day"
                    onSelect={(i, origin) => openDay(current[i].day, origin)}
                    tooltip={(i) => {
                      const d = current[i];
                      return (
                        <>
                          <div className="mb-1 font-bold">{fmtLongDay(d.day)}</div>
                          {d.traffic ? (
                            <>
                              <TipRow color="var(--series-1)" label="Flagged" value={fmtPct(d.traffic.flagged_rate)} />
                              <TipRow label="Predictions" value={fmtInt(d.traffic.predictions)} />
                            </>
                          ) : (
                            <span className="text-ink-2">No predictions</span>
                          )}
                        </>
                      );
                    }}
                  />
                }
                table={
                  <DataTable
                    head={["Day", "Flagged", "Predictions", "Avg latency (ms)", "Data quality"]}
                    rows={[...current]
                      .reverse()
                      .filter((d) => d.traffic)
                      .map((d) => [
                        d.day,
                        fmtPct(d.traffic!.flagged_rate),
                        d.traffic!.predictions,
                        d.traffic!.avg_latency_ms?.toFixed(1) ?? "n/a",
                        d.traffic!.avg_data_quality?.toFixed(0) ?? "n/a",
                      ])}
                  />
                }
              />
            </motion.div>

            <motion.div {...reveal(5)}>
              <AlertsFeed alerts={rangeAlerts} now={now} onSelect={openDay} />
            </motion.div>
          </>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-8 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark size={22} />
          <p>Model Doctor watches drift, performance and data quality for models served from the VPS.</p>
        </div>
      </footer>

      <DaySheet
        sheet={sheet}
        days={days}
        alerts={data.alerts}
        onOpened={onOpened}
        onClose={onClose}
        onClosed={onClosed}
        onNavigate={onNavigate}
      />
    </>
  );
}
