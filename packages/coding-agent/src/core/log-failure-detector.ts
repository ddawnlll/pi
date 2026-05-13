/**
 * Log Failure Detector - P4.6.1
 *
 * Scans log/tool output lines for failure signals and produces
 * validation-error state scoped to planExecId + workspaceId.
 *
 * Detects patterns from vitest, jest, and general build/test output:
 * - FAIL <test file>
 * - Tests: X passed, Y failed
 * - "failed, " in vitest summary
 * - Error: <message>
 * - Out of retries for workspace <id>
 * - File not found: <path>
 * - non-zero command exit code
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Category of failure signal detected in log output.
 */
export enum FailureSignalCategory {
	/** A test file reported FAIL */
	TestFail = "test_fail",
	/** A test summary with failures (e.g., "Tests: 3 passed, 1 failed") */
	TestSummaryFail = "test_summary_fail",
	/** Vitest summary contains "failed" */
	VitestSummaryFail = "vitest_summary_fail",
	/** An error line (e.g., "Error: something bad") */
	ErrorLine = "error_line",
	/** Out of retries for a workspace */
	OutOfRetries = "out_of_retries",
	/** File not found */
	FileNotFound = "file_not_found",
	/** Non-zero exit code from a command */
	NonZeroExitCode = "non_zero_exit_code",
}

/**
 * A single failure signal extracted from a log line.
 */
export interface FailureSignal {
	/** Category of failure signal */
	category: FailureSignalCategory;
	/** The original log line that triggered detection */
	rawLine: string;
	/** Human-readable description of the failure */
	description: string;
	/** Timestamp (epoch ms) if available; otherwise 0 */
	timestamp: number;
}

/**
 * Result of scanning a batch of log lines for failure signals.
 */
export interface LogScanResult {
	/** All failure signals found */
	signals: FailureSignal[];
	/** True when at least one signal was found */
	hasFailures: boolean;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const PATTERN_FAIL_TEST = /^FAIL /;
const PATTERN_FAIL_CONTAINS = /FAIL (?:src|test|lib|packages|components|app)[/]/;
const PATTERN_TEST_SUMMARY = /Tests?:.*?failed/i;
const PATTERN_VITEST_SUMMARY = /failed[,.]/;
const PATTERN_ERROR_LINE = /^Error:/;
const PATTERN_ERROR_CONTAINS = /Error: /;
const PATTERN_OUT_OF_RETRIES = /Out of retries/i;
const PATTERN_FILE_NOT_FOUND = /File not found:/i;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Scan a single log line for failure signals.
 *
 * @param line - A single line of log output
 * @param timestamp - Timestamp (epoch ms) of the line, or 0 if unknown
 * @returns Array of FailureSignal (may be empty)
 */
export function detectFailureSignals(line: string, timestamp: number = 0): FailureSignal[] {
	const signals: FailureSignal[] = [];
	const trimmed = line.trim();

	// Skip empty lines
	if (trimmed.length === 0) {
		return signals;
	}

	// FAIL src/hooks/... pattern
	if (PATTERN_FAIL_TEST.test(trimmed) || PATTERN_FAIL_CONTAINS.test(trimmed)) {
		signals.push({
			category: FailureSignalCategory.TestFail,
			rawLine: trimmed,
			description: `Test FAIL: ${trimmed}`,
			timestamp,
		});
	}

	// "Tests: 3 passed, 1 failed" pattern
	if (PATTERN_TEST_SUMMARY.test(trimmed)) {
		// Extract passed/failed counts if possible
		const match = trimmed.match(/Tests?:.*?([0-9]+|no) passed.*?([0-9]+|no) failed/i);
		const passed = match ? match[1] : "?";
		const failed = match ? match[2] : "?";
		signals.push({
			category: FailureSignalCategory.TestSummaryFail,
			rawLine: trimmed,
			description: `Test summary with failures: ${passed} passed, ${failed} failed`,
			timestamp,
		});
	}

	// vitest summary with "failed, " or "failed."
	if (PATTERN_VITEST_SUMMARY.test(trimmed) && !PATTERN_TEST_SUMMARY.test(trimmed)) {
		// Avoid double-counting with TestSummaryFail
		signals.push({
			category: FailureSignalCategory.VitestSummaryFail,
			rawLine: trimmed,
			description: `Vitest summary with failures: ${trimmed}`,
			timestamp,
		});
	}

	// "Error:" at start of line
	if (PATTERN_ERROR_LINE.test(trimmed)) {
		signals.push({
			category: FailureSignalCategory.ErrorLine,
			rawLine: trimmed,
			description: trimmed,
			timestamp,
		});
	}

	// "Error: " contained somewhere (but not at line start — already caught above)
	if (!PATTERN_ERROR_LINE.test(trimmed) && PATTERN_ERROR_CONTAINS.test(trimmed)) {
		// Only add if not already captured by start-of-line check above
		signals.push({
			category: FailureSignalCategory.ErrorLine,
			rawLine: trimmed,
			description: trimmed,
			timestamp,
		});
	}

	// "Out of retries"
	if (PATTERN_OUT_OF_RETRIES.test(trimmed)) {
		signals.push({
			category: FailureSignalCategory.OutOfRetries,
			rawLine: trimmed,
			description: `Retries exhausted: ${trimmed}`,
			timestamp,
		});
	}

	// "File not found:"
	if (PATTERN_FILE_NOT_FOUND.test(trimmed)) {
		signals.push({
			category: FailureSignalCategory.FileNotFound,
			rawLine: trimmed,
			description: `File not found: ${trimmed}`,
			timestamp,
		});
	}

	return signals;
}

/**
 * Scan a batch of log lines for failure signals.
 *
 * @param lines - Array of log lines
 * @param startTimestamp - Base timestamp (epoch ms) for lines without explicit timestamps
 * @returns Scan result with all signals and hasFailures flag
 */
export function scanLogLines(lines: string[], startTimestamp: number = 0): LogScanResult {
	const signals: FailureSignal[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const detected = detectFailureSignals(line, startTimestamp + i);
		signals.push(...detected);
	}

	return {
		signals,
		hasFailures: signals.length > 0,
	};
}

/**
 * Record a non-zero exit code as a failure signal.
 *
 * @param exitCode - The process exit code
 * @param command - The command that was run
 * @param timestamp - Timestamp (epoch ms)
 * @returns FailureSignal if exit code is non-zero, null otherwise
 */
export function recordExitCodeFailure(exitCode: number, command: string, timestamp: number = 0): FailureSignal | null {
	if (exitCode === 0) {
		return null;
	}

	return {
		category: FailureSignalCategory.NonZeroExitCode,
		rawLine: `Command "${command}" exited with code ${exitCode}`,
		description: `Command exited with non-zero code ${exitCode}: ${command}`,
		timestamp,
	};
}
