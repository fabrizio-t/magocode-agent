'use strict';

/**
 * Delay before reconnect attempt number `attempt` (1-based): exponential from
 * `baseMs` up to `maxMs`, spread by +/- `jitter` so a fleet that lost the
 * server at the same moment does not reconnect in lockstep.
 */
function nextReconnectDelay(attempt, {
  baseMs = 5000,
  maxMs = 60000,
  jitter = 0.2,
  random = Math.random,
} = {}) {
  const step = Math.max(0, Math.floor(Number(attempt) || 1) - 1);
  const ceiling = Math.max(baseMs, maxMs);
  // Cap the exponent so a long outage cannot overflow to Infinity.
  const exponential = Math.min(ceiling, baseMs * 2 ** Math.min(step, 30));
  const spread = exponential * jitter;
  return Math.max(0, Math.round(exponential - spread + random() * 2 * spread));
}

module.exports = { nextReconnectDelay };
