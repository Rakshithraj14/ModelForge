import { Hono } from "hono";
import { sendAlert } from "./alerts.js";
import { DRIFT_SAMPLE_SIZE, computeDriftReport } from "./drift.js";
import { PERFORMANCE_SAMPLE_SIZE, computePerformance } from "./performance.js";

const app = new Hono();
// training recall on fraud was 1.0 (see model-service artifacts/metadata.json)
const RECALL_ALERT_THRESHOLD = 0.8;

// Checks incoming features against the model's registered schema: missing
// (absent/null) or invalid (wrong type, or negative for numeric fields —
// balances/amounts can't be negative in PaySim) fields lower the score.
export function scoreDataQuality(schema, features) {
  const fields = Object.keys(schema);
  if (fields.length === 0) return 100;

  let bad = 0;
  for (const field of fields) {
    const value = features[field];
    const type = schema[field];
    if (value === undefined || value === null) {
      bad += 1;
    } else if (type === "float" || type === "int") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) bad += 1;
    } else if (type === "string") {
      if (typeof value !== "string" || value.length === 0) bad += 1;
    }
  }
  return Math.round(((fields.length - bad) / fields.length) * 100);
}

function bearerToken(c) {
  const header = c.req.header("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

// TELEMETRY_API_KEY writes (ingest, label, trigger checks); READ_API_KEY only reads
// reports, so a dashboard can't inject data if its key leaks. An unset secret
// never matches: the token must be non-empty.
function canWrite(c) {
  const token = bearerToken(c);
  return token !== "" && token === c.env.TELEMETRY_API_KEY;
}

function canRead(c) {
  const token = bearerToken(c);
  return token !== "" && (token === c.env.TELEMETRY_API_KEY || token === c.env.READ_API_KEY);
}

// Pulls the most recent telemetry for a model, scores it against the model's
// training baseline, and stores the report. Returns null when there's either
// no baseline yet or no telemetry to analyze — both are "nothing to do", not
// errors, so callers can skip storing anything.
export async function runDriftCheck(env, modelId, sampleSize = DRIFT_SAMPLE_SIZE) {
  const db = env.DB;
  const model = await db.prepare("SELECT baseline_json FROM models WHERE model_id = ?").bind(modelId).first();
  if (!model || !model.baseline_json) return null;

  const { results } = await db
    .prepare("SELECT features_json FROM telemetry WHERE model_id = ? ORDER BY id DESC LIMIT ?")
    .bind(modelId, sampleSize)
    .all();
  if (results.length === 0) return null;

  const samples = results.map((row) => JSON.parse(row.features_json));
  const report = computeDriftReport(JSON.parse(model.baseline_json), samples);

  await db
    .prepare(
      "INSERT INTO drift_reports (model_id, ts, sample_size, scores_json, max_severity) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(modelId, new Date().toISOString(), samples.length, JSON.stringify(report.scores), report.max_severity)
    .run();

  const alert = driftAlert(report, samples.length);
  if (alert) await sendAlert(env, { model_id: modelId, ...alert });

  return { sample_size: samples.length, ...report };
}

// The alert decisions, kept pure so scripts/seed-history.mjs applies the exact same rules.
export function driftAlert(report, sampleSize) {
  if (report.max_severity !== "HIGH") return null;
  const drifted = Object.entries(report.scores)
    .filter(([, score]) => score >= 0.25)
    .map(([feature, score]) => `${feature}: PSI ${score.toFixed(2)}`)
    .join("\n");
  return {
    kind: "drift",
    severity: "HIGH",
    message: `Feature drift detected over the last ${sampleSize} predictions (threshold 0.25):\n${drifted}`,
  };
}

export function performanceAlert(metrics) {
  // recall is 0 by definition when no fraud case is labeled yet — that's "no data", not "degraded"
  const fraudCases = metrics.fraud_cases;
  if (fraudCases === 0 || metrics.recall >= RECALL_ALERT_THRESHOLD) return null;
  return {
    kind: "performance",
    severity: "DEGRADED",
    message: `Recall dropped to ${metrics.recall.toFixed(2)} (threshold ${RECALL_ALERT_THRESHOLD}): missed ${Math.round((1 - metrics.recall) * fraudCases)} of ${fraudCases} labeled fraud cases.\nAccuracy ${metrics.accuracy.toFixed(2)}, precision ${metrics.precision.toFixed(2)}, F1 ${metrics.f1.toFixed(2)}.`,
  };
}

// Same shape as runDriftCheck: pulls the most recently *labeled* telemetry
// (actual IS NOT NULL) and scores predictions against ground truth. Returns
// null when there's nothing labeled yet.
export async function runPerformanceCheck(env, modelId, sampleSize = PERFORMANCE_SAMPLE_SIZE) {
  const db = env.DB;
  const { results } = await db
    .prepare("SELECT prediction, actual FROM telemetry WHERE model_id = ? AND actual IS NOT NULL ORDER BY id DESC LIMIT ?")
    .bind(modelId, sampleSize)
    .all();
  if (results.length === 0) return null;

  const metrics = computePerformance(results);

  await db
    .prepare(
      "INSERT INTO performance_reports (model_id, ts, sample_size, accuracy, precision, recall, f1, fraud_cases) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(modelId, new Date().toISOString(), results.length, metrics.accuracy, metrics.precision, metrics.recall, metrics.f1, metrics.fraud_cases)
    .run();

  const alert = performanceAlert(metrics);
  if (alert) await sendAlert(env, { model_id: modelId, ...alert });

  return { sample_size: results.length, ...metrics };
}

app.post("/api/v1/telemetry", async (c) => {
  if (!canWrite(c)) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json();
  const { model_id, prediction_id, features, prediction, probability, latency_ms } = body;
  if (!model_id || !features || prediction === undefined || probability === undefined) {
    return c.json({ error: "model_id, features, prediction, and probability are required" }, 422);
  }

  const model = await c.env.DB.prepare("SELECT version, schema_json FROM models WHERE model_id = ?")
    .bind(model_id)
    .first();
  if (!model) {
    return c.json({ error: `model_id '${model_id}' is not registered` }, 404);
  }

  const dataQualityScore = scoreDataQuality(JSON.parse(model.schema_json), features);

  await c.env.DB.prepare(
    "INSERT INTO telemetry (model_id, model_version, prediction_id, ts, features_json, prediction, probability, latency_ms, data_quality_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      model_id,
      model.version,
      prediction_id ?? null,
      new Date().toISOString(),
      JSON.stringify(features),
      prediction,
      probability,
      latency_ms ?? null,
      dataQualityScore
    )
    .run();

  return c.json({ status: "ok", data_quality_score: dataQualityScore }, 201);
});

app.post("/api/v1/labels", async (c) => {
  if (!canWrite(c)) return c.json({ error: "unauthorized" }, 401);

  const { prediction_id, actual } = await c.req.json();
  if (!prediction_id || (actual !== 0 && actual !== 1)) {
    return c.json({ error: "prediction_id and actual (0 or 1) are required" }, 422);
  }

  const { meta } = await c.env.DB.prepare("UPDATE telemetry SET actual = ? WHERE prediction_id = ?")
    .bind(actual, prediction_id)
    .run();
  if (meta.changes === 0) {
    return c.json({ error: `prediction_id '${prediction_id}' not found` }, 404);
  }

  return c.json({ status: "ok" });
});

app.post("/api/v1/models/:model_id/drift/run", async (c) => {
  if (!canWrite(c)) return c.json({ error: "unauthorized" }, 401);
  const report = await runDriftCheck(c.env, c.req.param("model_id"));
  if (!report) return c.json({ error: "no baseline registered or no telemetry to analyze" }, 404);
  return c.json(report);
});

app.get("/api/v1/models/:model_id/drift", async (c) => {
  if (!canRead(c)) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT ts, sample_size, scores_json, max_severity FROM drift_reports WHERE model_id = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(c.req.param("model_id"))
    .first();
  if (!row) return c.json({ error: "no drift report yet" }, 404);
  return c.json({ ts: row.ts, sample_size: row.sample_size, scores: JSON.parse(row.scores_json), max_severity: row.max_severity });
});

app.post("/api/v1/models/:model_id/performance/run", async (c) => {
  if (!canWrite(c)) return c.json({ error: "unauthorized" }, 401);
  const report = await runPerformanceCheck(c.env, c.req.param("model_id"));
  if (!report) return c.json({ error: "no labeled telemetry to analyze" }, 404);
  return c.json(report);
});

app.get("/api/v1/models/:model_id/performance", async (c) => {
  if (!canRead(c)) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT ts, sample_size, accuracy, precision, recall, f1, fraud_cases FROM performance_reports WHERE model_id = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(c.req.param("model_id"))
    .first();
  if (!row) return c.json({ error: "no performance report yet" }, 404);
  return c.json(row);
});

app.get("/api/v1/models/:model_id/alerts", async (c) => {
  if (!canRead(c)) return c.json({ error: "unauthorized" }, 401);
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 500);
  const { results } = await c.env.DB.prepare(
    "SELECT ts, kind, severity, message FROM alerts WHERE model_id = ? ORDER BY ts DESC LIMIT ?"
  )
    .bind(c.req.param("model_id"), limit)
    .all();
  return c.json(results);
});

// One point per day for the dashboard. SQLite returns the bare columns of the row
// that holds MAX(ts), so each day keeps its latest report and the Cron's repeats collapse.
app.get("/api/v1/models/:model_id/daily", async (c) => {
  if (!canRead(c)) return c.json({ error: "unauthorized" }, 401);
  const modelId = c.req.param("model_id");
  const days = Math.min(Math.max(Number.parseInt(c.req.query("days") ?? "365", 10) || 365, 1), 366);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = c.env.DB;

  const [drift, performance, traffic] = await Promise.all([
    db
      .prepare(
        "SELECT substr(ts, 1, 10) AS day, sample_size, scores_json, max_severity, MAX(ts) AS ts FROM drift_reports WHERE model_id = ? AND ts >= ? GROUP BY day ORDER BY day"
      )
      .bind(modelId, since)
      .all(),
    db
      .prepare(
        "SELECT substr(ts, 1, 10) AS day, sample_size, accuracy, precision, recall, f1, fraud_cases, MAX(ts) AS ts FROM performance_reports WHERE model_id = ? AND ts >= ? GROUP BY day ORDER BY day"
      )
      .bind(modelId, since)
      .all(),
    db
      .prepare(
        "SELECT substr(ts, 1, 10) AS day, COUNT(*) AS predictions, AVG(prediction) AS flagged_rate, AVG(latency_ms) AS avg_latency_ms, AVG(data_quality_score) AS avg_data_quality FROM telemetry WHERE model_id = ? AND ts >= ? GROUP BY day ORDER BY day"
      )
      .bind(modelId, since)
      .all(),
  ]);

  return c.json({
    days,
    drift: drift.results.map(({ scores_json, ...r }) => ({ ...r, scores: JSON.parse(scores_json) })),
    performance: performance.results,
    traffic: traffic.results,
  });
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    const { results } = await env.DB.prepare("SELECT model_id FROM models").all();
    ctx.waitUntil(
      Promise.all(results.flatMap((row) => [runDriftCheck(env, row.model_id), runPerformanceCheck(env, row.model_id)]))
    );
  },
};
