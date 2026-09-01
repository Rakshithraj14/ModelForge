import { Hono } from "hono";
import { computeDriftReport } from "./drift.js";
import { computePerformance } from "./performance.js";

const app = new Hono();
const DRIFT_SAMPLE_SIZE = 100;
const PERFORMANCE_SAMPLE_SIZE = 200;

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

function requireAuth(c) {
  return c.req.header("Authorization") === `Bearer ${c.env.TELEMETRY_API_KEY}`;
}

// Pulls the most recent telemetry for a model, scores it against the model's
// training baseline, and stores the report. Returns null when there's either
// no baseline yet or no telemetry to analyze — both are "nothing to do", not
// errors, so callers can skip storing anything.
export async function runDriftCheck(db, modelId, sampleSize = DRIFT_SAMPLE_SIZE) {
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

  return { sample_size: samples.length, ...report };
}

// Same shape as runDriftCheck: pulls the most recently *labeled* telemetry
// (actual IS NOT NULL) and scores predictions against ground truth. Returns
// null when there's nothing labeled yet.
export async function runPerformanceCheck(db, modelId, sampleSize = PERFORMANCE_SAMPLE_SIZE) {
  const { results } = await db
    .prepare("SELECT prediction, actual FROM telemetry WHERE model_id = ? AND actual IS NOT NULL ORDER BY id DESC LIMIT ?")
    .bind(modelId, sampleSize)
    .all();
  if (results.length === 0) return null;

  const metrics = computePerformance(results);

  await db
    .prepare(
      "INSERT INTO performance_reports (model_id, ts, sample_size, accuracy, precision, recall, f1) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(modelId, new Date().toISOString(), results.length, metrics.accuracy, metrics.precision, metrics.recall, metrics.f1)
    .run();

  return { sample_size: results.length, ...metrics };
}

app.post("/api/v1/telemetry", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

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
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

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
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const report = await runDriftCheck(c.env.DB, c.req.param("model_id"));
  if (!report) return c.json({ error: "no baseline registered or no telemetry to analyze" }, 404);
  return c.json(report);
});

app.get("/api/v1/models/:model_id/drift", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT ts, sample_size, scores_json, max_severity FROM drift_reports WHERE model_id = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(c.req.param("model_id"))
    .first();
  if (!row) return c.json({ error: "no drift report yet" }, 404);
  return c.json({ ts: row.ts, sample_size: row.sample_size, scores: JSON.parse(row.scores_json), max_severity: row.max_severity });
});

app.post("/api/v1/models/:model_id/performance/run", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const report = await runPerformanceCheck(c.env.DB, c.req.param("model_id"));
  if (!report) return c.json({ error: "no labeled telemetry to analyze" }, 404);
  return c.json(report);
});

app.get("/api/v1/models/:model_id/performance", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const row = await c.env.DB.prepare(
    "SELECT ts, sample_size, accuracy, precision, recall, f1 FROM performance_reports WHERE model_id = ? ORDER BY id DESC LIMIT 1"
  )
    .bind(c.req.param("model_id"))
    .first();
  if (!row) return c.json({ error: "no performance report yet" }, 404);
  return c.json(row);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    const { results } = await env.DB.prepare("SELECT model_id FROM models").all();
    ctx.waitUntil(
      Promise.all(
        results.flatMap((row) => [runDriftCheck(env.DB, row.model_id), runPerformanceCheck(env.DB, row.model_id)])
      )
    );
  },
};
