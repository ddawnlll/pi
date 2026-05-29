/**
 * V5 Output Types — V5.02 Evidence Index Integration Test
 *
 * Tests that V5 outputs (answers, memory injection reports, drafts)
 * can reference evidenceRefs and use evidence assessment.
 *
 * Acceptance Criteria (V5.02):
 * AC1: Every V5 answer, proposal, memory injection report, and draft
 *      can reference evidenceRefs.
 * AC3: Missing evidence downgrades confidence or blocks confident claims.
 */

import { describe, expect, it } from "vitest";
import { createEvidenceApi } from "../../src/brain/evidence/api.js";
import { createEvidenceIndex } from "../../src/brain/evidence/index.js";
import type { EvidenceAssessment, EvidenceRef } from "../../src/brain/evidence/types.js";
import {
	buildConfidenceExplanation,
	buildV5Answer,
	buildV5Draft,
	buildV5MemoryInjectionReport,
	evidenceMeetsThreshold,
	type V5MemoryInjection,
} from "../../src/brain/evidence/v5-outputs.js";

// =========================================================================
// Helpers
// =========================================================================

/** Create a HIGH-confidence assessment for testing. */
function highAssessment(): EvidenceAssessment {
	return {
		level: "HIGH",
		confidence: 0.9,
		resolvedCount: 2,
		missingCount: 0,
		lowConfidenceCount: 0,
		resolutions: [],
		summary: "All evidence resolved with high confidence.",
		recommendations: [],
	};
}

/** Create a BLOCKED assessment for testing. */
function blockedAssessment(): EvidenceAssessment {
	return {
		level: "BLOCKED",
		confidence: 0,
		resolvedCount: 0,
		missingCount: 2,
		lowConfidenceCount: 0,
		resolutions: [],
		summary: "Critical evidence is missing.",
		recommendations: ["Resolve missing critical evidence."],
	};
}

/** Create a LOW assessment for testing. */
function lowAssessment(): EvidenceAssessment {
	return {
		level: "LOW",
		confidence: 0.2,
		resolvedCount: 1,
		missingCount: 2,
		lowConfidenceCount: 1,
		resolutions: [],
		summary: "Low confidence - most evidence missing.",
		recommendations: ["Gather more evidence."],
	};
}

/** Create a MEDIUM assessment for testing. */
function mediumAssessment(): EvidenceAssessment {
	return {
		level: "MEDIUM",
		confidence: 0.55,
		resolvedCount: 2,
		missingCount: 1,
		lowConfidenceCount: 0,
		resolutions: [],
		summary: "Medium confidence - some evidence resolved.",
		recommendations: ["Consider gathering additional evidence."],
	};
}

// =========================================================================
// AC #1: Every V5 output can reference evidenceRefs
// =========================================================================

describe("V5 Output Types — AC #1 (EvidenceRef Support)", () => {
	it("should build a V5Answer with evidence refs", () => {
		const evidenceRefs: EvidenceRef[] = [
			{ type: "memory", id: "mem-1", label: "Memory", description: "Context", timestamp: "", confidence: 0.9 },
			{
				type: "validation",
				id: "val-1",
				label: "Validation",
				description: "Passed",
				timestamp: "",
				confidence: 0.8,
			},
		];

		const answer = buildV5Answer(
			{
				id: "answer-1",
				content: "The retry logic uses exponential backoff.",
				summary: "Explained retry strategy",
				evidenceRefs,
				sourceType: "user_question",
			},
			highAssessment(),
		);

		expect(answer).not.toBeNull();
		expect(answer!.id).toBe("answer-1");
		expect(answer!.evidenceRefs).toHaveLength(2);
		expect(answer!.confidenceLevel).toBe("HIGH");
		expect(answer!.confidence).toBe(0.9);
		expect(answer!.confidenceExplanation).toContain("High confidence");
		expect(answer!.sourceType).toBe("user_question");
	});

	it("should build a V5Answer with blocked evidence", () => {
		const evidenceRefs: EvidenceRef[] = [
			{
				type: "validation",
				id: "val-missing",
				label: "Missing validation",
				description: "Not run",
				timestamp: "",
				confidence: 0,
			},
		];

		// Without blocking option, the answer is still created but with BLOCKED level
		const answer = buildV5Answer(
			{
				id: "answer-blocked",
				content: "Cannot answer confidently.",
				summary: "Blocked answer",
				evidenceRefs,
				sourceType: "system_query",
			},
			blockedAssessment(),
		);

		expect(answer).not.toBeNull();
		expect(answer!.confidenceLevel).toBe("BLOCKED");
		expect(answer!.confidence).toBe(0);
		expect(answer!.confidenceExplanation).toContain("Blocked");

		// With blocking option, null is returned
		const nullAnswer = buildV5Answer(
			{
				id: "answer-null",
				content: "Should be null.",
				summary: "Null due to blocking",
				evidenceRefs,
				sourceType: "system_query",
			},
			blockedAssessment(),
			{ blockOnMissingCriticalEvidence: true },
		);

		expect(nullAnswer).toBeNull();
	});

	it("should build a V5MemoryInjectionReport with evidence refs", () => {
		const evidenceRefs: EvidenceRef[] = [
			{
				type: "memory",
				id: "mem-1",
				label: "Source memory",
				description: "Source context",
				timestamp: "",
				confidence: 0.8,
			},
		];

		const injections: V5MemoryInjection[] = [
			{
				id: "inj-1",
				memoryType: "architecture",
				title: "Retry pattern",
				content: "Use exponential backoff",
				evidenceRefs: [
					{ type: "validation", id: "val-1", label: "V", description: "D", timestamp: "", confidence: 0.9 },
				],
				confidenceLevel: "HIGH",
				confidence: 0.9,
				successful: true,
			},
			{
				id: "inj-2",
				memoryType: "architecture",
				title: "Circuit breaker",
				content: "Add circuit breaker",
				evidenceRefs: [],
				confidenceLevel: "BLOCKED",
				confidence: 0,
				successful: false,
				error: "Insufficient evidence",
			},
		];

		const report = buildV5MemoryInjectionReport(
			{
				id: "report-1",
				scope: "workspace-42",
				summary: "Injected retry pattern",
				evidenceRefs,
			},
			injections,
			mediumAssessment(),
		);

		expect(report.id).toBe("report-1");
		expect(report.scope).toBe("workspace-42");
		expect(report.injections).toHaveLength(2);
		expect(report.evidenceRefs).toHaveLength(1);
		expect(report.successfulInjections).toBe(1);
		expect(report.blockedInjections).toBe(1);
		expect(report.overallConfidence).toBe("MEDIUM");
	});

	it("should build a V5Draft with evidence refs", () => {
		const evidenceRefs: EvidenceRef[] = [
			{
				type: "proposal",
				id: "p-1",
				label: "Proposal",
				description: "Refactor plan",
				timestamp: "",
				confidence: 0.85,
			},
		];

		const draft = buildV5Draft(
			{
				id: "draft-1",
				title: "Refactor worker pool",
				content: "Change the worker pool to use a priority queue.",
				draftType: "code_change",
				evidenceRefs,
			},
			highAssessment(),
		);

		expect(draft).not.toBeNull();
		expect(draft!.id).toBe("draft-1");
		expect(draft!.title).toBe("Refactor worker pool");
		expect(draft!.draftType).toBe("code_change");
		expect(draft!.evidenceRefs).toHaveLength(1);
		expect(draft!.confidenceLevel).toBe("HIGH");
		expect(draft!.evidenceSufficient).toBe(true);
	});

	it("should return null for a blocked draft with block option", () => {
		const evidenceRefs: EvidenceRef[] = [];

		const draft = buildV5Draft(
			{
				id: "draft-blocked",
				title: "Blocked draft",
				content: "Should not proceed.",
				draftType: "code_change",
				evidenceRefs,
			},
			blockedAssessment(),
			{ blockOnMissingCriticalEvidence: true },
		);

		expect(draft).toBeNull();
	});

	it("should still create draft without block option even when evidence is blocked", () => {
		const draft = buildV5Draft(
			{
				id: "draft-weak",
				title: "Weak draft",
				content: "Proceeding with caution.",
				draftType: "plan_adjustment",
				evidenceRefs: [],
			},
			blockedAssessment(),
		);

		expect(draft).not.toBeNull();
		expect(draft!.confidenceLevel).toBe("BLOCKED");
		expect(draft!.evidenceSufficient).toBe(false);
		expect(draft!.recommendations.length).toBeGreaterThan(0);
	});
});

// =========================================================================
// AC #3: Missing evidence downgrades confidence or blocks claims
// =========================================================================

describe("V5 Output Types — AC #3 (Confidence Assessment)", () => {
	it("should build confidence explanation for each level", () => {
		const high = highAssessment();
		const blocked = blockedAssessment();
		const low = lowAssessment();
		const medium = mediumAssessment();

		expect(buildConfidenceExplanation(high)).toContain("High confidence");
		expect(buildConfidenceExplanation(medium)).toContain("Medium confidence");
		expect(buildConfidenceExplanation(low)).toContain("Low confidence");
		expect(buildConfidenceExplanation(blocked)).toContain("Blocked");
	});

	it("should check evidence meets threshold", () => {
		// HIGH meets HIGH threshold
		expect(evidenceMeetsThreshold(highAssessment(), "HIGH")).toBe(true);

		// HIGH meets MEDIUM threshold
		expect(evidenceMeetsThreshold(highAssessment(), "MEDIUM")).toBe(true);

		// HIGH meets LOW threshold
		expect(evidenceMeetsThreshold(highAssessment(), "LOW")).toBe(true);

		// MEDIUM does NOT meet HIGH threshold
		expect(evidenceMeetsThreshold(mediumAssessment(), "HIGH")).toBe(false);

		// MEDIUM meets MEDIUM threshold
		expect(evidenceMeetsThreshold(mediumAssessment(), "MEDIUM")).toBe(true);

		// BLOCKED does not meet HIGH threshold
		expect(evidenceMeetsThreshold(blockedAssessment(), "HIGH")).toBe(false);

		// BLOCKED does not meet LOW threshold
		expect(evidenceMeetsThreshold(blockedAssessment(), "LOW")).toBe(false);
	});

	it("should integrate with EvidenceApi for real assessment in outputs", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Register evidence
		await api.registerEvidence("memory", "mem-real", "Real memory", "Exists in index", 0.85);

		// Build refs for assessment
		const refs: EvidenceRef[] = [
			{
				type: "memory",
				id: "mem-real",
				label: "Real memory",
				description: "Exists",
				timestamp: "",
				confidence: 0.85,
			},
			{
				type: "validation",
				id: "val-real",
				label: "Real validation",
				description: "Also exists",
				timestamp: "",
				confidence: 0.75,
			},
		];

		// Register all refs so assessment is HIGH
		await api.registerEvidence("validation", "val-real", "Real validation", "Also exists", 0.75);

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("HIGH");

		const answer = buildV5Answer(
			{
				id: "integrated-answer",
				content: "This answer is backed by evidence.",
				summary: "Integrated answer",
				evidenceRefs: refs,
				sourceType: "user_question",
			},
			assessment,
		);

		expect(answer).not.toBeNull();
		expect(answer!.confidenceLevel).toBe("HIGH");
	});

	it("should block output when critical evidence is missing", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Register only non-critical evidence
		await api.registerEvidence("memory", "mem-only", "Only memory", "No validation", 0.9);

		const refs: EvidenceRef[] = [
			{ type: "memory", id: "mem-only", label: "Memory", description: "Exists", timestamp: "", confidence: 0.9 },
			{
				type: "validation",
				id: "val-missing",
				label: "Missing validation",
				description: "Not in index",
				timestamp: "",
				confidence: 0,
			},
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("BLOCKED");

		// Draft with block option should be null
		const draft = buildV5Draft(
			{
				id: "blocked-draft",
				title: "Blocked",
				content: "Cannot proceed.",
				draftType: "code_change",
				evidenceRefs: refs,
			},
			assessment,
			{ blockOnMissingCriticalEvidence: true },
		);

		expect(draft).toBeNull();
	});
});

// =========================================================================
// Proposal Integration (Proposal type carries evidenceRefs)
// =========================================================================

describe("V5 Output Types — Proposal evidenceRefs Integration", () => {
	it("should create a proposal with evidenceRefs", async () => {
		const { createProposal, createProposalCreateInput } = await import("../../src/brain/proposals/types.js");

		const evidenceRefs: EvidenceRef[] = [
			{ type: "memory", id: "mem-1", label: "Memory", description: "Context", timestamp: "", confidence: 0.9 },
			{
				type: "validation",
				id: "val-1",
				label: "Validation",
				description: "Passed",
				timestamp: "",
				confidence: 0.8,
			},
		];

		const input = createProposalCreateInput({
			type: "reflection_proposal",
			title: "Test proposal",
			description: "A proposal with evidence refs",
			whyNow: "Because we need evidence",
			expectedImpact: "Better traceability",
			evidence: {
				memoryIds: ["mem-1"],
				observationIds: [],
				sourceRefs: [],
				confidence: 0.85,
				evidenceSummary: "Test evidence",
			},
			risk: {
				level: "low",
				factors: ["Test"],
				mitigation: ["Review"],
				affectedSystems: ["Test system"],
				impactDescription: "Minimal impact",
			},
			evidenceRefs,
		});

		const proposal = createProposal(input);

		expect(proposal.evidenceRefs).toBeDefined();
		expect(proposal.evidenceRefs).toHaveLength(2);
		expect(proposal.evidenceRefs![0].type).toBe("memory");
		expect(proposal.evidenceRefs![1].type).toBe("validation");
	});
});
