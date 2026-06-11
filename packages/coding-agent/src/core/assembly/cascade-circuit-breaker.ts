/**
 * P45.10 — Cascade Circuit Breaker
 *
 * Prevents replay storms by limiting cascade depth, per-namespace replays,
 * and total replays. Breaks the circuit when thresholds are exceeded.
 */

export { TargetedReplayEngine, DEFAULT_CASCADE_CONFIG } from "./targeted-replay-engine.js";
export type { ReplayTarget, ReplayPlan, CascadeBreakerConfig } from "./targeted-replay-engine.js";
