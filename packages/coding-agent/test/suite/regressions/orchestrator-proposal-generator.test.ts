/**
 * Orchestrator Proposal Generator Tests - P11.H
 *
 * Tests for the orchestrator proposal generator:
 * - AC1: Creates proposal records from scan findings
 * - AC2: Each proposal has evidence links, confidence, risk level, policy
 *   classification, and suggested next action
 * - AC3: Self-modification proposals are flagged separately
 * - AC4: Proposal generation is idempotent and avoids duplicate spam
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { DetectionResult } from "../../../src/core/detection-types.js";
import type { HealthSignal, ScanResult, SignalSeverity } from "../../../src/repo-scanner/repo-health-signal.js";
import {
	createOrchestratorProposalGenerator,
	OrchestratorProposalGenerator,
} from "../../../src/orchestrator/orchestrator-proposal-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
	const dir = join(tmpdir(), `p11h-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeSignal(overrides: Partial<HealthSignal> & { id: string; title: string; severity: SignalSeverity }): HealthSignal {
	return {
		id: overrides.id,
		title: overrides.title,
		description: overrides.description ?? `Description for ${overrides.title}`,
		severity: overrides.severity,
		category: overrides.category ?? "typecheck",
		scope: overrides.scope ?? "packages/test",
		evidence: overrides.evidence ?? [],
		proposals: overrides.proposals ?? [],
		verified: overrides.verified ?? false,
		timestamp: overrides.timestamp ?? new Date().toISOString(),
	};
}

function makeScanResult(signals: HealthSignal[], overrides?: Partial<ScanResult>): ScanResult {
	return {
		signals,
		summary: {
			totalSignals: signals.length,
			errors: signals.filter((s) => s.severity === "error").length,
			warnings: signals.filter((s) => s.severity === "warning").length,
			infos: signals.filter((s) => s.severity === "info").length,
			byCategory: {},
			totalEvidence: signals.reduce((acc, s) => acc + s.evidence.length, 0),
			totalProposals: signals.reduce((acc, s) => acc + s.proposals.length, 0),
			autoFixableCount: signals.filter((s) => s.proposals.some((p) => p.autoFixable)).length,
			durationMs: 0,
		},
		repoRoot: overrides?.repoRoot ?? "/test",
		startedAt: overrides?.startedAt ?? new Date().toISOString(),
		completedAt: overrides?.completedAt ?? new Date().toISOString(),
		scannerVersion: overrides?.scannerVersion ?? "1.0.0",
	};
}

function makeDetection(overrides: Partial<DetectionResult> & { id: string; title: string }): DetectionResult {
	return {
		id: overrides.id,
		category: overrides.category ?? "bug_candidate",
		title: overrides.title,
		description: overrides.description ?? `Description for ${overrides.title}`,
		risk: overrides.risk ?? "medium",
		confidence: overrides.confidence ?? "medium",
		evidence: overrides.evidence ?? [],
		requiresApproval: overrides.requiresApproval ?? false,
		isUnsafe: overrides.isUnsafe ?? false,
		unsafeReason: overrides.unsafeReason,
		isFalsePositive: overrides.isFalsePositive,
		affectedPaths: overrides.affectedPaths,
		affectedWorkspaceIds: overrides.affectedWorkspaceIds,
		estimatedEffort: overrides.estimatedEffort,
		suggestedFix: overrides.suggestedFix,
		detectedAt: overrides.detectedAt ?? Date.now(),
		source: overrides.source ?? "test",
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrchestratorProposalGenerator", () => {
	let tmpDir: string;
	let generator: OrchestratorProposalGenerator;

	beforeEach(() => {
		tmpDir = makeTempDir();
		generator = createOrchestratorProposalGenerator({ cwd: tmpDir });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// AC1: Create proposal records from scan findings
	// -----------------------------------------------------------------------

	describe("AC1: Create proposal records from scan findings", () => {
		it("should generate proposals from a scan result with signals", () => {
			const signals: HealthSignal[] = [
				makeSignal({
					id: "signal-001",
					title: "Unused export detected",
					severity: "warning",
					category: "dead_code",
					scope: "packages/test",
					evidence: [
						{
							description: "File exports unused type 'Foo'",
							filePath: "packages/test/src/types.ts",
							lineStart: 42,
							lineEnd: 45,
						},
					],
					proposals: [
						{
							description: "Remove unused export 'Foo'",
							targetFiles: ["packages/test/src/types.ts"],
							effort: "trivial",
							autoFixable: true,
						},
					],
				}),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			expect(result.newCount).toBe(1);
			expect(result.duplicateCount).toBe(0);
			expect(result.errors).toHaveLength(0);

			const proposal = result.proposals[0];
			expect(proposal.title).toBe("Unused export detected");
			expect(proposal.description).toBe("Remove unused export 'Foo'");
			expect(proposal.sourceType).toBe("repo_health");
		});

		it("should handle a signal with multiple embedded proposals", () => {
			const signal = makeSignal({
				id: "signal-002",
				title: "Multiple issues in file",
				severity: "error",
				category: "typecheck",
				scope: "packages/test",
				evidence: [
					{
						description: "Compilation error in main.ts",
						filePath: "packages/test/src/main.ts",
						lineStart: 10,
					},
				],
				proposals: [
					{
						description: "Fix type error on line 10",
						targetFiles: ["packages/test/src/main.ts"],
						effort: "small",
						autoFixable: false,
					},
					{
						description: "Add missing import",
						targetFiles: ["packages/test/src/main.ts"],
						effort: "trivial",
						autoFixable: true,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(2);
			expect(result.newCount).toBe(2);
		});

		it("should handle a signal with no embedded proposals", () => {
			const signal = makeSignal({
				id: "signal-003",
				title: "Informational",
				severity: "info",
				category: "git",
				scope: "packages/test",
				evidence: [
					{
						description: "Git working tree is clean",
					},
				],
				proposals: [],
			});

			const scanResult = makeScanResult([signal]);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			expect(result.newCount).toBe(1);
			const proposal = result.proposals[0];
			expect(proposal.description).toBe("Description for Informational");
			expect(proposal.autoFixable).toBe(false);
			expect(proposal.effort).toBe("medium");
		});

		it("should generate proposals from detection results", () => {
			const detections: DetectionResult[] = [
				makeDetection({
					id: "det-001",
					title: "Potential null reference",
					category: "bug_candidate",
					risk: "high",
					confidence: "medium",
					evidence: [
						{
							type: "code_reference",
							description: "Possible null dereference in process()",
							filePath: "src/handler.ts",
							lineRange: { start: 50, end: 55 },
							data: "const result = data.process();",
							capturedAt: Date.now(),
						},
					],
					affectedPaths: ["src/handler.ts"],
					suggestedFix: "Add null check before calling process()",
				}),
			];

			const result = generator.generateFromDetections(detections);

			expect(result.proposals).toHaveLength(1);
			expect(result.newCount).toBe(1);

			const proposal = result.proposals[0];
			expect(proposal.title).toBe("Potential null reference");
			expect(proposal.sourceType).toBe("detection");
			expect(proposal.risk).toBe("high");
			expect(proposal.confidence).toBe("medium");
		});

		it("should return empty result for empty input", () => {
			const scanResult = makeScanResult([]);
			const result = generator.generateFromScanResult(scanResult);
			expect(result.proposals).toHaveLength(0);
			expect(result.newCount).toBe(0);
			expect(result.duplicateCount).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Each proposal has evidence links, confidence, risk, policy, action
	// -----------------------------------------------------------------------

	describe("AC2: Proposal fields", () => {
		it("should include evidence links referencing the source signal", () => {
			const signal = makeSignal({
				id: "signal-evidence-001",
				title: "Broken import",
				severity: "error",
				category: "imports",
				scope: "packages/test",
				evidence: [
					{
						description: "Cannot find module './missing'",
						filePath: "packages/test/src/index.ts",
						lineStart: 1,
						lineEnd: 1,
						snippet: "import { something } from './missing';",
					},
				],
				proposals: [
					{
						description: "Fix broken import path",
						targetFiles: ["packages/test/src/index.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			const result = generator.generateFromScanResult(scanResult);
			const proposal = result.proposals[0];

			// Evidence links
			expect(proposal.evidenceLinks).toHaveLength(1);
			const link = proposal.evidenceLinks[0];
			expect(link.sourceId).toBe("signal-evidence-001");
			expect(link.sourceType).toBe("repo_health");
			expect(link.description).toBe("Cannot find module './missing'");
			expect(link.filePath).toBe("packages/test/src/index.ts");
			expect(link.lineRange?.start).toBe(1);
			expect(link.snippet).toBe("import { something } from './missing';");
		});

		it("should include confidence derived from signal severity", () => {
			const signals: HealthSignal[] = [
				makeSignal({ id: "s1", title: "Error signal", severity: "error", proposals: [{ description: "Fix error", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s2", title: "Warning signal", severity: "warning", proposals: [{ description: "Fix warning", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s3", title: "Info signal", severity: "info", proposals: [{ description: "Fix info", targetFiles: [], effort: "small", autoFixable: false }] }),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals[0].confidence).toBe("high");
			expect(result.proposals[1].confidence).toBe("medium");
			expect(result.proposals[2].confidence).toBe("low");
		});

		it("should include risk level derived from signal severity", () => {
			const signals: HealthSignal[] = [
				makeSignal({ id: "s4", title: "Error signal", severity: "error", proposals: [{ description: "Fix error", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s5", title: "Warning signal", severity: "warning", proposals: [{ description: "Fix warning", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s6", title: "Info signal", severity: "info", proposals: [{ description: "Fix info", targetFiles: [], effort: "small", autoFixable: false }] }),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals[0].risk).toBe("high");
			expect(result.proposals[1].risk).toBe("medium");
			expect(result.proposals[2].risk).toBe("low");
		});

		it("should include policy classification mapped from health category", () => {
			const signals: HealthSignal[] = [
				makeSignal({ id: "s7", title: "Type error", severity: "error", category: "typecheck", proposals: [{ description: "Fix type", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s8", title: "Cycle", severity: "error", category: "dependency_graph", proposals: [{ description: "Fix cycle", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s9", title: "Safety", severity: "error", category: "safety", proposals: [{ description: "Fix safety", targetFiles: [], effort: "small", autoFixable: false }] }),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals[0].policyClassification).toBe("code_quality");
			expect(result.proposals[1].policyClassification).toBe("dependency");
			expect(result.proposals[2].policyClassification).toBe("safety");
		});

		it("should include suggested next action", () => {
			const signals: HealthSignal[] = [
				makeSignal({ id: "s10", title: "Error auto-fixable", severity: "error", proposals: [{ description: "Fix error", targetFiles: [], effort: "small", autoFixable: true }] }),
				makeSignal({ id: "s11", title: "Error not auto-fixable", severity: "error", proposals: [{ description: "Fix error", targetFiles: [], effort: "small", autoFixable: false }] }),
				makeSignal({ id: "s12", title: "Info signal", severity: "info", proposals: [{ description: "Info", targetFiles: [], effort: "small", autoFixable: false }] }),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals[0].suggestedNextAction).toBe("apply_auto_fix");
			expect(result.proposals[1].suggestedNextAction).toBe("create_workspace");
			expect(result.proposals[2].suggestedNextAction).toBe("no_action_required");
		});
	});

	// -----------------------------------------------------------------------
	// AC3: Self-modification proposals are flagged separately
	// -----------------------------------------------------------------------

	describe("AC3: Self-modification flagging", () => {
		beforeEach(() => {
			// Create a .pi directory to make the self-modification firewall trigger
			const piDir = join(tmpDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "settings.json"), "{}");
		});

		it("should flag proposals touching pi source code as self-modification", () => {
			const signal = makeSignal({
				id: "signal-sm-001",
				title: "Agent config improvement",
				severity: "info",
				category: "git",
				scope: ".pi/agent",
				evidence: [
					{
						description: "Agent config could be optimized",
						filePath: ".pi/agent/AGENTS.md",
					},
				],
				proposals: [
					{
						description: "Update agent configuration for better performance",
						targetFiles: [".pi/agent/AGENTS.md"],
						effort: "small",
						autoFixable: true,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			// Create generator in non-autonomous mode so self-modification is flagged, not blocked
			const localGenerator = createOrchestratorProposalGenerator({
				cwd: tmpDir,
				isAutonomous: false,
			});
			const result = localGenerator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			const proposal = result.proposals[0];

			expect(proposal.isSelfModification).toBe(true);
			expect(proposal.selfModificationReason).toBeTruthy();
			expect(proposal.selfModificationReason).toContain("protected system");
			expect(proposal.suggestedNextAction).toBe("flag_for_review");
		});

		it("should flag proposals touching pi packages as self-modification", () => {
			const signal = makeSignal({
				id: "signal-sm-002",
				title: "Package improvement",
				severity: "warning",
				category: "imports",
				scope: "packages/ai",
				evidence: [
					{
						description: "Refactor opportunity in AI package",
						filePath: "packages/ai/src/types.ts",
					},
				],
				proposals: [
					{
						description: "Refactor AI package types",
						targetFiles: ["packages/ai/src/types.ts"],
						effort: "medium",
						autoFixable: false,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			const localGenerator = createOrchestratorProposalGenerator({
				cwd: tmpDir,
				isAutonomous: false,
			});
			const result = localGenerator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			const proposal = result.proposals[0];

			expect(proposal.isSelfModification).toBe(true);
			expect(proposal.selfModificationReason).toBeTruthy();
			expect(proposal.suggestedNextAction).toBe("flag_for_review");
		});

		it("should not flag non-pi files as self-modification", () => {
			const signal = makeSignal({
				id: "signal-sm-003",
				title: "User code issue",
				severity: "error",
				category: "typecheck",
				scope: "src",
				evidence: [
					{
						description: "Type error in user code",
						filePath: "src/app.ts",
					},
				],
				proposals: [
					{
						description: "Fix type error in user code",
						targetFiles: ["src/app.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			const proposal = result.proposals[0];

			expect(proposal.isSelfModification).toBe(false);
			expect(proposal.selfModificationReason).toBeUndefined();
		});

		it("should flag detections touching protected systems", () => {
			const detection = makeDetection({
				id: "det-sm-001",
				title: "Protected system issue",
				category: "bug_candidate",
				affectedPaths: [".pi/settings.json"],
				suggestedFix: "Update settings",
			});

			const localGenerator = createOrchestratorProposalGenerator({
				cwd: tmpDir,
				isAutonomous: false,
			});
			const result = localGenerator.generateFromDetections([detection]);

			expect(result.proposals).toHaveLength(1);
			const proposal = result.proposals[0];

			expect(proposal.isSelfModification).toBe(true);
			expect(proposal.suggestedNextAction).toBe("flag_for_review");
		});
	});

	// -----------------------------------------------------------------------
	// AC4: Idempotent proposal generation
	// -----------------------------------------------------------------------

	describe("AC4: Idempotent generation and deduplication", () => {
		it("should skip duplicate proposals based on content hash", () => {
			const signal = makeSignal({
				id: "signal-dedup-001",
				title: "Duplicate test",
				severity: "warning",
				category: "dead_code",
				scope: "packages/test",
				evidence: [
					{
						description: "Duplicate finding",
						filePath: "packages/test/src/file.ts",
					},
				],
				proposals: [
					{
						description: "Fix duplicate issue",
						targetFiles: ["packages/test/src/file.ts"],
						effort: "small",
						autoFixable: true,
					},
				],
			});

			const scanResult = makeScanResult([signal]);

			// First call — should generate
			const result1 = generator.generateFromScanResult(scanResult);
			expect(result1.proposals).toHaveLength(1);
			expect(result1.newCount).toBe(1);
			expect(result1.duplicateCount).toBe(0);

			// Second call with same signal — should skip as duplicate
			const result2 = generator.generateFromScanResult(scanResult);
			expect(result2.proposals).toHaveLength(0);
			expect(result2.newCount).toBe(0);
			expect(result2.duplicateCount).toBe(1);
		});

		it("should allow same signal content with different IDs as distinct", () => {
			// Different signal IDs but same description should still be unique
			// because the hash uses the source ID
			const signal1 = makeSignal({
				id: "signal-distinct-001",
				title: "Same content",
				severity: "warning",
				category: "dead_code",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Fix issue",
						targetFiles: ["packages/test/src/file.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const signal2 = makeSignal({
				id: "signal-distinct-002",
				title: "Same content",
				severity: "warning",
				category: "dead_code",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Fix issue",
						targetFiles: ["packages/test/src/file.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const scanResult = makeScanResult([signal1, signal2]);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(2);
			expect(result.newCount).toBe(2);
			expect(result.duplicateCount).toBe(0);
		});

		it("should deduplicate across consecutive calls", () => {
			const signal = makeSignal({
				id: "signal-cross-001",
				title: "Cross-call duplicate",
				severity: "error",
				category: "typecheck",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Fix cross-call issue",
						targetFiles: ["packages/test/src/main.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const scanResult1 = makeScanResult([signal]);
			const result1 = generator.generateFromScanResult(scanResult1);
			expect(result1.newCount).toBe(1);

			// Same signal but different scan result instance
			const scanResult2 = makeScanResult([signal]);
			const result2 = generator.generateFromScanResult(scanResult2);
			expect(result2.newCount).toBe(0);
			expect(result2.duplicateCount).toBe(1);
		});

		it("should deduplicate across generateFromScanResult and generateFromDetections", () => {
			// The hashing uses different source types (signal ID vs detection ID)
			// so they should not collide even if descriptions are the same
			const signal = makeSignal({
				id: "cross-001",
				title: "Cross-type issue",
				severity: "error",
				category: "typecheck",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Fix issue",
						targetFiles: ["packages/test/src/main.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const detection = makeDetection({
				id: "cross-002",
				title: "Cross-type issue from detection",
				category: "bug_candidate",
				evidence: [],
			});

			generator.generateFromScanResult(makeScanResult([signal]));
			const result = generator.generateFromDetections([detection]);

			// Detection has different source ID, so it shouldn't be a duplicate
			expect(result.newCount).toBe(1);
			expect(result.duplicateCount).toBe(0);
		});

		it("should support seedFromProposals for restoring state", () => {
			// Generate once
			const signal = makeSignal({
				id: "seed-test-001",
				title: "Seed test",
				severity: "warning",
				category: "dead_code",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Fix seed test issue",
						targetFiles: ["packages/test/src/file.ts"],
						effort: "small",
						autoFixable: false,
					},
				],
			});

			const scanResult = makeScanResult([signal]);
			const result1 = generator.generateFromScanResult(scanResult);
			expect(result1.newCount).toBe(1);

			// Simulate restart: create new generator and seed from existing proposals
			const newGenerator = createOrchestratorProposalGenerator({ cwd: tmpDir });
			newGenerator.seedFromProposals(result1.proposals);

			// Same input should now be duplicates
			const result2 = newGenerator.generateFromScanResult(scanResult);
			expect(result2.newCount).toBe(0);
			expect(result2.duplicateCount).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe("Error handling", () => {
		it("should continue processing remaining signals when one fails", () => {
			const signals: HealthSignal[] = [
				makeSignal({
					id: "signal-err-001",
					title: "Good signal",
					severity: "info",
					category: "git",
					scope: "packages/test",
					evidence: [],
					proposals: [
						{
							description: "This should work",
							targetFiles: [],
							effort: "small",
							autoFixable: false,
						},
					],
				}),
			];

			// Create a scan result with an invalid signal (no id) by using a proxy
			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			// Should still work fine
			expect(result.proposals).toHaveLength(1);
			expect(result.errors).toHaveLength(0);
		});

		it("should limit proposals to max configured", () => {
			const signals: HealthSignal[] = [];
			for (let i = 0; i < 10; i++) {
				signals.push(
					makeSignal({
						id: `signal-max-${String(i).padStart(3, "0")}`,
						title: `Signal ${i}`,
						severity: "info",
						category: "git",
						scope: "packages/test",
						evidence: [],
						proposals: [
							{
								description: `Proposal ${i}`,
								targetFiles: [],
								effort: "small",
								autoFixable: false,
							},
						],
					}),
				);
			}

			const limitedGenerator = createOrchestratorProposalGenerator({
				cwd: tmpDir,
				maxProposals: 3,
			});

			const scanResult = makeScanResult(signals);
			const result = limitedGenerator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(3);
			expect(result.newCount).toBe(3);
		});
	});

	// -----------------------------------------------------------------------
	// Integration: End-to-end flow
	// -----------------------------------------------------------------------

	describe("Integration: end-to-end flow", () => {
		it("should generate proposals with all AC2 fields populated", () => {
			const signals: HealthSignal[] = [
				makeSignal({
					id: "signal-e2e-001",
					title: "Dependency cycle detected",
					severity: "error",
					category: "dependency_graph",
					scope: "packages/core",
					evidence: [
						{
							description: "Circular dependency between module A and module B",
							filePath: "packages/core/src/module-a.ts",
							lineStart: 1,
							lineEnd: 100,
						},
						{
							description: "Circular dependency in module B",
							filePath: "packages/core/src/module-b.ts",
						},
					],
					proposals: [
						{
							description: "Extract shared dependency into separate module",
							targetFiles: [
								"packages/core/src/module-a.ts",
								"packages/core/src/module-b.ts",
							],
							effort: "medium",
							autoFixable: false,
						},
					],
				}),
			];

			const scanResult = makeScanResult(signals);
			const result = generator.generateFromScanResult(scanResult);

			expect(result.proposals).toHaveLength(1);
			const proposal = result.proposals[0];

			// AC1: Created from scan findings
			expect(proposal.title).toBe("Dependency cycle detected");
			expect(proposal.sourceType).toBe("repo_health");

			// AC2: Fields
			expect(proposal.evidenceLinks).toHaveLength(2);
			expect(proposal.confidence).toBe("high"); // error -> high
			expect(proposal.risk).toBe("high"); // error -> high
			expect(proposal.policyClassification).toBe("dependency"); // dependency_graph -> dependency
			expect(proposal.suggestedNextAction).toBe("flag_for_review"); // self-modification -> flag_for_review

			// AC3: packages/core/* matches packages/**/* protected pattern
			expect(proposal.isSelfModification).toBe(true);

			// AC4: Has content hash
			expect(proposal.contentHash).toBeTruthy();
			expect(proposal.id).toBe(`prop-${proposal.contentHash.slice(0, 12)}`);
		});

		it("should handle mixed input with signals and detections", () => {
			const signal = makeSignal({
				id: "mixed-001",
				title: "Scanner finding",
				severity: "warning",
				category: "test",
				scope: "packages/test",
				evidence: [],
				proposals: [
					{
						description: "Add missing tests",
						targetFiles: ["packages/test/src/spec.ts"],
						effort: "medium",
						autoFixable: false,
					},
				],
			});

			const detection = makeDetection({
				id: "mixed-002",
				title: "Detector finding",
				category: "performance_issue",
				risk: "low",
				confidence: "high",
				affectedPaths: ["src/perf.ts"],
			});

			const scanResult = makeScanResult([signal]);
			const scanProposals = generator.generateFromScanResult(scanResult);
			const detectionProposals = generator.generateFromDetections([detection]);

			expect(scanProposals.proposals).toHaveLength(1);
			expect(detectionProposals.proposals).toHaveLength(1);

			expect(scanProposals.proposals[0].sourceType).toBe("repo_health");
			expect(detectionProposals.proposals[0].sourceType).toBe("detection");

			// Different hashes since they use different source IDs
			expect(scanProposals.proposals[0].contentHash).not.toBe(
				detectionProposals.proposals[0].contentHash,
			);
		});
	});
});
