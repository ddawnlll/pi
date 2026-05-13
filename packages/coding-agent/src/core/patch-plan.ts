/**
 * Patch Plan - Targeted patch planner and edit fallback for large files.
 *
 * P4.5 Workstream 4.5.D: When a full rewrite is blocked by the EditStrategyPolicy,
 * generates a PatchPlan that describes the targeted edits the agent should apply
 * instead of rewriting the entire file.
 *
 * Provides:
 * - PatchPlan format: structured list of patch operations
 * - PatchInstructionPacket: instruction returned to the agent when a write is blocked
 * - PatchPlanArchiver: archives patch plans to workspace artifacts
 * - patchFallbackForLargeFile: generates a patch plan from old/new content
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { EditStrategyReasonCode, EditStrategyResult } from "./edit-strategy-policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single patch operation within a PatchPlan.
 */
export interface PatchOperation {
	/** Unique operation ID within the plan */
	id: string;
	/** The exact text to find in the original file */
	oldText: string;
	/** The replacement text */
	newText: string;
	/** Optional description of what this patch does */
	description: string;
}

/**
 * A PatchPlan describes a set of targeted edit operations to apply to a file,
 * used as a fallback when a full rewrite is blocked by the edit strategy policy.
 */
export interface PatchPlan {
	/** Unique plan ID */
	id: string;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Relative file path this plan targets */
	filePath: string;
	/** Reason code that triggered the patch plan (from EditStrategyPolicy) */
	triggerReasonCode: EditStrategyReasonCode;
	/** Human-readable reason the full rewrite was blocked */
	triggerReason: string;
	/** Line count of the existing file */
	existingLineCount: number;
	/** Byte size of the existing file */
	existingByteSize: number;
	/** Patch operations to apply */
	patches: PatchOperation[];
	/** Timestamp when the plan was created */
	createdAt: number;
	/** Status of the plan */
	status: PatchPlanStatus;
}

/**
 * Status of a PatchPlan.
 */
export type PatchPlanStatus = "pending" | "applied" | "failed" | "archived";

/**
 * Instruction packet returned to the agent when a full rewrite is blocked.
 * Contains the PatchPlan and guidance on how to proceed.
 */
export interface PatchInstructionPacket {
	/** The type of instruction (always "patch_mode" for blocked rewrites) */
	instructionType: "patch_mode";
	/** The relative file path */
	filePath: string;
	/** Reason the full rewrite was blocked */
	reason: string;
	/** Reason code from the policy */
	reasonCode: EditStrategyReasonCode;
	/** The patch plan to follow */
	patchPlan: PatchPlan;
	/** Guidance for the agent */
	guidance: string;
}

/**
 * Archived patch plan data for workspace artifacts.
 */
export interface ArchivedPatchPlan {
	/** Plan ID */
	planId: string;
	/** Relative file path */
	filePath: string;
	/** Trigger reason code */
	triggerReasonCode: EditStrategyReasonCode;
	/** Status at time of archival */
	status: PatchPlanStatus;
	/** Number of patches */
	patchCount: number;
	/** Timestamp when archived */
	archivedAt: number;
	/** Serialized patch plan */
	plan: PatchPlan;
}

// ---------------------------------------------------------------------------
// PatchOperation helpers
// ---------------------------------------------------------------------------

let patchOpCounter = 0;

/**
 * Create a new PatchOperation.
 *
 * @param oldText - The exact text to find in the original file
 * @param newText - The replacement text
 * @param description - Optional description of what this patch does
 * @returns PatchOperation with a unique ID
 */
export function createPatchOperation(oldText: string, newText: string, description: string = ""): PatchOperation {
	patchOpCounter++;
	return {
		id: `patch-op-${patchOpCounter}-${Date.now()}`,
		oldText,
		newText,
		description,
	};
}

// ---------------------------------------------------------------------------
// PatchPlan creation
// ---------------------------------------------------------------------------

let patchPlanCounter = 0;

/**
 * Create a new PatchPlan.
 *
 * @param options - Patch plan creation options
 * @returns PatchPlan instance
 */
export function createPatchPlan(options: {
	planExecId: string;
	workspaceId: string;
	filePath: string;
	triggerReasonCode: EditStrategyReasonCode;
	triggerReason: string;
	existingLineCount: number;
	existingByteSize: number;
	patches: PatchOperation[];
	status?: PatchPlanStatus;
}): PatchPlan {
	patchPlanCounter++;
	return {
		id: `patch-plan-${patchPlanCounter}-${Date.now()}`,
		planExecId: options.planExecId,
		workspaceId: options.workspaceId,
		filePath: options.filePath,
		triggerReasonCode: options.triggerReasonCode,
		triggerReason: options.triggerReason,
		existingLineCount: options.existingLineCount,
		existingByteSize: options.existingByteSize,
		patches: options.patches,
		createdAt: Date.now(),
		status: options.status ?? "pending",
	};
}

// ---------------------------------------------------------------------------
// PatchInstructionPacket creation
// ---------------------------------------------------------------------------

/**
 * Create a PatchInstructionPacket from a blocked policy result.
 *
 * When the EditStrategyPolicy blocks a full rewrite, this function generates
 * an instruction packet that tells the agent to use targeted edits instead.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filePath - Relative file path
 * @param policyResult - The policy result that blocked the rewrite
 * @param existingLineCount - Line count of the existing file
 * @param existingByteSize - Byte size of the existing file
 * @param patches - Pre-computed patches (if available), otherwise an empty list is provided
 * @returns PatchInstructionPacket with guidance
 */
export function createPatchInstructionPacket(
	planExecId: string,
	workspaceId: string,
	filePath: string,
	policyResult: EditStrategyResult,
	existingLineCount: number,
	existingByteSize: number,
	patches: PatchOperation[] = [],
): PatchInstructionPacket {
	const patchPlan = createPatchPlan({
		planExecId,
		workspaceId,
		filePath,
		triggerReasonCode: policyResult.reasonCode,
		triggerReason: policyResult.reason,
		existingLineCount,
		existingByteSize,
		patches,
	});

	const guidance = buildPatchGuidance(policyResult, filePath, existingLineCount);

	return {
		instructionType: "patch_mode",
		filePath,
		reason: policyResult.reason,
		reasonCode: policyResult.reasonCode,
		patchPlan,
		guidance,
	};
}

/**
 * Build human-readable guidance for the patch instruction packet.
 */
function buildPatchGuidance(policyResult: EditStrategyResult, filePath: string, existingLineCount: number): string {
	const lines: string[] = [];

	lines.push(`Full rewrite of "${filePath}" is blocked by the edit strategy policy (${existingLineCount} lines).`);
	lines.push("Use the edit tool with targeted replacements instead of rewriting the entire file.");

	if (policyResult.reasonCode === "tsx_component_patch_required") {
		lines.push("TSX/JSX components over the line limit require targeted patches. Keep oldText small and unique.");
	} else if (policyResult.reasonCode === "existing_file_blocked_size") {
		lines.push(
			"The file exceeds the line limit for full rewrites. Break the changes into small, non-overlapping patches.",
		);
	} else if (policyResult.reasonCode === "existing_file_blocked_bytes") {
		lines.push(
			"The file exceeds the byte size limit for full rewrites. Break the changes into small, non-overlapping patches.",
		);
	} else if (policyResult.reasonCode === "generated_file_rewrite_blocked") {
		lines.push("This generated file is not marked as rewrite-allowed. Apply targeted patches only.");
	} else if (policyResult.reasonCode === "hard_safety_gate_blocked") {
		lines.push("The file exceeds the hard safety gate limit. Apply targeted patches only.");
	}

	lines.push("Read the file first, then apply edits with exact oldText matches.");
	lines.push("Each edits[].oldText must match a unique, non-overlapping region of the file.");

	return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Patch Plan Archive
// ---------------------------------------------------------------------------

/**
 * Manages archiving of patch plans to workspace artifact files.
 *
 * Patch plans are serialized to JSON and written to a configurable
 * artifacts directory. This provides persistence for debugging and
 * dashboard visibility.
 */
export class PatchPlanArchiver {
	private artifactsDir: string;
	private writeFn: (filePath: string, content: string) => Promise<void>;
	private mkdirFn: (dir: string) => Promise<void>;

	constructor(options?: {
		artifactsDir?: string;
		writeFile?: (filePath: string, content: string) => Promise<void>;
		mkdir?: (dir: string) => Promise<void>;
	}) {
		this.artifactsDir = options?.artifactsDir ?? ".pi/patch-plans";
		this.writeFn = options?.writeFile ?? ((p, c) => fs.writeFile(p, c, "utf-8"));
		this.mkdirFn = options?.mkdir ?? ((d) => fs.mkdir(d, { recursive: true }).then(() => {}));
	}

	/**
	 * Archive a patch plan to a workspace artifact file.
	 *
	 * @param patchPlan - The patch plan to archive
	 * @returns Path to the archived file
	 */
	async archive(patchPlan: PatchPlan): Promise<string> {
		const archived: ArchivedPatchPlan = {
			planId: patchPlan.id,
			filePath: patchPlan.filePath,
			triggerReasonCode: patchPlan.triggerReasonCode,
			status: patchPlan.status,
			patchCount: patchPlan.patches.length,
			archivedAt: Date.now(),
			plan: patchPlan,
		};

		const dir = this.artifactsDir;
		await this.mkdirFn(dir);

		const fileName = `patch-plan-${patchPlan.id}.json`;
		const filePath = path.join(dir, fileName);
		await this.writeFn(filePath, JSON.stringify(archived, null, 2));
		return filePath;
	}

	/**
	 * Archive multiple patch plans.
	 *
	 * @param patchPlans - Array of patch plans to archive
	 * @returns Array of paths to archived files
	 */
	async archiveMany(patchPlans: PatchPlan[]): Promise<string[]> {
		const paths: string[] = [];
		for (const plan of patchPlans) {
			const p = await this.archive(plan);
			paths.push(p);
		}
		return paths;
	}
}

/**
 * Create a PatchPlanArchiver instance.
 */
export function createPatchPlanArchiver(options?: {
	artifactsDir?: string;
	writeFile?: (filePath: string, content: string) => Promise<void>;
	mkdir?: (dir: string) => Promise<void>;
}): PatchPlanArchiver {
	return new PatchPlanArchiver(options);
}

// ---------------------------------------------------------------------------
// Large File Patch Fallback
// ---------------------------------------------------------------------------

/**
 * Result of generating a large file patch fallback.
 */
export interface LargeFilePatchFallbackResult {
	/** The patch instruction packet */
	packet: PatchInstructionPacket;
	/** The generated patch plan */
	patchPlan: PatchPlan;
}

/**
 * Generate a patch fallback for a large file that cannot be fully rewritten.
 *
 * Instead of regenerating the entire file content, this creates a PatchPlan
 * with targeted edit operations derived from the diff between old and new content.
 *
 * This avoids the token cost of outputting the entire file by describing
 * only the changes needed.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filePath - Relative file path
 * @param policyResult - The policy result that blocked the rewrite
 * @param existingLineCount - Line count of the existing file
 * @param existingByteSize - Byte size of the existing file
 * @param oldContent - Current file content (for diff derivation)
 * @param newContent - Intended new file content
 * @returns LargeFilePatchFallbackResult with the patch instruction packet
 */
export function patchFallbackForLargeFile(
	planExecId: string,
	workspaceId: string,
	filePath: string,
	policyResult: EditStrategyResult,
	existingLineCount: number,
	existingByteSize: number,
	oldContent: string,
	newContent: string,
): LargeFilePatchFallbackResult {
	const patches = computeChangePatches(oldContent, newContent);

	const packet = createPatchInstructionPacket(
		planExecId,
		workspaceId,
		filePath,
		policyResult,
		existingLineCount,
		existingByteSize,
		patches,
	);

	return {
		packet,
		patchPlan: packet.patchPlan,
	};
}

// ---------------------------------------------------------------------------
// Change Patch Computation
// ---------------------------------------------------------------------------

const LF = String.fromCharCode(10);

/**
 * Compute patch operations from the diff between old and new content.
 *
 * Uses a line-grouped diff approach:
 * 1. Split both contents into lines
 * 2. Find the longest common subsequence of unchanged lines
 * 3. Group consecutive changed lines into patch operations
 *
 * Each patch operation covers a contiguous block of changed lines.
 *
 * @param oldContent - Original file content
 * @param newContent - New file content
 * @returns Array of PatchOperations derived from the diff
 */
export function computeChangePatches(oldContent: string, newContent: string): PatchOperation[] {
	if (oldContent === newContent) {
		return [];
	}

	const oldLines = oldContent.split(LF);
	const newLines = newContent.split(LF);

	// Compute LCS
	const lcs = computeLCS(oldLines, newLines);

	// Track which old/new lines are part of the LCS (unchanged)
	const oldUnchanged = new Set<number>();
	const newUnchanged = new Set<number>();
	for (const [oi, ni] of lcs) {
		oldUnchanged.add(oi);
		newUnchanged.add(ni);
	}

	// Identify changed regions and generate patches
	const patches: PatchOperation[] = [];

	// Walk through both arrays simultaneously
	let oi = 0;
	let ni = 0;

	while (oi < oldLines.length || ni < newLines.length) {
		// Skip over unchanged lines
		while (oi < oldLines.length && ni < newLines.length && oldUnchanged.has(oi) && newUnchanged.has(ni)) {
			oi++;
			ni++;
		}

		// Find changed region in old
		const oldStart = oi;
		while (oi < oldLines.length && !oldUnchanged.has(oi)) {
			oi++;
		}
		const oldEnd = oi;

		// Find changed region in new
		const newStart = ni;
		while (ni < newLines.length && !newUnchanged.has(ni)) {
			ni++;
		}
		const newEnd = ni;

		// If both are empty, we've reached the end
		if (oldStart === oldEnd && newStart === newEnd) {
			break;
		}

		// Include one surrounding context line for uniqueness (if available)
		const contextBefore = oldStart > 0 ? oldLines[oldStart - 1] : undefined;
		const contextAfter = oi < oldLines.length ? oldLines[oi] : undefined;

		const oldBlock = oldLines.slice(oldStart, oldEnd).join(LF);
		const newBlock = newLines.slice(newStart, newEnd).join(LF);

		let fullOldText = "";
		let fullNewText = "";

		if (contextBefore !== undefined) {
			fullOldText += contextBefore + LF;
			fullNewText += contextBefore + LF;
		}

		fullOldText += oldBlock;
		fullNewText += newBlock;

		if (contextAfter !== undefined) {
			fullOldText += LF + contextAfter;
			fullNewText += LF + contextAfter;
		}

		// If oldBlock is empty, this is a pure insertion
		if (oldBlock === "" && newBlock !== "") {
			if (contextBefore !== undefined) {
				// Insert after context line
				patches.push(
					createPatchOperation(
						contextBefore,
						contextBefore + LF + newBlock,
						`Insert ${newEnd - newStart} lines after context`,
					),
				);
			} else if (contextAfter !== undefined) {
				// Insert before context line
				patches.push(
					createPatchOperation(
						contextAfter,
						newBlock + LF + contextAfter,
						`Insert ${newEnd - newStart} lines before context`,
					),
				);
			} else {
				// No context — full content insertion
				patches.push(createPatchOperation("", newBlock, `Insert ${newEnd - newStart} lines`));
			}
		} else {
			// Replace old block with new block
			patches.push(
				createPatchOperation(
					fullOldText,
					fullNewText,
					`Change lines ${oldStart + 1}-${oldEnd} (${oldEnd - oldStart} old, ${newEnd - newStart} new)`,
				),
			);
		}
	}

	// If no patches generated but content differs, fallback to full replacement
	if (patches.length === 0 && oldContent !== newContent) {
		patches.push(createPatchOperation(oldContent, newContent, "Full content replacement (fallback)"));
	}

	return patches;
}

// ---------------------------------------------------------------------------
// LCS Computation
// ---------------------------------------------------------------------------

/**
 * Compute the LCS (longest common subsequence) of two string arrays.
 *
 * Returns pairs of [oldIndex, newIndex] for each line in the LCS.
 *
 * @param oldLines - Lines of the original content
 * @param newLines - Lines of the new content
 * @returns Array of [oldIndex, newIndex] pairs
 */
function computeLCS(oldLines: string[], newLines: string[]): Array<[number, number]> {
	const m = oldLines.length;
	const n = newLines.length;

	// For very large files, use a hash-based approach
	if (m > 1000 || n > 1000) {
		return computeLCSSparse(oldLines, newLines);
	}

	// Standard DP LCS
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find the LCS pairs
	const result: Array<[number, number]> = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (oldLines[i - 1] === newLines[j - 1]) {
			result.push([i - 1, j - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return result.reverse();
}

/**
 * Sparse LCS for large files — uses a hash-based approach to find
 * matching lines efficiently without the full O(n*m) DP table.
 */
function computeLCSSparse(oldLines: string[], newLines: string[]): Array<[number, number]> {
	const result: Array<[number, number]> = [];

	// Build index of old lines by content
	const oldIndex = new Map<string, number[]>();
	for (let i = 0; i < oldLines.length; i++) {
		const line = oldLines[i];
		if (line.trim().length === 0) continue; // Skip blank lines for matching
		const existing = oldIndex.get(line);
		if (existing) {
			existing.push(i);
		} else {
			oldIndex.set(line, [i]);
		}
	}

	// For each new line, find matching old lines and maintain ordering
	let lastOldIdx = -1;
	const usedOld = new Set<number>();

	for (let ni = 0; ni < newLines.length; ni++) {
		const line = newLines[ni];
		if (line.trim().length === 0) continue;

		const candidates = oldIndex.get(line);
		if (!candidates) continue;

		// Find the first candidate after lastOldIdx that hasn't been used
		for (const oi of candidates) {
			if (oi > lastOldIdx && !usedOld.has(oi)) {
				result.push([oi, ni]);
				lastOldIdx = oi;
				usedOld.add(oi);
				break;
			}
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Write Gate Integration Helper
// ---------------------------------------------------------------------------

/**
 * Generate a PatchInstructionPacket when a write gate blocks a full rewrite.
 *
 * This is the primary integration point: when the WriteGate blocks a write,
 * call this function to produce the instruction packet that tells the agent
 * to use targeted edits instead of regenerating the entire file.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filePath - Relative file path
 * @param policyResult - The policy result that blocked the rewrite
 * @param existingLineCount - Line count of the existing file
 * @param existingByteSize - Byte size of the existing file
 * @param snapshot - Pre-write snapshot content (optional)
 * @returns PatchInstructionPacket with guidance
 */
export function blockedRewriteToPatchPacket(
	planExecId: string,
	workspaceId: string,
	filePath: string,
	policyResult: EditStrategyResult,
	existingLineCount: number,
	existingByteSize: number,
	snapshot: string | undefined,
): PatchInstructionPacket {
	const patches: PatchOperation[] = [];

	const packet = createPatchInstructionPacket(
		planExecId,
		workspaceId,
		filePath,
		policyResult,
		existingLineCount,
		existingByteSize,
		patches,
	);

	// Add snapshot-aware guidance
	if (snapshot) {
		packet.guidance +=
			" A pre-edit snapshot is available. Read the file to get the current content, then apply targeted edits.";
	}

	return packet;
}
