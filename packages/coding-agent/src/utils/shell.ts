import { existsSync } from "node:fs";
import { delimiter } from "node:path";
// eslint-disable-next-line no-restricted-imports
import child_process, { spawn, spawnSync } from "child_process";
import { getBinDir } from "../config.js";

// ---------------------------------------------------------------------------
// Global validation process lock
//
// Hard security layer: intercepts ALL child_process.spawn calls at the
// Node.js runtime level. When a validation command (vitest, npm test, etc.)
// is spawned, it is queued behind any already-running validation command.
//
// This catches spawns from ANY code path — bash tool, bash-executor, direct
// execSync/exec, npm scripts, third-party tools — regardless of whether
// they go through the bash-executor.ts validation lock.
// ---------------------------------------------------------------------------

/**
 * Commands matching any of these prefixes are considered validation commands.
 * Validation commands are serialized globally via the spawn lock.
 */
const VALIDATION_COMMAND_PREFIXES: readonly string[] = [
	"vitest",
	"npx vitest",
	"npm test",
	"npm run test",
	"npm run typecheck",
	"npm run check",
	"npm run build",
	"pnpm test",
	"pnpm run test",
	"tsc --noEmit",
	"npx tsc --noEmit",
	"npx tsgo --noEmit",
	"vite build",
];

function isValidationCommand(command: string): boolean {
	const trimmed = command.trimStart();
	return VALIDATION_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * A fair async mutex for serializing validation command spawns.
 * Only one validation process may run at a time across the entire process.
 */
class ValidationSpawnLock {
	private _locked = false;
	private _queue: Array<() => void> = [];

	acquire(): Promise<void> {
		if (!this._locked) {
			this._locked = true;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this._queue.push(resolve);
		});
	}

	release(): void {
		const next = this._queue.shift();
		if (next) {
			queueMicrotask(next);
		} else {
			this._locked = false;
		}
	}
}

const _validationSpawnLock = new ValidationSpawnLock();

/**
 * Install the global spawn interceptor.
 * Patches child_process.spawn so any validation command (vitest, npm test, etc.)
 * kills any previously spawned validation process before spawning a new one.
 *
 * This is a hard safety net: it runs at the Node.js runtime level and catches
 * spawns from ANY code path, regardless of whether they go through bash-executor
 * or the bash tool's validationLock option.
 *
 * Auto-installed at module load time.
 */
export function installValidationSpawnLock(): void {
	const origSpawn = child_process.spawn;

	// Already patched — detect by checking if our marker exists
	if ((child_process as any).__pi_validation_spawn_patched) return;

	const patchedSpawn: typeof origSpawn = function (
		this: unknown,
		command: string,
		argsOrOptions?: any,
		options?: any,
	) {
		// Determine the full command string for validation check
		const fullCommand = Array.isArray(argsOrOptions) ? `${command} ${argsOrOptions.join(" ")}` : command;

		if (!isValidationCommand(fullCommand)) {
			// Not a validation command — pass through immediately
			return origSpawn.call(this, command as any, argsOrOptions as any, options as any);
		}

		// Validation command — kill any previously running validation process
		// before spawning a new one. This is a hard safety net.
		killTrackedDetachedChildren();

		const spawnResult = origSpawn.call(this, command as any, argsOrOptions as any, options as any);

		// Track this process so it can be killed when a new validation starts
		// or during cleanup.
		if (spawnResult.pid) {
			trackDetachedChildPid(spawnResult.pid);

			// When this process exits, untrack so the slot frees up
			spawnResult.on("exit", () => {
				untrackDetachedChildPid(spawnResult.pid!);
			});
		}

		return spawnResult;
	} as typeof origSpawn;

	(child_process as any).spawn = patchedSpawn;
	(child_process as any).__pi_validation_spawn_patched = true;
}

/**
 * Uninstall the global spawn interceptor (for testing only).
 */
export function uninstallValidationSpawnLock(): void {
	(child_process as any).spawn = child_process.spawn;
	(child_process as any).__pi_validation_spawn_patched = false;
}

export interface ShellConfig {
	shell: string;
	args: string[];
}

/**
 * Find bash executable on PATH (cross-platform)
 */
function findBashOnPath(): string | null {
	if (process.platform === "win32") {
		// Windows: Use 'where' and verify file exists (where can return non-existent paths)
		try {
			const result = spawnSync("where", ["bash.exe"], { encoding: "utf-8", timeout: 5000 });
			if (result.status === 0 && result.stdout) {
				const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
				if (firstMatch && existsSync(firstMatch)) {
					return firstMatch;
				}
			}
		} catch {
			// Ignore errors
		}
		return null;
	}

	// Unix: Use 'which' and trust its output (handles Termux and special filesystems)
	try {
		const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5000 });
		if (result.status === 0 && result.stdout) {
			const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
			if (firstMatch) {
				return firstMatch;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
}

/**
 * Resolve shell configuration based on platform and an optional explicit shell path.
 * Resolution order:
 * 1. User-specified shellPath
 * 2. On Windows: Git Bash in known locations, then bash on PATH
 * 3. On Unix: /bin/bash, then bash on PATH, then fallback to sh
 */
export function getShellConfig(customShellPath?: string): ShellConfig {
	// 1. Check user-specified shell path
	if (customShellPath) {
		if (existsSync(customShellPath)) {
			return { shell: customShellPath, args: ["-c"] };
		}
		throw new Error(`Custom shell path not found: ${customShellPath}`);
	}

	if (process.platform === "win32") {
		// 2. Try Git Bash in known locations
		const paths: string[] = [];
		const programFiles = process.env.ProgramFiles;
		if (programFiles) {
			paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
		}
		const programFilesX86 = process.env["ProgramFiles(x86)"];
		if (programFilesX86) {
			paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
		}

		for (const path of paths) {
			if (existsSync(path)) {
				return { shell: path, args: ["-c"] };
			}
		}

		// 3. Fallback: search bash.exe on PATH (Cygwin, MSYS2, WSL, etc.)
		const bashOnPath = findBashOnPath();
		if (bashOnPath) {
			return { shell: bashOnPath, args: ["-c"] };
		}

		throw new Error(
			`No bash shell found. Options:\n` +
				`  1. Install Git for Windows: https://git-scm.com/download/win\n` +
				`  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
				"  3. Set shellPath in settings.json\n\n" +
				`Searched Git Bash in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
		);
	}

	// Unix: try /bin/bash, then bash on PATH, then fallback to sh
	if (existsSync("/bin/bash")) {
		return { shell: "/bin/bash", args: ["-c"] };
	}

	const bashOnPath = findBashOnPath();
	if (bashOnPath) {
		return { shell: bashOnPath, args: ["-c"] };
	}

	return { shell: "sh", args: ["-c"] };
}

export function getShellEnv(): NodeJS.ProcessEnv {
	const binDir = getBinDir();
	const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const currentPath = process.env[pathKey] ?? "";
	const pathEntries = currentPath.split(delimiter).filter(Boolean);
	const hasBinDir = pathEntries.includes(binDir);
	const updatedPath = hasBinDir ? currentPath : [binDir, currentPath].filter(Boolean).join(delimiter);

	return {
		...process.env,
		[pathKey]: updatedPath,
	};
}

/**
 * Sanitize binary output for display/storage.
 * Removes characters that crash string-width or cause display issues:
 * - Control characters (except tab, newline, carriage return)
 * - Lone surrogates
 * - Unicode Format characters (crash string-width due to a bug)
 * - Characters with undefined code points
 */
export function sanitizeBinaryOutput(str: string): string {
	// Use Array.from to properly iterate over code points (not code units)
	// This handles surrogate pairs correctly and catches edge cases where
	// codePointAt() might return undefined
	return Array.from(str)
		.filter((char) => {
			// Filter out characters that cause string-width to crash
			// This includes:
			// - Unicode format characters
			// - Lone surrogates (already filtered by Array.from)
			// - Control chars except \t \n \r
			// - Characters with undefined code points

			const code = char.codePointAt(0);

			// Skip if code point is undefined (edge case with invalid strings)
			if (code === undefined) return false;

			// Allow tab, newline, carriage return
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;

			// Filter out control characters (0x00-0x1F, except 0x09, 0x0a, 0x0x0d)
			if (code <= 0x1f) return false;

			// Filter out Unicode format characters
			if (code >= 0xfff9 && code <= 0xfffb) return false;

			return true;
		})
		.join("");
}

// ---------------------------------------------------------------------------
// Process supervisor — scope-aware process tracking and lifecycle
// ---------------------------------------------------------------------------

/**
 * Process scope metadata.
 */
export interface ProcessScope {
	scopeId: string;
	planExecId?: string;
	workspaceId?: string;
	toolCallId?: string;
	command?: string;
	cwd?: string;
	startedAt: number;
}

/**
 * Tracked process with full metadata.
 */
export interface TrackedProcess extends ProcessScope {
	pid: number;
	pgid?: number;
	killedAt?: number;
	killReason?: string;
}

/**
 * Process tracking map (PID -> TrackedProcess).
 *
 * Replaces the raw Set<number> with a richer store while keeping
 * existing PID-only export signatures compatible.
 */
const trackedProcesses = new Map<number, TrackedProcess>();

/**
 * Create a new process scope identifier.
 */
export function createProcessScope(input: Partial<ProcessScope> & { scopeId?: string }): ProcessScope {
	return {
		scopeId: input.scopeId ?? `scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		planExecId: input.planExecId,
		workspaceId: input.workspaceId,
		toolCallId: input.toolCallId,
		command: input.command,
		cwd: input.cwd,
		startedAt: input.startedAt ?? Date.now(),
	};
}

export function trackDetachedChildPid(pid: number): void {
	// Maintain backward compatibility: existing callers only pass a PID.
	// If already tracked with metadata, leave it; otherwise add a bare record.
	if (!trackedProcesses.has(pid)) {
		trackedProcesses.set(pid, {
			pid,
			scopeId: `bare-${pid}`,
			startedAt: Date.now(),
		} as TrackedProcess);
	}
}

export function untrackDetachedChildPid(pid: number): void {
	trackedProcesses.delete(pid);
}

/**
 * Track a process with full metadata (scope, command, etc.).
 */
export function trackProcess(process: TrackedProcess): void {
	trackedProcesses.set(process.pid, process);
}

/**
 * Kill a specific tracked process by PID.
 * Calls killProcessTree and then removes the PID from tracking.
 */
export function killTrackedProcess(pid: number, reason?: string): void {
	killProcessTree(pid);
	const existing = trackedProcesses.get(pid);
	if (existing) {
		existing.killedAt = Date.now();
		existing.killReason = reason;
	}
	trackedProcesses.delete(pid);
}

/**
 * Kill all processes belonging to a given scope ID.
 */
export function killProcessScope(scopeId: string, reason?: string): void {
	const toKill: number[] = [];
	for (const [pid, proc] of trackedProcesses) {
		if (proc.scopeId === scopeId) {
			toKill.push(pid);
		}
	}
	for (const pid of toKill) {
		killProcessTree(pid);
		const existing = trackedProcesses.get(pid);
		if (existing) {
			existing.killedAt = Date.now();
			existing.killReason = reason;
		}
		trackedProcesses.delete(pid);
	}
}

/**
 * Kill all processes for a specific workspace within a plan.
 */
export function killWorkspaceProcesses(planExecId: string, workspaceId: string, _reason?: string): void {
	const toKill: number[] = [];
	for (const [pid, proc] of trackedProcesses) {
		if (proc.planExecId === planExecId && proc.workspaceId === workspaceId) {
			toKill.push(pid);
		}
	}
	for (const pid of toKill) {
		killProcessTree(pid);
		trackedProcesses.delete(pid);
	}
}

/**
 * Kill all processes for a specific plan execution.
 */
export function killPlanProcesses(planExecId: string, reason?: string): void {
	const toKill: number[] = [];
	for (const [pid, proc] of trackedProcesses) {
		if (proc.planExecId === planExecId) {
			toKill.push(pid);
		}
	}
	for (const pid of toKill) {
		killProcessTree(pid);
		const existing = trackedProcesses.get(pid);
		if (existing) {
			existing.killedAt = Date.now();
			existing.killReason = reason;
		}
		trackedProcesses.delete(pid);
	}
}

/**
 * Kill all tracked processes and clear the map.
 */
export function killAllTrackedProcesses(_reason?: string): void {
	for (const pid of trackedProcesses.keys()) {
		killProcessTree(pid);
	}
	trackedProcesses.clear();
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use killAllTrackedProcesses instead. */
export function killTrackedDetachedChildren(): void {
	killAllTrackedProcesses();
}

// ---------------------------------------------------------------------------
// Process resource guard (memory watchdog)
// ---------------------------------------------------------------------------

/**
 * Configuration for the process memory watchdog.
 */
export interface MemoryWatchdogConfig {
	/** Max RSS per process scope in bytes (default: 2 GB). */
	maxRssPerScope: number;
	/** Max number of processes per scope (default: 64). */
	maxProcessesPerScope: number;
	/** Polling interval in ms (default: 2000). */
	pollIntervalMs: number;
	/** Maximum runtime in ms for any single bash scope without a timeout (default: 180000). */
	maxRuntimeMs: number;
}

const DEFAULT_MEMORY_WATCHDOG_CONFIG: MemoryWatchdogConfig = {
	maxRssPerScope: 2 * 1024 * 1024 * 1024, // 2 GB
	maxProcessesPerScope: 64,
	pollIntervalMs: 2000,
	maxRuntimeMs: 180_000, // 3 minutes
};

let watchdogConfig: MemoryWatchdogConfig = { ...DEFAULT_MEMORY_WATCHDOG_CONFIG };
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Configure the memory watchdog.
 */
export function configureMemoryWatchdog(config: Partial<MemoryWatchdogConfig>): void {
	watchdogConfig = { ...watchdogConfig, ...config };
}

/**
 * Parse /proc/[pid]/stat for RSS on Linux.
 */
function readProcRss(pid: number): number | null {
	if (process.platform !== "linux") return null;
	try {
		const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
		const statPath = `/proc/${pid}/stat`;
		if (!existsSync(statPath)) return null;
		const stat = readFileSync(statPath, "utf-8");
		// /proc/[pid]/stat: field 24 (1-indexed) is RSS in pages
		const fields = stat.split(")")[1]?.trim().split(/\s+/) ?? [];
		// RSS is field 24 - but fields start after the closing paren, so index 22
		const rssPages = Number(fields[22]);
		if (Number.isNaN(rssPages)) return null;
		return rssPages * 4096; // pages to bytes
	} catch {
		return null;
	}
}

/**
 * Collect descendant PIDs of a process tree using pstree or /proc.
 */
function getDescendantPids(pid: number, visited?: Set<number>): number[] {
	const result: number[] = [];
	const seen = visited ?? new Set<number>();
	if (seen.has(pid)) return result;
	seen.add(pid);

	if (process.platform === "linux") {
		try {
			const { existsSync: exists } = require("node:fs") as typeof import("node:fs");
			const taskPath = `/proc/${pid}/task/${pid}/children`;
			if (exists(taskPath)) {
				const { readFileSync } = require("node:fs") as typeof import("node:fs");
				const children = readFileSync(taskPath, "utf-8").trim().split(/\s+/).filter(Boolean);
				for (const childPid of children) {
					const child = Number(childPid);
					if (!Number.isNaN(child) && !seen.has(child)) {
						result.push(child);
						result.push(...getDescendantPids(child, seen));
					}
				}
			}
			return result;
		} catch {
			// Fall through to fallback
		}
	}

	// Fallback: use pgrep/pkill
	try {
		const { spawnSync } = require("child_process") as typeof import("child_process");
		const out = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf-8", timeout: 2000 });
		if (out.status === 0 && out.stdout) {
			const children = out.stdout
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(Number)
				.filter((n) => !Number.isNaN(n) && !seen.has(n));
			for (const child of children) {
				result.push(child);
				result.push(...getDescendantPids(child, seen));
			}
		}
	} catch {
		// Non-fatal
	}

	return result;
}

/**
 * Run one watchdog iteration: inspect tracked processes and kill violators.
 */
function watchdogIteration(): void {
	if (trackedProcesses.size === 0) return;

	const now = Date.now();
	// Group PIDs by scope
	const scopeToPids = new Map<string, number[]>();
	for (const [pid, proc] of trackedProcesses) {
		const scopeId = proc.scopeId ?? `bare-${pid}`;
		if (!scopeToPids.has(scopeId)) scopeToPids.set(scopeId, []);
		scopeToPids.get(scopeId)!.push(pid);
	}

	for (const [scopeId, pids] of scopeToPids) {
		// Check process count per scope
		if (pids.length > watchdogConfig.maxProcessesPerScope) {
			for (const pid of pids) {
				killProcessTree(pid);
				trackedProcesses.delete(pid);
			}
			continue;
		}

		// Check RSS per scope (Linux only)
		if (process.platform === "linux") {
			let totalRss = 0;
			for (const pid of pids) {
				const rss = readProcRss(pid);
				if (rss !== null) totalRss += rss;
				// Also check descendants
				for (const childPid of getDescendantPids(pid)) {
					const childRss = readProcRss(childPid);
					if (childRss !== null) totalRss += childRss;
				}
			}
			if (totalRss > watchdogConfig.maxRssPerScope) {
				for (const pid of pids) {
					killProcessTree(pid);
					trackedProcesses.delete(pid);
				}
				continue;
			}
		}

		// Check max runtime
		for (const [pid, proc] of trackedProcesses) {
			if (proc.scopeId !== scopeId) continue;
			const runtime = now - proc.startedAt;
			if (runtime > watchdogConfig.maxRuntimeMs && !proc.killedAt) {
				killProcessTree(pid);
				proc.killedAt = now;
				proc.killReason = `runtime-exceeded:${watchdogConfig.maxRuntimeMs}ms`;
				trackedProcesses.delete(pid);
			}
		}
	}
}

/**
 * Start the process memory watchdog.
 */
export function startMemoryWatchdog(config?: Partial<MemoryWatchdogConfig>): void {
	if (watchdogTimer) return;
	if (config) configureMemoryWatchdog(config);
	watchdogTimer = setInterval(watchdogIteration, watchdogConfig.pollIntervalMs);
	watchdogTimer.unref();
}

/**
 * Stop the process memory watchdog.
 */
export function stopMemoryWatchdog(): void {
	if (watchdogTimer) {
		clearInterval(watchdogTimer);
		watchdogTimer = null;
	}
}

// ---------------------------------------------------------------------------
// Startup orphan reaper
// ---------------------------------------------------------------------------

import { existsSync as fsExistsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Directory for persisted process-scope metadata.
 * Used so orphaned processes from a crash can be reaped on startup.
 */
function getProcessMetadataDir(): string {
	const dir = process.env.PI_PROCESS_METADATA_DIR ?? join(tmpdir(), "pi-processes");
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		// Non-fatal
	}
	return dir;
}

/**
 * Persist process metadata to disk so it can survive a crash.
 */
export function persistProcessMetadata(proc: TrackedProcess): void {
	try {
		const dir = getProcessMetadataDir();
		const filePath = join(dir, `${proc.pid}.json`);
		writeFileSync(filePath, JSON.stringify(proc, null, 2), "utf-8");
	} catch {
		// Non-fatal
	}
}

/**
 * Remove persisted process metadata for a PID.
 */
export function removeProcessMetadata(pid: number): void {
	try {
		const dir = getProcessMetadataDir();
		const filePath = join(dir, `${pid}.json`);
		if (fsExistsSync(filePath)) {
			unlinkSync(filePath);
		}
	} catch {
		// Non-fatal
	}
}

/**
 * Reap orphan processes from a previous crash.
 * Reads persisted process metadata and kills any still-alive PIDs.
 * Returns the number of orphans reaped.
 */
export function reapOrphanProcesses(): number {
	let reaped = 0;
	try {
		const dir = getProcessMetadataDir();
		if (!fsExistsSync(dir)) return 0;
		const files = readdirSync(dir);
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			try {
				const content = readFileSync(join(dir, file), "utf-8");
				const meta = JSON.parse(content) as TrackedProcess;
				// Check if process is still alive
				try {
					process.kill(meta.pid, 0); // signal 0 = test existence
					// Process is alive — kill it
					killProcessTree(meta.pid);
					reaped++;
				} catch {
					// Process already dead, just clean up metadata
				}
				unlinkSync(join(dir, file));
			} catch {
				// Skip malformed files
			}
		}
	} catch {
		// Non-fatal
	}
	return reaped;
}

// ---------------------------------------------------------------------------
// Shutdown hooks
// ---------------------------------------------------------------------------

/** Whether shutdown hooks have been installed. */
let shutdownHooksInstalled = false;

/**
 * Install shutdown hooks to clean up tracked processes on exit.
 */
export function installProcessShutdownHooks(): void {
	if (shutdownHooksInstalled) return;
	shutdownHooksInstalled = true;

	const shutdown = (signal: string) => {
		killAllTrackedProcesses(`shutdown-${signal}`);
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGHUP", () => shutdown("SIGHUP"));
	process.on("beforeExit", () => shutdown("beforeExit"));
	process.on("uncaughtException", (err) => {
		console.error("[process-supervisor] uncaughtException, killing tracked processes:", err);
		shutdown("uncaughtException");
	});
	process.on("unhandledRejection", (reason) => {
		console.error("[process-supervisor] unhandledRejection, killing tracked processes:", reason);
		shutdown("unhandledRejection");
	});
}

// ---------------------------------------------------------------------------
// Backward-compatible convenience functions
// ---------------------------------------------------------------------------

/** @deprecated Use getTrackedProcesses() instead. */
export function getTrackedProcesses(): TrackedProcess[] {
	return Array.from(trackedProcesses.values());
}

/**
 * Kill all tracked processes that match the given scope filters.
 */
export function killTrackedProcessesByScope(scope: {
	planExecId?: string;
	workspaceId?: string;
	scopeId?: string;
}): void {
	const toKill: number[] = [];
	for (const [pid, proc] of trackedProcesses) {
		if (
			(scope.planExecId !== undefined && proc.planExecId !== scope.planExecId) ||
			(scope.workspaceId !== undefined && proc.workspaceId !== scope.workspaceId) ||
			(scope.scopeId !== undefined && proc.scopeId !== scope.scopeId)
		) {
			continue;
		}
		if (scope.planExecId !== undefined || scope.workspaceId !== undefined || scope.scopeId !== undefined) {
			toKill.push(pid);
		}
	}
	for (const pid of toKill) {
		killProcessTree(pid);
		trackedProcesses.delete(pid);
	}
}

/**
 * Kill a process and all its children (cross-platform)
 *
 * Best-effort only; ignores already-dead processes.
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		// Use taskkill on Windows to kill process tree
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch {
			// Ignore errors if taskkill fails
		}
	} else {
		// First, try to kill the entire process group (works with pid:0 spawn option)
		// This is the preferred method as it catches all child processes including
		// vitest workers spawned via fork pools
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Process group might not exist or already dead
		}

		// Then, try to kill the process itself
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already dead
		}

		// Additional fallback: use pkill to catch any orphaned child processes
		try {
			spawnSync("pkill", ["-P", String(pid)], { stdio: "ignore" });
		} catch {
			// pkill might not be available or fail
		}
	}
}
