/**
 * Evidence Pack — V5.04 Context Builder & Memory Injection
 *
 * Defines the evidence pack summary structure that is included in
 * memory injection reports, context packs, and plan drafts.
 *
 * An evidence pack is a curated collection of evidence references
 * with an overall assessment, designed to be renderable in dashboard
 * Draft Studio and Memory UI.
 *
 * Following V4 ExecutionKernel doctrine: these types describe outputs
 * that are emitted as events; they never mutate execution state directly.
 *
 * @packageDocumentation
 */

import type { EvidenceAssessment, EvidenceConfidenceLevel, EvidenceRef, EvidenceResolution } from "./types.js";
import { assessEvidenceConfidence } from "./types.js";

// =========================================================================
// Evidence Pack Types
// =========================================================================

/**
 * A categorized group of evidence references within a pack.
 *
 * Groups help organize evidence by source type for UI rendering.
 */
export interface EvidencePackGroup {
	/** Human-readable group label (e.g., "Memory Records", "Validation Results"). */
	label: string;
	/** The evidence ref type these references belong to. */
	type: string;
	/** Evidence references in this group. */
	refs: EvidenceRef[];
	/** Number of references in this group. */
	count: number;
	/** Number of resolved references in this group. */
	resolvedCount: number;
	/** Average confidence for this group. */
	averageConfidence: number;
}

/**
 * A summary of an evidence pack — the compact form included in
 * memory injection reports and plan drafts.
 *
 * This structure is designed to be:
 * - Renderable in dashboard Draft Studio and Memory UI
 * - Machine-readable for automated confidence assessment
 * - Human-readable for user review
 */
export interface EvidencePackSummary {
	/** Unique pack identifier (UUID). */
	id: string;
	/** Short human-readable title for this pack. */
	title: string;
	/** Overall confidence level derived from all evidence. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** Total number of evidence references in the pack. */
	totalRefs: number;
	/** Number of resolved references. */
	resolvedRefs: number;
	/** Number of missing/unresolved references. */
	missingRefs: number;
	/** Evidence references grouped by type. */
	groups: EvidencePackGroup[];
	/** Complete list of evidence references (for detailed rendering). */
	refs: EvidenceRef[];
	/** Human-readable summary of what this pack covers. */
	summary: string;
	/** ISO 8601 timestamp of when this pack was generated. */
	generatedAt: string;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

/**
 * A full evidence pack with resolutions and detailed assessment.
 *
 * This is the complete form used internally by the context builder
 * and memory injection engines before serialization to the summary form.
 */
export interface EvidencePack {
	/** Unique pack identifier (UUID). */
	id: string;
	/** Short human-readable title. */
	title: string;
	/** The scope or context this pack was built for (e.g., workspace ID). */
	scope: string;
	/** Evidence references in the pack. */
	refs: EvidenceRef[];
	/** Resolutions for each reference. */
	resolutions: EvidenceResolution[];
	/** Full confidence assessment. */
	assessment: EvidenceAssessment;
	/** Evidence grouped by type. */
	groups: EvidencePackGroup[];
	/** Human-readable description of what this pack covers. */
	summary: string;
	/** ISO 8601 timestamp of when this pack was generated. */
	generatedAt: string;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Builder Functions
// =========================================================================

/**
 * Options for building an evidence pack.
 */
export interface EvidencePackOptions {
	/** Human-readable title for the pack. */
	title?: string;
	/** Metadata to attach to the pack. */
	metadata?: Record<string, unknown>;
}

/**
 * Build an evidence pack from a set of evidence references.
 *
 * Resolves each reference, assesses confidence, and groups by type.
 *
 * @param scope - The scope or context (e.g., workspace ID, plan exec ID)
 * @param refs - The evidence references to include
 * @param resolveFn - Function to resolve evidence refs to their content
 * @param options - Optional configuration
 * @returns A fully populated EvidencePack
 */
export async function buildEvidencePack(
	scope: string,
	refs: EvidenceRef[],
	resolveFn: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>,
	options?: EvidencePackOptions,
): Promise<EvidencePack> {
	const generatedAt = new Date().toISOString();

	// Resolve all references
	const resolutions = await resolveFn(refs);

	// Assess confidence
	const assessment = assessEvidenceConfidence(resolutions);

	// Group by type
	const groups = buildEvidencePackGroups(resolutions);

	const title = options?.title ?? `Evidence Pack for ${scope}`;

	return {
		id: crypto.randomUUID(),
		title,
		scope,
		refs,
		resolutions,
		assessment,
		groups,
		summary: buildEvidencePackSummaryText(assessment, groups, refs.length),
		generatedAt,
		metadata: options?.metadata,
	};
}

/**
 * Build a compact EvidencePackSummary from a full EvidencePack.
 *
 * The summary is the serializable form included in injection reports
 * and plan drafts for dashboard UI rendering.
 *
 * @param pack - The full evidence pack
 * @returns A compact summary
 */
export function buildEvidencePackSummary(pack: EvidencePack): EvidencePackSummary {
	const resolvedRefs = pack.resolutions.filter((r) => r.resolved).length;
	const missingRefs = pack.resolutions.filter((r) => !r.resolved).length;

	return {
		id: pack.id,
		title: pack.title,
		confidenceLevel: pack.assessment.level,
		confidence: pack.assessment.confidence,
		totalRefs: pack.refs.length,
		resolvedRefs,
		missingRefs,
		groups: pack.groups,
		refs: pack.refs,
		summary: pack.summary,
		generatedAt: pack.generatedAt,
		metadata: pack.metadata,
	};
}

// =========================================================================
// Internal Helpers
// =========================================================================

/**
 * Group evidence resolutions by type and compute group stats.
 */
function buildEvidencePackGroups(resolutions: EvidenceResolution[]): EvidencePackGroup[] {
	const byType = new Map<string, EvidenceResolution[]>();

	for (const resolution of resolutions) {
		const type = resolution.ref.type;
		if (!byType.has(type)) {
			byType.set(type, []);
		}
		byType.get(type)!.push(resolution);
	}

	const groups: EvidencePackGroup[] = [];

	for (const [type, typeResolutions] of byType.entries()) {
		const resolved = typeResolutions.filter((r) => r.resolved);
		const avgConfidence =
			resolved.length > 0 ? resolved.reduce((sum, r) => sum + r.ref.confidence, 0) / resolved.length : 0;

		groups.push({
			label: getGroupLabel(type),
			type,
			refs: typeResolutions.map((r) => r.ref),
			count: typeResolutions.length,
			resolvedCount: resolved.length,
			averageConfidence: avgConfidence,
		});
	}

	// Sort groups by resolved count descending (most evidence first)
	groups.sort((a, b) => b.resolvedCount - a.resolvedCount);

	return groups;
}

/**
 * Get a human-readable label for an evidence ref type.
 */
function getGroupLabel(type: string): string {
	const labels: Record<string, string> = {
		git_file: "Git Files",
		validation: "Validation Results",
		execution_journal: "Execution Journal",
		memory: "Memory Records",
		proposal: "Proposals",
		reflection: "Reflections",
		approval: "Approvals",
		observation: "Brain Observations",
		signal: "Brain Signals",
		temporal_event: "Temporal Events",
	};
	return labels[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a human-readable summary string for the evidence pack.
 */
function buildEvidencePackSummaryText(
	assessment: EvidenceAssessment,
	groups: EvidencePackGroup[],
	totalRefs: number,
): string {
	const parts: string[] = [];

	const totalResolved = groups.reduce((sum, g) => sum + g.resolvedCount, 0);
	const totalMissing = totalRefs - totalResolved;

	parts.push(`Evidence pack with ${totalRefs} reference(s)`);

	if (totalResolved > 0) {
		parts.push(`${totalResolved} resolved`);
	}
	if (totalMissing > 0) {
		parts.push(`${totalMissing} unresolved`);
	}

	parts.push(`confidence level: ${assessment.level} (${(assessment.confidence * 100).toFixed(0)}%)`);

	if (groups.length > 0) {
		const groupDescriptions = groups.map((g) => `${g.label}: ${g.resolvedCount}/${g.count}`);
		parts.push(`Groups: ${groupDescriptions.join(", ")}`);
	}

	return parts.join(" — ");
}

// =========================================================================
// Factory
// =========================================================================

// =========================================================================
// Evidence Refs Validation
// =========================================================================

/**
 * Validate that content claiming memory support includes evidence refs.
 *
 * This enforces AC4: No generated content can claim memory support without
 * included evidence refs. Any content that references memory records or makes
 * memory-backed claims MUST include at least one evidence reference.
 *
 * @param content - The generated content to validate (e.g., answer text, draft body)
 * @param evidenceRefs - The evidence refs included with the content
 * @param options - Optional validation parameters
 * @returns True if the content passes validation
 */
export function validateContentHasEvidenceRefs(
	content: string,
	evidenceRefs: EvidenceRef[],
	options?: {
		/** Require at least this many evidence refs (default: 1). */
		minRefs?: number;
		/** Check for memory-related keywords in content (default: true). */
		checkMemoryKeywords?: boolean;
		/** Labels to check when content references memory (e.g., ["memory", "failure", "recall"]). */
		memoryKeywords?: string[];
	},
): boolean {
	const minRefs = options?.minRefs ?? 1;
	const checkMemoryKeywords = options?.checkMemoryKeywords ?? true;
	const memoryKeywords = options?.memoryKeywords ?? ["memory", "recall", "remember", "past failure", "previous error"];

	// If no evidence refs provided, validation fails
	if (evidenceRefs.length < minRefs) {
		return false;
	}

	// If content mentions memory keywords but has no memory-type evidence refs, validation fails
	if (checkMemoryKeywords && content) {
		const contentLower = content.toLowerCase();
		const mentionsMemory = memoryKeywords.some((kw) => contentLower.includes(kw.toLowerCase()));

		if (mentionsMemory) {
			// Check that at least one evidence ref is a memory type
			const hasMemoryRef = evidenceRefs.some((ref) => ref.type === "memory");
			if (!hasMemoryRef) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Create an empty evidence pack for a given scope.
 *
 * @param scope - The scope or context
 * @param title - Optional title
 * @returns An empty EvidencePack
 */
export function createEmptyEvidencePack(scope: string, title?: string): EvidencePack {
	const generatedAt = new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		title: title ?? `Empty Evidence Pack for ${scope}`,
		scope,
		refs: [],
		resolutions: [],
		assessment: {
			level: "LOW",
			confidence: 0,
			resolvedCount: 0,
			missingCount: 0,
			lowConfidenceCount: 0,
			resolutions: [],
			summary: "No evidence references in this pack.",
			recommendations: ["Add evidence references before making confident claims."],
		},
		groups: [],
		summary: "Empty evidence pack — no references registered.",
		generatedAt,
	};
}
