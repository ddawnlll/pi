/**
 * Orchestrator Proposal Generator - P11.H
 *
 * Generates proposal records from scan findings (repo health signals,
 * detections, dashboard metrics, etc.). Each proposal includes evidence
 * links, confidence, risk level, policy classification, and a suggested
 * next action.
 *
 * Self-modification proposals are flagged separately via the
 * SelfModificationFirewall and require explicit enhanced approval.
 *
 * Proposal generation is idempotent: duplicate proposals are detected
 * via content-based hashing and skipped.
 *
 * Acceptance Criteria:
 * 1. The orchestrator can create proposal records from scan findings.
 * 2. Each proposal has evidence links, confidence, risk level, policy
 *    classification, and suggested next action.
 * 3. Self-modification proposals are flagged separately and require
 *    explicit approval.
 * 4. Proposal generation is idempotent and avoids duplicate spam.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { DetectionResult } from "../core/detection-types.js";
import { SelfModificationFirewall } from "../core/self-modification-firewall.js";
import type { HealthSignal, ScanResult } from "../repo-scanner/repo-health-signal.js";
import { PiLogger } from "../utils/logger.js";
import type {
	OrchestratorProposal,
	PolicyClassification,
	ProposalEvidenceLink,
	ProposalGenerationResult,
	ProposalSourceType,
	SuggestedNextAction,
} from "./orchestrator-types.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "orchestrator-proposal-generator" });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the orchestrator proposal generator.
 */
export interface OrchestratorProposalGeneratorConfig {
	/** Working directory for resolving relative paths */
	cwd: string;
	/** Whether the agent is in autonomous mode */
	isAutonomous?: boolean;
	/** Maximum number of proposals to generate per call */
	maxProposals?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PROPOSALS = 100;

// ---------------------------------------------------------------------------
// OrchestratorProposalGenerator
// ---------------------------------------------------------------------------

/**
 * Generates orchestrated proposal records from scan findings.
 *
 * Converts repo health signals, detections, and other scan outputs into
 * structured proposal records with evidence links, confidence/risk
 * assessment, policy classification, and next action suggestions.
 *
 * Self-modification proposals are flagged via the built-in firewall.
 * Duplicates are detected through content hashing.
 */
export class OrchestratorProposalGenerator {
	private readonly cwd: string;
	private readonly firewall: SelfModificationFirewall;
	private readonly maxProposals: number;
	private readonly knownHashes: Set<string> = new Set();

	constructor(config: OrchestratorProposalGeneratorConfig) {
		this.cwd = config.cwd;
		this.firewall = new SelfModificationFirewall({
			cwd: config.cwd,
			isAutonomous: config.isAutonomous ?? false,
		});
		this.maxProposals = config.maxProposals ?? DEFAULT_MAX_PROPOSALS;
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Generate proposal records from a scan result (repo health scan output).
	 *
	 * Each health signal in the scan result produces zero or more proposals.
	 * Duplicate proposals are skipped via content hashing.
	 *
	 * @param scanResult - The scan result to generate proposals from
	 * @returns Proposal generation result with new, duplicate, and error counts
	 */
	generateFromScanResult(scanResult: ScanResult): ProposalGenerationResult {
		const startTime = Date.now();
		const errors: string[] = [];
		const generated: OrchestratorProposal[] = [];
		let duplicateCount = 0;

		log.info(`Generating proposals from scan result with ${scanResult.signals.length} signals`);

		for (const signal of scanResult.signals) {
			if (generated.length >= this.maxProposals) {
				log.warn(`Reached max proposals (${this.maxProposals}), truncating`);
				break;
			}

			try {
				const proposals = this.generateFromSignal(signal);
				for (const proposal of proposals) {
					if (generated.length >= this.maxProposals) break;

					if (this.isDuplicate(proposal.contentHash)) {
						duplicateCount++;
						continue;
					}

					this.knownHashes.add(proposal.contentHash);
					generated.push(proposal);
				}
			} catch (error) {
				const msg = `Error generating proposal from signal ${signal.id}: ${error instanceof Error ? error.message : String(error)}`;
				errors.push(msg);
				log.error(msg);
			}
		}

		const newCount = generated.length;
		const duration = Date.now() - startTime;

		log.info(`Generated ${newCount} new proposals (${duplicateCount} duplicates skipped) in ${duration}ms`);

		if (errors.length > 0) {
			log.warn(`Encountered ${errors.length} error(s) during proposal generation`);
		}

		return {
			proposals: generated,
			newCount,
			duplicateCount,
			errors,
		};
	}

	/**
	 * Generate proposal records from detection results.
	 *
	 * Each detection result produces a single proposal record.
	 *
	 * @param detections - Array of detection results
	 * @returns Proposal generation result
	 */
	generateFromDetections(detections: DetectionResult[]): ProposalGenerationResult {
		const errors: string[] = [];
		const generated: OrchestratorProposal[] = [];
		let duplicateCount = 0;

		log.info(`Generating proposals from ${detections.length} detection(s)`);

		for (const detection of detections) {
			if (generated.length >= this.maxProposals) break;

			try {
				const proposal = this.detectionToProposal(detection);

				if (this.isDuplicate(proposal.contentHash)) {
					duplicateCount++;
					continue;
				}

				this.knownHashes.add(proposal.contentHash);
				generated.push(proposal);
			} catch (error) {
				const msg = `Error generating proposal from detection ${detection.id}: ${error instanceof Error ? error.message : String(error)}`;
				errors.push(msg);
				log.error(msg);
			}
		}

		return {
			proposals: generated,
			newCount: generated.length,
			duplicateCount,
			errors,
		};
	}

	/**
	 * Reset the known hashes set (for testing or between runs).
	 */
	reset(): void {
		this.knownHashes.clear();
	}

	/**
	 * Pre-seed known hashes for idempotent proposal generation.
	 *
	 * Useful when loading existing proposals on orchestrator startup
	 * so that re-generating from the same findings skips duplicates.
	 *
	 * @param proposals - Existing proposals to seed from
	 */
	seedFromProposals(proposals: OrchestratorProposal[]): void {
		for (const proposal of proposals) {
			this.knownHashes.add(proposal.contentHash);
		}
		log.info(`Seeded ${proposals.length} known hashes for duplicate detection`);
	}

	// -----------------------------------------------------------------------
	// Signal conversion
	// -----------------------------------------------------------------------

	/**
	 * Generate proposals from a single health signal.
	 *
	 * A signal may produce multiple proposals (one per SignalProposal item)
	 * or a single proposal from the signal itself if it has no proposals.
	 */
	private generateFromSignal(signal: HealthSignal): OrchestratorProposal[] {
		const proposals: OrchestratorProposal[] = [];

		// If the signal has explicit proposals, create one record per proposal
		if (signal.proposals.length > 0) {
			for (const signalProposal of signal.proposals) {
				proposals.push(this.signalProposalToOrchestratorProposal(signal, signalProposal));
			}
		} else {
			// Signal without explicit proposals — create a single proposal from the signal
			proposals.push(this.signalToOrchestratorProposal(signal));
		}

		return proposals;
	}

	/**
	 * Convert a health signal + its embedded proposal into an orchestrator proposal record.
	 */
	private signalProposalToOrchestratorProposal(
		signal: HealthSignal,
		signalProposal: {
			description: string;
			targetFiles: string[];
			effort: "trivial" | "small" | "medium" | "large";
			autoFixable: boolean;
		},
	): OrchestratorProposal {
		const affectedPaths = this.normalizePaths(signalProposal.targetFiles);
		const evidenceLinks = this.buildEvidenceLinks(signal);

		// Determine if this proposal involves self-modification
		const smCheck = this.firewall.checkFilePaths(affectedPaths);

		// Compute content hash for idempotency
		const contentHash = this.computeHash(signal.id, signalProposal.description);

		// Derive policy classification from signal category
		const policyClassification = this.classifyPolicy(signal.category);

		// Derive confidence from signal severity
		const confidence = this.severityToConfidence(signal.severity);

		// Derive risk from signal severity
		const risk = this.severityToRisk(signal.severity);

		// Determine suggested next action
		const suggestedNextAction = this.determineAction(
			signalProposal.autoFixable,
			smCheck.hasSelfModification,
			signal.severity,
		);

		return {
			id: `prop-${contentHash.slice(0, 12)}`,
			title: signal.title,
			description: signalProposal.description,
			sourceType: "repo_health",
			evidenceLinks,
			confidence,
			risk,
			policyClassification,
			suggestedNextAction,
			isSelfModification: smCheck.hasSelfModification,
			selfModificationReason: smCheck.hasSelfModification ? smCheck.summary : undefined,
			contentHash,
			generatedAt: new Date().toISOString(),
			affectedPaths,
			autoFixable: signalProposal.autoFixable,
			effort: signalProposal.effort,
		};
	}

	/**
	 * Convert a health signal (without embedded proposals) into an orchestrator proposal record.
	 */
	private signalToOrchestratorProposal(signal: HealthSignal): OrchestratorProposal {
		const evidenceLinks = this.buildEvidenceLinks(signal);
		const affectedPaths = this.collectPathsFromSignal(signal);

		// Determine if this proposal involves self-modification
		const smCheck = this.firewall.checkFilePaths(affectedPaths);

		// Compute content hash for idempotency
		const contentHash = this.computeHash(signal.id, signal.description);

		// Derive policy classification from signal category
		const policyClassification = this.classifyPolicy(signal.category);

		// Derive confidence from signal severity
		const confidence = this.severityToConfidence(signal.severity);

		// Derive risk from signal severity
		const risk = this.severityToRisk(signal.severity);

		// Determine suggested next action
		const suggestedNextAction = this.determineAction(false, smCheck.hasSelfModification, signal.severity);

		return {
			id: `prop-${contentHash.slice(0, 12)}`,
			title: signal.title,
			description: signal.description,
			sourceType: "repo_health",
			evidenceLinks,
			confidence,
			risk,
			policyClassification,
			suggestedNextAction,
			isSelfModification: smCheck.hasSelfModification,
			selfModificationReason: smCheck.hasSelfModification ? smCheck.summary : undefined,
			contentHash,
			generatedAt: new Date().toISOString(),
			affectedPaths,
			autoFixable: false,
			effort: "medium",
		};
	}

	/**
	 * Convert a detection result into an orchestrator proposal record.
	 */
	private detectionToProposal(detection: DetectionResult): OrchestratorProposal {
		const affectedPaths = detection.affectedPaths ?? [];
		const evidenceLinks: ProposalEvidenceLink[] = detection.evidence.map((ev) => ({
			sourceId: detection.id,
			sourceType: "detection",
			description: ev.description,
			filePath: ev.filePath,
			lineRange: ev.lineRange,
			snippet: ev.data,
		}));

		// Determine if this proposal involves self-modification
		const smCheck = this.firewall.checkFilePaths(affectedPaths);

		// Compute content hash for idempotency
		const contentHash = this.computeHash(detection.id, detection.description);

		const policyClassification = this.classifyDetectionPolicy(detection.category);

		// Determine suggested next action
		let suggestedNextAction: SuggestedNextAction;
		if (detection.isUnsafe) {
			suggestedNextAction = "flag_for_review";
		} else if (smCheck.hasSelfModification) {
			suggestedNextAction = "flag_for_review";
		} else if (detection.suggestedFix) {
			suggestedNextAction = "create_workspace";
		} else {
			suggestedNextAction = "generate_report";
		}

		return {
			id: `prop-${contentHash.slice(0, 12)}`,
			title: detection.title,
			description: detection.description,
			sourceType: "detection",
			evidenceLinks,
			confidence: detection.confidence,
			risk: detection.risk,
			policyClassification,
			suggestedNextAction,
			isSelfModification: smCheck.hasSelfModification,
			selfModificationReason: smCheck.hasSelfModification ? smCheck.summary : undefined,
			contentHash,
			generatedAt: new Date().toISOString(),
			affectedPaths,
			autoFixable: !!detection.suggestedFix && !detection.isUnsafe,
			effort: detection.estimatedEffort ? this.effortFromString(detection.estimatedEffort) : "medium",
		};
	}

	// -----------------------------------------------------------------------
	// Evidence link building
	// -----------------------------------------------------------------------

	/**
	 * Build evidence links from a health signal's evidence array.
	 */
	private buildEvidenceLinks(signal: HealthSignal): ProposalEvidenceLink[] {
		return signal.evidence.map((ev) => ({
			sourceId: signal.id,
			sourceType: "repo_health" as ProposalSourceType,
			description: ev.description,
			filePath: ev.filePath,
			lineRange: ev.lineStart != null ? { start: ev.lineStart, end: ev.lineEnd ?? ev.lineStart } : undefined,
			snippet: ev.snippet,
		}));
	}

	/**
	 * Collect file paths referenced in a health signal's evidence.
	 */
	private collectPathsFromSignal(signal: HealthSignal): string[] {
		const paths = new Set<string>();

		for (const ev of signal.evidence) {
			if (ev.filePath) {
				paths.add(ev.filePath);
			}
		}

		for (const proposal of signal.proposals) {
			for (const file of proposal.targetFiles) {
				paths.add(file);
			}
		}

		return Array.from(paths);
	}

	// -----------------------------------------------------------------------
	// Classification helpers
	// -----------------------------------------------------------------------

	/**
	 * Classify a health category into a policy classification.
	 */
	private classifyPolicy(category: string): PolicyClassification {
		switch (category) {
			case "typecheck":
			case "build":
			case "dead_code":
			case "imports":
			case "file_scope":
				return "code_quality";
			case "dependency_graph":
				return "dependency";
			case "safety":
				return "safety";
			case "test":
				return "test_coverage";
			case "schema":
			case "workspace_config":
			case "repo_metadata":
				return "configuration";
			case "git":
				return "suggestion";
			case "skills":
				return "configuration";
			default:
				return "suggestion";
		}
	}

	/**
	 * Classify a detection category into a policy classification.
	 */
	private classifyDetectionPolicy(category: string): PolicyClassification {
		switch (category) {
			case "bug_candidate":
			case "code_quality":
				return "code_quality";
			case "dependency_issue":
				return "dependency";
			case "security_concern":
				return "security";
			case "performance_issue":
				return "performance";
			case "test_coverage_gap":
				return "test_coverage";
			case "documentation_gap":
				return "documentation";
			case "conflict_hotspot":
			case "queue_inefficiency":
			case "validation_bottleneck":
			case "dashboard_ux_issue":
				return "suggestion";
			case "refactor_opportunity":
				return "code_quality";
			default:
				return "suggestion";
		}
	}

	// -----------------------------------------------------------------------
	// Mapping helpers
	// -----------------------------------------------------------------------

	/**
	 * Map signal severity to confidence level.
	 */
	private severityToConfidence(severity: string): "low" | "medium" | "high" {
		switch (severity) {
			case "error":
				return "high";
			case "warning":
				return "medium";
			case "info":
				return "low";
			default:
				return "medium";
		}
	}

	/**
	 * Map signal severity to risk level.
	 */
	private severityToRisk(severity: string): "low" | "medium" | "high" {
		switch (severity) {
			case "error":
				return "high";
			case "warning":
				return "medium";
			case "info":
				return "low";
			default:
				return "medium";
		}
	}

	/**
	 * Determine suggested next action based on proposal properties.
	 */
	private determineAction(autoFixable: boolean, isSelfModification: boolean, severity: string): SuggestedNextAction {
		if (isSelfModification) {
			return "flag_for_review";
		}
		if (autoFixable) {
			return "apply_auto_fix";
		}
		if (severity === "error") {
			return "create_workspace";
		}
		if (severity === "warning") {
			return "generate_report";
		}
		return "no_action_required";
	}

	/**
	 * Convert an effort string (e.g., "~30 min") to a standard effort level.
	 */
	private effortFromString(effort: string): "trivial" | "small" | "medium" | "large" {
		const lower = effort.toLowerCase();

		if (/trivial|min|\d+\s*m/.test(lower) && !/hour|day/.test(lower)) {
			return "small";
		}
		if (/hour|hr/.test(lower) && !/day/.test(lower)) {
			return "medium";
		}
		if (/day/.test(lower)) {
			return "large";
		}
		return "medium";
	}

	// -----------------------------------------------------------------------
	// Path normalization
	// -----------------------------------------------------------------------

	/**
	 * Normalize file paths (deduplicate, resolve relative paths).
	 */
	private normalizePaths(paths: string[]): string[] {
		const normalized = new Set<string>();

		for (const p of paths) {
			normalized.add(p.replace(/\\/g, "/"));
		}

		return Array.from(normalized);
	}

	// -----------------------------------------------------------------------
	// Idempotency (AC4)
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash from source identifiers and content.
	 *
	 * The hash is based on the source finding's ID and a content string
	 * (description), ensuring that the same finding always produces the
	 * same hash regardless of when it is processed.
	 */
	private computeHash(sourceId: string, content: string): string {
		const hash = createHash("sha256");
		hash.update(sourceId);
		hash.update(":");
		hash.update(content.trim().toLowerCase());
		return hash.digest("hex");
	}

	/**
	 * Check if a content hash has already been seen.
	 */
	private isDuplicate(contentHash: string): boolean {
		return this.knownHashes.has(contentHash);
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create an orchestrator proposal generator instance.
 *
 * @param config - Generator configuration
 * @returns A new OrchestratorProposalGenerator
 */
export function createOrchestratorProposalGenerator(
	config: OrchestratorProposalGeneratorConfig,
): OrchestratorProposalGenerator {
	return new OrchestratorProposalGenerator(config);
}
