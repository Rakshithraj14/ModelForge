"use client";

import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import {
  type DayRecord,
  FEATURES,
  FEATURE_LABELS,
  PSI_ALERT,
  PSI_WATCH,
  fmtInt,
  fmtLongDay,
  fmtPct,
  hasRecallSignal,
} from "@/lib/health";
import type { Alert } from "@/lib/schema";
import { StatusTag } from "./status";

export type SheetState = { day: string; origin: DOMRect; phase: "ghost" | "open" | "closing" };

const SPRING = { type: "spring", stiffness: 420, damping: 40 } as const;

/**
 * The sheet morphs out of whatever was clicked (an alert row, a strip day, a heatmap cell)
 * and back into it on close. SVG cells can't carry a layoutId, so a ghost box is placed
 * at the clicked rect and the sheet shares its layoutId.
 */
export function DaySheet({
  sheet,
  days,
  alerts,
  onOpened,
  onClose,
  onClosed,
  onNavigate,
}: {
  sheet: SheetState | null;
  days: DayRecord[];
  alerts: Alert[];
  onOpened: () => void;
  onClose: () => void;
  onClosed: () => void;
  onNavigate: (day: string) => void;
}) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const isOpen = sheet?.phase === "open";

  // ghost -> open on the next frame, so the ghost is laid out before the sheet takes over
  useEffect(() => {
    if (sheet?.phase !== "ghost") return;
    opener.current = document.activeElement;
    const id = requestAnimationFrame(onOpened);
    return () => cancelAnimationFrame(id);
  }, [sheet?.phase, onOpened]);

  useEffect(() => {
    if (!isOpen) return;
    closeBtn.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen]);

  const idx = sheet ? days.findIndex((d) => d.day === sheet.day) : -1;
  const record = idx >= 0 ? days[idx] : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowLeft" && idx > 0) onNavigate(days[idx - 1].day);
    else if (e.key === "ArrowRight" && idx < days.length - 1) onNavigate(days[idx + 1].day);
    else if (e.key === "Tab" && panel.current) {
      const f = panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex='0']");
      if (!f.length) return;
      const [first, last] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) last.focus();
      else if (!e.shiftKey && document.activeElement === last) first.focus();
      else return;
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-[rgb(10_14_22/0.38)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && !isOpen && !reduce && (
          <motion.div
            key="ghost"
            layoutId="day-sheet"
            transition={SPRING}
            className="fixed z-50 border border-line bg-surface"
            style={{ left: sheet.origin.left, top: sheet.origin.top, width: sheet.origin.width, height: sheet.origin.height, borderRadius: 6 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            onLayoutAnimationComplete={() => sheet.phase === "closing" && onClosed()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && record && (
          <motion.div
            key="sheet"
            ref={panel}
            layoutId={reduce ? undefined : "day-sheet"}
            transition={SPRING}
            initial={reduce ? { opacity: 0 } : undefined}
            animate={reduce ? { opacity: 1 } : undefined}
            exit={reduce ? { opacity: 0 } : undefined}
            role="dialog"
            aria-modal="true"
            aria-labelledby="day-sheet-title"
            onKeyDown={onKeyDown}
            className="fixed inset-x-2 bottom-2 top-[10dvh] z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-[var(--shadow)] sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-[460px]"
            style={{ borderRadius: 14 }}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: reduce ? 0 : 0.14, duration: 0.18 } }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <SheetBody
                record={record}
                alerts={alerts.filter((a) => a.ts.slice(0, 10) === record.day)}
                closeBtn={closeBtn}
                onClose={onClose}
                prev={idx > 0 ? () => onNavigate(days[idx - 1].day) : undefined}
                next={idx < days.length - 1 ? () => onNavigate(days[idx + 1].day) : undefined}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SheetBody({
  record,
  alerts,
  closeBtn,
  onClose,
  prev,
  next,
}: {
  record: DayRecord;
  alerts: Alert[];
  closeBtn: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  prev?: () => void;
  next?: () => void;
}) {
  const { drift, performance, traffic } = record;
  const navBtn = "flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40";
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <h2 id="day-sheet-title" className="font-display text-xl font-bold tracking-tight text-ink">
            {fmtLongDay(record.day)}
          </h2>
          <div className="mt-2">
            <StatusTag status={record.status} size="md" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={navBtn} onClick={prev} disabled={!prev} aria-label="Previous day">
            <CaretLeftIcon size={16} />
          </button>
          <button type="button" className={navBtn} onClick={next} disabled={!next} aria-label="Next day">
            <CaretRightIcon size={16} />
          </button>
          <button ref={closeBtn} type="button" className={navBtn} onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5">
        <p className="text-sm text-ink-2">
          {record.reasons.length ? record.reasons.join(". ") + "." : record.status === "none" ? "No checks reported on this day." : "Every check was within its limits."}
        </p>

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink">Feature drift (PSI)</h3>
          {drift ? (
            <>
              <div className="mb-1 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.25rem] gap-3 text-[11px] text-muted">
                <span />
                <span className="relative h-3">
                  <span className="absolute -translate-x-1/2" style={{ left: `${PSI_ALERT * 100}%` }}>
                    0.25
                  </span>
                  <span className="absolute right-0">1+</span>
                </span>
                <span />
              </div>
              <ul className="space-y-2">
                {FEATURES.map((f) => {
                  const psi = drift.scores[f] ?? 0;
                  return (
                    <li key={f} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.25rem] items-center gap-3">
                      <span className="truncate text-xs text-ink-2">{FEATURE_LABELS[f]}</span>
                      <span className="relative h-2.5">
                        <span className="absolute inset-y-[-3px] w-px bg-line" style={{ left: `${PSI_WATCH * 100}%` }} aria-hidden />
                        <span className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${PSI_ALERT * 100}%` }} aria-hidden />
                        <span
                          className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--series-1)]"
                          style={{ width: `${Math.max(Math.min(psi, 1) * 100, 1)}%` }}
                        />
                      </span>
                      <span className="tabular text-right text-xs font-bold text-ink">{psi.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Over the last {drift.sample_size} predictions. The lighter rule marks 0.1 (watch), the darker one the 0.25 alert threshold. Bars past 1 are
                drawn full.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">No drift report on this day.</p>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink">Performance</h3>
          {hasRecallSignal(performance) ? (
            <>
              <dl className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["Recall", performance.recall],
                    ["Precision", performance.precision],
                    ["F1", performance.f1],
                    ["Accuracy", performance.accuracy],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-2">
                    <dt className="text-[11px] text-ink-2">{label}</dt>
                    <dd className="text-base font-bold text-ink">{v.toFixed(2)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted">
                From the last {performance.sample_size} labeled predictions, {performance.fraud_cases} of them fraud. Labels arrive about a week after the prediction.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              {performance ? "No fraud was labeled in this window, so recall can't be measured yet." : "No performance report on this day."}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink">Traffic</h3>
          {traffic ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["Predictions", fmtInt(traffic.predictions)],
                  ["Flagged as fraud", fmtPct(traffic.flagged_rate)],
                  ["Avg latency", traffic.avg_latency_ms == null ? "n/a" : `${traffic.avg_latency_ms.toFixed(1)} ms`],
                  ["Data quality", traffic.avg_data_quality == null ? "n/a" : `${traffic.avg_data_quality.toFixed(0)} / 100`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line pb-2">
                  <dt className="text-ink-2">{k}</dt>
                  <dd className="tabular font-bold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-ink-2">No predictions recorded on this day.</p>
          )}
        </section>

        {alerts.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-bold text-ink">Alerts sent</h3>
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.ts + a.kind} className="whitespace-pre-line rounded-[var(--radius-control)] bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
                  <span className="mb-1 block text-sm font-medium capitalize text-ink">{a.kind}</span>
                  {a.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
