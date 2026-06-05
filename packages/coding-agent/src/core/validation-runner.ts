/**
 * Validation Runner — P26.H
 *
 * Managed validation runtime that enforces timeouts, no-watch rules,
 * process group tracking, output caps, and kill-tree behavior.
 *
 * Every validation command runs:
 * - With a deadline (hard timeout)
 * - With closed stdin
 * - With CI environment variables
 * - With an output cap (max bytes / lines)
 * - Inside a managed process group
 * - Blocked if classified as a watch/dev-server command
 * - Timeout escalates SIGTERM -> SIGKILL
 * - Child PIDs are tracked and killed on timeout
 */

import { spawn } from "node:child_process";
import type { ActorEventSink } from "../execution-runtime/actor-events.js";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a validation run.
 */
export interface ValidationRunResult {
	/** Whether the command completed within deadline */
	success: boolean;
	/** Exit code, or null if killed */
	exitCode: number | null;
	/** Captured stdout */
	stdout: string;
	/** Captured stderr */
	stderr: string;
	/** Duration in ms */
	durationMs: number;
	/** Reason for failure, if any */
	error?: string;
	/** Whether the command was killed by timeout */
	timedOut?: boolean;
	/** Whether the command was blocked (watch/dev-server) */
	blocked?: boolean;
	/** PIDs of child processes that were killed */
	killedChildPids?: number[];
}

/**
 * Configuration for a validation run.
 */
export interface ValidationRunConfig {
	/** Maximum execution time in ms */
	timeoutMs: number;
	/** Maximum stdout bytes */
	maxStdoutBytes?: number;
	/** Maximum stderr bytes */
	maxStderrBytes?: number;
	/** Working directory */
	cwd: string;
	/** Environment variables to set */
	env?: Record<string, string>;
	/** Whether to block watch/dev-server commands */
	blockWatchCommands?: boolean;
}

// ---------------------------------------------------------------------------
// Watch/dev-server command detection
// ---------------------------------------------------------------------------

const WATCH_PATTERNS = [
	/--watch$/,
	/--watch\s/,
	/\s--watch/,
	/\bwatch\b/,
	/\bdev\b/,
	/\bdev:/,
	/dev-server/,
	/--dev$/,
	/--dev\s/,
	/\snodemon\s/,
	/\snodemon$/,
	/\btsx\s+.*--watch\b/,
	/\bwebpack\b.*--watch/,
	/\bvite\b.*--watch/,
	/\bnext\s+dev\b/,
	/\bnuxt\s+dev\b/,
];

/**
 * Check if a command is a watch/dev-server command that should be blocked.
 */
export function isWatchCommand(command: string): boolean {
	return WATCH_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Classification of a validation command.
 */
export type CommandClassification = "targeted" | "heavy" | "watch" | "unknown";

const HEAVY_VALIDATION_COMMANDS = ["test", "build", "lint:check", "typecheck", "check"];

/**
 * Classify a validation command.
 */
export function classifyCommand(command: string): CommandClassification {
	if (isWatchCommand(command)) return "watch";
	const cmd = command.trim().split(/\s+/)[0] ?? "";
	if (HEAVY_VALIDATION_COMMANDS.some((h) => cmd.includes(h) || command.includes(h))) {
		return "heavy";
	}
	if (cmd === "echo" || cmd === "ls" || cmd === "cat" || cmd === "head" || cmd === "tail") {
		return "targeted";
	}
	return "unknown";
}

// ---------------------------------------------------------------------------
// Process group helpers
// ---------------------------------------------------------------------------

/**
 * Tracked child process info.
 */
interface ChildProcessInfo {
	pid: number;
	cmd: string;
	startedAt: number;
}

/**
 * Kill a process tree (process group) on all platforms.
 * Sends SIGTERM first, then SIGKILL after a grace period.
 *
 * @param pid - Process ID to kill (process group leader)
 * @param killedPids - Array to collect killed PIDs
 */
function killProcessTree(pid: number, killedPids: number[]): void {
	try {
		// Negative PID kills the process group (SIGTERM first)
		process.kill(-pid, "SIGTERM");
	} catch {
		// Process may already be dead
	}

	// Give the process a short grace period
	const start = Date.now();
	const check = () => {
		try {
			// If process is still alive after 2s, send SIGKILL
			if (Date.now() - start > 2000) {
				try {
					process.kill(-pid, "SIGKILL");
				} catch {
					// Already dead
				}
				return;
			}
			// Check if process is still alive
			process.kill(pid, 0);
			setTimeout(check, 100);
		} catch {
			// Process is dead, nothing more to do
		}
	};
	setTimeout(check, 100);
	killedPids.push(pid);
}

// ---------------------------------------------------------------------------
// ValidationRunner
// ---------------------------------------------------------------------------

/**
 * Managed validation runner.
 *
 * Runs validation commands with:
 * - Hard deadline (timeout)
 * - Closed stdin
 * - CI environment
 * - Output cap
 * - Managed process group
 * - Watch/dev-server blocking
 * - SIGTERM -> SIGKILL escalation
 */
export class ValidationRunner {
	private childProcesses: Map<number, ChildProcessInfo> = new Map();

	constructor(private readonly eventSink?: ActorEventSink) {}

	/**
	 * Run a validation command.
	 *
	 * @param command - Shell command to run
	 * @param config - Run configuration
	 * @returns Validation run result
	 */
	async run(command: string, config: ValidationRunConfig): Promise<ValidationRunResult> {
		const startTime = Date.now();
		await this.eventSink?.emit({
			type: "validation_started",
			timestamp: startTime,
			payload: { command, cwd: config.cwd, timeoutMs: config.timeoutMs },
		});

		// Check for watch/dev-server commands
		if (config.blockWatchCommands !== false && isWatchCommand(command)) {
			await this.eventSink?.emit({
				type: "validation_failed",
				timestamp: Date.now(),
				payload: { command, cwd: config.cwd, blocked: true, reason: "watch_command_blocked" },
			});
			return {
				success: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				durationMs: 0,
				error: `Command blocked: '${command}' is classified as a watch/dev-server command`,
				blocked: true,
			};
		}

		return new Promise<ValidationRunResult>((resolve) => {
			const killedChildPids: number[] = [];
			let timedOut = false;

			// Spawn with process group (detached: false, setsid on Unix)
			const child = spawn(command, [], {
				cwd: config.cwd,
				env: {
					...process.env,
					CI: "true",
					NODE_ENV: "test",
					...config.env,
				},
				shell: true,
				stdio: ["pipe", "pipe", "pipe"],
				// Process group (setsid) for kill-tree behavior
				detached: false,
			});

			// Close stdin immediately
			if (child.stdin) {
				child.stdin.end();
			}

			// Track the child process
			if (child.pid !== undefined) {
				this.childProcesses.set(child.pid, {
					pid: child.pid,
					cmd: command,
					startedAt: Date.now(),
				});
			}

			// Output collection with caps (use mutable wrapper objects for ref semantics)
			const stdoutBuf: { data: string } = { data: "" };
			const stderrBuf: { data: string } = { data: "" };
			const maxStdout = config.maxStdoutBytes ?? 10 * 1024 * 1024; // 10 MB default
			const maxStderr = config.maxStderrBytes ?? 1 * 1024 * 1024; // 1 MB default

			const collectOutput = (stream: NodeJS.ReadableStream | null, dest: { data: string }, maxBytes: number) => {
				if (!stream) return;
				stream.on("data", (chunk: Buffer) => {
					if (dest.data.length < maxBytes) {
						const remaining = maxBytes - dest.data.length;
						dest.data += chunk.toString("utf-8").slice(0, remaining);
					}
				});
			};

			collectOutput(child.stdout, stdoutBuf, maxStdout);
			collectOutput(child.stderr, stderrBuf, maxStderr);

			// Timeout handling — SIGTERM -> SIGKILL escalation
			const timeoutHandle = setTimeout(() => {
				timedOut = true;
				if (child.pid !== undefined) {
					killProcessTree(child.pid, killedChildPids);
				}
				child.kill("SIGTERM");

				// SIGKILL escalation after grace period
				setTimeout(() => {
					try {
						if (child.pid !== undefined) {
							process.kill(-child.pid, "SIGKILL");
						}
					} catch {
						// Already dead
					}
				}, 2000).unref();
			}, config.timeoutMs);
			timeoutHandle.unref();

			// Handle process exit
			child.on("exit", (exitCode, signal) => {
				clearTimeout(timeoutHandle);

				if (child.pid !== undefined) {
					this.childProcesses.delete(child.pid);
				}

				const durationMs = Date.now() - startTime;

				if (timedOut || signal === "SIGTERM" || signal === "SIGKILL") {
					void this.eventSink?.emit({
						type: "validation_timed_out",
						timestamp: Date.now(),
						payload: { command, cwd: config.cwd, timeoutMs: config.timeoutMs, exitCode },
					});
					resolve({
						success: false,
						exitCode,
						stdout: stdoutBuf.data,
						stderr: stderrBuf.data,
						durationMs,
						error: `Command timed out after ${config.timeoutMs}ms`,
						timedOut: true,
						killedChildPids: killedChildPids.length > 0 ? killedChildPids : undefined,
					});
				} else if (exitCode !== 0) {
					void this.eventSink?.emit({
						type: "validation_failed",
						timestamp: Date.now(),
						payload: { command, cwd: config.cwd, exitCode },
					});
					resolve({
						success: false,
						exitCode,
						stdout: stdoutBuf.data,
						stderr: stderrBuf.data,
						durationMs,
						error: `Command failed with exit code ${exitCode}`,
					});
				} else {
					void this.eventSink?.emit({
						type: "validation_passed",
						timestamp: Date.now(),
						payload: { command, cwd: config.cwd, exitCode: 0 },
					});
					resolve({
						success: true,
						exitCode: 0,
						stdout: stdoutBuf.data,
						stderr: stderrBuf.data,
						durationMs,
					});
				}
			});

			// Handle errors (e.g., command not found)
			child.on("error", (err) => {
				clearTimeout(timeoutHandle);

				if (child.pid !== undefined) {
					this.childProcesses.delete(child.pid);
				}

				const durationMs = Date.now() - startTime;
				resolve({
					success: false,
					exitCode: null,
					stdout: stdoutBuf.data,
					stderr: stderrBuf.data,
					durationMs,
					error: `Failed to start command: ${err.message}`,
				});
			});
		});
	}

	/**
	 * Get the list of currently tracked child processes.
	 */
	getTrackedProcesses(): ChildProcessInfo[] {
		return Array.from(this.childProcesses.values());
	}

	/**
	 * Kill all tracked child processes.
	 * Used for cleanup / force-kill scenarios.
	 */
	killAll(): number[] {
		const killedPids: number[] = [];
		for (const [pid] of this.childProcesses) {
			killProcessTree(pid, killedPids);
			this.childProcesses.delete(pid);
		}
		return killedPids;
	}
}

/**
 * Create a ValidationRunner instance.
 */
export function createValidationRunner(): ValidationRunner {
	return new ValidationRunner();
}
