/**
 * Sandbox Executor
 *
 * Executes extension code in an isolated context with timeout and memory cap
 * using Node.js `vm` + `worker_threads`.
 *
 * Each execution runs in a separate Worker thread to enforce memory limits
 * via `--max-old-space-size`. The code runs inside a `vm.createContext()`
 * sandbox where `require`, `process`, `__dirname`, and `__filename` are
 * all explicitly `undefined`.
 */

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

// ============================================================================
// Constants
// ============================================================================

/** Error type constant for sandbox timeout. */
export const SANDBOX_TIMEOUT = "SANDBOX_TIMEOUT";

/** Error type constant for sandbox out-of-memory. */
export const SANDBOX_OOM = "SANDBOX_OOM";

// ============================================================================
// Types
// ============================================================================

/** A single console log entry from within the sandbox. */
export interface SandboxLog {
	type: string;
	text: string;
}

/** Result of a sandbox execution. */
export interface SandboxResult {
	/** Whether execution completed successfully. */
	success: boolean;
	/** The return value of the executed code (if any). */
	output: unknown;
	/** Console log entries captured during execution. */
	logs: SandboxLog[];
	/** Execution duration in milliseconds. */
	durationMs: number;
	/** Memory used in MB (approximate). */
	memoryUsedMB?: number;
	/** Exit code (0 for success, non-zero for errors). */
	exitCode: number;
	/** Error message if execution failed. */
	error?: string;
	/** Error type classification (SANDBOX_TIMEOUT or SANDBOX_OOM). */
	errorType?: string;
}

/** Options for sandbox execution. */
export interface SandboxExecutorOptions {
	/** Maximum execution time in milliseconds (default: 31000). */
	timeoutMs?: number;
	/** Maximum memory in MB (enforced via --max-old-space-size on the Worker). */
	maxMemoryMB?: number;
}

// ============================================================================
// Worker Path Resolution
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the path to the sandbox worker script.
 *
 * At runtime (compiled JS), the worker is `sandbox-worker.js`.
 * During development/vitest, we fall back to `sandbox-worker.ts`.
 */
function getWorkerPath(): string {
	const jsPath = join(__dirname, "sandbox-worker.js");
	const tsPath = join(__dirname, "sandbox-worker.ts");
	return existsSync(jsPath) ? jsPath : tsPath;
}

// ============================================================================
// SandboxExecutor
// ============================================================================

/**
 * Executes code in an isolated sandbox context.
 *
 * Uses `worker_threads` for process-level isolation (memory limits) and
 * `vm.createContext()` for JavaScript-level isolation (no `require`, etc.).
 */
export class SandboxExecutor {
	/**
	 * Execute arbitrary code in a sandboxed environment.
	 *
	 * @param code - JavaScript code to execute
	 * @param input - Optional input data to make available to the sandbox
	 * @param options - Execution options (timeout, memory limits)
	 * @returns Promise resolving to a SandboxResult
	 */
	static async run(
		code: string,
		input?: unknown,
		options: SandboxExecutorOptions = {},
	): Promise<SandboxResult> {
		const startTime = performance.now();
		const workerPath = getWorkerPath();
		const timeoutMs = options.timeoutMs ?? 31000;

		return new Promise<SandboxResult>((resolve) => {
			const worker = new Worker(workerPath, {
				workerData: {
					code,
					input,
					timeoutMs,
					maxMemoryMB: options.maxMemoryMB,
				},
			});

			let completed = false;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

			// Main-thread timeout enforcement
			if (timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					if (completed) return;
					completed = true;
					worker.terminate();

					const durationMs = Math.round(performance.now() - startTime);
					resolve({
						success: false,
						output: undefined,
						logs: [],
						durationMs,
						exitCode: 124,
						error: `Execution timed out after ${timeoutMs}ms`,
						errorType: SANDBOX_TIMEOUT,
					});
				}, timeoutMs);
			}

			// Successful or errored completion from the worker
			worker.on("message", (msg: { success: boolean; output: unknown; logs?: SandboxLog[]; error?: Record<string, unknown> | string }) => {
				if (completed) return;
				completed = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);

				const durationMs = Math.round(performance.now() - startTime);

				if (msg.success) {
					resolve({
						success: true,
						output: msg.output,
						logs: msg.logs ?? [],
						durationMs,
						exitCode: 0,
					});
				} else {
					const errorMessage =
						typeof msg.error === "string"
							? msg.error
							: (msg.error?.message as string | undefined) ?? "Unknown sandbox error";
					const errorCode =
						typeof msg.error === "object" && msg.error !== null
							? (msg.error.code as string | undefined)
							: undefined;

					// The worker does NOT set a timeout on vm.Script.runInContext().
					// The only timeout is the main-thread one above. So if the worker
					// reports ERR_SCRIPT_EXECUTION_TIMEOUT and a memory limit was set,
					// it must be from vm.Script resource limits (OOM).
					if (options.maxMemoryMB && errorCode === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
						resolve({
							success: false,
							output: undefined,
							logs: msg.logs ?? [],
							durationMs,
							exitCode: 137,
							error: "Memory limit exceeded",
							errorType: SANDBOX_OOM,
						});
					} else {
						resolve({
							success: false,
							output: undefined,
							logs: msg.logs ?? [],
							durationMs,
							exitCode: 1,
							error: errorMessage,
						});
					}
				}
			});

			// Runtime error from worker (e.g., worker crashed with OOM or other error)
			worker.on("error", (err: Error) => {
				if (completed) return;
				completed = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);

				const durationMs = Math.round(performance.now() - startTime);

				// Check if the error indicates an out-of-memory condition
				if (options.maxMemoryMB && isOomError(err)) {
					resolve({
						success: false,
						output: undefined,
						logs: [],
						durationMs,
						exitCode: 137,
						error: "Memory limit exceeded",
						errorType: SANDBOX_OOM,
					});
				} else {
					resolve({
						success: false,
						output: undefined,
						logs: [],
						durationMs,
						exitCode: 1,
						error: err.message ?? String(err),
					});
				}
			});

			// Worker exit without message (e.g., crash, SIGKILL)
			worker.on("exit", (code: number) => {
				if (completed) return;
				completed = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);

				const durationMs = Math.round(performance.now() - startTime);

				if (code !== 0 && options.maxMemoryMB) {
					resolve({
						success: false,
						output: undefined,
						logs: [],
						durationMs,
						exitCode: code,
						error: "Memory limit exceeded",
						errorType: SANDBOX_OOM,
					});
				} else {
					resolve({
						success: false,
						output: undefined,
						logs: [],
						durationMs,
						exitCode: code,
						error: code !== 0 ? `Worker exited with code ${code}` : "Worker exited without sending result",
					});
				}
			});
		});
	}
}

/**
 * Check whether an error indicates an out-of-memory condition.
 */
function isOomError(err: Error): boolean {
	const msg = err.message?.toLowerCase() ?? "";
	return (
		msg.includes("heap out of memory") ||
		msg.includes("allocation failure") ||
		msg.includes("out of memory") ||
		msg.includes("memory limit") ||
		msg.includes("javascript heap out of memory") ||
		msg.includes("max-old-space-size")
	);
}
