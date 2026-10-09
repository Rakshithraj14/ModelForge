import { fmtDay, fmtMonth } from "./health";

export type Tick = { i: number; label: string };

/** Day labels for short ranges, month starts for long ones, thinned so labels never collide. */
export function xTicks(days: string[], plotWidth: number, minGap = 52): Tick[] {
  const n = days.length;
  let ticks: Tick[];
  if (n <= 10) {
    ticks = days.map((d, i) => ({ i, label: fmtDay(d) }));
  } else if (n <= 45) {
    ticks = [];
    for (let i = n - 1; i >= 0; i -= 7) ticks.unshift({ i, label: fmtDay(days[i]) });
  } else {
    ticks = days.flatMap((d, i) =>
      d.endsWith("-01") ? [{ i, label: d.slice(5, 7) === "01" ? `${fmtMonth(d)} ${d.slice(0, 4)}` : fmtMonth(d) }] : []
    );
  }
  const step = n > 1 ? plotWidth / (n - 1) : plotWidth;
  const kept: Tick[] = [];
  for (const t of ticks) {
    if (!kept.length || (t.i - kept[kept.length - 1].i) * step >= minGap) kept.push(t);
  }
  return kept;
}
