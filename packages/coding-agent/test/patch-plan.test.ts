/**
 * Tests for Patch Plan - Targeted patch planner and edit fallback
 *
 * P4.5 Workstream 4.5.D Acceptance Criteria:
 * 1. blocked rewrite returns patch-mode instruction packet
 * 2. PatchPlan format implemented
 * 3. patch plan archived in workspace artifacts
 * 4. large file patch fallback avoids full-file regeneration
 * 5. patch fixture passes tests
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createEditStrategyPolicy } from "../src/core/edit-strategy-policy.js";
import {
	blockedRewriteToPatchPacket,
	computeChangePatches,
	createPatchInstructionPacket,
	createPatchOperation,
	createPatchPlan,
	createPatchPlanArchiver,
	type PatchPlanArchiver,
	type PatchPlanStatus,
	patchFallbackForLargeFile,
} from "../src/core/patch-plan.js";

// ---------------------------------------------------------------------------
// AC1: Blocked rewrite returns patch-mode instruction packet
// ---------------------------------------------------------------------------

describe("AC1: Blocked rewrite returns patch-mode instruction packet", () => {
	it("should create a PatchInstructionPacket when a full rewrite is blocked", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("large.ts", false, 500, 20000);

		// The policy blocks full rewrite for this file
		expect(result.writeAllowed).toBe(false);

		const packet = blockedRewriteToPatchPacket(
			"plan1",
			"ws1",
			"large.ts",
			result,
			500,
			20000,
			"original content snapshot",
		);

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.filePath).toBe("large.ts");
		expect(packet.reason).toBeTruthy();
		expect(packet.reasonCode).toBe(result.reasonCode);
		expect(packet.guidance).toContain("patch");
		expect(packet.patchPlan).toBeDefined();
	});

	it("should include snapshot-aware guidance when snapshot is provided", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("file.tsx", false, 400, 15000);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "file.tsx", result, 400, 15000, "snapshot content");

		expect(packet.guidance).toContain("pre-edit snapshot");
	});

	it("should not include snapshot guidance when snapshot is absent", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("file.ts", false, 500, 20000);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "file.ts", result, 500, 20000, undefined);

		expect(packet.guidance).not.toContain("pre-edit snapshot");
	});

	it("should return correct instruction type for TSX component blocks", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("component.tsx", false, 400, 15000);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "component.tsx", result, 400, 15000, undefined);

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.reasonCode).toBe("tsx_component_patch_required");
		expect(packet.guidance).toContain("TSX");
	});

	it("should return correct instruction for byte-size blocks", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("wide.ts", false, 100, 9000);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "wide.ts", result, 100, 9000, undefined);

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.reasonCode).toBe("existing_file_blocked_bytes");
	});
});

// ---------------------------------------------------------------------------
// AC2: PatchPlan format implemented
// ---------------------------------------------------------------------------

describe("AC2: PatchPlan format implemented", () => {
	it("should create a PatchPlan with all required fields", () => {
		const plan = createPatchPlan({
			planExecId: "plan1",
			workspaceId: "ws1",
			filePath: "large.ts",
			triggerReasonCode: "existing_file_blocked_size",
			triggerReason: "File exceeds line limit",
			existingLineCount: 500,
			existingByteSize: 20000,
			patches: [],
		});

		expect(plan.id).toBeTruthy();
		expect(plan.planExecId).toBe("plan1");
		expect(plan.workspaceId).toBe("ws1");
		expect(plan.filePath).toBe("large.ts");
		expect(plan.triggerReasonCode).toBe("existing_file_blocked_size");
		expect(plan.triggerReason).toBe("File exceeds line limit");
		expect(plan.existingLineCount).toBe(500);
		expect(plan.existingByteSize).toBe(20000);
		expect(plan.patches).toEqual([]);
		expect(plan.createdAt).toBeGreaterThan(0);
		expect(plan.status).toBe("pending");
	});

	it("should support all PatchPlanStatus values", () => {
		const statuses: PatchPlanStatus[] = ["pending", "applied", "failed", "archived"];

		for (const status of statuses) {
			const plan = createPatchPlan({
				planExecId: "plan1",
				workspaceId: "ws1",
				filePath: "file.ts",
				triggerReasonCode: "existing_file_blocked_size",
				triggerReason: "blocked",
				existingLineCount: 500,
				existingByteSize: 20000,
				patches: [],
				status,
			});

			expect(plan.status).toBe(status);
		}
	});

	it("should create PatchOperation with required fields", () => {
		const op = createPatchOperation("old text", "new text", "description");

		expect(op.id).toBeTruthy();
		expect(op.oldText).toBe("old text");
		expect(op.newText).toBe("new text");
		expect(op.description).toBe("description");
	});

	it("should create PatchOperation without description", () => {
		const op = createPatchOperation("old", "new");

		expect(op.id).toBeTruthy();
		expect(op.oldText).toBe("old");
		expect(op.newText).toBe("new");
		expect(op.description).toBe("");
	});

	it("should create PatchInstructionPacket from policy result", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const policyResult = policy.checkPolicy("large.ts", false, 500, 20000);

		const packet = createPatchInstructionPacket("plan1", "ws1", "large.ts", policyResult, 500, 20000);

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.filePath).toBe("large.ts");
		expect(packet.reason).toBeTruthy();
		expect(packet.reasonCode).toBe(policyResult.reasonCode);
		expect(packet.patchPlan).toBeDefined();
		expect(packet.patchPlan.filePath).toBe("large.ts");
		expect(packet.guidance).toBeTruthy();
	});

	it("should create PatchInstructionPacket with pre-computed patches", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const policyResult = policy.checkPolicy("large.ts", false, 500, 20000);

		const patches = [
			createPatchOperation("old1", "new1", "first change"),
			createPatchOperation("old2", "new2", "second change"),
		];

		const packet = createPatchInstructionPacket("plan1", "ws1", "large.ts", policyResult, 500, 20000, patches);

		expect(packet.patchPlan.patches.length).toBe(2);
		expect(packet.patchPlan.patches[0].oldText).toBe("old1");
		expect(packet.patchPlan.patches[1].newText).toBe("new2");
	});
});

// ---------------------------------------------------------------------------
// AC3: Patch plan archived in workspace artifacts
// ---------------------------------------------------------------------------

describe("AC3: Patch plan archived in workspace artifacts", () => {
	let archivedFiles: Map<string, string>;
	let createdDirs: string[];
	let archiver: PatchPlanArchiver;

	beforeEach(() => {
		archivedFiles = new Map();
		createdDirs = [];
		archiver = createPatchPlanArchiver({
			artifactsDir: "/test/artifacts",
			writeFile: async (filePath: string, content: string) => {
				archivedFiles.set(filePath, content);
			},
			mkdir: async (dir: string) => {
				createdDirs.push(dir);
			},
		});
	});

	it("should archive a patch plan to a JSON file", async () => {
		const plan = createPatchPlan({
			planExecId: "plan1",
			workspaceId: "ws1",
			filePath: "large.ts",
			triggerReasonCode: "existing_file_blocked_size",
			triggerReason: "File too large",
			existingLineCount: 500,
			existingByteSize: 20000,
			patches: [createPatchOperation("old", "new", "fix")],
		});

		const archivePath = await archiver.archive(plan);

		expect(archivePath).toContain("patch-plan-");
		expect(archivePath).toContain(".json");
		expect(createdDirs).toContain("/test/artifacts");

		const content = archivedFiles.get(archivePath);
		expect(content).toBeTruthy();

		const parsed = JSON.parse(content!);
		expect(parsed.planId).toBe(plan.id);
		expect(parsed.filePath).toBe("large.ts");
		expect(parsed.triggerReasonCode).toBe("existing_file_blocked_size");
		expect(parsed.status).toBe("pending");
		expect(parsed.patchCount).toBe(1);
		expect(parsed.plan).toBeDefined();
		expect(parsed.plan.patches.length).toBe(1);
		expect(parsed.archivedAt).toBeGreaterThan(0);
	});

	it("should include archived plan with full plan data", async () => {
		const patches = [
			createPatchOperation("import old", "import new", "update import"),
			createPatchOperation("return old", "return new", "update return"),
		];

		const plan = createPatchPlan({
			planExecId: "plan2",
			workspaceId: "ws2",
			filePath: "module.ts",
			triggerReasonCode: "tsx_component_patch_required",
			triggerReason: "TSX component requires patch mode",
			existingLineCount: 400,
			existingByteSize: 15000,
			patches,
		});

		const archivePath = await archiver.archive(plan);
		const content = archivedFiles.get(archivePath);
		const parsed = JSON.parse(content!);

		expect(parsed.plan.planExecId).toBe("plan2");
		expect(parsed.plan.workspaceId).toBe("ws2");
		expect(parsed.plan.filePath).toBe("module.ts");
		expect(parsed.plan.patches.length).toBe(2);
		expect(parsed.plan.patches[0].oldText).toBe("import old");
		expect(parsed.plan.patches[1].newText).toBe("return new");
		expect(parsed.plan.existingLineCount).toBe(400);
	});

	it("should archive multiple patch plans", async () => {
		const plan1 = createPatchPlan({
			planExecId: "plan1",
			workspaceId: "ws1",
			filePath: "a.ts",
			triggerReasonCode: "existing_file_blocked_size",
			triggerReason: "blocked",
			existingLineCount: 300,
			existingByteSize: 12000,
			patches: [createPatchOperation("a", "b", "change a")],
		});

		const plan2 = createPatchPlan({
			planExecId: "plan1",
			workspaceId: "ws1",
			filePath: "b.ts",
			triggerReasonCode: "existing_file_blocked_bytes",
			triggerReason: "blocked bytes",
			existingLineCount: 100,
			existingByteSize: 9000,
			patches: [createPatchOperation("c", "d", "change c")],
		});

		const paths = await archiver.archiveMany([plan1, plan2]);

		expect(paths.length).toBe(2);
		expect(archivedFiles.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// AC4: Large file patch fallback avoids full-file regeneration
// ---------------------------------------------------------------------------

describe("AC4: Large file patch fallback avoids full-file regeneration", () => {
	it("should generate targeted patches instead of full content", () => {
		const oldContent = ["import React from 'react';", "const x = 1;", "const y = 2;", "export default x;"].join(
			String.fromCharCode(10),
		);

		const newContent = [
			"import React from 'react';",
			"const x = 10;", // changed
			"const y = 2;",
			"export default x;",
		].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		// Should produce at least one targeted patch
		expect(patches.length).toBeGreaterThan(0);

		// The patch should reference only the changed portion, not the entire file
		for (const patch of patches) {
			// oldText should be much smaller than full file content
			expect(patch.oldText.length).toBeLessThan(oldContent.length);
			expect(patch.newText.length).toBeLessThan(newContent.length);
		}
	});

	it("should produce patches for multiple separate changes", () => {
		const oldContent = ["line1", "line2", "line3", "line4", "line5"].join(String.fromCharCode(10));

		const newContent = ["line1-changed", "line2", "line3", "line4-changed", "line5"].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThanOrEqual(2);
	});

	it("should return empty patches when content is identical", () => {
		const content = "same content";
		const patches = computeChangePatches(content, content);

		expect(patches.length).toBe(0);
	});

	it("should handle insertion-only changes", () => {
		const oldContent = ["line1", "line3"].join(String.fromCharCode(10));

		const newContent = ["line1", "line2-inserted", "line3"].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThan(0);

		// At least one patch should have the new text containing the inserted line
		const hasInsertPatch = patches.some((p) => p.newText.includes("line2-inserted"));
		expect(hasInsertPatch).toBe(true);
	});

	it("should handle deletion-only changes", () => {
		const oldContent = ["line1", "line2-to-delete", "line3"].join(String.fromCharCode(10));

		const newContent = ["line1", "line3"].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThan(0);

		// At least one patch should reference the deleted line
		const hasDeletePatch = patches.some((p) => p.oldText.includes("line2-to-delete"));
		expect(hasDeletePatch).toBe(true);
	});

	it("should generate a full fallback patch for completely different content", () => {
		const oldContent = "completely different old content";
		const newContent = "totally new and unrelated content";

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThan(0);
		// All old content is replaced
		expect(patches.some((p) => p.oldText === oldContent || p.oldText.includes(oldContent))).toBe(true);
	});

	it("patchFallbackForLargeFile should return a structured result", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const policyResult = policy.checkPolicy("large.ts", false, 500, 20000);

		const oldContent = "const x = 1;";
		const newContent = "const x = 2;";

		const result = patchFallbackForLargeFile(
			"plan1",
			"ws1",
			"large.ts",
			policyResult,
			500,
			20000,
			oldContent,
			newContent,
		);

		expect(result.packet).toBeDefined();
		expect(result.packet.instructionType).toBe("patch_mode");
		expect(result.patchPlan).toBeDefined();
		expect(result.patchPlan.filePath).toBe("large.ts");
		expect(result.patchPlan.patches.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// AC5: Patch fixture passes tests
// ---------------------------------------------------------------------------

describe("AC5: Patch fixture tests", () => {
	it("should handle a realistic TSX component patch scenario", () => {
		const oldComponent = [
			'import React from "react";',
			"",
			"interface Props {",
			"  name: string;",
			"}",
			"",
			"export const Component: React.FC<Props> = ({ name }) => {",
			"  return <div>{name}</div>;",
			"};",
		].join(String.fromCharCode(10));

		const newComponent = [
			'import React from "react";',
			"",
			"interface Props {",
			"  name: string;",
			"  age: number;",
			"}",
			"",
			"export const Component: React.FC<Props> = ({ name, age }) => {",
			"  return <div>{name} is {age}</div>;",
			"};",
		].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldComponent, newComponent);

		expect(patches.length).toBeGreaterThan(0);

		// Verify patches contain the key changes
		const allNewText = patches.map((p) => p.newText).join(" ");
		expect(allNewText).toContain("age");
		expect(allNewText).toContain("number");
	});

	it("should handle a realistic import change scenario", () => {
		const oldFile = [
			'import { foo } from "./old-module";',
			'import { bar } from "./utils";',
			"",
			"const result = foo(bar);",
			"export default result;",
		].join(String.fromCharCode(10));

		const newFile = [
			'import { foo } from "./new-module";',
			'import { bar } from "./utils";',
			"",
			"const result = foo(bar);",
			"export default result;",
		].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldFile, newFile);

		expect(patches.length).toBeGreaterThan(0);

		// The patch should reference the changed import
		const hasOldModule = patches.some((p) => p.oldText.includes("old-module"));
		const hasNewModule = patches.some((p) => p.newText.includes("new-module"));
		expect(hasOldModule).toBe(true);
		expect(hasNewModule).toBe(true);
	});

	it("should handle a large file with minimal changes", () => {
		// Simulate a 500-line file with a single-line change
		const lines: string[] = [];
		for (let i = 1; i <= 500; i++) {
			lines.push(`const line${i} = ${i};`);
		}
		const oldContent = lines.join(String.fromCharCode(10));

		// Change line 250
		const newLines = [...lines];
		newLines[249] = "const line250 = 999; // changed";
		const newContent = newLines.join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThan(0);

		// The patches should be much smaller than the full file
		const totalOldPatchSize = patches.reduce((sum, p) => sum + p.oldText.length, 0);
		expect(totalOldPatchSize).toBeLessThan(oldContent.length * 0.5);
	});

	it("should handle end-of-file additions", () => {
		const oldContent = `line1${String.fromCharCode(10)}line2`;
		const newContent = `line1${String.fromCharCode(10)}line2${String.fromCharCode(10)}line3-added`;

		const patches = computeChangePatches(oldContent, newContent);

		expect(patches.length).toBeGreaterThan(0);

		const hasAdded = patches.some((p) => p.newText.includes("line3-added"));
		expect(hasAdded).toBe(true);
	});

	it("should roundtrip: patches applied to old content produce new content", () => {
		const oldContent = ["import React from 'react';", "const x = 1;", "const y = 2;", "export default x;"].join(
			String.fromCharCode(10),
		);

		const newContent = [
			"import React from 'react';",
			"const x = 10;",
			"const y = 20;",
			"export default { x, y };",
		].join(String.fromCharCode(10));

		const patches = computeChangePatches(oldContent, newContent);

		// Apply patches in order to old content
		let applied = oldContent;
		for (const patch of patches) {
			// Only apply if oldText is found in the current content
			if (applied.includes(patch.oldText)) {
				applied = applied.replace(patch.oldText, patch.newText);
			}
		}

		// After applying all patches, the content should match the new content
		expect(applied).toBe(newContent);
	});
});

// ---------------------------------------------------------------------------
// Integration: blockedRewriteToPatchPacket with real policy
// ---------------------------------------------------------------------------

describe("Integration: blockedRewriteToPatchPacket with policy", () => {
	it("should produce a valid packet for token_saving mode blocks", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("big.ts", false, 500, 20000);

		expect(result.writeAllowed).toBe(false);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "big.ts", result, 500, 20000, "snapshot data");

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.filePath).toBe("big.ts");
		expect(packet.patchPlan.triggerReasonCode).toBe(result.reasonCode);
	});

	it("should produce a valid packet for speed mode hard gate blocks", () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });
		const result = policy.checkPolicy("huge.ts", false, 1500, 60000);

		expect(result.writeAllowed).toBe(false);

		const packet = blockedRewriteToPatchPacket("plan1", "ws1", "huge.ts", result, 1500, 60000, undefined);

		expect(packet.instructionType).toBe("patch_mode");
		expect(packet.reasonCode).toBe("hard_safety_gate_blocked");
		expect(packet.guidance).toContain("hard safety gate");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
	it("should handle empty old content to new content", () => {
		const patches = computeChangePatches("", "new content");
		expect(patches.length).toBeGreaterThan(0);
		expect(patches[0].oldText).toBe("");
		expect(patches[0].newText).toBe("new content");
	});

	it("should handle new content to empty content", () => {
		const patches = computeChangePatches("old content", "");
		expect(patches.length).toBeGreaterThan(0);
		expect(patches[0].newText).toBe("");
	});

	it("should handle single-line content changes", () => {
		const patches = computeChangePatches("hello", "world");
		expect(patches.length).toBeGreaterThan(0);
		expect(patches[0].oldText).toBe("hello");
		expect(patches[0].newText).toBe("world");
	});

	it("should create PatchOperation with unique IDs", () => {
		const op1 = createPatchOperation("a", "b");
		const op2 = createPatchOperation("c", "d");

		// IDs should be unique
		expect(op1.id).not.toBe(op2.id);
	});

	it("should create PatchPlan with unique IDs", () => {
		const plan1 = createPatchPlan({
			planExecId: "p1",
			workspaceId: "w1",
			filePath: "f1.ts",
			triggerReasonCode: "existing_file_blocked_size",
			triggerReason: "r1",
			existingLineCount: 100,
			existingByteSize: 5000,
			patches: [],
		});

		const plan2 = createPatchPlan({
			planExecId: "p2",
			workspaceId: "w2",
			filePath: "f2.ts",
			triggerReasonCode: "existing_file_blocked_bytes",
			triggerReason: "r2",
			existingLineCount: 200,
			existingByteSize: 10000,
			patches: [],
		});

		expect(plan1.id).not.toBe(plan2.id);
	});

	it("archived patch plan should have all required fields", async () => {
		let archivedData: string | undefined;
		const archiver = createPatchPlanArchiver({
			artifactsDir: "/tmp/test",
			writeFile: async (_p, content) => {
				archivedData = content;
			},
			mkdir: async () => {},
		});

		const plan = createPatchPlan({
			planExecId: "plan1",
			workspaceId: "ws1",
			filePath: "test.ts",
			triggerReasonCode: "existing_file_blocked_size",
			triggerReason: "too large",
			existingLineCount: 300,
			existingByteSize: 15000,
			patches: [createPatchOperation("old", "new", "test change")],
			status: "applied",
		});

		await archiver.archive(plan);

		expect(archivedData).toBeTruthy();
		const parsed = JSON.parse(archivedData!);
		expect(parsed.planId).toBe(plan.id);
		expect(parsed.filePath).toBe("test.ts");
		expect(parsed.status).toBe("applied");
		expect(parsed.patchCount).toBe(1);
		expect(parsed.archivedAt).toBeGreaterThan(0);
		expect(parsed.plan.id).toBe(plan.id);
	});
});
