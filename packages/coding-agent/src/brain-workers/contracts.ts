/**
 * Brain Worker Contracts — 25.C
 *
 * Manages worker contract registration, validation, capability matching,
 * and manifest generation. The contract system ensures that every worker's
 * declared capabilities align with its role and that dependencies between
 * workers are satisfied.
 *
 * File scope: Contract validation, capability resolution, and manifest
 * generation utilities. Consumes types from ./types.ts.
 */

import { randomUUID } from "node:crypto";
import {
	type ContractValidationResult,
	type WorkerBudget,
	type WorkerContract,
	type WorkerManifest,
	type WorkerRole,
	DEFAULT_ROLE_BUDGETS,
	DEFAULT_WORKER_DEDUP_CONFIG,
	WORKER_ROLE_LABELS,
	validateWorkerContract,
} from "./types.js";

// ---------------------------------------------------------------------------
// Role-Based Contract Templates
// ---------------------------------------------------------------------------

/**
 * Generate a default contract for a given worker role.
 *
 * Each role has a standard contract template with appropriate inputs,
 * outputs, capabilities, and dependencies. These can be customized
 * for specific worker instances.
 *
 * @param role - The worker role to generate a contract for.
 * @param version - Optional version string (default: "1.0.0").
 * @returns A WorkerContract with role-appropriate defaults.
 */
export function generateContractForRole(role: WorkerRole, version: string = "1.0.0"): WorkerContract {
	const baseId = `brain-worker.${role}`;
	const label = WORKER_ROLE_LABELS[role];

	switch (role) {
		case "observer":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Monitors execution, queues, and integrations for signals and observations.`,
				version,
				capabilities: ["monitor_queue", "monitor_execution", "detect_signals", "record_observations"],
				inputs: [
					{ name: "queue_state", description: "Current queue depth and state", type: "QueueState", required: true, sources: ["workspace-scheduler"] },
					{ name: "execution_events", description: "Execution lifecycle events", type: "ExecutionEvent[]", required: false, sources: ["autonomous-executor"] },
					{ name: "integration_state", description: "Integration dirty state", type: "IntegrationState", required: false, sources: ["integration-queue"] },
				],
				outputs: [
					{ name: "observations", description: "Recorded brain observations", type: "BrainObservation[]", destinations: ["brain-observation-engine"] },
					{ name: "signals", description: "Detected signals from monitoring", type: "BrainSignal[]", destinations: ["brain-analysis"] },
				],
				errors: [
					{ code: "QUEUE_UNAVAILABLE", description: "Queue state not available for reading", severity: "warning", remediation: "Check queue store availability" },
					{ code: "OBSERVATION_STORE_FAILURE", description: "Failed to persist observation", severity: "critical", remediation: "Check observation store write path" },
				],
				dependencies: [],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "analyst":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Analyzes observations to detect patterns and synthesize actionable signals.`,
				version,
				capabilities: ["pattern_detection", "signal_synthesis", "trend_analysis", "anomaly_detection"],
				inputs: [
					{ name: "observations", description: "Recent brain observations", type: "BrainObservation[]", required: true, sources: ["observer", "observation-engine"] },
					{ name: "historical_signals", description: "Previously detected signals for context", type: "BrainSignal[]", required: false, sources: ["brain-timeline"] },
				],
				outputs: [
					{ name: "synthesized_signals", description: "New signals derived from observation analysis", type: "BrainSignal[]", destinations: ["brain-timeline", "proposal-generator"] },
					{ name: "analysis_reports", description: "Detailed analysis reports for diagnostics", type: "AnalysisReport[]", destinations: ["brain-audit"] },
				],
				errors: [
					{ code: "INSUFFICIENT_OBSERVATIONS", description: "Not enough observations to identify patterns", severity: "info", remediation: "Wait for more observation data" },
					{ code: "PATTERN_EXTRACTION_FAILED", description: "Failed to extract patterns from observations", severity: "warning", remediation: "Check observation quality and source integrity" },
				],
				dependencies: ["brain-worker.observer"],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "proposer":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Generates actionable proposals from signals, memory, and detected patterns.`,
				version,
				capabilities: ["proposal_generation", "risk_assessment", "evidence_assembly", "priority_scoring"],
				inputs: [
					{ name: "signals", description: "Active signals requiring action", type: "BrainSignal[]", required: true, sources: ["analyst", "observation-engine"] },
					{ name: "memory_records", description: "Relevant memory context", type: "MemoryRecord[]", required: false, sources: ["memory-store"] },
					{ name: "goal_state", description: "Current goals and preferences", type: "GoalState", required: false, sources: ["goal-store"] },
				],
				outputs: [
					{ name: "proposals", description: "Generated actionable proposals", type: "Proposal[]", destinations: ["proposal-inbox", "proposal-store"] },
				],
				errors: [
					{ code: "NO_ACTIONABLE_SIGNALS", description: "No signals met the action threshold", severity: "info", remediation: "Re-evaluate signal thresholds" },
					{ code: "PROPOSAL_VALIDATION_FAILED", description: "Generated proposal failed validation", severity: "warning", remediation: "Check proposal generation parameters" },
				],
				dependencies: ["brain-worker.analyst"],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "reflector":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Runs scheduled reflection cycles over memory, outcomes, and execution history.`,
				version,
				capabilities: ["reflection_execution", "outcome_analysis", "memory_proposal_generation", "future_suggestion"],
				inputs: [
					{ name: "memory_records", description: "Memory records for reflection", type: "MemoryRecord[]", required: true, sources: ["memory-store"] },
					{ name: "execution_history", description: "Past execution outcomes", type: "ExecutionRecord[]", required: false, sources: ["execution-store"] },
					{ name: "goal_state", description: "Current goals for context", type: "GoalState", required: false, sources: ["goal-store"] },
				],
				outputs: [
					{ name: "reflection_reports", description: "Generated reflection reports", type: "ReflectionReport[]", destinations: ["brain-timeline", "brain-audit"] },
					{ name: "memory_proposals", description: "Proposals for memory updates", type: "MemoryProposal[]", destinations: ["proposal-generator"] },
				],
				errors: [
					{ code: "REFLECTION_TIMEOUT", description: "Reflection cycle exceeded maxRuntimeMs", severity: "warning", remediation: "Reduce scope or increase budget" },
					{ code: "MEMORY_UNAVAILABLE", description: "Memory store not reachable", severity: "critical", remediation: "Check memory store health" },
				],
				dependencies: ["brain-worker.archivist"],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "diagnostician":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Deep-dive diagnostics on failures, hotspots, anomalies, and system health.`,
				version,
				capabilities: ["failure_analysis", "root_cause_diagnosis", "health_assessment", "remediation_suggestion"],
				inputs: [
					{ name: "failure_signals", description: "Signals indicating failures or anomalies", type: "BrainSignal[]", required: true, sources: ["analyst", "observation-engine"] },
					{ name: "execution_logs", description: "Execution logs for diagnostic analysis", type: "ExecutionLog[]", required: false, sources: ["execution-store"] },
					{ name: "worker_statuses", description: "Status of related workers", type: "WorkerStatus[]", required: false, sources: ["brain-worker-registry"] },
				],
				outputs: [
					{ name: "diagnostic_reports", description: "Root cause diagnostic reports", type: "DiagnosticReport[]", destinations: ["brain-audit", "failure-classifier"] },
					{ name: "remediation_suggestions", description: "Suggested remediation actions", type: "RemediationSuggestion[]", destinations: ["proposal-generator"] },
				],
				errors: [
					{ code: "INSUFFICIENT_EVIDENCE", description: "Not enough evidence for conclusive diagnosis", severity: "warning", remediation: "Collect more execution context" },
					{ code: "DIAGNOSTIC_TIMEOUT", description: "Diagnostic analysis exceeded time budget", severity: "warning", remediation: "Narrow diagnostic scope" },
				],
				dependencies: ["brain-worker.analyst"],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "archivist":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Manages memory lifecycle — expiry, conflict detection, compaction, and archival.`,
				version,
				capabilities: ["memory_lifecycle", "conflict_detection", "memory_compaction", "tier_management"],
				inputs: [
					{ name: "memory_records", description: "Memory records to manage", type: "MemoryRecord[]", required: true, sources: ["memory-store"] },
					{ name: "conflict_signals", description: "Detected memory conflicts", type: "MemoryConflict[]", required: false, sources: ["memory-store"] },
				],
				outputs: [
					{ name: "lifecycle_actions", description: "Actions taken on memory lifecycle", type: "LifecycleAction[]", destinations: ["memory-store", "brain-timeline"] },
					{ name: "compaction_reports", description: "Compaction and archival reports", type: "CompactionReport[]", destinations: ["brain-audit"] },
				],
				errors: [
					{ code: "COMPACTION_FAILED", description: "Memory compaction process failed", severity: "warning", remediation: "Retry compaction with reduced scope" },
					{ code: "CONFLICT_RESOLUTION_FAILED", description: "Automatic conflict resolution failed", severity: "info", remediation: "Flag for manual review" },
				],
				dependencies: [],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		case "coordinator":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Orchestrates multi-worker workflows, dependency resolution, and dispatch.`,
				version,
				capabilities: ["workflow_orchestration", "dependency_resolution", "worker_dispatch", "progress_tracking"],
				inputs: [
					{ name: "worker_statuses", description: "Status of registered workers", type: "WorkerStatus[]", required: true, sources: ["brain-worker-registry"] },
					{ name: "pending_tasks", description: "Tasks awaiting worker dispatch", type: "WorkerTask[]", required: true, sources: ["task-queue"] },
					{ name: "contract_registry", description: "Available worker contracts for capability matching", type: "WorkerContract[]", required: true, sources: ["contract-registry"] },
				],
				outputs: [
					{ name: "dispatch_orders", description: "Worker dispatch instructions", type: "DispatchOrder[]", destinations: ["brain-worker-registry"] },
					{ name: "workflow_status", description: "Status of active workflows", type: "WorkflowStatus[]", destinations: ["brain-timeline", "dashboard"] },
				],
				errors: [
					{ code: "NO_CAPABLE_WORKER", description: "No worker found with required capabilities", severity: "critical", remediation: "Register a worker with the required capabilities" },
					{ code: "DEPENDENCY_CYCLE", description: "Circular dependency detected in workflow", severity: "critical", remediation: "Redesign workflow to eliminate circular dependency" },
				],
				dependencies: ["brain-worker.observer", "brain-worker.analyst", "brain-worker.proposer"],
				supportsStreaming: true,
				supportsCancellation: true,
			};

		case "auditor":
			return {
				id: `${baseId}.v${version}`,
				name: `${label} Contract`,
				description: `Audits decisions, policy compliance, provenance chains, and worker health.`,
				version,
				capabilities: ["policy_compliance_audit", "provenance_verification", "decision_audit", "worker_health_check"],
				inputs: [
					{ name: "policy_events", description: "Policy compliance events to audit", type: "PolicyEvent[]", required: true, sources: ["policy-engine"] },
					{ name: "worker_statuses", description: "Worker statuses for health audit", type: "WorkerStatus[]", required: true, sources: ["brain-worker-registry"] },
					{ name: "audit_logs", description: "Historical audit log entries", type: "AuditLogEntry[]", required: false, sources: ["brain-audit"] },
				],
				outputs: [
					{ name: "audit_reports", description: "Generated audit reports", type: "AuditReport[]", destinations: ["brain-audit", "dashboard"] },
					{ name: "compliance_alerts", description: "Policy compliance alerts", type: "ComplianceAlert[]", destinations: ["brain-timeline", "proposal-inbox"] },
				],
				errors: [
					{ code: "POLICY_ENGINE_UNAVAILABLE", description: "Policy engine not reachable for audit", severity: "critical", remediation: "Check policy engine health" },
					{ code: "INSUFFICIENT_AUDIT_TRAIL", description: "Not enough data to complete audit", severity: "warning", remediation: "Increase audit log retention" },
				],
				dependencies: ["brain-worker.coordinator"],
				supportsStreaming: false,
				supportsCancellation: true,
			};

		default: {
			const _exhaustive: never = role;
			throw new Error(`Unknown worker role: ${_exhaustive}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Capability Matching
// ---------------------------------------------------------------------------

/**
 * Result of a capability match operation.
 */
export interface CapabilityMatchResult {
	/** Whether the required capabilities are satisfied */
	satisfied: boolean;
	/** Capabilities that were matched */
	matched: string[];
	/** Capabilities that are missing */
	missing: string[];
	/** Extra capabilities the provider offers beyond requirements */
	extra: string[];
}

/**
 * Check if a set of provided capabilities satisfies a set of required capabilities.
 *
 * Partial matching is supported: if `allowPartial` is true, the match
 * succeeds as long as at least one required capability is provided.
 * By default, ALL required capabilities must be present.
 *
 * @param provided - The capabilities a worker provides.
 * @param required - The capabilities that are required.
 * @param allowPartial - If true, match succeeds on at least one match.
 * @returns A CapabilityMatchResult describing the match.
 */
export function matchCapabilities(
	provided: string[],
	required: string[],
	allowPartial: boolean = false,
): CapabilityMatchResult {
	const providedSet = new Set(provided);
	const matched: string[] = [];
	const missing: string[] = [];

	for (const req of required) {
		if (providedSet.has(req)) {
			matched.push(req);
		} else {
			missing.push(req);
		}
	}

	const extra = provided.filter((p) => !required.includes(p));

	const satisfied = allowPartial ? matched.length > 0 : missing.length === 0;

	return { satisfied, matched, missing, extra };
}

// ---------------------------------------------------------------------------
// Dependency Resolution
// ---------------------------------------------------------------------------

/**
 * Result of a dependency resolution check.
 */
export interface DependencyResolutionResult {
	/** Whether all dependencies are satisfied */
	resolved: boolean;
	/** Dependencies that are satisfied */
	satisfied: string[];
	/** Dependencies that are missing */
	unsatisfied: string[];
	/** Errors encountered during resolution */
	errors: string[];
}

/**
 * Check if a worker's dependencies are satisfied by a set of available contracts.
 *
 * For each dependency listed in the worker's contract, checks if there
 * is at least one contract in the provided set whose ID matches (or
 * starts with) the dependency string.
 *
 * @param contract - The contract whose dependencies to check.
 * @param availableContracts - Contracts available in the system.
 * @returns A DependencyResolutionResult describing the resolution.
 */
export function resolveDependencies(
	contract: WorkerContract,
	availableContracts: WorkerContract[],
): DependencyResolutionResult {
	const satisfied: string[] = [];
	const unsatisfied: string[] = [];
	const errors: string[] = [];

	if (contract.dependencies.length === 0) {
		return { resolved: true, satisfied: [], unsatisfied: [], errors: [] };
	}

	for (const dep of contract.dependencies) {
		// Check for exact match or prefix match (e.g., "brain-worker.observer" matches
		// "brain-worker.observer.v1.0.0")
		const found = availableContracts.some(
			(c) => c.id === dep || c.id.startsWith(dep) || c.id.startsWith(`${dep}.`),
		);

		if (found) {
			satisfied.push(dep);
		} else {
			unsatisfied.push(dep);
			errors.push(`Dependency '${dep}' is not satisfied by any available contract`);
		}
	}

	return {
		resolved: unsatisfied.length === 0,
		satisfied,
		unsatisfied,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Contract Validation
// ---------------------------------------------------------------------------

/**
 * Validate a contract against a set of requirements.
 *
 * Checks:
 * 1. The contract itself is structurally valid (via validateWorkerContract).
 * 2. All required inputs are present.
 * 3. All required capabilities are present.
 * 4. Dependencies can be resolved (if availableContracts provided).
 *
 * @param contract - The contract to validate.
 * @param requiredCapabilities - Capabilities the contract must provide.
 * @param availableContracts - Contracts available for dependency resolution.
 * @returns A ContractValidationResult with errors and warnings.
 */
export function validateContractAgainstRequirements(
	contract: WorkerContract,
	requiredCapabilities?: string[],
	availableContracts?: WorkerContract[],
): ContractValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// 1. Structural validation
	const structural = validateWorkerContract(contract);
	if (!structural.valid) {
		errors.push(...structural.errors);
		// If structural validation fails, return early since we can't check further
		return { valid: false, errors, warnings };
	}

	// 2. Capability check
	if (requiredCapabilities && requiredCapabilities.length > 0) {
		const capabilityMatch = matchCapabilities(contract.capabilities, requiredCapabilities);
		if (!capabilityMatch.satisfied) {
			errors.push(
				`Missing required capabilities: ${capabilityMatch.missing.join(", ")}`,
			);
		}
		if (capabilityMatch.missing.length > 0 && capabilityMatch.matched.length > 0) {
			warnings.push(
				`Partially satisfied: missing ${capabilityMatch.missing.join(", ")}`,
			);
		}
	}

	// 3. Input requirements check
	for (const input of contract.inputs) {
		if (input.required && (!input.sources || input.sources.length === 0)) {
			warnings.push(
				`Required input '${input.name}' has no sources configured`,
			);
		}
	}

	// 4. Output destination check
	for (const output of contract.outputs) {
		if (!output.destinations || output.destinations.length === 0) {
			warnings.push(
				`Output '${output.name}' has no destinations configured`,
			);
		}
	}

	// 5. Dependency resolution
	if (availableContracts && availableContracts.length > 0) {
		const depResult = resolveDependencies(contract, availableContracts);
		if (!depResult.resolved) {
			errors.push(...depResult.errors);
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Contract Registry (In-Memory)
// ---------------------------------------------------------------------------

/**
 * Simple in-memory registry for worker contracts.
 *
 * Provides registration, lookup by ID, querying by capability, and
 * bulk availability for dependency resolution.
 */
export class ContractRegistry {
	private contracts: Map<string, WorkerContract> = new Map();

	/**
	 * Register a contract.
	 *
	 * @param contract - The contract to register.
	 * @throws If a contract with the same ID is already registered.
	 */
	register(contract: WorkerContract): void {
		if (this.contracts.has(contract.id)) {
			throw new Error(`Contract '${contract.id}' is already registered`);
		}
		this.contracts.set(contract.id, contract);
	}

	/**
	 * Unregister a contract by ID.
	 *
	 * @param contractId - The ID of the contract to unregister.
	 * @returns true if the contract was found and removed.
	 */
	unregister(contractId: string): boolean {
		return this.contracts.delete(contractId);
	}

	/**
	 * Look up a contract by ID.
	 *
	 * @param contractId - The contract ID to look up.
	 * @returns The contract, or undefined if not found.
	 */
	get(contractId: string): WorkerContract | undefined {
		return this.contracts.get(contractId);
	}

	/**
	 * Get all registered contracts.
	 *
	 * @returns Array of all registered contracts.
	 */
	getAll(): WorkerContract[] {
		return Array.from(this.contracts.values());
	}

	/**
	 * Find contracts that provide a specific capability.
	 *
	 * @param capability - The capability to search for.
	 * @returns Contracts that provide the capability.
	 */
	findByCapability(capability: string): WorkerContract[] {
		return this.getAll().filter((c) => c.capabilities.includes(capability));
	}

	/**
	 * Find contracts for a given role.
	 *
	 * @param role - The worker role to search for.
	 * @returns Contracts whose ID contains the role name.
	 */
	findByRole(role: WorkerRole): WorkerContract[] {
		return this.getAll().filter((c) => c.id.includes(role));
	}

	/**
	 * Get the count of registered contracts.
	 */
	get size(): number {
		return this.contracts.size;
	}

	/**
	 * Clear all registered contracts.
	 */
	clear(): void {
		this.contracts.clear();
	}
}

// ---------------------------------------------------------------------------
// Manifest Generator
// ---------------------------------------------------------------------------

/**
 * Options for generating a worker manifest.
 */
export interface ManifestGenerationOptions {
	/** Worker role (required) */
	role: WorkerRole;
	/** Human-readable name (required) */
	name: string;
	/** Human-readable description (required) */
	description: string;
	/** Contract version (default: "1.0.0") */
	version?: string;
	/** Tags for categorization */
	tags?: string[];
	/** Custom contract overrides — merged with the role template */
	contractOverrides?: Partial<WorkerContract>;
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Generate a complete WorkerManifest for a given role and options.
 *
 * Creates a role-appropriate contract via generateContractForRole,
 * then overlays any custom overrides, and assembles the manifest.
 *
 * @param options - Manifest generation options.
 * @returns A fully populated WorkerManifest.
 */
export function generateManifest(options: ManifestGenerationOptions): WorkerManifest {
	const baseContract = generateContractForRole(options.role, options.version ?? "1.0.0");

	// Apply contract overrides
	const contract: WorkerContract = options.contractOverrides
		? {
				...baseContract,
				...options.contractOverrides,
				// Deep merge arrays instead of replacing
				capabilities: options.contractOverrides.capabilities ?? baseContract.capabilities,
				inputs: options.contractOverrides.inputs ?? baseContract.inputs,
				outputs: options.contractOverrides.outputs ?? baseContract.outputs,
				errors: options.contractOverrides.errors ?? baseContract.errors,
				dependencies: options.contractOverrides.dependencies ?? baseContract.dependencies,
			}
		: baseContract;

	const manifest: WorkerManifest = {
		id: randomUUID(),
		role: options.role,
		name: options.name,
		version: options.version ?? "1.0.0",
		createdAt: new Date().toISOString(),
		description: options.description,
		contract,
		budget: { ...contractDefaults(options.role) },
		dedupConfig: { ...DEFAULT_WORKER_DEDUP_CONFIG },
		tags: options.tags ?? [],
		metadata: options.metadata ?? {},
	};

	return manifest;
}

/**
 * Get default budget values for a worker role.
 */
function contractDefaults(role: WorkerRole): WorkerBudget {
	return { ...DEFAULT_ROLE_BUDGETS[role] };
}
