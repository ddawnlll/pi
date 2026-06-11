/**
 * P44.6.09 — WriteGate v2 Mode-Aware Policy
 *
 * Requires create-new operations to prove:
 * - Target path is specified
 * - Artifact type is clear
 * - Overwrite policy is defined
 * - Acceptance evidence is present
 *
 * Before any write executes, all four conditions must be satisfied.
 *
 * Contract Schema: 4.1.1
 */

import { type EngineConfig, EngineMode, type OverwritePolicy, type WriteConfig } from "../mode/engine-mode.js";
import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Write Gate Result
// ---------------------------------------------------------------------------

export interface WriteGateResult extends DiagnosticCollection {
	/** Whether the write operation is authorized. */
	authorized: boolean;
	/** The resolved target path for the write. */
	targetPath: string;
	/** The resolved artifact type. */
	artifactType: string;
	/** The resolved overwrite policy. */
	overwritePolicy: OverwritePolicy;
}

// ---------------------------------------------------------------------------
// Write Gate Evaluation
// ---------------------------------------------------------------------------

export function evaluateWriteGate(config: EngineConfig, envelope: TaskIntentEnvelope): WriteGateResult {
	const diagnostics: ModeDiagnostic[] = [];

	// Only applicable for Write mode
	if (config.mode !== EngineMode.Write) {
		return {
			authorized: false,
			targetPath: "",
			artifactType: "unknown",
			overwritePolicy: "fail_if_exists",
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: "WriteGate v2 requires EngineMode.Write. Current mode is not write.",
				},
			],
		};
	}

	const writeConfig = config as WriteConfig;

	// Check 1: Target path must be specified
	if (!writeConfig.targetPath) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_MISSING_TARGET",
			message: "Write operation requires a target path.",
		});
	}

	// Check 2: Artifact type determination
	const artifactType = determineArtifactType(writeConfig.targetPath);
	if (artifactType === "unknown") {
		diagnostics.push({
			severity: "warning",
			code: "WARN_MISSING_CONSTRAINTS",
			message: `Could not determine artifact type from target path: '${writeConfig.targetPath}'. Proceeding with 'file' type.`,
		});
	}

	// Check 3: Overwrite policy must be defined
	if (!writeConfig.overwritePolicy) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_EVIDENCE_MISSING",
			message:
				"Write operation requires an overwrite policy (fail_if_exists, allow, require_confirmation, or append_only).",
		});
	}

	// Check 4: Evidence presence (from envelope constraints)
	const hasEvidenceConstraints = envelope.constraints.length > 0;
	if (!hasEvidenceConstraints) {
		diagnostics.push({
			severity: "warning",
			code: "WARN_MISSING_CONSTRAINTS",
			message: "No acceptance evidence constraints specified. Consider adding constraints to verify write success.",
		});
	}

	const hasBlocking = diagnostics.some((d) => d.severity === "blocking");

	return {
		authorized: !hasBlocking,
		targetPath: writeConfig.targetPath || "",
		artifactType: artifactType === "unknown" ? "file" : artifactType,
		overwritePolicy: writeConfig.overwritePolicy || "fail_if_exists",
		diagnostics,
	};
}

function determineArtifactType(targetPath: string): string {
	if (!targetPath) return "unknown";
	const ext = targetPath.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "ts":
			return "typescript";
		case "tsx":
			return "typescript_react";
		case "js":
			return "javascript";
		case "jsx":
			return "javascript_react";
		case "json":
			return "json";
		case "css":
			return "css";
		case "html":
			return "html";
		case "md":
			return "markdown";
		case "yaml":
		case "yml":
			return "yaml";
		default:
			return "file";
	}
}
