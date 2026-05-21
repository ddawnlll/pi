/**
 * Provenance Tracker — P18.F / Workspace 7.F
 *
 * Tracks decision provenance chains so every action can be explained
 * with its evidence lineage.
 *
 * Features:
 * - Directed provenance chain: decision -> policy evaluation -> evidence
 * - Links to proposal, memory, observation, and policy rule refs
 * - Human-readable explanation generation via chain traversal
 * - JSON-file-based persistence to `.pi/brain/audit/provenance/`
 * - Stats for monitoring
 *
 * File Structure:
 *   .pi/brain/audit/provenance/
 *   └── records.json           # All provenance records as JSON object
 */

import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import type {
	AuditEntry,
	ProvenanceLink,
	ProvenanceRecord,
	ProvenanceTargetType,
} from "../policy/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PERSISTENCE_DIR = ".pi/brain/audit/provenance";
const RECORDS_FILE = "records.json";

// ---------------------------------------------------------------------------
// ProvenanceTracker
// ---------------------------------------------------------------------------

/**
 * Tracks and explains decision provenance chains.
 *
 * Every policy evaluation can create a provenance record linking the
 * decision to its input context (proposals, memories, observations,
 * and policy rules). The chain can be traversed to generate
 * human-readable explanations.
 */
export class ProvenanceTracker {
	private readonly persistencePath: string;
	private records: Map<string, ProvenanceRecord> = new Map();
	private persistenceReady: boolean = false;

	constructor(options?: { persistencePath?: string }) {
		this.persistencePath = options?.persistencePath ?? DEFAULT_PERSISTENCE_DIR;
	}

	// -----------------------------------------------------------------------
	// Init / Teardown
	// -----------------------------------------------------------------------

	/**
	 * Ensure the persistence directory exists and load existing records.
	 * Safe to call multiple times.
	 */
	async init(): Promise<void> {
		if (this.persistenceReady) return;
		await mkdir(resolve(this.persistencePath), { recursive: true });
		await this.load();
		this.persistenceReady = true;
	}

	// -----------------------------------------------------------------------
	// Track
	// -----------------------------------------------------------------------

	/**
	 * Create a new provenance record for a target.
	 *
	 * @param targetId - The ID of the target (proposal, plan, memory, decision, approval)
	 * @param targetType - The type of the target
	 * @param links - Initial provenance links
	 * @returns The new ProvenanceRecord
	 */
	async track(
		targetId: string,
		targetType: ProvenanceTargetType,
		links: ProvenanceLink[],
	): Promise<ProvenanceRecord> {
		await this.init();

		const now = new Date().toISOString();
		const record: ProvenanceRecord = {
			id: this.generateId(),
			targetId,
			targetType,
			links: links.map((l) => ({
				...l,
				timestamp: l.timestamp || now,
			})),
			createdAt: now,
			updatedAt: now,
		};

		this.records.set(targetId, record);
		await this.save();
		return record;
	}

	/**
	 * Add a link to an existing provenance record.
	 *
	 * @param targetId - The target ID to add the link to
	 * @param link - The provenance link to add
	 * @returns The updated ProvenanceRecord
	 * @throws If no record exists for the target ID
	 */
	async addLink(targetId: string, link: ProvenanceLink): Promise<ProvenanceRecord> {
		await this.init();

		const existing = this.records.get(targetId);
		if (!existing) {
			// Auto-create a record if none exists (lazy creation)
			return this.track(targetId, "decision", [link]);
		}

		const now = new Date().toISOString();
		existing.links.push({
			...link,
			timestamp: link.timestamp || now,
		});
		existing.updatedAt = now;

		this.records.set(targetId, existing);
		await this.save();
		return existing;
	}

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	/**
	 * Get the provenance record for a specific target ID.
	 *
	 * @param targetId - The target ID to look up
	 * @returns The provenance record, or null if not found
	 */
	async getProvenance(targetId: string): Promise<ProvenanceRecord | null> {
		await this.init();
		return this.records.get(targetId) ?? null;
	}

	/**
	 * Get the full provenance chain for a target ID, traversing
	 * linked records recursively.
	 *
	 * @param targetId - The starting target ID
	 * @returns Array of ProvenanceLinks from the chain traversal
	 */
	async getChain(targetId: string): Promise<ProvenanceLink[]> {
		await this.init();
		return this.buildExplanationChain(targetId, new Set(), 0).map(
			(line) =>
				({
					sourceId: targetId,
					sourceType: "decision" as ProvenanceTargetType,
					relationship: "derived_from" as const,
					timestamp: new Date().toISOString(),
					summary: line,
					metadata: {},
				}) as ProvenanceLink,
		);
	}

	// -----------------------------------------------------------------------
	// Explanation
	// -----------------------------------------------------------------------

	/**
	 * Generate a human-readable explanation of a decision from its audit entry.
	 *
	 * @param decisionAuditEntry - The audit entry for the decision
	 * @returns A human-readable explanation string
	 */
	async explainDecision(decisionAuditEntry: AuditEntry): Promise<string> {
		await this.init();

		const lines: string[] = [];
		const decision = decisionAuditEntry.decision;
		const action = decisionAuditEntry.action;
		const actor = decisionAuditEntry.actor;

		lines.push(`Decision: ${decision.toUpperCase()} — "${action}" by ${actor}`);
		lines.push(`When: ${decisionAuditEntry.timestamp}`);

		if (decisionAuditEntry.policyRuleId) {
			const ruleRef = decisionAuditEntry.policyRuleName
				? `${decisionAuditEntry.policyRuleName} (${decisionAuditEntry.policyRuleId})`
				: decisionAuditEntry.policyRuleId;
			lines.push(`Matched Rule: ${ruleRef}`);
		}

		if (decisionAuditEntry.proposalId) {
			lines.push(`Proposal: ${decisionAuditEntry.proposalId}`);
		}

		if (decisionAuditEntry.planExecId) {
			lines.push(`Plan Execution: ${decisionAuditEntry.planExecId}`);
		}

		if (decisionAuditEntry.memoryId) {
			lines.push(`Memory: ${decisionAuditEntry.memoryId}`);
		}

		if (decisionAuditEntry.evidence && decisionAuditEntry.evidence.length > 0) {
			lines.push("Evidence:");
			for (const ev of decisionAuditEntry.evidence) {
				lines.push(`  - ${ev.type}: ${ev.id}${ev.description ? ` — ${ev.description}` : ""}`);
			}
		}

		// Include context
		const ctx = decisionAuditEntry.context;
		lines.push(`Autonomy Level: ${ctx.autonomyLevel}`);
		if (ctx.riskLevel) {
			lines.push(`Risk Level: ${ctx.riskLevel}`);
		}

		// Chain traversal from provenance records
		const record = this.records.get(decisionAuditEntry.id);
		if (record && record.links.length > 0) {
			lines.push("");
			lines.push("Provenance Chain:");
			const chainLines = this.buildExplanationChain(decisionAuditEntry.id, new Set(), 0);
			lines.push(...chainLines);
		}

		return lines.join("\n");
	}

	/**
	 * Generate a human-readable explanation of a proposal's provenance.
	 *
	 * @param proposalId - The proposal ID to explain
	 * @returns A human-readable explanation string
	 */
	async explainProposal(proposalId: string): Promise<string> {
		await this.init();

		const record = this.records.get(proposalId);
		if (!record) {
			return `No provenance record found for proposal: ${proposalId}`;
		}

		const lines: string[] = [];
		lines.push(`Provenance for Proposal: ${proposalId}`);
		lines.push(`Created: ${record.createdAt}`);
		lines.push(`Last Updated: ${record.updatedAt}`);
		lines.push(`Links: ${record.links.length}`);

		if (record.links.length > 0) {
			lines.push("");
			lines.push("Chain:");
			const chainLines = this.buildExplanationChain(proposalId, new Set(), 0);
			lines.push(...chainLines);
		}

		return lines.join("\n");
	}

	/**
	 * Generate a human-readable explanation of a memory's provenance.
	 *
	 * @param memoryId - The memory ID to explain
	 * @returns A human-readable explanation string
	 */
	async explainMemory(memoryId: string): Promise<string> {
		await this.init();

		const record = this.records.get(memoryId);
		if (!record) {
			return `No provenance record found for memory: ${memoryId}`;
		}

		const lines: string[] = [];
		lines.push(`Provenance for Memory: ${memoryId}`);
		lines.push(`Created: ${record.createdAt}`);
		lines.push(`Last Updated: ${record.updatedAt}`);
		lines.push(`Links: ${record.links.length}`);

		if (record.links.length > 0) {
			lines.push("");
			lines.push("Chain:");
			const chainLines = this.buildExplanationChain(memoryId, new Set(), 0);
			lines.push(...chainLines);
		}

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Internal: Chain Building
	// -----------------------------------------------------------------------

	/**
	 * Recursively build explanation lines for a provenance chain.
	 *
	 * Tracks visited nodes to prevent infinite loops from circular links.
	 *
	 * @param targetId - The current target ID to explain
	 * @param visited - Set of already-visited target IDs
	 * @param depth - Current recursion depth (for indentation)
	 * @returns Array of explanation lines
	 */
	private buildExplanationChain(
		targetId: string,
		visited: Set<string>,
		depth: number,
	): string[] {
		if (visited.has(targetId)) {
			return [`${"  ".repeat(depth)}[circular reference: ${targetId}]`];
		}

		const record = this.records.get(targetId);
		if (!record) {
			return [`${"  ".repeat(depth)}No provenance record for: ${targetId}`];
		}

		visited.add(targetId);
		const lines: string[] = [];

		for (const link of record.links) {
			const indent = "  ".repeat(depth);
			const arrow = this.relationshipArrow(link.relationship);
			lines.push(
				`${indent}${link.sourceId} (${link.sourceType}) ${arrow} ${targetId} (${record.targetType})`,
			);
			if (link.summary) {
				lines.push(`${indent}  Summary: ${link.summary}`);
			}

			// Recurse into linked sources
			if (link.sourceId !== targetId) {
				const subChain = this.buildExplanationChain(link.sourceId, visited, depth + 1);
				lines.push(...subChain);
			}
		}

		visited.delete(targetId);
		return lines;
	}

	/**
	 * Get a human-readable arrow symbol for a relationship type.
	 */
	private relationshipArrow(relationship: string): string {
		switch (relationship) {
			case "derived_from":
				return "<-- derived from --";
			case "supported_by":
				return "<-- supported by --";
			case "triggered_by":
				return "<-- triggered by --";
			case "corrected_by":
				return "<-- corrected by --";
			case "evaluated_by":
				return "<-- evaluated by --";
			case "resulted_in":
				return "-- resulted in -->";
			default:
				return "<--";
		}
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	/**
	 * Save all provenance records to disk.
	 *
	 * Writes to a single JSON file that is atomically replaced.
	 */
	async save(): Promise<void> {
		const filePath = this.getFilePath();
		await mkdir(resolve(this.persistencePath), { recursive: true });

		const data = {
			version: 1,
			updatedAt: new Date().toISOString(),
			records: Object.fromEntries(this.records),
		};

		// Atomic write: write to temp file then rename
		const tempPath = `${filePath}.tmp`;
		await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");

		const { rename } = await import("fs/promises");
		await rename(tempPath, filePath);
	}

	/**
	 * Load provenance records from disk.
	 *
	 * If the file does not exist yet, this is a no-op.
	 * If the file is corrupted, it is skipped and an error is logged.
	 */
	async load(): Promise<void> {
		const filePath = this.getFilePath();
		if (!existsSync(filePath)) {
			return;
		}

		try {
			const content = await readFile(filePath, "utf-8");
			const data = JSON.parse(content);

			if (!data.records || typeof data.records !== "object") {
				console.error("[ProvenanceTracker] Invalid records file: missing records object");
				return;
			}

			const loaded = new Map<string, ProvenanceRecord>();
			for (const [key, value] of Object.entries(data.records)) {
				const record = value as ProvenanceRecord;
				if (!record.id || !record.targetId || !record.targetType) {
					console.error(`[ProvenanceTracker] Skipping malformed record: ${key}`);
					continue;
				}
				loaded.set(key, record);
			}

			this.records = loaded;
		} catch (err) {
			console.error(`[ProvenanceTracker] Failed to load records: ${err}`);
		}
	}

	/**
	 * Get the full file path for the records file.
	 */
	private getFilePath(): string {
		return resolve(this.persistencePath, RECORDS_FILE);
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get statistics about stored provenance records.
	 *
	 * @returns Stats object
	 */
	async getStats(): Promise<{
		totalRecords: number;
		totalLinks: number;
		byType: Record<ProvenanceTargetType, number>;
	}> {
		await this.init();

		const byType: Record<string, number> = {};
		let totalLinks = 0;

		for (const record of this.records.values()) {
			byType[record.targetType] = (byType[record.targetType] ?? 0) + 1;
			totalLinks += record.links.length;
		}

		return {
			totalRecords: this.records.size,
			totalLinks,
			byType: byType as Record<ProvenanceTargetType, number>,
		};
	}

	/**
	 * Get all records currently held (for testing/debugging).
	 */
	getAllRecords(): Map<string, ProvenanceRecord> {
		return new Map(this.records);
	}

	/**
	 * Clear all records in memory (does not persist).
	 */
	clearInMemory(): void {
		this.records.clear();
		this.persistenceReady = false;
	}

	// -----------------------------------------------------------------------
	// Internal: ID Generation
	// -----------------------------------------------------------------------

	private idCounter = 0;

	/**
	 * Generate a simple unique ID for provenance records.
	 */
	private generateId(): string {
		this.idCounter++;
		const now = Date.now().toString(36);
		const counter = this.idCounter.toString(36).padStart(6, "0");
		const rand = Math.random().toString(36).slice(2, 6);
		return `prov-${now}-${counter}-${rand}`;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new ProvenanceTracker instance.
 *
 * @param options - Optional configuration
 * @returns A new ProvenanceTracker instance
 */
export function createProvenanceTracker(options?: {
	persistencePath?: string;
}): ProvenanceTracker {
	return new ProvenanceTracker(options);
}
