/**
 * Fail-closed runtime risk gate.
 *
 * Real execution is allowed only when all three runtime controls are
 * positively known and fresh: daily loss, gross exposure, and heartbeat.
 * Missing, stale, future-dated, non-finite, or negative telemetry blocks.
 */
export function evaluateRuntimeRisk({
  state,
  maxDailyLoss,
  maxExposure,
  maxHeartbeatAgeSeconds,
  nowMs = Date.now(),
  expectedDate = new Date(nowMs).toISOString().slice(0, 10)
} = {}) {
  const failures = [];

  if (!state || typeof state !== "object") {
    return { passed: false, failures: ["risk:telemetry_missing"] };
  }

  const dailyLoss = Number(state.daily_loss);
  const grossExposure = Number(state.gross_exposure);
  const heartbeatMs = Date.parse(state.heartbeat_at);
  const heartbeatAgeSeconds = Number.isFinite(heartbeatMs)
    ? (nowMs - heartbeatMs) / 1000
    : Number.POSITIVE_INFINITY;

  if (state.as_of_date !== expectedDate) failures.push("risk:telemetry_date_mismatch");
  if (!Number.isFinite(dailyLoss) || dailyLoss < 0) failures.push("risk:daily_loss_unknown");
  if (!Number.isFinite(grossExposure) || grossExposure < 0) failures.push("risk:exposure_unknown");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs > nowMs) failures.push("risk:heartbeat_invalid");
  if (Number.isFinite(heartbeatMs) && heartbeatAgeSeconds > Number(maxHeartbeatAgeSeconds)) {
    failures.push("risk:heartbeat_stale");
  }
  if (!Number.isFinite(Number(maxDailyLoss)) || Number(maxDailyLoss) < 0) failures.push("risk:max_daily_loss_invalid");
  if (!Number.isFinite(Number(maxExposure)) || Number(maxExposure) < 0) failures.push("risk:max_exposure_invalid");

  if (dailyLoss > Number(maxDailyLoss)) failures.push("risk:max_daily_loss_exceeded");
  if (grossExposure > Number(maxExposure)) failures.push("risk:max_exposure_exceeded");

  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    dailyLoss: Number.isFinite(dailyLoss) ? dailyLoss : null,
    grossExposure: Number.isFinite(grossExposure) ? grossExposure : null,
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) ? heartbeatAgeSeconds : null
  });
}
