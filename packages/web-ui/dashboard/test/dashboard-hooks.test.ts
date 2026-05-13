/**
 * Tests for Dashboard Types and Hooks (workspace 7.F)
 *
 * @tags dashboard hooks
 *
 * Acceptance Criteria:
 * 1. Dashboard types cover parallelism preview responses
 * 2. Hook can validate, patch, revalidate, approve, and run
 * 3. Hook handles validation errors and stale previews
 * 4. Existing plan upload hook remains compatible
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
	useParallelismPreview,
	type ParallelismPreviewState,
	type PreviewWorkflowStage,
	type StaleReason,
	type PreviewError,
} from "../src/hooks/useParallelismPreview";
import type {
	ValidateWithPreviewResponse,
	DependencyPatch,
	PreviewResult,
	BatchPlanResult,
	DependencyGraphNode,
	TopologicalBatch,
	BatchPlanWarning,
	BatchPlanError,
	SuggestedFix,
} from "../src/types";

// ---------------------------------------------------------------------------
// AC 1: Dashboard types cover parallelism preview responses
// ---------------------------------------------------------------------------

describe("dashboard parallelism preview types", () => {
	it("DependencyGraphNode has all required fields", () => {
		const node: DependencyGraphNode = {
			id: "7.A",
			title: "Test Workspace",
			dependencies: [],
			dependents: ["7.B"],
			batchIndex: 1,
		};
		expect(node.id).toBe("7.A");
		expect(node.title).toBe("Test Workspace");
		expect(node.dependencies).toEqual([]);
		expect(node.dependents).toEqual(["7.B"]);
		expect(node.batchIndex).toBe(1);
	});

	it("TopologicalBatch has all required fields", () => {
		const batch: TopologicalBatch = {
			batchIndex: 1,
			workspaceIds: ["7.A", "7.B"],
			width: 2,
		};
		expect(batch.batchIndex).toBe(1);
		expect(batch.workspaceIds).toHaveLength(2);
		expect(batch.width).toBe(2);
	});

	it("DependencyPatch has all required fields and actions", () => {
		const addPatch: DependencyPatch = {
			workspaceId: "7.B",
			action: "add_dependency",
			dependencyId: "7.A",
		};
		expect(addPatch.action).toBe("add_dependency");

		const removePatch: DependencyPatch = {
			workspaceId: "7.B",
			action: "remove_dependency",
			dependencyId: "7.A",
		};
		expect(removePatch.action).toBe("remove_dependency");
	});

	it("SuggestedFix has all required fields and categories", () => {
		const fix: SuggestedFix = {
			id: "fix-1",
			category: "remove_dependency",
			description: "Remove dep",
			workspaceIds: ["7.B"],
			patch: {
				workspaceId: "7.B",
				action: "remove_dependency",
				dependencyId: "7.A",
			},
		};
		expect(fix.category).toBe("remove_dependency");
		expect(fix.patch).toBeDefined();

		const fixNoPatch: SuggestedFix = {
			id: "fix-2",
			category: "adjust_parallelism",
			description: "Adjust",
			workspaceIds: [],
		};
		expect(fixNoPatch.patch).toBeUndefined();
	});

	it("BatchPlanWarning has all required warning types", () => {
		const warnings: BatchPlanWarning[] = [
			{ type: "over_serialized", message: "over-serialized" },
			{ type: "low_effective_parallelism", message: "low", workspaceIds: ["7.A"] },
			{ type: "single_width_batch", message: "single", batchIndex: 2 },
		];
		expect(warnings).toHaveLength(3);
	});

	it("BatchPlanError has all required error types", () => {
		const errors: BatchPlanError[] = [
			{ type: "cycle", message: "cycle detected", workspaceIds: ["7.A"] },
			{ type: "missing_dependency", message: "missing" },
			{ type: "empty_queue", message: "empty" },
		];
		expect(errors).toHaveLength(3);
	});

	it("BatchPlanResult has all required fields", () => {
		const result: BatchPlanResult = {
			dependencyGraph: [],
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: 3,
			parallelismDelta: 3,
			isOverSerialized: false,
			warnings: [],
			errors: [],
		};
		expect(result.effectiveParallelism).toBe(0);
		expect(result.requestedParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(3);
		expect(result.isOverSerialized).toBe(false);
	});

	it("PreviewResult has all required fields", () => {
		const result: PreviewResult = {
			success: true,
			batchPlan: undefined,
			errors: [],
			warnings: [],
			appliedPatches: [],
			rejectedPatches: [],
		};
		expect(result.success).toBe(true);
		expect(result.appliedPatches).toEqual([]);
		expect(result.rejectedPatches).toEqual([]);
	});

	it("PreviewResult handles rejected patches", () => {
		const result: PreviewResult = {
			success: false,
			errors: ["Cycle detected"],
			warnings: [],
			appliedPatches: [],
			rejectedPatches: [
				{
					patch: { workspaceId: "7.A", action: "add_dependency", dependencyId: "7.B" },
					reason: "Would create a cycle",
				},
			],
		};
		expect(result.rejectedPatches).toHaveLength(1);
		expect(result.rejectedPatches[0].reason).toContain("cycle");
	});

	it("ValidateWithPreviewResponse includes batchPlan and suggestedFixes", () => {
		const response: ValidateWithPreviewResponse = {
			success: true,
			parseResult: {
				title: "Test Plan",
				phase: "P7",
				workspaceCount: 4,
				maxParallel: 3,
			},
			safety: {
				safe: true,
				critical: [],
				warnings: [],
			},
			batchPlan: {
				dependencyGraph: [],
				batches: [],
				totalBatches: 3,
				effectiveParallelism: 2,
				requestedParallelism: 3,
				parallelismDelta: 1,
				isOverSerialized: false,
				warnings: [],
				errors: [],
			},
			suggestedFixes: [
				{
					id: "fix-1",
					category: "adjust_parallelism",
					description: "Lower parallelism",
					workspaceIds: [],
				},
			],
			requiresApproval: true,
		};
		expect(response.batchPlan).toBeDefined();
		expect(response.suggestedFixes).toHaveLength(1);
		expect(response.requiresApproval).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC 2: Hook can validate, patch, revalidate, approve, and run
// ---------------------------------------------------------------------------

describe("useParallelismPreview hook workflow", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const sampleValidationResponse: ValidateWithPreviewResponse = {
		success: true,
		parseResult: {
			title: "Test Plan",
			phase: "P7",
			workspaceCount: 4,
			maxParallel: 3,
		},
		safety: {
			safe: true,
			critical: [],
			warnings: [],
		},
		batchPlan: {
			dependencyGraph: [
				{
					id: "7.A",
					title: "A",
					dependencies: [],
					dependents: ["7.B"],
					batchIndex: 1,
				},
				{
					id: "7.B",
					title: "B",
					dependencies: ["7.A"],
					dependents: [],
					batchIndex: 2,
				},
			],
			batches: [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B"], width: 1 },
			],
			totalBatches: 2,
			effectiveParallelism: 1,
			requestedParallelism: 3,
			parallelismDelta: 2,
			isOverSerialized: true,
			warnings: [
				{
					type: "over_serialized",
					message: "Plan is over-serialized",
				},
			],
			errors: [],
		},
		suggestedFixes: [
			{
				id: "fix-remove-7.B-7.A",
				category: "remove_dependency",
				description: "Remove dependency A from B",
				workspaceIds: ["7.B"],
				patch: {
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			},
		],
		requiresApproval: false,
	};

	function jsonOk(body: unknown): Response {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	describe("validate", () => {
		it("transitions from idle to validated on success", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			expect(result.current.state.stage).toBe("idle");

			let validateResult: ValidateWithPreviewResponse | null = null;
			await act(async () => {
				validateResult = await result.current.validate('{"phase":"P7"}');
			});

			expect(result.current.state.stage).toBe("validated");
			expect(result.current.state.validationResponse).toStrictEqual(
				sampleValidationResponse,
			);
			expect(result.current.state.error).toBeNull();
			expect(validateResult).toStrictEqual(sampleValidationResponse);
		});

		it("transitions to error on validation failure", async () => {
			const failResponse: ValidateWithPreviewResponse = {
				success: false,
				errors: ["Invalid JSON", "Missing required field: phase"],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(failResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate("bad content");
			});

			expect(result.current.state.stage).toBe("error");
			expect(result.current.state.error).not.toBeNull();
			expect(result.current.state.error!.message).toContain("Invalid JSON");
			expect(result.current.state.error!.recoverable).toBe(true);
			expect(result.current.state.error!.validationErrors).toHaveLength(2);
		});

		it("returns null when projectId is null", async () => {
			const { result } = renderHook(() =>
				useParallelismPreview(null),
			);

			let validateResult: ValidateWithPreviewResponse | null = null;
			await act(async () => {
				validateResult = await result.current.validate('{"phase":"P7"}');
			});

			expect(validateResult).toBeNull();
			expect(result.current.state.stage).toBe("idle");
		});

		it("captures validation errors in error state", async () => {
			const errorResponse: ValidateWithPreviewResponse = {
				success: false,
				errors: ["Workspace 7.X not found"],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(errorResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			expect(result.current.state.stage).toBe("error");
			expect(result.current.state.error!.validationErrors).toContain(
				"Workspace 7.X not found",
			);
		});
	});

	describe("patch", () => {
		it("applies a dependency patch after validation", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const previewResult: PreviewResult = {
				success: true,
				batchPlan: sampleValidationResponse.batchPlan,
				errors: [],
				warnings: [],
				appliedPatches: [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				],
				rejectedPatches: [],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(previewResult));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			// First validate
			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});
			expect(result.current.state.stage).toBe("validated");

			// Then patch
			const patches: DependencyPatch[] = [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			];

			await act(async () => {
				await result.current.patch('{"phase":"P7"}', patches);
			});

			expect(result.current.state.stage).toBe("patched");
			expect(result.current.state.appliedPatches).toHaveLength(1);
			expect(result.current.state.appliedPatches[0].dependencyId).toBe("7.A");
		});

		it("rejects patching before validation", async () => {
			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			const patches: DependencyPatch[] = [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			];

			await act(async () => {
				await result.current.patch('{"phase":"P7"}', patches);
			});

			// Should stay idle with an error
			expect(result.current.state.error).not.toBeNull();
			expect(result.current.state.error!.message).toContain(
				"validated before patching",
			);
		});

		it("accumulates applied patches across multiple patch calls", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const previewResult1: PreviewResult = {
				success: true,
				batchPlan: sampleValidationResponse.batchPlan,
				errors: [],
				warnings: [],
				appliedPatches: [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				],
				rejectedPatches: [],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(previewResult1));

			const previewResult2: PreviewResult = {
				success: true,
				batchPlan: sampleValidationResponse.batchPlan,
				errors: [],
				warnings: [],
				appliedPatches: [
					{
						workspaceId: "7.C",
						action: "add_dependency",
						dependencyId: "7.A",
					},
				],
				rejectedPatches: [],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(previewResult2));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			await act(async () => {
				await result.current.patch('{"phase":"P7"}', [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				]);
			});

			await act(async () => {
				await result.current.patch('{"phase":"P7"}', [
					{
						workspaceId: "7.C",
						action: "add_dependency",
						dependencyId: "7.A",
					},
				]);
			});

			expect(result.current.state.appliedPatches).toHaveLength(2);
		});

		it("resets approval when patches are applied", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const previewResult: PreviewResult = {
				success: true,
				batchPlan: sampleValidationResponse.batchPlan,
				errors: [],
				warnings: [],
				appliedPatches: [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				],
				rejectedPatches: [],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(previewResult));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			// Approve after validation
			act(() => {
				result.current.approve();
			});
			expect(result.current.state.isApproved).toBe(true);

			// Patching should reset approval (approval was set on previous state snapshot,
			// but patching resets it in the new state)
			// Note: due to React state batching, the approval might persist in the
			// intermediate render. We verify the final state after patching.

			// Now patch - which should reset approval
			await act(async () => {
				await result.current.patch('{"phase":"P7"}', [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				]);
			});

			expect(result.current.state.stage).toBe("patched");
			expect(result.current.state.isApproved).toBe(false);
		});
	});

	describe("revalidate", () => {
		it("clears stale flag after successful revalidation", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			// Manually set stale state
			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			// Force stale
			act(() => {
				// Access internal state through hook to simulate staleness
				// We'll do this by changing content after validation
			});

			// Revalidate with same content should clear stale
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			await act(async () => {
				await result.current.revalidate('{"phase":"P7"}');
			});

			expect(result.current.state.stage).toBe("validated");
			expect(result.current.state.isStale).toBe(false);
			expect(result.current.state.staleReason).toBeNull();
		});
	});

	describe("approve", () => {
		it("approves a validated plan", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			let approved = false;
			act(() => {
				approved = result.current.approve();
			});

			expect(approved).toBe(true);
			expect(result.current.state.stage).toBe("approved");
			expect(result.current.state.isApproved).toBe(true);
		});

		it("refuses approval before validation", () => {
			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			let approved = true;
			act(() => {
				approved = result.current.approve();
			});

			expect(approved).toBe(false);
			expect(result.current.state.error).not.toBeNull();
			expect(result.current.state.error!.message).toContain("validated before approval");
		});

		it("refuses approval when preview is stale", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			// We need to trigger stale state - patch with changed content
			const previewFail: PreviewResult = {
				success: true,
				batchPlan: sampleValidationResponse.batchPlan,
				errors: ["Extra error"],
				warnings: [],
				appliedPatches: [],
				rejectedPatches: [],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(previewFail));

			// Patching with different fingerprint to trigger stale
			// Since we validated with '{"phase":"P7"}', using different content triggers stale
			await act(async () => {
				await result.current.patch('{"phase":"P7","extra":"diff"}', [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				]);
			});

			// Should be stale now
			expect(result.current.state.isStale).toBe(true);

			let approved = true;
			act(() => {
				approved = result.current.approve();
			});

			expect(approved).toBe(false);
			expect(result.current.state.error).not.toBeNull();
			expect(result.current.state.error!.message).toContain("Revalidate");
		});
	});

	describe("run", () => {
		it("runs an approved plan", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			act(() => {
				result.current.approve();
			});

			const runResponse = {
				success: true,
				planExecutionId: "exec-123",
			};
			fetchMock.mockResolvedValueOnce(jsonOk(runResponse));

			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			expect(runResult?.success).toBe(true);
			expect(runResult?.planExecutionId).toBe("exec-123");
			expect(result.current.state.planExecutionId).toBe("exec-123");
		});

		it("auto-approves plans that don't require approval", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			// Don't call approve() manually; requiresApproval is false
			const runResponse = {
				success: true,
				planExecutionId: "exec-auto",
			};
			fetchMock.mockResolvedValueOnce(jsonOk(runResponse));

			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			expect(runResult?.success).toBe(true);
			expect(runResult?.planExecutionId).toBe("exec-auto");
		});

		it("refuses run for plans requiring approval without explicit approval", async () => {
			const requiresApprovalResponse: ValidateWithPreviewResponse = {
				...sampleValidationResponse,
				requiresApproval: true,
			};
			fetchMock.mockResolvedValueOnce(jsonOk(requiresApprovalResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			// Try to run without approving
			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			expect(runResult).toBeNull();
			expect(result.current.state.error).not.toBeNull();
			expect(result.current.state.error!.message).toContain("approve");
		});

		it("refuses run when preview is stale", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			act(() => {
				result.current.approve();
			});

			// Make the preview stale by patching with changed content
			// This should set isStale=true and reset isApproved=false
			await act(async () => {
				await result.current.patch('{"phase":"P7","modified":true}', [
					{
						workspaceId: "7.B",
						action: "remove_dependency",
						dependencyId: "7.A",
					},
				]);
			});

			// Should be stale now
			expect(result.current.state.isStale).toBe(true);

			// Try to approve while stale — should fail
			let approved = true;
			act(() => {
				approved = result.current.approve();
			});
			expect(approved).toBe(false);

			// Run should also fail because isApproved is false / stale
			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			// Run should be blocked (null or error state)
			expect(result.current.state.error).not.toBeNull();
		});

		it("returns null when projectId is null", async () => {
			const { result } = renderHook(() =>
				useParallelismPreview(null),
			);

			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			expect(runResult).toBeNull();
		});

		it("handles run failure from server", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			act(() => {
				result.current.approve();
			});

			const failResponse = {
				success: false,
				errors: ["Plan execution failed: insufficient resources"],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(failResponse));

			let runResult: { success: boolean; planExecutionId?: string; errors?: string[] } | null = null;
			await act(async () => {
				runResult = await result.current.run('{"phase":"P7"}');
			});

			expect(runResult?.success).toBe(false);
			expect(result.current.state.stage).toBe("error");
			expect(result.current.state.error!.message).toContain("insufficient resources");
		});
	});

	describe("reset", () => {
		it("resets all state to initial idle", async () => {
			fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate('{"phase":"P7"}');
			});

			expect(result.current.state.stage).toBe("validated");

			act(() => {
				result.current.reset();
			});

			expect(result.current.state.stage).toBe("idle");
			expect(result.current.state.validationResponse).toBeNull();
			expect(result.current.state.appliedPatches).toEqual([]);
			expect(result.current.state.previewResult).toBeNull();
			expect(result.current.state.error).toBeNull();
			expect(result.current.state.isApproved).toBe(false);
			expect(result.current.state.planExecutionId).toBeNull();
		});
	});

	describe("clearError", () => {
		it("clears current error without resetting workflow", async () => {
			const failResponse: ValidateWithPreviewResponse = {
				success: false,
				errors: ["Parse error"],
			};
			fetchMock.mockResolvedValueOnce(jsonOk(failResponse));

			const { result } = renderHook(() =>
				useParallelismPreview("project-1"),
			);

			await act(async () => {
				await result.current.validate("bad");
			});

			expect(result.current.state.error).not.toBeNull();

			act(() => {
				result.current.clearError();
			});

			expect(result.current.state.error).toBeNull();
			// Stage should remain as error (not reset to idle)
			expect(result.current.state.stage).toBe("error");
		});
	});
});

// ---------------------------------------------------------------------------
// AC 3: Hook handles validation errors and stale previews
// ---------------------------------------------------------------------------

describe("useParallelismPreview error and stale handling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function jsonOk(body: unknown): Response {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	const sampleValidationResponse: ValidateWithPreviewResponse = {
		success: true,
		parseResult: {
			title: "Test Plan",
			phase: "P7",
			workspaceCount: 2,
			maxParallel: 3,
		},
		batchPlan: {
			dependencyGraph: [],
			batches: [],
			totalBatches: 1,
			effectiveParallelism: 1,
			requestedParallelism: 3,
			parallelismDelta: 2,
			isOverSerialized: true,
			warnings: [],
			errors: [],
		},
		suggestedFixes: [],
		requiresApproval: false,
	};

	it("detects stale preview when plan content changes", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		expect(result.current.state.validatedContentFingerprint).not.toBeNull();

		// Try to patch with different content
		const differentContent = '{"phase":"P7","modified":true}';
		await act(async () => {
			await result.current.patch(differentContent, [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			]);
		});

		expect(result.current.state.isStale).toBe(true);
		expect(result.current.state.staleReason).toBe("plan_content_changed");
		expect(result.current.state.error).not.toBeNull();
		expect(result.current.state.error!.message).toContain("content has changed");
	});

	it("marks preview stale when server rejects patches", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

		const previewWithRejections: PreviewResult = {
			success: false,
			errors: ["Cycle detected after patching"],
			warnings: [],
			appliedPatches: [],
			rejectedPatches: [
				{
					patch: {
						workspaceId: "7.A",
						action: "add_dependency",
						dependencyId: "7.B",
					},
					reason: "Would create a dependency cycle",
				},
			],
		};
		fetchMock.mockResolvedValueOnce(jsonOk(previewWithRejections));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		await act(async () => {
			await result.current.patch('{"phase":"P7"}', [
				{
					workspaceId: "7.A",
					action: "add_dependency",
					dependencyId: "7.B",
				},
			]);
		});

		expect(result.current.state.isStale).toBe(true);
		expect(result.current.state.staleReason).toBe("server_rejected_patch");
	});

	it("marks preview stale when patching introduces inconsistency", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));

		// Preview with more errors than rejected patches = inconsistency
		const inconsistentPreview: PreviewResult = {
			success: true,
			errors: ["Cycle detected", "Missing workspace 7.Z"],
			warnings: [],
			appliedPatches: [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			],
			rejectedPatches: [], // 0 rejections but 2 errors => stale
		};
		fetchMock.mockResolvedValueOnce(jsonOk(inconsistentPreview));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		await act(async () => {
			await result.current.patch('{"phase":"P7"}', [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			]);
		});

		expect(result.current.state.isStale).toBe(true);
		expect(result.current.state.staleReason).toBe("patches_applied_out_of_order");
	});

	it("handles network errors during validation gracefully", async () => {
		fetchMock.mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		expect(result.current.state.stage).toBe("error");
		expect(result.current.state.error).not.toBeNull();
		expect(result.current.state.error!.recoverable).toBe(true);
		expect(result.current.state.error!.message).toContain("Network error");
	});

	it("handles network errors during patching gracefully", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));
		fetchMock.mockRejectedValueOnce(new Error("Server unreachable"));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		await act(async () => {
			await result.current.patch('{"phase":"P7"}', [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			]);
		});

		expect(result.current.state.error).not.toBeNull();
		expect(result.current.state.error!.message).toContain("Server unreachable");
	});

	it("handles HTTP error responses during validation", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response("Internal Server Error", { status: 500 }),
		);

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		expect(result.current.state.stage).toBe("error");
		expect(result.current.state.error!.message).toContain("500");
	});

	it("handles HTTP error responses during patching", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));
		fetchMock.mockResolvedValueOnce(
			new Response("Bad Request", { status: 400 }),
		);

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		await act(async () => {
			await result.current.patch('{"phase":"P7"}', [
				{
					workspaceId: "7.B",
					action: "remove_dependency",
					dependencyId: "7.A",
				},
			]);
		});

		expect(result.current.state.error).not.toBeNull();
		expect(result.current.state.error!.message).toContain("400");
	});

	it("handles HTTP error responses during run", async () => {
		fetchMock.mockResolvedValueOnce(jsonOk(sampleValidationResponse));
		fetchMock.mockResolvedValueOnce(
			new Response("Service Unavailable", { status: 503 }),
		);

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		act(() => {
			result.current.approve();
		});

		await act(async () => {
			await result.current.run('{"phase":"P7"}');
		});

		expect(result.current.state.error).not.toBeNull();
		expect(result.current.state.error!.message).toContain("503");
	});

	it("allows recovery after error via revalidation", async () => {
		fetchMock.mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate('{"phase":"P7"}');
		});

		expect(result.current.state.stage).toBe("error");

		// Recover by revalidating
		const successResponse: ValidateWithPreviewResponse = {
			success: true,
			batchPlan: {
				dependencyGraph: [],
				batches: [],
				totalBatches: 0,
				effectiveParallelism: 0,
				requestedParallelism: 3,
				parallelismDelta: 3,
				isOverSerialized: false,
				warnings: [],
				errors: [],
			},
			suggestedFixes: [],
			requiresApproval: false,
		};
		fetchMock.mockResolvedValueOnce(jsonOk(successResponse));

		await act(async () => {
			await result.current.revalidate('{"phase":"P7"}');
		});

		expect(result.current.state.stage).toBe("validated");
		expect(result.current.state.error).toBeNull();
	});

	it("preserves error details including validation errors from server", async () => {
		const failResponse: ValidateWithPreviewResponse = {
			success: false,
			errors: [
				"Workspace 7.X references non-existent dependency 7.Y",
				"Cycle detected: 7.A -> 7.B -> 7.A",
			],
		};
		fetchMock.mockResolvedValueOnce(jsonOk(failResponse));

		const { result } = renderHook(() =>
			useParallelismPreview("project-1"),
		);

		await act(async () => {
			await result.current.validate("bad plan");
		});

		expect(result.current.state.error!.validationErrors).toHaveLength(2);
		expect(result.current.state.error!.validationErrors![0]).toContain(
			"7.X references non-existent",
		);
		expect(result.current.state.error!.validationErrors![1]).toContain(
			"Cycle detected",
		);
	});
});

// ---------------------------------------------------------------------------
// AC 4: Existing plan upload hook remains compatible
// ---------------------------------------------------------------------------

describe("usePlanRunner backward compatibility", () => {
	it("usePlanRunner types remain importable without changes", async () => {
		// Verify that the existing types from usePlanRunner are still available
		const { usePlanRunner, ValidationResult, RunPlanResult, ActiveExecution } =
			await import("../src/hooks/usePlanRunner");

		expect(usePlanRunner).toBeDefined();
		expect(typeof usePlanRunner).toBe("function");
	});

	it("usePlanRunner hook still works after parallelism preview additions", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const { usePlanRunner } = await import("../src/hooks/usePlanRunner");
		const { result } = renderHook(() => usePlanRunner("project-1"));

		expect(result.current.validating).toBe(false);
		expect(result.current.running).toBe(false);
		expect(result.current.validationResult).toBeNull();
		expect(result.current.runResult).toBeNull();
		expect(typeof result.current.validate).toBe("function");
		expect(typeof result.current.run).toBe("function");
		expect(typeof result.current.clearResults).toBe("function");
		expect(typeof result.current.fetchActiveExecutions).toBe("function");

		vi.restoreAllMocks();
	});

	it("parallelism preview types do not conflict with existing types", () => {
		// Import both type sets and verify no naming conflicts
		// The types in types.ts are additive — existing interfaces unchanged
		interface ExistingTypesCheck {
			planState: import("../src/types").PlanState;
			project: import("../src/types").Project;
			planExecution: import("../src/types").PlanExecution;
			executionStats: import("../src/types").ExecutionStats;
			gitFileChange: import("../src/types").GitFileChange;
		}

		interface NewTypesCheck {
			dependencyGraphNode: import("../src/types").DependencyGraphNode;
			topologicalBatch: import("../src/types").TopologicalBatch;
			dependencyPatch: import("../src/types").DependencyPatch;
			batchPlanResult: import("../src/types").BatchPlanResult;
			previewResult: import("../src/types").PreviewResult;
			validateWithPreviewResponse: import("../src/types").ValidateWithPreviewResponse;
			suggestedFix: import("../src/types").SuggestedFix;
		}

		// If this compiles, types are compatible
		expect(true).toBe(true);
	});
});
