/**
 * P45.10 — Cascade Circuit Breaker
 *
 * Prevents replay storms by limiting cascade depth, per-namespace replays,
 * and total replays. Breaks the circuit when thresholds are exceeded.
 */

export type { CascadeBreakerConfig, ReplayPlan, ReplayTarget } from "./targeted-replay-engine.js";
export { DEFAULT_CASCADE_CONFIG, TargetedReplayEngine } from "./targeted-replay-engine.js";
