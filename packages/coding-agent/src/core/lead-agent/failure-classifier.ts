/**
 * Failure Classifier — P38.LEAD
 *
 * Pure, deterministic classification of failure messages into known failure classes.
 * The classifier examines error messages, completion gate block reasons, command
 * history, and exit codes to determine the most likely failure category.
 *
 * All classification rules are pure functions — no side effects, no I/O.
 */

import type { FailureClass } from "./types.js";

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/**
 * Classify an error message into a FailureClass.
 *
 * Rules are checked in priority order. The first matching rule wins.
 *
 * @param errorMessage - The error message from the worker
 * @param completionGateBlockReasons - Completion gate block reasons (if any)
 * @param commandHistory - Recent command history entries
 * @param lastCommand - Last command executed (if any)
 * @param lastCommandExitCode - Exit code of last command (if any)
 * @returns Classified failure class
 */
export function classifyFailure(params: {
	errorMessage: string;
	completionGateBlockReasons?: string[];
	commandHistory?: Array<{ command: string; exitCode: number | null; noTestsFoundDetected?: boolean }>;
	lastCommand?: string | null;
	lastCommandExitCode?: number | null;
}): FailureClass {
	const combined = combineEvidence(params);

	// 1. No tests found, exit code 0 — this is a validation failure, not a pass
	if (
		/No test files found/i.test(combined) ||
		params.commandHistory?.some((h) => h.noTestsFoundDetected === true && h.exitCode === 0)
	) {
		return "no_tests_found_exit_zero";
	}

	// 2. Command history is empty / no command evidence — only when there's
	// no specific target command mentioned in the error. If a target command
	// is explicitly named, classify as target_command_not_executed (rule #3).
	if (/commandHistory.*empty/i.test(combined) || /no command evidence/i.test(combined)) {
		// Only classify as command_history_missing if no specific target command
		// path is mentioned (if a path is given, rule #3 takes precedence).
		if (!/Target command has not been executed:\s*\S+/i.test(combined)) {
			return "command_history_missing";
		}
	}

	// 3. Target command not executed in completion gate
	if (/Target command has not been executed/i.test(combined) || /Target command not executed/i.test(combined)) {
		return "target_command_not_executed";
	}

	// 4. FSM illegal transitions
	if (/Illegal attempt transition:\s*PENDING\s*->\s*SUCCEEDED/i.test(combined)) {
		return "stale_attempt_completion";
	}

	if (/Illegal attempt transition:\s*SUCCEEDED\s*->\s*RUNNING/i.test(combined)) {
		return "attempt_cache_retry_bug";
	}

	if (/Illegal attempt transition/i.test(combined)) {
		return "illegal_attempt_transition";
	}

	// 5. Memory/process kills
	if (/memory\s*limit|rss|SIGKILL|OOM|heap\s*out/i.test(combined)) {
		return "memory_limit_or_process_killed";
	}

	// 6. File lock stuck
	if (/file\s*lock/i.test(combined)) {
		return "file_lock_stuck";
	}

	// 7. Queue snapshot missing
	if (/queue\s*snapshot/i.test(combined)) {
		return "queue_snapshot_missing";
	}

	// 8. Completion gate blocked (general)
	if (/Completion gate blocked/i.test(combined)) {
		return "completion_gate_blocked";
	}

	// 9. Test file missing
	if (/test.*file.*(?:not found|missing|does not exist)/i.test(combined)) {
		return "test_file_missing";
	}

	// 10. Wrong test path
	if (/No tests found/i.test(combined) || /command.*path.*wrong|wrong.*test.*path/i.test(combined)) {
		return "wrong_test_path";
	}

	// 11. Validation command failed
	if (/validation.*fail|test.*fail/i.test(combined)) {
		return "validation_command_failed";
	}

	// 12. Stop not drained
	if (/stop.*not.*drain|drain.*fail|workers.*still.*running/i.test(combined)) {
		return "stop_not_drained";
	}

	// 13. Dependency missing
	if (/dependency.*missing|dependency.*not.*found|artifact.*missing/i.test(combined)) {
		return "dependency_missing";
	}

	// 14. Artifact missing
	if (/artifact.*missing|artifact.*not.*found/i.test(combined)) {
		return "artifact_missing";
	}

	// 15. Plan contract mismatch
	if (/plan.*contract|schema.*mismatch|contract.*version/i.test(combined)) {
		return "plan_contract_mismatch";
	}

	// 16. Continue recovery failed
	if (/continue.*recover|recovery.*fail/i.test(combined)) {
		return "continue_recovery_failed";
	}

	// 17. Unknown
	return "unknown";
}

/**
 * Combine error message, gate block reasons, and command output into one string for matching.
 */
function combineEvidence(params: {
	errorMessage: string;
	completionGateBlockReasons?: string[];
	commandHistory?: Array<{ command: string; exitCode: number | null; noTestsFoundDetected?: boolean }>;
	lastCommand?: string | null;
	lastCommandExitCode?: number | null;
}): string {
	const parts: string[] = [params.errorMessage];
	if (params.completionGateBlockReasons && params.completionGateBlockReasons.length > 0) {
		parts.push(params.completionGateBlockReasons.join("; "));
	}
	if (params.lastCommand) {
		parts.push(params.lastCommand);
	}
	if (params.commandHistory && params.commandHistory.length > 0) {
		for (const h of params.commandHistory.slice(-3)) {
			parts.push(h.command);
			if (h.noTestsFoundDetected) parts.push("No test files found");
		}
	}
	return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Classification confidence helpers
// ---------------------------------------------------------------------------

/**
 * Get the severity of a failure class.
 */
export function failureClassSeverity(fc: FailureClass): "low" | "medium" | "high" | "blocking" {
	switch (fc) {
		case "target_command_not_executed":
		case "command_history_missing":
		case "completion_gate_blocked":
		case "file_lock_stuck":
		case "queue_snapshot_missing":
		case "stop_not_drained":
			return "high";
		case "illegal_attempt_transition":
		case "stale_attempt_completion":
		case "attempt_cache_retry_bug":
		case "memory_limit_or_process_killed":
			return "blocking";
		case "no_tests_found_exit_zero":
		case "test_file_missing":
		case "wrong_test_path":
		case "validation_command_failed":
		case "dependency_missing":
		case "artifact_missing":
		case "plan_contract_mismatch":
		case "continue_recovery_failed":
			return "medium";
		case "unknown":
			return "low";
	}
}

/**
 * Get a human-readable label for a failure class.
 */
export function failureClassLabel(fc: FailureClass): string {
	switch (fc) {
		case "target_command_not_executed":
			return "Target command not recorded as executed";
		case "command_history_missing":
			return "Command history is empty — no commands recorded";
		case "test_file_missing":
			return "Test file does not exist";
		case "wrong_test_path":
			return "Test command path does not match package cwd";
		case "no_tests_found_exit_zero":
			return "No test files matched — exited 0 but validation not satisfied";
		case "validation_command_failed":
			return "Validation command failed";
		case "completion_gate_blocked":
			return "Completion gate blocked";
		case "memory_limit_or_process_killed":
			return "Process killed due to memory limit";
		case "stale_attempt_completion":
			return "Stale attempt completion detected";
		case "illegal_attempt_transition":
			return "Illegal FSM transition";
		case "attempt_cache_retry_bug":
			return "Attempt cache produced illegal retry transition";
		case "stop_not_drained":
			return "Plan stop failed to drain active workers";
		case "continue_recovery_failed":
			return "Continue recovery failed";
		case "queue_snapshot_missing":
			return "Queue snapshot is missing";
		case "file_lock_stuck":
			return "File lock is stuck";
		case "dependency_missing":
			return "Dependency is missing";
		case "artifact_missing":
			return "Required artifact is missing";
		case "plan_contract_mismatch":
			return "Plan contract does not match expected schema";
		case "unknown":
			return "Unknown failure";
	}
}
