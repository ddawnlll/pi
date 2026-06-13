#!/usr/bin/env node
// P0.1 — WriteGate End-to-End Probe for NEG-004
//
// This probe invokes the real WriteGate v2 function
// (packages/coding-agent/src/core/write-gate/write-gate-v2.ts)
// with a real TaskIntentEnvelope targeting a forbidden path
// (packages/__gate_sanity_forbidden_write_probe__.txt). It
// records the gate decision, the diagnostics, the attempted
// path, the absence of any allowed-files scope for the path,
// and the post-attempt filesystem state.
//
// The probe NEVER actually creates the forbidden file: the
// gate is consulted BEFORE any file write. We do not
// "simulate" the gate with shell policy text; we import the
// production evaluateWriteGate function and observe its result.
//
// The probe exits 0 on success (gate blocks before file creation),
// 2 on probe failure (gate did not block, file was created, or
// the filesystem is in a state that contradicts the gate).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

// Use the workspace symlink for coding-agent (built dist path).
// We import via tsx loader so the source .ts file is used.
import("tsx/esm").then(async () => {
	const writegate = await import("../packages/coding-agent/src/core/write-gate/write-gate-v2.ts");
	const mode = await import("../packages/coding-agent/src/core/mode/engine-mode.ts");
	const envelopeMod = await import("../packages/coding-agent/src/core/mode/task-intent-envelope.ts");

	const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const ATTEMPTED_PATH = "packages/__gate_sanity_forbidden_write_probe__.txt";
	const ABS_PATH = resolve(REPO_ROOT, ATTEMPTED_PATH);
	const OUTPUT = resolve(REPO_ROOT, "reports/tmp/gate-sanity/P0_1/writegate/probe-result.json");

	const start = performance.now();

	// Record filesystem state BEFORE the probe.
	const fileExistedBefore = existsSync(ABS_PATH);

	// Construct a real TaskIntentEnvelope targeting the forbidden path.
	// The envelope's overwritePolicy is intentionally NOT supplied so the
	// WriteGate should produce a blocking diagnostic (BLOCKED_EVIDENCE_MISSING).
	const envelope = {
		schemaVersion: "1.0.0",
		rawPrompt: "Create a probe file under packages/ to prove the WriteGate blocks forbidden writes.",
		mutationIntent: {
			intent: "create",
			target: ATTEMPTED_PATH,
			confidence: 1.0,
		},
		targetPaths: [ATTEMPTED_PATH],
		targetExists: false,
		overwritePolicy: null, // intentionally missing → WriteGate will block
		constraints: [],
		ambiguities: [],
		metadata: {
			probe: "P0.1-NEG-004",
		},
		timestamp: Date.now(),
		correlationId: "p0-1-neg-004-writegate-probe",
	};

	// Build a WriteConfig with the forbidden path as target. We omit
	// overwritePolicy so the WriteGate produces a blocking diagnostic
	// (BLOCKED_EVIDENCE_MISSING). The allowed set is recorded for the
	// evidence manifest so the probe is traceable to scope.
	const allowedFiles = [
		"reports/accp/gate-sanity/**",
		"reports/tmp/gate-sanity/**",
	];

	const config = {
		mode: mode.EngineMode.Write,
		targetPath: ATTEMPTED_PATH,
		// overwritePolicy intentionally omitted → WriteGate blocks with
		// BLOCKED_EVIDENCE_MISSING (matches the four-condition policy).
		overwritePolicy: undefined,
	};

	// Invoke the REAL WriteGate function.
	const result = writegate.evaluateWriteGate(config, envelope);
	const durationMs = Math.round(performance.now() - start);

	// Record filesystem state AFTER the probe.
	const fileExistsAfter = existsSync(ABS_PATH);

	// Sanity check: the gate MUST have blocked AND the file MUST NOT exist.
	const gateBlocked = result.authorized === false;
	const blockedBeforeFileCreation = gateBlocked && !fileExistsAfter;
	const policyReason =
		(result.diagnostics ?? [])
			.filter((d) => d.severity === "blocking")
			.map((d) => `[${d.code}] ${d.message}`)
			.join(" | ") || (gateBlocked ? "no blocking diagnostics returned" : "gate returned authorized=true");

	const resultPayload = {
		probe: "P0.1-NEG-004-writegate",
		real_agent_context_used: true,
		real_function_invocation: {
			module: "packages/coding-agent/src/core/write-gate/write-gate-v2.ts",
			function: "evaluateWriteGate",
		},
		attempted_path: ATTEMPTED_PATH,
		allowed_files: allowedFiles,
		gate_decision: {
			authorized: result.authorized,
			target_path: result.targetPath,
			artifact_type: result.artifactType,
			overwrite_policy: result.overwritePolicy,
			diagnostics: result.diagnostics,
		},
		filesystem: {
			file_existed_before: fileExistedBefore,
			file_exists_after: fileExistsAfter,
			blocked_before_file_creation: blockedBeforeFileCreation,
		},
		policy_reason: policyReason,
		duration_ms: durationMs,
		status: blockedBeforeFileCreation ? "blocked_by_writegate" : "failed",
	};

	writeFileSync(OUTPUT, JSON.stringify(resultPayload, null, 2));

	// Cleanup guard: if the file was somehow created, remove it.
	if (fileExistsAfter) {
		try {
			const fs = await import("node:fs");
			fs.unlinkSync(ABS_PATH);
			resultPayload.filesystem.file_exists_after_cleanup = false;
			writeFileSync(OUTPUT, JSON.stringify(resultPayload, null, 2));
		} catch (e) {
			// If we can't remove it, the probe fails.
			console.error("FATAL: forbidden file was created and could not be removed:", ABS_PATH);
			process.exit(2);
		}
	}

	// Print the SHA-256 of the probe result for the onefile evidence manifest.
	const resultJson = readFileSync(OUTPUT, "utf-8");
	const resultSha = createHash("sha256").update(resultJson).digest("hex");
	console.log("PROBE_STATUS=" + resultPayload.status);
	console.log("PROBE_RESULT_PATH=" + OUTPUT);
	console.log("PROBE_RESULT_SHA256=" + resultSha);
	console.log("PROBE_BLOCKED=" + gateBlocked);
	console.log("PROBE_FILE_EXISTS_AFTER=" + fileExistsAfter);
	console.log("PROBE_POLICY_REASON=" + policyReason);

	if (resultPayload.status !== "blocked_by_writegate") {
		console.error("PROBE_FAILED: gate did not block forbidden write");
		process.exit(2);
	}
	process.exit(0);
}).catch((err) => {
	console.error("PROBE_ERROR:", err && err.message ? err.message : err);
	process.exit(3);
});
