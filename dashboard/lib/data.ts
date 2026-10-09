import { z } from "zod";
import raw from "@/data/snapshot.json";
import { Alert, Daily } from "./schema";

// A frozen export of the Worker's reports. Parsed at build time, so a malformed
// snapshot fails the build instead of shipping a broken page.
const Snapshot = z.object({ modelId: z.string(), snapshotAt: z.string(), daily: Daily, alerts: z.array(Alert) });

export const dashboardData = Snapshot.parse(raw);
export type DashboardData = z.infer<typeof Snapshot>;
