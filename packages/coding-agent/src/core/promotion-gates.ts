/**
 * P26.N — Promotion Gates
 *
 * Records promotion gate passes for each P26 workstream.
 * Each gate documents what was validated and when it passed.
 * Promotion gates must pass before stable_3 dogfood is permitted,
 * and stable_3 must pass before stable_6 is permitted.
 *
 * This is a lightweight in-memory/JSON-backed record keeper.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a promotion gate.
 */
export type PromotionGateStatus = "pending" | "passed" | "failed" | "skipped";

/**
 * A single promotion gate record.
 */
export interface PromotionGateRecord {
	/** Unique gate ID (e.g., "executor_isolation", "abort_chain") */
	id: string;
	/** Human-readable description */
	description: string;
	/** Current status */
	status: PromotionGateStatus;
	/** When the gate was last evaluated (ISO timestamp) */
	evaluatedAt: string | null;
	/** Which P26 workstream this gate belongs to */
	workstream: string;
	/** Validation evidence / notes */
	evidence?: string;
	/** Error message if failed */
	error?: string;
}

/**
 * Promotion gates configuration.
 */
export interface PromotionGatesConfig {
	/** Whether promotion gates are enforced */
	enabled: boolean;
	/** Scale mode that requires all gates to pass */
	requiredForMode: string;
	/** File path to persist gate records */
	persistPath?: string;
}

/**
 * Default promotion gates configuration.
 */
export const DEFAULT_PROMOTION_GATES_CONFIG: PromotionGatesConfig = {
	enabled: true,
	requiredForMode: "stable_3",
};

// ---------------------------------------------------------------------------
// PromotionGates
// ---------------------------------------------------------------------------

/**
 * Promotion gates manager.
 *
 * Tracks which P26 workstream gates have passed and prevents
 * stable_3/stable_6 execution until required gates pass.
 */
export class PromotionGates {
	private config: PromotionGatesConfig;
	private gates: Map<string, PromotionGateRecord> = new Map();

	constructor(config: Partial<PromotionGatesConfig> = {}) {
		this.config = { ...DEFAULT_PROMOTION_GATES_CONFIG, ...config };
	}

	/**
	 * Register a promotion gate.
	 *
	 * @param id - Gate ID
	 * @param description - Human-readable description
	 * @param workstream - P26 workstream identifier
	 */
	registerGate(id: string, description: string, workstream: string): void {
		this.gates.set(id, {
			id,
			description,
			status: "pending",
			evaluatedAt: null,
			workstream,
		});
	}

	/**
	 * Mark a gate as passed.
	 *
	 * @param id - Gate ID
	 * @param evidence - Optional validation evidence
	 */
	async passGate(id: string, evidence?: string): Promise<void> {
		const gate = this.gates.get(id);
		if (!gate) {
			throw new Error(`Unknown promotion gate: ${id}`);
		}
		gate.status = "passed";
		gate.evaluatedAt = new Date().toISOString();
		if (evidence) gate.evidence = evidence;
		await this.persist();
	}

	/**
	 * Mark a gate as failed.
	 *
	 * @param id - Gate ID
	 * @param error - Error description
	 */
	async failGate(id: string, error: string): Promise<void> {
		const gate = this.gates.get(id);
		if (!gate) {
			throw new Error(`Unknown promotion gate: ${id}`);
		}
		gate.status = "failed";
		gate.evaluatedAt = new Date().toISOString();
		gate.error = error;
		await this.persist();
	}

	/**
	 * Get a specific gate record.
	 */
	getGate(id: string): PromotionGateRecord | undefined {
		return this.gates.get(id);
	}

	/**
	 * Get all gate records.
	 */
	getAllGates(): PromotionGateRecord[] {
		return Array.from(this.gates.values());
	}

	/**
	 * Check whether the required mode is permitted.
	 *
	 * For "stable_3": all gates must be passed.
	 * For "stable_6": stable_3 gates plus additional stress gates must pass.
	 *
	 * @param mode - Scale mode to check
	 * @returns True if the mode is permitted
	 */
	isModePermitted(mode: string): boolean {
		if (!this.config.enabled) return true;

		const gates = this.getAllGates();

		if (mode === "stable_3") {
			// All gates must pass
			return gates.every((g) => g.status === "passed");
		}

		if (mode === "stable_6") {
			// All gates must pass AND stable_3-specific gates must pass
			const allPassed = gates.every((g) => g.status === "passed");
			if (!allPassed) return false;

			// stable_6 requires additional stress test gates
			const stressGates = gates.filter((g) => g.workstream === "P26.N" || g.id.includes("stress"));
			return stressGates.every((g) => g.status === "passed");
		}

		// stable_1 has no gate requirements
		return true;
	}

	/**
	 * Get pending/failed gates for a given mode.
	 */
	getBlockedGates(_mode: string): PromotionGateRecord[] {
		if (!this.config.enabled) return [];
		const gates = this.getAllGates();
		return gates.filter((g) => g.status !== "passed");
	}

	/**
	 * Load gate records from disk.
	 */
	async load(): Promise<void> {
		if (!this.config.persistPath) return;
		try {
			const content = await fs.readFile(this.config.persistPath, "utf-8");
			const data = JSON.parse(content) as PromotionGateRecord[];
			for (const record of data) {
				this.gates.set(record.id, record);
			}
		} catch {
			// File doesn't exist yet
		}
	}

	/**
	 * Persist gate records to disk.
	 */
	private async persist(): Promise<void> {
		if (!this.config.persistPath) return;
		const dir = path.dirname(this.config.persistPath);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(this.config.persistPath, JSON.stringify(this.getAllGates(), null, 2), "utf-8");
	}

	/**
	 * Reset all gates to pending.
	 */
	async reset(): Promise<void> {
		for (const gate of this.gates.values()) {
			gate.status = "pending";
			gate.evaluatedAt = null;
			gate.evidence = undefined;
			gate.error = undefined;
		}
		await this.persist();
	}
}

/**
 * Create the standard set of P26 promotion gates.
 *
 * These cover every P26 workstream and should be registered before
 * any validation runs.
 */
export function createP26PromotionGates(config?: Partial<PromotionGatesConfig>): PromotionGates {
	const gates = new PromotionGates(config);

	// P26.A — Repair-mode lockdown
	gates.registerGate("repair_mode_lockdown", "Repair-mode lockdown and promotion guard", "P26.A");

	// P26.B — Executor isolation
	gates.registerGate("executor_isolation", "Per-workspace executor isolation", "P26.B");

	// P26.C — ExecutionContext refactor
	gates.registerGate("execution_context", "WorkspaceExecutionContext refactor", "P26.C");

	// P26.D — Abort correctness
	gates.registerGate("abort_chain", "Abort, pause, stop, and force-kill correctness", "P26.D");

	// P26.E — GitRunner serialization
	gates.registerGate("git_serialization", "GitRunner serialization and worktree lock hardening", "P26.E");

	// P26.F — Attempt-scoped worktrees
	gates.registerGate("attempt_scoped_worktrees", "Attempt-scoped worktrees, branches, and artifacts", "P26.F");

	// P26.G — StateStore concurrency
	gates.registerGate("state_store_concurrency", "StateStore serialization, atomic writes, journal integrity", "P26.G");

	// P26.H — Validation runner
	gates.registerGate("validation_runner", "Managed validation runner and process lifecycle containment", "P26.H");

	// P26.I — Validation lane
	gates.registerGate("validation_lane", "Validation lane backpressure and scheduler feedback", "P26.I");

	// P26.J — LLM watchdog
	gates.registerGate("llm_watchdog", "Bounded LLM provider runtime and idle watchdog", "P26.J");

	// P26.K — Lease monitor
	gates.registerGate("lease_monitor", "Lease monitor, heartbeat, quarantine, and requeue", "P26.K");

	// P26.L — Integration queue
	gates.registerGate("integration_queue", "Integration queue correctness and writeSet drift gate", "P26.L");

	// P26.M — Anti-stall analysis
	gates.registerGate("anti_stall_analysis", "Plan-intake anti-stall analysis and optimizer hardening", "P26.M");

	// P26.N — Stress tests
	gates.registerGate("stable_3_dogfood", "stable_3 dogfood — all P26 gates pass before stable_6", "P26.N");
	gates.registerGate("stable_6_stress", "stable_6 stress — 6-slot execution, abort, timeout, contention", "P26.N");

	return gates;
}
