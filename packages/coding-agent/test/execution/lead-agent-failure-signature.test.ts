/**
 * Lead Agent Failure Signature Tests — P38.LEAD
 *
 * Tests that failure signatures are deterministic and correctly classified.
 */
import { describe, expect, it } from "vitest";
import { classifyFailure } from "../../src/core/lead-agent/failure-classifier.js";
import { buildFailureSignatureString } from "../../src/core/lead-agent/failure-signature.js";

describe("buildFailureSignatureString", () => {
	it("extracts target command not executed signature", () => {
		const sig = buildFailureSignatureString({
			errorMessage:
				"Completion gate blocked: Target command has not been executed: npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		expect(sig).toBe(
			"completion_gate:target_command_not_executed:packages/coding-agent/test/execution/patch-coordinator.test.ts",
		);
	});

	it("extracts no tests found exit zero signature", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "No test files found, exiting with code 0",
		});
		expect(sig).toMatch(/^validation:no_tests_found_exit_zero:/);
	});

	it("extracts FSM illegal transition PENDING -> SUCCEEDED", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "Illegal attempt transition: PENDING -> SUCCEEDED",
		});
		expect(sig).toBe("fsm:illegal_transition:PENDING->SUCCEEDED");
	});

	it("extracts FSM illegal transition SUCCEEDED -> RUNNING", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "Illegal attempt transition: SUCCEEDED -> RUNNING",
		});
		expect(sig).toBe("fsm:illegal_transition:SUCCEEDED->RUNNING");
	});

	it("produces same signature for same error message", () => {
		const msg =
			"Completion gate blocked: Target command has not been executed: npm test -- packages/foo/test/bar.test.ts";
		const sig1 = buildFailureSignatureString({ errorMessage: msg });
		const sig2 = buildFailureSignatureString({ errorMessage: msg });
		expect(sig1).toBe(sig2);
	});

	it("produces distinct signatures for different test files", () => {
		const sig1 = buildFailureSignatureString({
			errorMessage:
				"Completion gate blocked: Target command has not been executed: npm test -- packages/foo/test/a.test.ts",
		});
		const sig2 = buildFailureSignatureString({
			errorMessage:
				"Completion gate blocked: Target command has not been executed: npm test -- packages/foo/test/b.test.ts",
		});
		expect(sig1).not.toBe(sig2);
	});

	it("detects memory limit signatures", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "Worker killed: memory limit exceeded (SIGKILL)",
			lastCommand: "npm test --maxWorkers=4",
		});
		expect(sig).toMatch(/^process:memory_limit:/);
	});

	it("detects file lock stuck signatures", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "File lock stuck for src/index.ts",
		});
		expect(sig).toBe("file_lock:stuck:generic");
	});

	it("falls back to deterministic hash for unknown errors", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "Something completely unexpected went wrong",
		});
		expect(sig).toMatch(/^unknown:[a-f0-9]{8}$/);
	});

	it("detects command history empty signature", () => {
		const sig = buildFailureSignatureString({
			errorMessage: "Completion gate blocked: commandHistory is empty",
		});
		expect(sig).toMatch(/^completion_gate:command_history_missing:/);
	});
});

describe("classifyFailure", () => {
	it("classifies target_command_not_executed", () => {
		const cls = classifyFailure({
			errorMessage:
				"Completion gate blocked: Target command has not been executed: npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		expect(cls).toBe("target_command_not_executed");
	});

	it("classifies no_tests_found_exit_zero", () => {
		const cls = classifyFailure({
			errorMessage: "No test files found, exiting with code 0",
		});
		expect(cls).toBe("no_tests_found_exit_zero");
	});

	it("classifies no_tests_found_exit_zero from command history", () => {
		const cls = classifyFailure({
			errorMessage: "Validation failed",
			commandHistory: [{ command: "npm test", exitCode: 0, noTestsFoundDetected: true }],
		});
		expect(cls).toBe("no_tests_found_exit_zero");
	});

	it("classifies stale_attempt_completion for PENDING->SUCCEEDED", () => {
		const cls = classifyFailure({
			errorMessage: "Illegal attempt transition: PENDING -> SUCCEEDED",
		});
		expect(cls).toBe("stale_attempt_completion");
	});

	it("classifies attempt_cache_retry_bug for SUCCEEDED->RUNNING", () => {
		const cls = classifyFailure({
			errorMessage: "Illegal attempt transition: SUCCEEDED -> RUNNING",
		});
		expect(cls).toBe("attempt_cache_retry_bug");
	});

	it("classifies illegal_attempt_transition for other transitions", () => {
		const cls = classifyFailure({
			errorMessage: "Illegal attempt transition: RUNNING -> SUCCEEDED",
		});
		expect(cls).toBe("illegal_attempt_transition");
	});

	it("classifies memory_limit_or_process_killed", () => {
		const cls = classifyFailure({
			errorMessage: "Process killed: memory limit reached (rss 2048MB)",
		});
		expect(cls).toBe("memory_limit_or_process_killed");
	});

	it("classifies file_lock_stuck", () => {
		const cls = classifyFailure({
			errorMessage: "File lock conflict detected",
		});
		expect(cls).toBe("file_lock_stuck");
	});

	it("classifies queue_snapshot_missing", () => {
		const cls = classifyFailure({
			errorMessage: "Queue snapshot is missing for plan",
		});
		expect(cls).toBe("queue_snapshot_missing");
	});

	it("classifies command_history_missing when no specific target command path is given", () => {
		const cls = classifyFailure({
			errorMessage: "Completion gate blocked: commandHistory is empty, no commands were recorded",
			commandHistory: [],
		});
		expect(cls).toBe("command_history_missing");
	});

	it("classifies completion_gate_blocked for general gate blocks", () => {
		const cls = classifyFailure({
			errorMessage: "Completion gate blocked: Unresolved test failures: FAIL test/foo.test.ts",
		});
		expect(cls).toBe("completion_gate_blocked");
	});

	it("returns unknown for unrecognized errors", () => {
		const cls = classifyFailure({
			errorMessage: "Something went wrong",
		});
		expect(cls).toBe("unknown");
	});
});
