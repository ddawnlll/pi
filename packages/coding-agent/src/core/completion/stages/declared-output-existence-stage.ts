/**
 * P44.5.03 — Declared Output Existence Stage
 *
 * Blocks completion when declared output files or PlanSpec-required output
 * files do not exist on the filesystem.
 *
 * This stage runs BEFORE commit or evidence checks because there's no point
 * verifying evidence or committing if the declared output doesn't exist.
 *
 * Contract Schema: 4.1.1
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the declared output existence stage.
 */
export interface DeclaredOutputExistenceStageConfig {
	/** Repository root path */
	repoRoot: string;
	/** List of files that are declared as outputs for this workspace */
	declaredOutputFiles: string[];
	/** Whether to check output files exist on the filesystem */
	checkFilesystemExistence: boolean;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the DeclaredOutputExistence stage.
 */
export function createDeclaredOutputExistenceStageRunner(config: DeclaredOutputExistenceStageConfig): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();
		const missingFiles: string[] = [];

		if (!config.checkFilesystemExistence) {
			return createPassedStageVerdict(
				"DeclaredOutputExistence",
				{ note: "filesystem check disabled", fileCount: config.declaredOutputFiles.length },
				Date.now() - startTime,
			);
		}

		for (const declaredFile of config.declaredOutputFiles) {
			const absolutePath = path.resolve(config.repoRoot, declaredFile);
			if (!fs.existsSync(absolutePath)) {
				missingFiles.push(declaredFile);
			}
		}

		if (missingFiles.length > 0) {
			return createFailedStageVerdict(
				"DeclaredOutputExistence",
				missingFiles.map((f) => `Declared output file not found: ${f}`),
				{
					filesystemCheck: true,
					missingFiles,
					declaredCount: config.declaredOutputFiles.length,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		return createPassedStageVerdict(
			"DeclaredOutputExistence",
			{
				filesystemCheck: true,
				fileCount: config.declaredOutputFiles.length,
				allFilesExist: true,
			},
			Date.now() - startTime,
		);
	};
}
