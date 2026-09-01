import { Hono } from "hono";
import { computeDriftReport } from "./drift.js";

const app = new Hono();
const DRIFT_SAMPLE_SIZE = 100;

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

app.post("/api/v1/telemetry", async (c) => {
  if (!requireAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json();
  const { model_id, features, prediction, probability, latency_ms } = body;
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
    "INSERT INTO telemetry (model_id, model_version, ts, features_json, prediction, probability, latency_ms, data_quality_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      model_id,
      model.version,
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

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    const { results } = await env.DB.prepare("SELECT model_id FROM models WHERE baseline_json IS NOT NULL").all();
    ctx.waitUntil(Promise.all(results.map((row) => runDriftCheck(env.DB, row.model_id))));
  },
};
