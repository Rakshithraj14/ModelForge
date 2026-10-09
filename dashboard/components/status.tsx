"use client";

import { CheckCircleIcon, MinusCircleIcon, WarningIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import type { Status } from "@/lib/health";

// Status colours are reserved for state. Each always travels with an icon and a label,
// and the label text stays in ink: colour never carries the meaning alone.
export const STATUS = {
  healthy: { label: "Healthy", color: "var(--good)", Icon: CheckCircleIcon },
  watch: { label: "Watch", color: "var(--warning)", Icon: WarningIcon },
  alert: { label: "Alert", color: "var(--critical)", Icon: WarningOctagonIcon },
  none: { label: "No report", color: "var(--muted)", Icon: MinusCircleIcon },
} as const;

export function StatusTag({ status, size = "sm" }: { status: Status; size?: "sm" | "md" }) {
  const { label, color, Icon } = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-tag)] border border-line bg-surface font-medium text-ink ${
        size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      <Icon weight="fill" size={size === "md" ? 16 : 14} color={color} aria-hidden />
      {label}
    </span>
  );
}
