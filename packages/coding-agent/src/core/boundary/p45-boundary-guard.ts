/**
 * P44.6.35 — P45 Boundary Guard
 *
 * Runtime-enforceable check that forbids implementation changes to:
 * - packages/coding-agent/src/p45/**
 * - packages/coding-agent/src/async-assembly/**
 * - packages/coding-agent/src/static-partitioner/**
 * - packages/coding-agent/src/deterministic-assembler/**
 *
 * The guard is a runtime-enforceable check (not just documentation).
 * It checks file paths against forbidden patterns and returns
 * blocking diagnostics if a forbidden path is touched.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Forbidden Paths
// ---------------------------------------------------------------------------

const FORBIDDEN_PREFIXES = [
	"packages/coding-agent/src/p45/",
	"packages/coding-agent/src/async-assembly/",
	"packages/coding-agent/src/static-partitioner/",
	"packages/coding-agent/src/deterministic-assembler/",
];

// ---------------------------------------------------------------------------
// Check Result
// ---------------------------------------------------------------------------

export interface P45BoundaryCheckResult extends DiagnosticCollection {
	/** Whether the operation crosses the P45 boundary. */
	boundaryCrossed: boolean;
	/** Forbidden paths that were detected. */
	forbiddenPaths: string[];
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export function checkP45Boundary(targetPaths: string[]): P45BoundaryCheckResult {
	const diagnostics: ModeDiagnostic[] = [];
	const forbiddenPaths: string[] = [];

	for (const targetPath of targetPaths) {
		const normalized = targetPath.replace(/\\/g, "/");
		for (const forbidden of FORBIDDEN_PREFIXES) {
			if (normalized.startsWith(forbidden) || normalized.includes(forbidden)) {
				forbiddenPaths.push(targetPath);
				diagnostics.push({
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: `P45 boundary violation: '${targetPath}' is in a forbidden path ('${forbidden}'). P44.6 must not implement any P45 async assembly runtime code.`,
				});
				break;
			}
		}
	}

	return {
		boundaryCrossed: forbiddenPaths.length > 0,
		forbiddenPaths,
		diagnostics,
	};
}
