/**
 * Python Smoke Runner — P38.1.HOTFIX
 *
 * Executes real Python commands (subprocess) for smoke-real E2E tests.
 * Starts server processes, runs unittest, validates output.
 * All subprocesses are tracked and terminated on cleanup.
 *
 * No real LLM calls. Uses Python stdlib only.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PythonCommandResult {
	command: string;
	cwd: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	timedOut: boolean;
}

export interface PythonServerProcess {
	proc: ChildProcess;
	port: number;
	url: string;
	cwd: string;
}

export interface PythonValidationResult {
	command: string;
	cwd: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	passed: boolean;
	durationMs: number;
	outputArtifact: string;
}

// ---------------------------------------------------------------------------
// Subprocess tracking
// ---------------------------------------------------------------------------

const trackedProcesses: ChildProcess[] = [];

function trackProcess(proc: ChildProcess): ChildProcess {
	trackedProcesses.push(proc);
	proc.on("exit", () => {
		const idx = trackedProcesses.indexOf(proc);
		if (idx >= 0) trackedProcesses.splice(idx, 1);
	});
	return proc;
}

export function killAllTrackedProcesses(): void {
	while (trackedProcesses.length > 0) {
		const proc = trackedProcesses.pop()!;
		try {
			proc.kill("SIGTERM");
		} catch {
			// already dead
		}
	}
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Run a Python command and capture its output.
 */
export async function runPythonCommand(
	args: string[],
	options: {
		cwd: string;
		env?: Record<string, string>;
		timeoutMs?: number;
	},
): Promise<PythonCommandResult> {
	const timeoutMs = options.timeoutMs ?? 30_000;
	const command = `python ${args.join(" ")}`;
	const startedAt = Date.now();

	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const proc = spawn("python3", args, {
			cwd: options.cwd,
			env: { ...process.env, PYTHONUNBUFFERED: "1", ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
		});

		trackProcess(proc);

		const timer = setTimeout(() => {
			timedOut = true;
			if (!settled) {
				settled = true;
				proc.kill("SIGKILL");
			}
		}, timeoutMs);

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({
					command,
					cwd: options.cwd,
					exitCode: null,
					stdout,
					stderr: `${stderr}\nProcess error: ${err.message}`,
					startedAt,
					finishedAt: Date.now(),
					durationMs: Date.now() - startedAt,
					timedOut: false,
				});
			}
		});

		proc.on("close", (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve({
					command,
					cwd: options.cwd,
					exitCode: code,
					stdout,
					stderr,
					startedAt,
					finishedAt: Date.now(),
					durationMs: Date.now() - startedAt,
					timedOut,
				});
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Python server management
// ---------------------------------------------------------------------------

/**
 * Start the Python backend server on a random free port.
 */
export function startPythonServer(options: { cwd: string; portFile?: string }): PythonServerProcess {
	// Use port 0 to let the OS assign a free port
	const env: Record<string, string> = {
		PORT: "0",
	};
	if (options.portFile) {
		env.PORT_FILE = options.portFile;
	}

	const proc = spawn("python3", ["backend/server.py"], {
		cwd: options.cwd,
		env: { ...process.env, PYTHONUNBUFFERED: "1", ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});

	trackProcess(proc);

	return {
		proc,
		port: 0, // will be read from stdout or port file
		url: "",
		cwd: options.cwd,
	};
}

/**
 * Wait for server to be ready by reading its port from stdout.
 */
export async function waitForServer(
	server: PythonServerProcess,
	timeoutMs = 10_000,
): Promise<{ port: number; url: string }> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		let stdout = "";

		const onData = (chunk: Buffer) => {
			stdout += chunk.toString();
			const match = stdout.match(/PORT=(\d+)/);
			if (match) {
				cleanup();
				const port = parseInt(match[1], 10);
				server.port = port;
				server.url = `http://127.0.0.1:${port}`;
				resolve({ port, url: server.url });
			}
		};

		const onExit = () => {
			cleanup();
			reject(new Error(`Server exited before becoming ready. stdout: ${stdout}`));
		};

		const timer = setInterval(() => {
			if (Date.now() > deadline) {
				cleanup();
				reject(new Error(`Server timed out after ${timeoutMs}ms. stdout: ${stdout}`));
			}
		}, 100);

		function cleanup() {
			clearInterval(timer);
			server.proc.stdout?.removeListener("data", onData);
			server.proc.removeListener("exit", onExit);
		}

		server.proc.stdout?.on("data", onData);
		server.proc.on("exit", onExit);
	});
}

/**
 * Stop a running Python server.
 */
export async function stopServer(server: PythonServerProcess): Promise<void> {
	try {
		server.proc.kill("SIGTERM");
	} catch {
		// already dead
	}
	// Give it a moment to clean up
	await new Promise((r) => setTimeout(r, 100));
	if (server.proc.exitCode === null) {
		try {
			server.proc.kill("SIGKILL");
		} catch {
			// already dead
		}
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Run Python unittest as final validation.
 */
export async function runPythonValidation(cwd: string, timeoutMs = 30_000): Promise<PythonValidationResult> {
	const command = "python -m unittest discover -s tests -v";
	const result = await runPythonCommand(["-m", "unittest", "discover", "-s", "tests", "-v"], {
		cwd,
		timeoutMs,
	});

	// Write output artifact
	const artifactPath = path.join(cwd, "validation-output.txt");
	await fs.writeFile(artifactPath, `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`, "utf-8");

	return {
		command,
		cwd,
		exitCode: result.exitCode ?? -1,
		stdout: result.stdout,
		stderr: result.stderr,
		passed: result.exitCode === 0,
		durationMs: result.durationMs,
		outputArtifact: artifactPath,
	};
}

// ---------------------------------------------------------------------------
// HTTP health check
// ---------------------------------------------------------------------------

/**
 * Perform an HTTP health check against the server.
 */
export async function healthCheck(
	url: string,
	timeoutMs = 5000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const resp = await fetch(`${url}/health`, { signal: controller.signal });
		clearTimeout(timer);
		const data = (await resp.json()) as Record<string, unknown>;
		return { ok: data.ok === true, status: resp.status };
	} catch (err) {
		clearTimeout(timer);
		return { ok: false, error: String(err) };
	}
}
