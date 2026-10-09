import assert from "node:assert";
import { afterEach, test } from "node:test";
import { sendAlert } from "../src/alerts.js";
import { runPerformanceCheck } from "../src/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response("{}");
  };
  return calls;
}

// recentAlert: what the cooldown SELECT returns; labeledRows: performance SELECT results
function fakeDb({ recentAlert = null, labeledRows = [], writes = [] } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => (sql.includes("FROM alerts") ? recentAlert : null),
            all: async () => ({ results: sql.startsWith("SELECT prediction, actual") ? labeledRows : [] }),
            run: async () => {
              writes.push({ sql, args });
              return { meta: {} };
            },
          };
        },
      };
    },
  };
}

const ALERT = { model_id: "fraud-detector", kind: "drift", severity: "HIGH", message: "amount: PSI 3.10" };

test("sendAlert: posts to Telegram and the webhook when both are configured, and logs it", async () => {
  const calls = stubFetch();
  const writes = [];
  const env = { DB: fakeDb({ writes }), TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42", ALERT_WEBHOOK_URL: "https://hook.test" };

  assert.strictEqual(await sendAlert(env, ALERT), true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url, "https://api.telegram.org/bottok/sendMessage");
  assert.strictEqual(calls[0].body.chat_id, "42");
  assert.deepStrictEqual(calls[1].body, ALERT);
  assert.match(writes[0].sql, /INSERT INTO alerts/);
});

test("sendAlert: skips silently within the cooldown window", async () => {
  const calls = stubFetch();
  const writes = [];
  const env = { DB: fakeDb({ recentAlert: { id: 1 }, writes }), TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42" };

  assert.strictEqual(await sendAlert(env, ALERT), false);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(writes.length, 0);
});

test("sendAlert: a failing channel doesn't stop the alert being logged", async () => {
  globalThis.fetch = async () => {
    throw new Error("telegram down");
  };
  const writes = [];
  const env = { DB: fakeDb({ writes }), TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42" };

  assert.strictEqual(await sendAlert(env, ALERT), true);
  assert.match(writes[0].sql, /INSERT INTO alerts/);
});

test("runPerformanceCheck: no labeled fraud cases is not treated as degraded", async () => {
  const calls = stubFetch();
  const writes = [];
  const labeledRows = [{ prediction: 0, actual: 0 }, { prediction: 0, actual: 0 }]; // recall is 0, but meaningless
  const env = { DB: fakeDb({ labeledRows, writes }), TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42" };

  await runPerformanceCheck(env, "fraud-detector");
  assert.strictEqual(calls.length, 0);
  assert.ok(!writes.some((w) => w.sql.includes("INSERT INTO alerts")));
});

test("runPerformanceCheck: missed fraud cases below the recall threshold fire an alert", async () => {
  const calls = stubFetch();
  const writes = [];
  const labeledRows = [
    { prediction: 0, actual: 1 },
    { prediction: 0, actual: 1 },
    { prediction: 1, actual: 1 },
  ]; // recall 1/3
  const env = { DB: fakeDb({ labeledRows, writes }), TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42" };

  await runPerformanceCheck(env, "fraud-detector");
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].body.text, /missed 2 of 3 labeled fraud cases/);
});
