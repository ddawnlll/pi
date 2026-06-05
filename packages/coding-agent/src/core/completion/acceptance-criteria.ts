/**
 * P44.01 — Acceptance Criteria & Traceability Schema
 *
 * Defines the formal schema for acceptance criteria with traceability to
 * evidence artifacts. Each criterion has a unique ID, level, category,
 * and links to evidence that proves it is satisfied.
 *
 * The system integrates with:
 * - EvidenceLedger (P44.02) for storing evidence artifacts
 * - WorkerReportContract (P44.06) for reporting results
 * - CompletionGate for blocking completion when criteria are unmet
 *
 * Contract Schema: 4.1.1
 */

import type { EvidenceLedgerEntry } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for acceptance criteria definitions.
 */
export const ACCEPTANCE_CRITERIA_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The level/severity of an acceptance criterion.
 * - `required`: Must be satisfied for the workspace/plan to complete.
 * - `nice_to_have`: Desirable but non-blocking.
 * - `blocking`: Immediately blocks completion if not met.
 */
export type CriterionLevel = "required" | "nice_to_have" | "blocking";

/**
 * The category/domain of an acceptance criterion.
 */
export type CriterionCategory =
	| "functional"
	| "quality"
	| "safety"
	| "performance"
	| "security"
	| "compliance"
	| "observability"
	| "test"
	| "documentation"
	| "process"
	| "custom";

/**
 * Verification status of a criterion.
 */
export type CriterionVerificationStatus =
	| "unverified"
	| "in_progress"
	| "satisfied"
	| "failed"
	| "skipped";

/**
 * Normalized acceptance criterion with full schema.
 */
export interface AcceptanceCriterion {
	/** Unique criterion identifier (e.g., "AC-P4401-001") */
	id: string;
	/** Human-readable description of what must be true */
	description: string;
	/** Level/severity of the criterion */
	level: CriterionLevel;
	/** Category/domain */
	category: CriterionCategory;
	/** Whether evidence artifacts are required to prove satisfaction */
	evidenceRequired: boolean;
	/** Current verification status */
	verificationStatus: CriterionVerificationStatus;
	/** IDs of evidence ledger entries that prove this criterion */
	evidenceIds: string[];
	/** Optional notes from the verifier */
	verifierNotes: string;
	/** Timestamp when verification was last performed (epoch ms) */
	verifiedAt: number | null;
	/** Who/what performed the verification */
	verifiedBy: string;
	/** Optional custom metadata */
	metadata?: Record<string, unknown>;
}

/**
 * A traceability link between a criterion and an evidence entry.
 */
export interface CriterionTraceabilityLink {
	/** Criterion ID */
	criterionId: string;
	/** Evidence entry ID */
	evidenceId: string;
	/** The nature of the link (e.g., "proves", "supports", "contradicts") */
	relationship: "proves" | "supports" | "contradicts" | "references";
	/** Optional explanation of the link */
	explanation: string;
	/** When the link was established (epoch ms) */
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Criterion Helpers
// ---------------------------------------------------------------------------

/**
 * Create a new acceptance criterion with default values.
 *
 * @param id - Unique criterion identifier
 * @param description - Human-readable description
 * @param overrides - Optional overrides for default values
 * @returns A fully populated AcceptanceCriterion
 */
export function createCriterion(
	id: string,
	description: string,
	overrides?: Partial<AcceptanceCriterion>,
): AcceptanceCriterion {
	return {
		id,
		description,
		level: "required",
		category: "functional",
		evidenceRequired: true,
		verificationStatus: "unverified",
		evidenceIds: [],
		verifierNotes: "",
		verifiedAt: null,
		verifiedBy: "",
		...overrides,
	};
}

/**
 * Generate a criterion ID from a workspace/plan context.
 *
 * @param prefix - Identifier prefix (e.g., "P4401" or "P44.01")
 * @param sequence - Sequence number (zero-padded to 3 digits)
 * @returns Formatted criterion ID (e.g., "AC-P4401-001")
 */
export function formatCriterionId(prefix: string, sequence: number): string {
	const normalized = prefix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `AC-${normalized}-${String(sequence).padStart(3, "0")}`;
}

/**
 * Check whether a criterion is in a terminal, blocking state.
 * Returns true if the criterion has failed or is blocking-level and unmet.
 *
 * @param criterion - The acceptance criterion to check
 * @returns True if the criterion should block completion
 */
export function isCriterionBlocking(criterion: AcceptanceCriterion): boolean {
	if (criterion.verificationStatus === "failed") {
		return true;
	}
	if (criterion.level === "blocking" && criterion.verificationStatus !== "satisfied") {
		return true;
	}
	if (criterion.level === "required" && criterion.verificationStatus !== "satisfied") {
		return true;
	}
	return false;
}

/**
 * Determine the overall verification status for a collection of criteria.
 *
 * Rules:
 * - If any required or blocking criterion has failed → "failed"
 * - If all criteria are satisfied → "satisfied"
 * - If any criterion is in_progress → "in_progress"
 * - If any criterion is unverified and evidence is required → "unverified"
 * - Otherwise → "satisfied" (all unverified nice_to_have are ignored)
 *
 * @param criteria - Array of acceptance criteria
 * @returns The aggregate status
 */
export function aggregateCriterionStatus(criteria: AcceptanceCriterion[]): CriterionVerificationStatus {
	let hasUnverified = false;
	let hasInProgress = false;
	let hasFailed = false;

	for (const c of criteria) {
		if (c.verificationStatus === "failed") {
			if (c.level === "required" || c.level === "blocking") {
				hasFailed = true;
			}
		}
		if (c.verificationStatus === "in_progress") {
			hasInProgress = true;
		}
		if (c.verificationStatus === "unverified" && c.evidenceRequired) {
			hasUnverified = true;
		}
	}

	if (hasFailed) return "failed";
	if (hasInProgress) return "in_progress";
	if (hasUnverified) return "unverified";
	return "satisfied";
}

/**
 * Get all criteria that are currently blocking completion.
 *
 * @param criteria - Array of acceptance criteria
 * @returns Filtered array of blocking criteria
 */
export function getBlockingCriteria(criteria: AcceptanceCriterion[]): AcceptanceCriterion[] {
	return criteria.filter(isCriterionBlocking);
}

/**
 * Format block reasons for criteria that are preventing completion.
 *
 * @param criteria - Array of acceptance criteria
 * @returns Human-readable block reason strings
 */
export function formatBlockingReasons(criteria: AcceptanceCriterion[]): string[] {
	return getBlockingCriteria(criteria).map((c) => {
		switch (c.verificationStatus) {
			case "failed":
				return `Acceptance criterion ${c.id} failed: ${c.description}`;
			case "unverified":
				return `Acceptance criterion ${c.id} unverified: ${c.description}`;
			default:
				return `Acceptance criterion ${c.id} not satisfied (${c.verificationStatus}): ${c.description}`;
		}
	});
}

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

/**
 * Create a traceability link between a criterion and an evidence entry.
 *
 * @param criterionId - Criterion ID
 * @param evidenceId - Evidence entry ID
 * @param relationship - Nature of the link
 * @param explanation - Optional explanation
 * @returns A CriterionTraceabilityLink
 */
export function createTraceabilityLink(
	criterionId: string,
	evidenceId: string,
	relationship: CriterionTraceabilityLink["relationship"] = "proves",
	explanation: string = "",
): CriterionTraceabilityLink {
	return {
		criterionId,
		evidenceId,
		relationship,
		explanation,
		createdAt: Date.now(),
	};
}

/**
 * Build a traceability report from criteria and evidence.
 *
 * @param criteria - Array of acceptance criteria
 * @param evidenceEntries - Array of evidence ledger entries
 * @param links - Array of traceability links
 * @returns A formatted traceability report string
 */
export function buildTraceabilityReport(
	criteria: AcceptanceCriterion[],
	evidenceEntries: EvidenceLedgerEntry[],
	links: CriterionTraceabilityLink[],
): string {
	const evidenceMap = new Map(evidenceEntries.map((e) => [e.id, e]));
	const lines: string[] = [];

	lines.push("# Traceability Report");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push(`Criteria: ${criteria.length}, Evidence: ${evidenceEntries.length}, Links: ${links.length}`);
	lines.push("");

	for (const criterion of criteria) {
		const criterionLinks = links.filter((l) => l.criterionId === criterion.id);
		lines.push(`## ${criterion.id} — ${criterion.description}`);
		lines.push(`- Level: ${criterion.level}`);
		lines.push(`- Category: ${criterion.category}`);
		lines.push(`- Status: ${criterion.verificationStatus}`);
		lines.push(`- Evidence Required: ${criterion.evidenceRequired}`);
		lines.push("");

		if (criterionLinks.length === 0) {
			lines.push("  No traceability links.");
		} else {
			for (const link of criterionLinks) {
				const evidence = evidenceMap.get(link.evidenceId);
				const evidenceDesc = evidence ? `"${evidence.description}"` : "(unknown)";
				lines.push(`  - ${link.relationship}: [${link.evidenceId}] ${evidenceDesc}`);
				if (link.explanation) {
					lines.push(`    - ${link.explanation}`);
				}
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Acceptance Criteria Registry
// ---------------------------------------------------------------------------

/**
 * Registry that holds acceptance criteria for a workspace or plan,
 * manages verification state, and provides serialization for reports.
 */
export class AcceptanceCriteriaRegistry {
	private criteria: Map<string, AcceptanceCriterion> = new Map();
	private traceabilityLinks: CriterionTraceabilityLink[] = [];
	private readonly scopeId: string;

	/**
	 * @param scopeId - Identifier for the scope (e.g., "P44.01" or "plan-P44")
	 */
	constructor(scopeId: string) {
		this.scopeId = scopeId;
	}

	/**
	 * Get the scope identifier.
	 */
	get scope(): string {
		return this.scopeId;
	}

	/**
	 * Register one or more acceptance criteria.
	 *
	 * @param newCriteria - Criteria to add
	 * @throws If a criterion with the same ID already exists
	 */
	register(...newCriteria: AcceptanceCriterion[]): void {
		for (const c of newCriteria) {
			if (this.criteria.has(c.id)) {
				throw new Error(`Acceptance criterion ${c.id} already registered in scope ${this.scopeId}`);
			}
			this.criteria.set(c.id, { ...c });
		}
	}

	/**
	 * Get a criterion by ID.
	 *
	 * @param id - Criterion ID
	 * @returns The criterion, or undefined if not found
	 */
	get(id: string): AcceptanceCriterion | undefined {
		return this.criteria.get(id);
	}

	/**
	 * Get all registered criteria.
	 */
	getAll(): AcceptanceCriterion[] {
		return Array.from(this.criteria.values());
	}

	/**
	 * Get criteria filtered by level.
	 *
	 * @param level - Level to filter by
	 * @returns Filtered array of criteria
	 */
	getByLevel(level: CriterionLevel): AcceptanceCriterion[] {
		return this.getAll().filter((c) => c.level === level);
	}

	/**
	 * Get criteria filtered by verification status.
	 *
	 * @param status - Status to filter by
	 * @returns Filtered array of criteria
	 */
	getByStatus(status: CriterionVerificationStatus): AcceptanceCriterion[] {
		return this.getAll().filter((c) => c.verificationStatus === status);
	}

	/**
	 * Update the verification status of a criterion.
	 *
	 * @param id - Criterion ID
	 * @param status - New verification status
	 * @param notes - Optional verifier notes
	 * @param verifiedBy - Identifier of the verifier
	 * @throws If the criterion ID is not found
	 */
	updateStatus(
		id: string,
		status: CriterionVerificationStatus,
		notes: string = "",
		verifiedBy: string = "system",
	): void {
		const criterion = this.criteria.get(id);
		if (!criterion) {
			throw new Error(`Acceptance criterion ${id} not found in scope ${this.scopeId}`);
		}
		this.criteria.set(id, {
			...criterion,
			verificationStatus: status,
			verifierNotes: notes,
			verifiedAt: Date.now(),
			verifiedBy,
		});
	}

	/**
	 * Mark a criterion as satisfied with associated evidence.
	 *
	 * @param id - Criterion ID
	 * @param evidenceId - Evidence entry ID that proves satisfaction
	 * @param notes - Optional verifier notes
	 * @param verifiedBy - Identifier of the verifier
	 */
	markSatisfied(id: string, evidenceId: string, notes: string = "", verifiedBy: string = "system"): void {
		this.updateStatus(id, "satisfied", notes, verifiedBy);
		this.addEvidenceLink(id, evidenceId);
	}

	/**
	 * Mark a criterion as failed.
	 *
	 * @param id - Criterion ID
	 * @param notes - Reason for failure
	 * @param verifiedBy - Identifier of the verifier
	 */
	markFailed(id: string, notes: string = "", verifiedBy: string = "system"): void {
		this.updateStatus(id, "failed", notes, verifiedBy);
	}

	/**
	 * Add an evidence link to a criterion.
	 *
	 * @param criterionId - Criterion ID
	 * @param evidenceId - Evidence entry ID
	 */
	addEvidenceLink(criterionId: string, evidenceId: string): void {
		const criterion = this.criteria.get(criterionId);
		if (!criterion) {
			throw new Error(`Acceptance criterion ${criterionId} not found in scope ${this.scopeId}`);
		}
		if (!criterion.evidenceIds.includes(evidenceId)) {
			this.criteria.set(criterionId, {
				...criterion,
				evidenceIds: [...criterion.evidenceIds, evidenceId],
			});
		}
	}

	/**
	 * Add a traceability link.
	 *
	 * @param link - The traceability link to add
	 */
	addTraceabilityLink(link: CriterionTraceabilityLink): void {
		this.traceabilityLinks.push(link);
	}

	/**
	 * Get all traceability links.
	 */
	getTraceabilityLinks(): CriterionTraceabilityLink[] {
		return this.traceabilityLinks;
	}

	/**
	 * Get traceability links for a specific criterion.
	 *
	 * @param criterionId - Criterion ID
	 * @returns Filtered traceability links
	 */
	getLinksForCriterion(criterionId: string): CriterionTraceabilityLink[] {
		return this.traceabilityLinks.filter((l) => l.criterionId === criterionId);
	}

	/**
	 * Get criteria that are blocking completion.
	 */
	getBlocking(): AcceptanceCriterion[] {
		return getBlockingCriteria(this.getAll());
	}

	/**
	 * Get the aggregate verification status.
	 */
	getAggregateStatus(): CriterionVerificationStatus {
		return aggregateCriterionStatus(this.getAll());
	}

	/**
	 * Get block reasons for criteria preventing completion.
	 */
	getBlockingReasons(): string[] {
		return formatBlockingReasons(this.getAll());
	}

	/**
	 * Check whether all required and blocking criteria are satisfied.
	 */
	isComplete(): boolean {
		return this.getAggregateStatus() === "satisfied";
	}

	/**
	 * Serialize the registry state to a plain object for reporting/artifacts.
	 */
	toJSON(): AcceptanceCriteriaReport {
		return {
			scopeId: this.scopeId,
			schemaVersion: ACCEPTANCE_CRITERIA_SCHEMA_VERSION,
			total: this.criteria.size,
			satisfied: this.getByStatus("satisfied").length,
			failed: this.getByStatus("failed").length,
			unverified: this.getByStatus("unverified").length,
			inProgress: this.getByStatus("in_progress").length,
			skipped: this.getByStatus("skipped").length,
			blocking: this.getBlocking().length,
			aggregateStatus: this.getAggregateStatus(),
			complete: this.isComplete(),
			criteria: this.getAll(),
			traceabilityLinks: this.traceabilityLinks,
		};
	}

	/**
	 * Build a human-readable traceability report.
	 */
	buildReport(evidenceEntries: EvidenceLedgerEntry[] = []): string {
		return buildTraceabilityReport(this.getAll(), evidenceEntries, this.traceabilityLinks);
	}

	/**
	 * Clear all criteria and links.
	 */
	clear(): void {
		this.criteria.clear();
		this.traceabilityLinks = [];
	}
}

// ---------------------------------------------------------------------------
// Report Types
// ---------------------------------------------------------------------------

/**
 * Serialized report format for acceptance criteria verification.
 */
export interface AcceptanceCriteriaReport {
	scopeId: string;
	schemaVersion: string;
	total: number;
	satisfied: number;
	failed: number;
	unverified: number;
	inProgress: number;
	skipped: number;
	blocking: number;
	aggregateStatus: CriterionVerificationStatus;
	complete: boolean;
	criteria: AcceptanceCriterion[];
	traceabilityLinks: CriterionTraceabilityLink[];
}

// ---------------------------------------------------------------------------
// Factory Helpers
// ---------------------------------------------------------------------------

/**
 * Create a registry pre-populated with criteria from a plan's workspace
 * definition. Converts the simple string[] format to the full schema.
 *
 * @param scopeId - Scope identifier (workspace or plan ID)
 * @param criteriaIds - Array of criterion IDs or strings to register
 * @returns A populated AcceptanceCriteriaRegistry
 */
export function createRegistryFromPlan(
	scopeId: string,
	criteriaIds: string[],
): AcceptanceCriteriaRegistry {
	const registry = new AcceptanceCriteriaRegistry(scopeId);
	for (let i = 0; i < criteriaIds.length; i++) {
		const raw = criteriaIds[i];
		const criterion = createCriterion(raw, raw, { level: "required", category: "functional" });
		registry.register(criterion);
	}
	return registry;
}

/**
 * Create criteria from a planned workspace's acceptance criteria array.
 * Supports both string[] and full AcceptanceCriterion[] formats.
 *
 * @param scopeId - Scope identifier
 * @param rawCriteria - Raw acceptance criteria (strings or objects)
 * @param startSequence - Starting sequence number for auto-generated IDs
 * @returns Array of fully-formed AcceptanceCriterion
 */
export function parseRawCriteria(
	scopeId: string,
	rawCriteria: (string | Partial<AcceptanceCriterion>)[],
	startSequence: number = 1,
): AcceptanceCriterion[] {
	return rawCriteria.map((raw, idx) => {
		if (typeof raw === "string") {
			return createCriterion(
				formatCriterionId(scopeId, startSequence + idx),
				raw,
			);
		}
		return createCriterion(
			raw.id || formatCriterionId(scopeId, startSequence + idx),
			raw.description || `Acceptance criterion ${startSequence + idx}`,
			raw,
		);
	});
}
