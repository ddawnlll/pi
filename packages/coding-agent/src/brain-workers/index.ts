/**
 * Brain Workers — 25.C, 25.D
 *
 * Brain worker contracts, roles, manifests, lifecycle states, and
 * the Brain Orchestrator Supervisor for job routing, leasing, health
 * monitoring, and diagnostics.
 *
 * This module provides:
 * - Contract system, role definitions, manifest generation (25.C)
 * - Lifecycle engine with budget/cooldown/dedup enforcement (25.C)
 * - Brain Orchestrator Supervisor with job routing, leasing, health
 *   monitoring, lease recovery, and evidence-backed diagnostics (25.D)
 *
 * @packageDocumentation
 */

export * from "./contracts.js";
export * from "./lifecycle.js";
// Brain Orchestrator Supervisor (25.D)
export * from "./supervisor/index.js";
export * from "./types.js";
