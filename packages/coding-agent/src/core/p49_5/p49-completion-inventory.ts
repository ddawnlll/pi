/**
 * P49.5.01 — P49 Completion Artifact Inventory and Readiness Input Contract
 *
 * Produces a deterministic inventory of P49 outputs that P45 depends on:
 * ACCP compiler package availability, route-signal compiler, gate-verdict compiler,
 * artifact writer, report registry, runtime reads compiled JSON only,
 * event/read-model visibility, and required/warn mode behavior.
 *
 * The inventory records paths, hashes where available, and freshness metadata.
 * It does not assume P49 success from the plan existing; it must inspect
 * artifacts and test-visible exports.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// =============================================================================
// Types
// =============================================================================

export interface P49ArtifactInventoryEntry {
	path: string;
	exists: boolean;
	fileHash?: string;
	lastModified?: string;
	notes?: string;
}

export interface P49ArtifactInventory {
	schemaVersion: string;
	generatedAt: string;
	repoRoot: string;
	artifacts: Record<string, P49ArtifactInventoryEntry>;
	summary: {
		total: number;
		existing: number;
		missing: number;
	};
}

// =============================================================================
// P49 Artifact Paths to Inspect
// =============================================================================

/**
 * P49 outputs that P45 depends on. These are inspected, not assumed.
 */
const P49_ARTIFACT_PATHS: Record<string, string> = {
	// ACCP compiler package
	accpCompilerIndex: "packages/accp-compiler/src/index.ts",
	accpCompilerPackageJson: "packages/accp-compiler/package.json",

	// ACCP route signal compiler
	accpRouteCompiler: "packages/coding-agent/src/core/smart-write/route-signal-compiler.ts",

	// ACCP gate verdict
	accpGateStageRunner: "packages/coding-agent/src/core/accp-gate-stage-runner.ts",

	// ACCP artifact writer
	accpArtifactStore: "packages/coding-agent/src/core/accp-artifact-store.ts",
	accpPromptRenderer: "packages/coding-agent/src/core/accp-prompt-renderer.ts",
	accpRouteBus: "packages/coding-agent/src/core/accp-route-bus.ts",

	// ACCP report validator
	accpReportValidator: "packages/coding-agent/src/core/accp/mode-report-validator.ts",

	// ACCP CAR correction path
	accpCarCorrection: "packages/coding-agent/src/core/accp/car-correction-path.ts",

	// Completion gate V2
	completionGateV2: "packages/coding-agent/src/core/completion/completion-gate-v2.ts",

	// Evidence ledger
	evidenceLedger: "packages/coding-agent/src/core/completion/evidence-ledger.ts",

	// Acceptance criteria
	acceptanceCriteria: "packages/coding-agent/src/core/completion/acceptance-criteria.ts",

	// Worker report contract
	workerReportContract: "packages/coding-agent/src/core/completion/worker-report-contract.ts",

	// Terminal verdict parser
	terminalVerdictParser: "packages/coding-agent/src/core/completion/terminal-verdict-parser.ts",

	// P45 boundary guard
	p45BoundaryGuard: "packages/coding-agent/src/core/boundary/p45-boundary-guard.ts",

	// P495 readiness guard
	p495ReadinessGuard: "packages/coding-agent/src/core/bridge/p495-readiness-guard.ts",

	// p495 artifact export
	p495ArtifactExport: "packages/coding-agent/src/core/bridge/p495-artifact-export.ts",
};

// =============================================================================
// Inventory Builder
// =============================================================================

/**
 * Compute SHA-256 hash of a file's contents.
 */
async function sha256File(filePath: string): Promise<string | undefined> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		return createHash("sha256").update(content, "utf-8").digest("hex");
	} catch {
		return undefined;
	}
}

/**
 * Check if a file exists and get its stats.
 */
async function inspectArtifact(
	_artifactKey: string,
	relativePath: string,
	repoRoot: string,
): Promise<P49ArtifactInventoryEntry> {
	const absPath = path.resolve(repoRoot, relativePath);
	try {
		const stat = await fs.stat(absPath);
		const fileHash = await sha256File(absPath);
		return {
			path: relativePath,
			exists: true,
			fileHash,
			lastModified: stat.mtime.toISOString(),
		};
	} catch {
		return {
			path: relativePath,
			exists: false,
			notes: "File not found on disk",
		};
	}
}

/**
 * Build the full P49 artifact inventory.
 */
export async function buildP49ArtifactInventory(
	repoRoot: string,
	options?: { additionalPaths?: Record<string, string> },
): Promise<P49ArtifactInventory> {
	const allPaths = { ...P49_ARTIFACT_PATHS, ...(options?.additionalPaths ?? {}) };
	const artifactEntries: Record<string, P49ArtifactInventoryEntry> = {};

	for (const [key, relPath] of Object.entries(allPaths)) {
		artifactEntries[key] = await inspectArtifact(key, relPath, repoRoot);
	}

	const existing = Object.values(artifactEntries).filter((e) => e.exists).length;
	const missing = Object.values(artifactEntries).filter((e) => !e.exists).length;

	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		repoRoot,
		artifacts: artifactEntries,
		summary: {
			total: Object.keys(artifactEntries).length,
			existing,
			missing,
		},
	};
}

/**
 * Check P49 readiness based on inventory.
 * Returns true only if ALL critical ACCP artifacts exist.
 */
export function isP49Ready(inventory: P49ArtifactInventory): boolean {
	const criticalKeys = [
		"accpCompilerIndex",
		"accpRouteCompiler",
		"accpGateStageRunner",
		"accpArtifactStore",
		"accpPromptRenderer",
		"accpRouteBus",
		"accpReportValidator",
		"completionGateV2",
		"evidenceLedger",
		"acceptanceCriteria",
	];
	for (const key of criticalKeys) {
		const entry = inventory.artifacts[key];
		if (!entry?.exists) {
			return false;
		}
	}
	return true;
}
