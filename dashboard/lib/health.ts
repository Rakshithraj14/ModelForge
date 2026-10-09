import type { Alert, Daily, DriftDay, PerformanceDay, TrafficDay } from "./schema";

// Same thresholds the Worker alerts on (worker/src/drift.js, worker/src/index.js).
export const PSI_WATCH = 0.1;
export const PSI_ALERT = 0.25;
export const RECALL_ALERT = 0.8;

export type Status = "healthy" | "watch" | "alert" | "none";

export type DayRecord = {
  day: string; // YYYY-MM-DD, UTC
  drift: DriftDay | null;
  performance: PerformanceDay | null;
  traffic: TrafficDay | null;
  status: Status;
  reasons: string[];
};

export const FEATURES = ["amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest", "type"] as const;

export const FEATURE_LABELS: Record<string, string> = {
  amount: "Amount",
  oldbalanceOrg: "Sender balance, before",
  newbalanceOrig: "Sender balance, after",
  oldbalanceDest: "Receiver balance, before",
  newbalanceDest: "Receiver balance, after",
  type: "Transaction type",
};

/** Recall only counts when the report window actually contained fraud. */
export function hasRecallSignal(p: PerformanceDay | null): p is PerformanceDay {
  return p !== null && p.fraud_cases !== null && p.fraud_cases > 0;
}

export function statusOf(drift: DriftDay | null, performance: PerformanceDay | null): { status: Status; reasons: string[] } {
  const reasons: string[] = [];
  let status: Status = drift || performance ? "healthy" : "none";

  if (drift?.max_severity === "HIGH") {
    status = "alert";
    const worst = Object.entries(drift.scores).sort((a, b) => b[1] - a[1])[0];
    reasons.push(`${FEATURE_LABELS[worst[0]] ?? worst[0]} drifted (PSI ${worst[1].toFixed(2)})`);
  } else if (drift?.max_severity === "MEDIUM") {
    status = "watch";
    reasons.push("Moderate feature drift");
  }

  if (hasRecallSignal(performance) && performance.recall < RECALL_ALERT) {
    status = "alert";
    reasons.push(`Recall ${performance.recall.toFixed(2)}, below ${RECALL_ALERT}`);
  }
  return { status, reasons };
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** Every calendar day from the first to the last report, gaps included, so time reads honestly. */
export function buildDays(daily: Daily): DayRecord[] {
  const drift = new Map(daily.drift.map((d) => [d.day, d]));
  const performance = new Map(daily.performance.map((d) => [d.day, d]));
  const traffic = new Map(daily.traffic.map((d) => [d.day, d]));
  const all = [...drift.keys(), ...performance.keys(), ...traffic.keys()].sort();
  if (all.length === 0) return [];

  const records: DayRecord[] = [];
  for (let day = all[0]; day <= all[all.length - 1]; day = addDays(day, 1)) {
    const d = drift.get(day) ?? null;
    const p = performance.get(day) ?? null;
    records.push({ day, drift: d, performance: p, traffic: traffic.get(day) ?? null, ...statusOf(d, p) });
  }
  return records;
}

export const RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "1y", label: "1Y", days: 365 },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export function sliceRange(days: DayRecord[], n: number) {
  return { current: days.slice(-n), previous: days.slice(-2 * n, -n) };
}

export function alertsInRange(alerts: Alert[], first: string, last: string) {
  return alerts.filter((a) => a.ts.slice(0, 10) >= first && a.ts.slice(0, 10) <= last);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function summarize(days: DayRecord[]) {
  const recalls = days.map((d) => d.performance).filter(hasRecallSignal);
  let worst: { feature: string; psi: number; day: string } | null = null;
  for (const d of days) {
    for (const [feature, psi] of Object.entries(d.drift?.scores ?? {})) {
      if (!worst || psi > worst.psi) worst = { feature, psi, day: d.day };
    }
  }
  return {
    predictions: days.reduce((s, d) => s + (d.traffic?.predictions ?? 0), 0),
    flagRate: mean(days.flatMap((d) => (d.traffic ? [d.traffic.flagged_rate] : []))),
    latency: mean(days.flatMap((d) => (d.traffic?.avg_latency_ms != null ? [d.traffic.avg_latency_ms] : []))),
    recall: mean(recalls.map((p) => p.recall)),
    latestRecall: recalls.at(-1) ?? null,
    worst,
    counts: {
      healthy: days.filter((d) => d.status === "healthy").length,
      watch: days.filter((d) => d.status === "watch").length,
      alert: days.filter((d) => d.status === "alert").length,
    },
  };
}

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
export const fmtDay = (day: string) => dateFmt.format(new Date(day));
export const fmtLongDay = (day: string) => longFmt.format(new Date(day));
export const fmtMonth = (day: string) => monthFmt.format(new Date(day));
export const fmtPct = (x: number | null, digits = 1) => (x == null ? "n/a" : `${(x * 100).toFixed(digits)}%`);
export const fmtInt = (x: number) => new Intl.NumberFormat("en").format(x);
