import { Hono } from "hono";

const app = new Hono();

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

  await c.env.DB.prepare(
    "INSERT INTO telemetry (model_id, ts, features_json, prediction, probability, latency_ms) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(model_id, new Date().toISOString(), JSON.stringify(features), prediction, probability, latency_ms ?? null)
    .run();

  return c.json({ status: "ok" }, 201);
});

export default app;
