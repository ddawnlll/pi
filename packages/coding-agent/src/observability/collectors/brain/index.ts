/**
 * Brain Collectors — Workspace 25.G
 *
 * Barrel file re-exporting all brain, overnight, and proposal collectors
 * and their associated types, budgets, dedupe configs, and diagnostic
 * interfaces.
 *
 * Each collector converts domain events into standardized ObservabilityEvent
 * records for the telemetry store, respecting budget, cooldown, dedupe,
 * and stop-condition constraints.
 *
 * @module observability/collectors/brain
 */

// ── Brain Collector (observations, signals, timeline events) ──────────
export {
	BrainCollector,
	type BrainCollectorBudget,
	type BrainCollectorBufferEntry,
	type BrainCollectorCooldown,
	type BrainCollectorDedupeConfig,
	type BrainCollectorDedupeEntry,
	type BrainCollectorDiagnostics,
	type BrainCollectorStopCondition,
	DEFAULT_BRAIN_COLLECTOR_BUDGET,
	DEFAULT_BRAIN_COLLECTOR_DEDUPE,
} from "./brain-collector.js";

// ── Overnight Collector (run sessions, status updates, stop conditions) ─
export {
	DEFAULT_OVERNIGHT_COLLECTOR_BUDGET,
	DEFAULT_OVERNIGHT_COLLECTOR_DEDUPE,
	OvernightCollector,
	type OvernightCollectorBudget,
	type OvernightCollectorBufferEntry,
	type OvernightCollectorCooldown,
	type OvernightCollectorDedupeConfig,
	type OvernightCollectorDedupeEntry,
	type OvernightCollectorDiagnostics,
	type OvernightCollectorEventType,
	type OvernightCollectorStopCondition,
} from "./overnight-collector.js";

// ── Proposal Collector (proposal lifecycle events) ──────────────────
export {
	DEFAULT_PROPOSAL_COLLECTOR_BUDGET,
	DEFAULT_PROPOSAL_COLLECTOR_DEDUPE,
	ProposalCollector,
	type ProposalCollectorBudget,
	type ProposalCollectorBufferEntry,
	type ProposalCollectorCooldown,
	type ProposalCollectorDedupeConfig,
	type ProposalCollectorDedupeEntry,
	type ProposalCollectorDiagnostics,
	type ProposalCollectorEventType,
	type ProposalCollectorStopCondition,
	type ProposalDedupeInput,
	type ProposalScoreInput,
	type ProposalStatusChangeInput,
} from "./proposal-collector.js";
