/**
 * Replay — P38.1
 *
 * Supports replaying failed scenarios from stored replay files.
 * Replay files contain the scenario definition, seed, and execution
 * mode so that failures can be deterministically reproduced.
 */

import * as fs from "node:fs/promises";
import type { GauntletPlan } from "./synthetic-plan-builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayFile {
	/** Replay format version */
	version: 1;
	/** Run ID this replay was captured from */
	runId: string;
	/** Plan ID */
	planId: string;
	/** Scenario name */
	name: string;
	/** Execution mode used */
	executionMode: "stable_3" | "patch_transaction";
	/** Seed used for this run */
	seed: number;
	/** The plan definition at the time of failure */
	plan: GauntletPlan;
	/** Why this scenario failed */
	failureReason: string;
	/** Context from the failed run */
	context: Record<string, unknown>;
	/** Timestamp of capture */
	capturedAt: string;
}

// ---------------------------------------------------------------------------
// Replay functions
// ---------------------------------------------------------------------------

/**
 * Save a replay file for a failed scenario.
 */
export async function saveReplay(
	filePath: string,
	data: {
		runId: string;
		plan: GauntletPlan;
		seed: number;
		failureReason: string;
		context: Record<string, unknown>;
	},
): Promise<void> {
	// Ensure parent directory exists
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	await fs.mkdir(dir, { recursive: true });
	const replayFile: ReplayFile = {
		version: 1,
		runId: data.runId,
		planId: data.plan.id,
		name: data.plan.name,
		executionMode: data.plan.executionMode,
		seed: data.seed,
		plan: data.plan,
		failureReason: data.failureReason,
		context: data.context,
		capturedAt: new Date().toISOString(),
	};

	await fs.writeFile(filePath, JSON.stringify(replayFile, null, 2), "utf-8");
}

/**
 * Load a replay file.
 */
export async function loadReplay(filePath: string): Promise<ReplayFile> {
	const content = await fs.readFile(filePath, "utf-8");
	const parsed = JSON.parse(content) as ReplayFile;

	if (parsed.version !== 1) {
		throw new Error(`Unsupported replay file version: ${parsed.version}`);
	}

	return parsed;
}

/**
 * Validate a replay file structure.
 */
export function validateReplay(data: unknown): { valid: boolean; error?: string } {
	if (typeof data !== "object" || data === null) {
		return { valid: false, error: "Replay data must be an object." };
	}

	const r = data as Record<string, unknown>;

	if (r.version !== 1) {
		return { valid: false, error: `Expected version 1, got ${r.version}.` };
	}
	if (typeof r.planId !== "string") {
		return { valid: false, error: "Missing planId." };
	}
	if (typeof r.executionMode !== "string") {
		return { valid: false, error: "Missing executionMode." };
	}
	if (typeof r.seed !== "number") {
		return { valid: false, error: "Missing seed." };
	}
	if (!r.plan || typeof r.plan !== "object") {
		return { valid: false, error: "Missing plan definition." };
	}

	return { valid: true };
}
