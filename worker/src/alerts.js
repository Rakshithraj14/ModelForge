// Sends an alert to Telegram and/or a generic webhook, logging it to D1.
// Unconfigured channels are skipped, same as model-service's telemetry POST.
export const ALERT_COOLDOWN_HOURS = 24;

export async function sendAlert(env, { model_id, kind, severity, message }) {
  // Cron runs every 15 min: without this a sustained problem re-alerts ~96x/day.
  const since = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const recent = await env.DB.prepare("SELECT id FROM alerts WHERE model_id = ? AND kind = ? AND ts > ? LIMIT 1")
    .bind(model_id, kind, since)
    .first();
  if (recent) return false;

  const sends = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const text = `🚨 ${kind.toUpperCase()} ALERT\n\nModel: ${model_id}\nSeverity: ${severity}\n\n${message}`;
    sends.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      })
    );
  }
  if (env.ALERT_WEBHOOK_URL) {
    sends.push(
      fetch(env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id, kind, severity, message }),
      })
    );
  }
  // a dead channel must not block logging or the other channel
  await Promise.allSettled(sends);

  await env.DB.prepare("INSERT INTO alerts (model_id, ts, kind, severity, message) VALUES (?, ?, ?, ?, ?)")
    .bind(model_id, new Date().toISOString(), kind, severity, message)
    .run();
  return true;
}
