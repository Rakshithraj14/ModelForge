import assert from "node:assert";
import { test } from "node:test";
import app from "../src/index.js";

function fakeDb(calls) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => ({ success: true }) };
        },
      };
    },
  };
}

const ENV = { TELEMETRY_API_KEY: "secret123" };
const VALID_BODY = {
  model_id: "fraud-detector",
  features: { amount: 100, type: "PAYMENT" },
  prediction: 1,
  probability: 0.9,
  latency_ms: 12.3,
};

test("rejects requests without the telemetry key", async () => {
  const res = await app.fetch(
    new Request("http://worker/api/v1/telemetry", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: { "Content-Type": "application/json" },
    }),
    { ...ENV, DB: fakeDb([]) }
  );
  assert.strictEqual(res.status, 401);
});

test("rejects a payload missing required fields", async () => {
  const res = await app.fetch(
    new Request("http://worker/api/v1/telemetry", {
      method: "POST",
      body: JSON.stringify({ model_id: "fraud-detector" }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret123" },
    }),
    { ...ENV, DB: fakeDb([]) }
  );
  assert.strictEqual(res.status, 422);
});

test("inserts telemetry when authorized and valid", async () => {
  const calls = [];
  const res = await app.fetch(
    new Request("http://worker/api/v1/telemetry", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret123" },
    }),
    { ...ENV, DB: fakeDb(calls) }
  );
  assert.strictEqual(res.status, 201);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO telemetry/);
  assert.strictEqual(calls[0].args[0], "fraud-detector");
});
