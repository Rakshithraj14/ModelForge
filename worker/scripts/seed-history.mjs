// Loads a year of seeded telemetry (from model-service/scripts/seed_history.py) and
// the daily reports the Cron would have produced for it, computed with the Worker's
// own drift/performance/alert code. Days that already have real reports are skipped.
//
// Usage: node scripts/seed-history.mjs <seed.ndjson> --local|--remote
// Undo:  DELETE FROM telemetry WHERE prediction_id LIKE 'seed-%'; reports and alerts
//        for seeded days carry ts 'YYYY-MM-DDT23:45:00.000Z' (see REPORT_TIME).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALERT_COOLDOWN_HOURS } from "../src/alerts.js";
import { DRIFT_SAMPLE_SIZE, computeDriftReport } from "../src/drift.js";
import { driftAlert, performanceAlert, scoreDataQuality } from "../src/index.js";
import { PERFORMANCE_SAMPLE_SIZE, computePerformance } from "../src/performance.js";

const MODEL_ID = "fraud-detector";
const REPORT_TIME = "T23:45:00.000Z"; // the day's last 15-minute Cron tick
const LABEL_DELAY_DAYS = 7;
const DAY_MS = 86_400_000;

const [ndjsonPath, flag] = process.argv.slice(2);
if (!ndjsonPath || !["--local", "--remote"].includes(flag)) {
  console.error("Usage: node scripts/seed-history.mjs <seed.ndjson> --local|--remote");
  process.exit(1);
}

function d1(args) {
  return execFileSync("npx", ["wrangler", "d1", "execute", "model-doctor", flag, ...args], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });
}

function query(sql) {
  const out = d1(["--json", "--command", sql]);
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

const sqlValue = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const row = (values) => `(${values.map(sqlValue).join(", ")})`;

const [model] = query(`SELECT version, schema_json, baseline_json FROM models WHERE model_id = '${MODEL_ID}'`);
if (!model?.baseline_json) throw new Error(`${MODEL_ID} has no baseline; run db:set-baseline first`);
const schema = JSON.parse(model.schema_json);
const baseline = JSON.parse(model.baseline_json);
const realDays = new Set(query("SELECT DISTINCT substr(ts, 1, 10) AS day FROM drift_reports").map((r) => r.day));

const byDay = new Map();
for (const line of readFileSync(ndjsonPath, "utf8").split("\n")) {
  if (!line) continue;
  const t = JSON.parse(line);
  const day = t.ts.slice(0, 10);
  if (realDays.has(day)) continue;
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(t);
}

const telemetry = [];
const driftReports = [];
const performanceReports = [];
const alerts = [];
const lastAlertAt = {};
const history = [];

for (const day of [...byDay.keys()].sort()) {
  history.push(...byDay.get(day));
  for (const t of byDay.get(day)) {
    telemetry.push(
      row([MODEL_ID, model.version, t.prediction_id, t.ts, JSON.stringify(t.features), t.prediction, t.probability, t.latency_ms, scoreDataQuality(schema, t.features), t.actual])
    );
  }

  const reportTs = day + REPORT_TIME;
  const raise = (alert) => {
    if (!alert) return;
    const since = Date.parse(reportTs) - ALERT_COOLDOWN_HOURS * 3_600_000;
    if (lastAlertAt[alert.kind] > since) return; // same cooldown rule as sendAlert
    lastAlertAt[alert.kind] = Date.parse(reportTs);
    alerts.push(row([MODEL_ID, reportTs, alert.kind, alert.severity, alert.message]));
  };

  const samples = history.slice(-DRIFT_SAMPLE_SIZE).map((t) => t.features);
  const drift = computeDriftReport(baseline, samples);
  driftReports.push(row([MODEL_ID, reportTs, samples.length, JSON.stringify(drift.scores), drift.max_severity]));
  raise(driftAlert(drift, samples.length));

  // ground truth only exists for predictions at least LABEL_DELAY_DAYS old
  const labelCutoff = new Date(Date.parse(day) - LABEL_DELAY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const labeled = history.filter((t) => t.actual !== null && t.ts.slice(0, 10) <= labelCutoff).slice(-PERFORMANCE_SAMPLE_SIZE);
  if (labeled.length > 0) {
    const m = computePerformance(labeled);
    performanceReports.push(row([MODEL_ID, reportTs, labeled.length, m.accuracy, m.precision, m.recall, m.f1, m.fraud_cases]));
    raise(performanceAlert(m));
  }
}

const statements = [];
const insert = (table, columns, rows, batch) => {
  for (let i = 0; i < rows.length; i += batch) {
    statements.push(`INSERT INTO ${table} (${columns}) VALUES\n${rows.slice(i, i + batch).join(",\n")};`);
  }
};
// D1 caps a statement at 100KB; 100 telemetry rows is ~35KB
insert("telemetry", "model_id, model_version, prediction_id, ts, features_json, prediction, probability, latency_ms, data_quality_score, actual", telemetry, 100);
insert("drift_reports", "model_id, ts, sample_size, scores_json, max_severity", driftReports, 100);
insert("performance_reports", "model_id, ts, sample_size, accuracy, precision, recall, f1, fraud_cases", performanceReports, 200);
insert("alerts", "model_id, ts, kind, severity, message", alerts, 100);

const sqlPath = join(mkdtempSync(join(tmpdir(), "seed-history-")), "seed.sql");
writeFileSync(sqlPath, statements.join("\n"));
console.log(
  `${byDay.size} days (skipped ${realDays.size} with real reports): ${telemetry.length} telemetry, ${driftReports.length} drift, ${performanceReports.length} performance, ${alerts.length} alerts`
);
d1(["--yes", "--file", sqlPath]);
console.log("done");
