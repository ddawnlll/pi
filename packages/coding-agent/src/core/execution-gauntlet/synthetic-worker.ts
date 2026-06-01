/**
 * Synthetic Worker — P38.1
 *
 * Controlled deterministic worker behaviors for execution gauntlet scenarios.
 * No real LLM calls. Workers produce deterministic artifacts and exit codes
 * based on seed-controlled behavior selection.
 *
 * Each behavior type corresponds to a known failure or success pattern
 * observed in production.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * Simple mulberry32 PRNG for deterministic randomness under seed.
 */
export function createRng(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------
// Synthetic worker behaviors
// ---------------------------------------------------------------------------

export type SyntheticWorkerBehavior =
	| "success"
	| "half_done"
	| "missing_command_history"
	| "wrong_test_path"
	| "no_tests_found_exit_zero"
	| "late_complete_after_reset"
	| "repeat_same_failure"
	| "validation_fail_then_repair"
	| "patch_non_overlapping"
	| "patch_write_set_violation"
	| "patch_stale_hash"
	| "timeout"
	| "memory_killed"
	| "instant_failure"
	| "unstable_failure_signature";

// ---------------------------------------------------------------------------
// Command execution result
// ---------------------------------------------------------------------------

export interface SyntheticCommandResult {
	/** Exit code */
	exitCode: number;
	/** Combined stdout + stderr */
	output: string;
	/** Whether this command should be recorded in command history */
	recordInHistory: boolean;
	/** Duration in ms */
	durationMs: number;
}

export interface SyntheticRunResult {
	/** Exit code */
	exitCode: number;
	/** Worker output */
	output: string;
	/** Command history entries */
	commandHistory: Array<{
		command: string;
		exitCode: number | null;
		outputSummary: string;
	}>;
	/** Files created (path -> content) */
	filesCreated: Record<string, string>;
	/** Patch artifact data (for patch_transaction mode) */
	patchArtifact?: {
		writeSet: string[];
		patches: Array<{ filePath: string; content: string }>;
		baseVersion?: string;
	};
	/** Files not in writeSet that patch touches (for writeSet violation testing) */
	patchLeakedFiles?: string[];
	/** Whether worker sends stale completion after workspace reset */
	staleCompletionSent?: boolean;
	/** Delay before stale completion in ms */
	staleCompletionDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Behavior implementations
// ---------------------------------------------------------------------------

/**
 * Create a synthetic worker that behaves deterministically based on behavior type and seed.
 */
export function createSyntheticWorker(
	behavior: SyntheticWorkerBehavior,
	options: {
		seed: number;
		workspaceId: string;
		workspaceDir: string;
		targetCommand?: string;
		/** For patch_transaction: declared writeSet */
		writeSet?: string[];
		/** Base version for patch */
		baseVersion?: string;
		/** If true, repair run — returns success for validation_fail_then_repair */
		isRepair?: boolean;
	},
): () => Promise<SyntheticRunResult> {
	const rng = createRng(options.seed);

	return async () => {
		switch (behavior) {
			case "success":
				return runSuccess(options, rng);
			case "half_done":
				return runHalfDone(options, rng);
			case "missing_command_history":
				return runMissingCommandHistory(options, rng);
			case "wrong_test_path":
				return runWrongTestPath(options, rng);
			case "no_tests_found_exit_zero":
				return runNoTestsFoundExitZero(options, rng);
			case "late_complete_after_reset":
				return runLateCompleteAfterReset(options, rng);
			case "repeat_same_failure":
				return runRepeatSameFailure(options, rng);
			case "validation_fail_then_repair":
				return runValidationFailThenRepair(options, rng);
			case "patch_non_overlapping":
				return runPatchNonOverlapping(options, rng);
			case "patch_write_set_violation":
				return runPatchWriteSetViolation(options, rng);
			case "patch_stale_hash":
				return runPatchStaleHash(options, rng);
			case "timeout":
				return runTimeout(options, rng);
			case "memory_killed":
				return runMemoryKilled(options, rng);
			case "instant_failure":
				return runInstantFailure(options, rng);
			case "unstable_failure_signature":
				return runUnstableFailureSignature(options, rng);
		}
	};
}

// ---------------------------------------------------------------------------
// Behavior: success
// ---------------------------------------------------------------------------

async function runSuccess(
	opts: { workspaceId: string; workspaceDir: string; targetCommand?: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const cmd = opts.targetCommand ?? "npm test";
	const files = createHelloFiles(opts.workspaceDir);

	for (const [p, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content, "utf-8");
	}

	return {
		exitCode: 0,
		output: `PASS src/hello.test.ts\nTests: 1 passed, 1 total`,
		commandHistory: [{ command: cmd, exitCode: 0, outputSummary: "Tests: 1 passed, 1 total" }],
		filesCreated: files,
	};
}

// ---------------------------------------------------------------------------
// Behavior: half_done
// ---------------------------------------------------------------------------

async function runHalfDone(
	opts: { workspaceId: string; workspaceDir: string; targetCommand?: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	// Create source file but no test file
	const srcDir = path.join(opts.workspaceDir, "src");
	await fs.mkdir(srcDir, { recursive: true });
	const srcFile = path.join(srcDir, "module.ts");
	await fs.writeFile(srcFile, "export const x = 1;\n", "utf-8");

	return {
		exitCode: 0,
		output: "Implementation created but no test file written.",
		commandHistory: [{ command: "npx tsgo src/module.ts", exitCode: 0, outputSummary: "OK" }],
		filesCreated: { [srcFile]: "export const x = 1;\n" },
	};
}

// ---------------------------------------------------------------------------
// Behavior: missing_command_history
// ---------------------------------------------------------------------------

async function runMissingCommandHistory(
	opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const files = createHelloFiles(opts.workspaceDir);
	for (const [p, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content, "utf-8");
	}

	return {
		exitCode: 0,
		output: "Implementation done.",
		commandHistory: [], // Intentionally empty
		filesCreated: files,
	};
}

// ---------------------------------------------------------------------------
// Behavior: wrong_test_path
// ---------------------------------------------------------------------------

async function runWrongTestPath(
	opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const files = createHelloFiles(opts.workspaceDir);
	for (const [p, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content, "utf-8");
	}

	return {
		exitCode: 1,
		output: `Error: Cannot find module './src/wrong-path.test.ts'`,
		commandHistory: [
			{ command: "npx vitest run src/wrong-path.test.ts", exitCode: 1, outputSummary: "Cannot find module" },
		],
		filesCreated: files,
	};
}

// ---------------------------------------------------------------------------
// Behavior: no_tests_found_exit_zero
// ---------------------------------------------------------------------------

async function runNoTestsFoundExitZero(
	opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const srcDir = path.join(opts.workspaceDir, "src");
	await fs.mkdir(srcDir, { recursive: true });
	const srcFile = path.join(srcDir, "module.ts");
	await fs.writeFile(srcFile, "export const x = 1;\n", "utf-8");

	return {
		exitCode: 0,
		output: "No test files found matching pattern '**/*.test.ts'",
		commandHistory: [
			{
				command: "npx vitest run",
				exitCode: 0,
				outputSummary: "No test files found matching pattern '**/*.test.ts'",
			},
		],
		filesCreated: { [srcFile]: "export const x = 1;\n" },
	};
}

// ---------------------------------------------------------------------------
// Behavior: late_complete_after_reset
// ---------------------------------------------------------------------------

async function runLateCompleteAfterReset(
	opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const files = createHelloFiles(opts.workspaceDir);
	for (const [p, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content, "utf-8");
	}

	return {
		exitCode: 0,
		output: "COMPLETE (stale - workspace already reset)",
		commandHistory: [{ command: "npm test", exitCode: 0, outputSummary: "Tests passed" }],
		filesCreated: files,
		staleCompletionSent: true,
		staleCompletionDelayMs: 5000,
	};
}

// ---------------------------------------------------------------------------
// Behavior: repeat_same_failure
// ---------------------------------------------------------------------------

async function runRepeatSameFailure(
	_opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	return {
		exitCode: 1,
		output: "Completion gate blocked: Target command has not been executed: npm test",
		commandHistory: [],
		filesCreated: {},
	};
}

// ---------------------------------------------------------------------------
// Behavior: validation_fail_then_repair
// ---------------------------------------------------------------------------

async function runValidationFailThenRepair(
	opts: { workspaceId: string; workspaceDir: string; isRepair?: boolean },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const files = createHelloFiles(opts.workspaceDir);
	for (const [p, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content, "utf-8");
	}

	// Deterministic: isRepair flag controls pass/fail
	if (opts.isRepair) {
		return {
			exitCode: 0,
			output: `PASS src/hello.test.ts\nTests: 1 passed, 1 total`,
			commandHistory: [{ command: "npm test", exitCode: 0, outputSummary: "Tests: 1 passed, 1 total" }],
			filesCreated: files,
		};
	}

	return {
		exitCode: 1,
		output: `FAIL src/hello.test.ts\n  expected 'hello world' to equal 'hello World'\nTests: 1 failed, 1 total`,
		commandHistory: [{ command: "npm test", exitCode: 1, outputSummary: "Tests: 1 failed, 1 total" }],
		filesCreated: files,
	};
}

// ---------------------------------------------------------------------------
// Behavior: patch_non_overlapping
// ---------------------------------------------------------------------------

async function runPatchNonOverlapping(
	opts: { workspaceId: string; workspaceDir: string; writeSet?: string[] },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const writeSet = opts.writeSet ?? ["src/file-a.ts", "src/file-b.ts"];
	const patches = writeSet.map((fp) => {
		const fullPath = path.join(opts.workspaceDir, fp);
		return { filePath: fullPath, content: `// patched: ${fp}\nexport const patched = true;\n` };
	});

	return {
		exitCode: 0,
		output: "Patches generated successfully.",
		commandHistory: [{ command: "npm run codegen", exitCode: 0, outputSummary: "3 patches generated" }],
		filesCreated: {},
		patchArtifact: {
			writeSet,
			patches,
			baseVersion: "abc123",
		},
	};
}

// ---------------------------------------------------------------------------
// Behavior: patch_write_set_violation
// ---------------------------------------------------------------------------

async function runPatchWriteSetViolation(
	opts: { workspaceId: string; workspaceDir: string; writeSet?: string[] },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const writeSet = opts.writeSet ?? ["src/file-a.ts"];
	// Patch touches file-b.ts which is NOT in writeSet
	const patches = [
		{ filePath: path.join(opts.workspaceDir, "src/file-a.ts"), content: "// patched: src/file-a.ts\n" },
		{ filePath: path.join(opts.workspaceDir, "src/file-b.ts"), content: "// leaked: src/file-b.ts\n" },
	];

	return {
		exitCode: 0,
		output: "Patches generated.",
		commandHistory: [{ command: "npm run codegen", exitCode: 0, outputSummary: "2 patches generated" }],
		filesCreated: {},
		patchArtifact: {
			writeSet,
			patches,
			baseVersion: "abc123",
		},
		patchLeakedFiles: ["src/file-b.ts"],
	};
}

// ---------------------------------------------------------------------------
// Behavior: patch_stale_hash
// ---------------------------------------------------------------------------

async function runPatchStaleHash(
	opts: { workspaceId: string; workspaceDir: string; writeSet?: string[] },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	const writeSet = opts.writeSet ?? ["src/file-a.ts"];
	const patches = [
		{ filePath: path.join(opts.workspaceDir, "src/file-a.ts"), content: "// patched: src/file-a.ts\n" },
	];

	return {
		exitCode: 0,
		output: "Patches generated with stale base hash.",
		commandHistory: [{ command: "npm run codegen", exitCode: 0, outputSummary: "1 patch generated (stale base)" }],
		filesCreated: {},
		patchArtifact: {
			writeSet,
			patches,
			baseVersion: "stale_hash_000", // Stale hash
		},
	};
}

// ---------------------------------------------------------------------------
// Behavior: timeout
// ---------------------------------------------------------------------------

async function runTimeout(
	_opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	return {
		exitCode: 124, // Standard timeout exit code
		output: "Command timed out after 300000ms",
		commandHistory: [],
		filesCreated: {},
	};
}

// ---------------------------------------------------------------------------
// Behavior: memory_killed
// ---------------------------------------------------------------------------

async function runMemoryKilled(
	_opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	return {
		exitCode: 137, // SIGKILL (128 + 9)
		output: "Killed: process exceeded memory limit",
		commandHistory: [],
		filesCreated: {},
	};
}

// ---------------------------------------------------------------------------
// Behavior: instant_failure
// ---------------------------------------------------------------------------

/**
 * Worker fails instantly (0s duration) with the same error every time.
 * Used to test the runaway retry loop guard and instant-failure detection.
 */
async function runInstantFailure(
	_opts: { workspaceId: string; workspaceDir: string },
	_rng: () => number,
): Promise<SyntheticRunResult> {
	return {
		exitCode: 1,
		output: "Preflight check failed: planExecutionId not set for worktree-based execution",
		commandHistory: [],
		filesCreated: {},
	};
}

// ---------------------------------------------------------------------------
// Behavior: unstable_failure_signature
// ---------------------------------------------------------------------------

/**
 * Worker fails with the same root cause but different error messages
 * (e.g., changing path, timestamp, attempt ID in the message).
 * Used to test that the normalized failure signature guard catches
 * semantically identical failures despite noisy messages.
 */
async function runUnstableFailureSignature(
	opts: { workspaceId: string; workspaceDir: string },
	rng: () => number,
): Promise<SyntheticRunResult> {
	// Generate a different temp path or attempt-id-like suffix each call
	const noise = Math.floor(rng() * 100000);
	return {
		exitCode: 1,
		output: `Cannot find module '${opts.workspaceDir}/.cache/attempt-${noise}/main.ts'`,
		commandHistory: [
			{
				command: "npx tsx src/main.ts",
				exitCode: 1,
				outputSummary: `Cannot find module 'main.ts' (attempt ${noise})`,
			},
		],
		filesCreated: {},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHelloFiles(workspaceDir: string): Record<string, string> {
	return {
		[path.join(workspaceDir, "src", "hello.ts")]: 'export function hello(): string { return "hello world"; }\n',
		[path.join(workspaceDir, "src", "hello.test.ts")]:
			'import { hello } from "./hello.js";\nif (hello() !== "hello world") { throw new Error("fail"); }\n',
	};
}
