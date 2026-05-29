/**
 * Reflection Audit — V5.10 AC3
 *
 * Append-only audit trail for reflection corrections and rejections.
 *
 * Every correction or rejection of a reflection report is recorded
 * as an immutable audit entry. The audit trail provides full
 * traceability for:
 * - Claim corrections (incorrect statements fixed)
 * - Claim rejections (false claims flagged)
 * - Full report rejections
 * - Report regenerations
 *
 * Following V4 ExecutionKernel doctrine: this module never mutates
 * execution state directly. It stores audit entries only and does
 * not modify plans, workspaces, or execution state.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type {
	ReflectionAuditEntry,
	ReflectionCorrection,
	ReflectionRejection,
	ReflectionReport,
	SourceRef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Audit Store Interface
// ---------------------------------------------------------------------------

/**
 * Reflection audit store interface.
 *
 * Persists audit entries and supports querying by report ID and time range.
 */
export interface ReflectionAuditStore {
	/** Append an audit entry (immutable — entries cannot be modified or deleted). */
	append(entry: ReflectionAuditEntry): Promise<void>;

	/** Get all audit entries for a specific reflection report. */
	getByReportId(reportId: string): Promise<ReflectionAuditEntry[]>;

	/** Get a single audit entry by ID. */
	getById(id: string): Promise<ReflectionAuditEntry | null>;

	/** List all audit entries with optional pagination. */
	list(limit?: number, offset?: number): Promise<{ entries: ReflectionAuditEntry[]; total: number }>;

	/** Count entries after a given timestamp. */
	countSince(timestamp: string): Promise<number>;

	/** Clear all entries (for testing only). */
	clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-Memory Audit Store
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of ReflectionAuditStore.
 *
 * Stores audit entries in an array. Entries are append-only and immutable.
 * Non-production use — for production, a database-backed implementation
 * would be used.
 */
export class InMemoryReflectionAuditStore implements ReflectionAuditStore {
	private entries: ReflectionAuditEntry[] = [];

	async append(entry: ReflectionAuditEntry): Promise<void> {
		this.entries.push(entry);
	}

	async getByReportId(reportId: string): Promise<ReflectionAuditEntry[]> {
		return this.entries.filter((e) => e.reportId === reportId);
	}

	async getById(id: string): Promise<ReflectionAuditEntry | null> {
		return this.entries.find((e) => e.id === id) ?? null;
	}

	async list(limit = 100, offset = 0): Promise<{ entries: ReflectionAuditEntry[]; total: number }> {
		const sorted = [...this.entries].sort(
			(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
		);
		const total = sorted.length;
		const entries = sorted.slice(offset, offset + limit);
		return { entries, total };
	}

	async countSince(timestamp: string): Promise<number> {
		const sinceMs = new Date(timestamp).getTime();
		return this.entries.filter((e) => new Date(e.timestamp).getTime() > sinceMs).length;
	}

	async clear(): Promise<void> {
		this.entries = [];
	}
}

// ---------------------------------------------------------------------------
// Reflection Audit Service
// ---------------------------------------------------------------------------

/**
 * Reflection audit service.
 *
 * Provides high-level methods for correcting and rejecting reflections,
 * storing the audit trail, and updating the reflection report accordingly.
 *
 * Following V4 ExecutionKernel doctrine:
 * - Audit entries are stored in the audit store, not in execution state
 * - Corrections update the in-memory report only (caller persists if desired)
 * - No plans, workspaces, or execution state are mutated
 */
export class ReflectionAuditService {
	constructor(private readonly store: ReflectionAuditStore) {}

	/**
	 * Get the underlying audit store.
	 */
	getStore(): ReflectionAuditStore {
		return this.store;
	}

	/**
	 * Correct a specific claim in a reflection report.
	 *
	 * Applies the correction to the report's evidence claims and records
	 * an audit entry. Does not mutate execution state.
	 *
	 * @param report - The reflection report to correct
	 * @param claimId - The ID of the claim to correct
	 * @param correctedValue - The corrected statement
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction ("user" or "system")
	 * @param sourceRefs - Optional source refs supporting the correction
	 * @returns The updated report (in-place mutation) and the audit entry
	 */
	async correctClaim(
		report: ReflectionReport,
		claimId: string,
		correctedValue: string,
		reason: string,
		correctedBy: string = "user",
		sourceRefs?: SourceRef[],
	): Promise<{ report: ReflectionReport; entry: ReflectionAuditEntry }> {
		// Find the claim and preserve the original
		const claim = report.claims?.find((c) => c.id === claimId);
		if (!claim) {
			throw new Error(`Claim ${claimId} not found in reflection report ${report.id}`);
		}

		const originalValue = claim.statement;

		// Apply the correction to the claim
		claim.statement = correctedValue;
		claim.audited = true;

		// Create audit entry
		const correction: ReflectionCorrection = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			correctedBy,
			type: "claim",
			claimId,
			originalValue,
			correctedValue,
			reason,
			sourceRefs: sourceRefs ?? [],
		};

		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: correction.timestamp,
			reportId: report.id,
			eventType: "correction",
			correction,
		};

		await this.store.append(entry);

		return { report, entry };
	}

	/**
	 * Correct the summary of a reflection report.
	 *
	 * @param report - The reflection report to correct
	 * @param correctedSummary - The corrected summary text
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction
	 * @returns The updated report and the audit entry
	 */
	async correctSummary(
		report: ReflectionReport,
		correctedSummary: string,
		reason: string,
		correctedBy: string = "user",
	): Promise<{ report: ReflectionReport; entry: ReflectionAuditEntry }> {
		const originalValue = report.summary;

		report.summary = correctedSummary;

		const correction: ReflectionCorrection = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			correctedBy,
			type: "summary",
			originalValue,
			correctedValue: correctedSummary,
			reason,
			sourceRefs: [],
		};

		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: correction.timestamp,
			reportId: report.id,
			eventType: "correction",
			correction,
		};

		await this.store.append(entry);

		return { report, entry };
	}

	/**
	 * Correct the confidence score of a reflection report.
	 *
	 * @param report - The reflection report to correct
	 * @param correctedConfidence - The corrected confidence (0-1)
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction
	 * @returns The updated report and the audit entry
	 */
	async correctConfidence(
		report: ReflectionReport,
		correctedConfidence: number,
		reason: string,
		correctedBy: string = "user",
	): Promise<{ report: ReflectionReport; entry: ReflectionAuditEntry }> {
		if (correctedConfidence < 0 || correctedConfidence > 1) {
			throw new Error("Confidence must be between 0 and 1");
		}

		const originalValue = String(report.confidence);

		report.confidence = correctedConfidence;

		const correction: ReflectionCorrection = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			correctedBy,
			type: "confidence",
			originalValue,
			correctedValue: String(correctedConfidence),
			reason,
			sourceRefs: [],
		};

		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: correction.timestamp,
			reportId: report.id,
			eventType: "correction",
			correction,
		};

		await this.store.append(entry);

		return { report, entry };
	}

	/**
	 * Reject a specific claim in a reflection report.
	 *
	 * Marks the claim as audited and records the rejection in the audit trail.
	 * The claim is not removed but flagged as rejected.
	 *
	 * @param report - The reflection report
	 * @param claimId - The ID of the claim to reject
	 * @param reason - Reason for rejection
	 * @param rejectedBy - Who rejected ("user" or "system")
	 * @returns The audit entry
	 */
	async rejectClaim(
		report: ReflectionReport,
		claimId: string,
		reason: string,
		rejectedBy: string = "user",
	): Promise<ReflectionAuditEntry> {
		const claim = report.claims?.find((c) => c.id === claimId);
		if (!claim) {
			throw new Error(`Claim ${claimId} not found in reflection report ${report.id}`);
		}

		claim.audited = true;

		const rejection: ReflectionRejection = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			rejectedBy,
			claimId,
			reason,
			rejectedStatement: claim.statement,
		};

		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: rejection.timestamp,
			reportId: report.id,
			eventType: "rejection",
			rejection,
		};

		await this.store.append(entry);

		return entry;
	}

	/**
	 * Reject the entire reflection report.
	 *
	 * Records the rejection in the audit trail without modifying the report
	 * content. The report remains accessible for historical reference.
	 *
	 * @param report - The reflection report to reject
	 * @param reason - Reason for rejection
	 * @param rejectedBy - Who rejected
	 * @returns The audit entry
	 */
	async rejectReport(
		report: ReflectionReport,
		reason: string,
		rejectedBy: string = "user",
	): Promise<ReflectionAuditEntry> {
		const rejection: ReflectionRejection = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			rejectedBy,
			reason,
			rejectedStatement: report.summary,
		};

		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: rejection.timestamp,
			reportId: report.id,
			eventType: "rejection",
			rejection,
		};

		await this.store.append(entry);

		return entry;
	}

	/**
	 * Record a reflection regeneration audit entry.
	 *
	 * Notes that a new reflection was generated, potentially replacing
	 * a previous version. This provides a chain of versions.
	 *
	 * @param reportId - The new reflection report ID
	 * @param previousReportId - The previous reflection report ID (if any)
	 * @param reason - Reason for regeneration
	 * @returns The audit entry
	 */
	async recordRegeneration(
		reportId: string,
		previousReportId?: string,
		reason?: string,
	): Promise<ReflectionAuditEntry> {
		const entry: ReflectionAuditEntry = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			reportId,
			eventType: "regeneration",
			previousReportId,
			metadata: { reason: reason ?? "Regenerated from new execution data" },
		};

		await this.store.append(entry);

		return entry;
	}
}
