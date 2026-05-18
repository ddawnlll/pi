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

/**
 * Detached child processes must be tracked so they can be killed on parent
 * shutdown signals (SIGHUP/SIGTERM).
 *
 * Also used by the global validation spawn lock to kill competing validation
 * processes when a new one is spawned.
 */
const trackedDetachedChildPids = new Set<number>();

export function trackDetachedChildPid(pid: number): void {
	trackedDetachedChildPids.add(pid);
}

export function untrackDetachedChildPid(pid: number): void {
	trackedDetachedChildPids.delete(pid);
}

export function killTrackedDetachedChildren(): void {
	for (const pid of trackedDetachedChildPids) {
		killProcessTree(pid);
	}
	trackedDetachedChildPids.clear();
}

/**
 * Kill a process and all its children (cross-platform)
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
		// Use SIGKILL on Unix/Linux/Mac
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Fallback to killing just the child if process group kill fails
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead
			}
		}
	}
}
