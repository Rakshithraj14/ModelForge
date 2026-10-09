import { z } from "zod";

// Mirrors the Worker's GET /api/v1/models/:id/daily and /alerts responses.
// Parsing at the boundary means a Worker change fails loudly here, not as a blank chart.

export const Severity = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const DriftDay = z.object({
  day: z.string(),
  ts: z.string(),
  sample_size: z.number(),
  max_severity: Severity,
  scores: z.record(z.string(), z.number()),
});

export const PerformanceDay = z.object({
  day: z.string(),
  ts: z.string(),
  sample_size: z.number(),
  accuracy: z.number(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  // null on reports written before fraud cases were recorded: recall there is unknowable
  fraud_cases: z.number().nullable(),
});

export const TrafficDay = z.object({
  day: z.string(),
  predictions: z.number(),
  flagged_rate: z.number(),
  avg_latency_ms: z.number().nullable(),
  avg_data_quality: z.number().nullable(),
});

export const Daily = z.object({
  days: z.number(),
  drift: z.array(DriftDay),
  performance: z.array(PerformanceDay),
  traffic: z.array(TrafficDay),
});

export const Alert = z.object({
  ts: z.string(),
  kind: z.enum(["drift", "performance"]),
  severity: z.string(),
  message: z.string(),
});

export type Severity = z.infer<typeof Severity>;
export type DriftDay = z.infer<typeof DriftDay>;
export type PerformanceDay = z.infer<typeof PerformanceDay>;
export type TrafficDay = z.infer<typeof TrafficDay>;
export type Daily = z.infer<typeof Daily>;
export type Alert = z.infer<typeof Alert>;
