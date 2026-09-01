import { Hono } from "hono";

const app = new Hono();

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

app.post("/api/v1/telemetry", async (c) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.TELEMETRY_API_KEY}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json();
  const { model_id, features, prediction, probability, latency_ms } = body;
  if (!model_id || !features || prediction === undefined || probability === undefined) {
    return c.json({ error: "model_id, features, prediction, and probability are required" }, 422);
  }

  const model = await c.env.DB.prepare("SELECT schema_json FROM models WHERE model_id = ?").bind(model_id).first();
  if (!model) {
    return c.json({ error: `model_id '${model_id}' is not registered` }, 404);
  }

  const dataQualityScore = scoreDataQuality(JSON.parse(model.schema_json), features);

  await c.env.DB.prepare(
    "INSERT INTO telemetry (model_id, ts, features_json, prediction, probability, latency_ms, data_quality_score) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(model_id, new Date().toISOString(), JSON.stringify(features), prediction, probability, latency_ms ?? null, dataQualityScore)
    .run();

  return c.json({ status: "ok", data_quality_score: dataQualityScore }, 201);
});

export default app;
