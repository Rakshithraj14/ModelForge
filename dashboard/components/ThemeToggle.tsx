"use client";

import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

const MODES = ["system", "light", "dark"] as const;
type Mode = (typeof MODES)[number];
const META = {
  system: { Icon: DesktopIcon, label: "Theme follows system" },
  light: { Icon: SunIcon, label: "Light theme" },
  dark: { Icon: MoonIcon, label: "Dark theme" },
};
const EVENT = "mf-theme-change";

// localStorage is an external store: subscribe to it rather than copying it into state.
// The storage event also keeps other open tabs in sync.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}
function readMode(): Mode {
  try {
    const t = localStorage.getItem("mf-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "system" as Mode);

  const cycle = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    try {
      if (next === "system") {
        localStorage.removeItem("mf-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("mf-theme", next);
        document.documentElement.dataset.theme = next;
      }
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };

  const { Icon, label } = META[mode];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${label}. Switch theme`}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-2 transition-colors hover:text-ink active:scale-[0.96]"
    >
      <Icon size={17} aria-hidden />
    </button>
  );
}
