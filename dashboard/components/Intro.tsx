"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { MARK_PULSE, MARK_TILE, PULSE_PATH } from "./Logo";

/**
 * Brand intro, once per session. The inline head script sets data-intro before first
 * paint (and skips it under reduced motion), so the overlay is present from the very
 * first frame instead of popping in after hydration.
 */
export function Intro() {
  const [show, setShow] = useState(true);

  // Without the flag the CSS gate keeps the overlay hidden, so the timer is harmless there.
  useEffect(() => {
    if (document.documentElement.dataset.intro === "1") {
      try {
        sessionStorage.setItem("mf-intro", "1");
      } catch {}
    }
    const t = setTimeout(() => setShow(false), 1450);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence onExitComplete={() => delete document.documentElement.dataset.intro}>
      {show && (
        <motion.div
          key="intro"
          aria-hidden
          className="intro-overlay fixed inset-0 z-[80] hidden items-center justify-center bg-bg"
          exit={{ opacity: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
        >
          <div className="flex items-center gap-4">
            <motion.svg width={64} height={64} viewBox="0 0 32 32" initial={{ scale: 0.82, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
              <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill={MARK_TILE} />
              <motion.path
                d={PULSE_PATH}
                fill="none"
                stroke={MARK_PULSE}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.7, delay: 0.2, ease: [0.65, 0, 0.35, 1] }}
              />
            </motion.svg>
            <motion.span
              className="font-display text-4xl font-bold tracking-tight text-ink"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              ModelForge
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
