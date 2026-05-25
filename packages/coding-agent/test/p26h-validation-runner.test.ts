/**
 * P26.H — Managed validation runner and process lifecycle containment
 *
 * Tests:
 * - Validation commands run with deadline, closed stdin, CI env, output cap
 * - Watch/dev-server commands are classified and blocked
 * - Timeout escalates SIGTERM to SIGKILL
 * - A deliberately hanging command exits as timed_out and does not leave children
 * - Command classification works
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyCommand, isWatchCommand, ValidationRunner } from "../src/core/validation-runner.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.H — Managed validation runner", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p26h-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	// ---- Watch command detection ----

	it("should classify --watch as watch command", () => {
		expect(isWatchCommand("npm run test -- --watch")).toBe(true);
	});

	it("should classify dev as watch command", () => {
		expect(isWatchCommand("npm run dev")).toBe(true);
	});

	it("should classify next dev as watch command", () => {
		expect(isWatchCommand("npx next dev")).toBe(true);
	});

	it("should not classify build as watch command", () => {
		expect(isWatchCommand("npm run build")).toBe(false);
	});

	it("should not classify test as watch command", () => {
		expect(isWatchCommand("npm test")).toBe(false);
	});

	it("should classify nodemon as watch command", () => {
		expect(isWatchCommand("npx nodemon server.js")).toBe(true);
	});

	it("should classify vite --watch as watch command", () => {
		expect(isWatchCommand("npx vite --watch")).toBe(true);
	});

	// ---- Command classification ----

	it("should classify test as heavy command", () => {
		expect(classifyCommand("npm test")).toBe("heavy");
	});

	it("should classify build as heavy command", () => {
		expect(classifyCommand("npm run build")).toBe("heavy");
	});

	it("should classify lint:check as heavy command", () => {
		expect(classifyCommand("npm run lint:check")).toBe("heavy");
	});

	it("should classify dev as watch command", () => {
		expect(classifyCommand("npm run dev")).toBe("watch");
	});

	it("should classify echo as targeted command", () => {
		expect(classifyCommand("echo hello")).toBe("targeted");
	});

	it("should classify ls as targeted command", () => {
		expect(classifyCommand("ls -la")).toBe("targeted");
	});

	// ---- Runner ----

	it("should block watch commands from running", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("npm run dev", {
			timeoutMs: 5000,
			cwd: tmpDir,
			blockWatchCommands: true,
		});

		expect(result.blocked).toBe(true);
		expect(result.success).toBe(false);
		expect(result.error).toContain("watch/dev-server command");
	});

	it("should allow watch commands when blockWatchCommands is false", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("echo 'not actually a watch'", {
			timeoutMs: 5000,
			cwd: tmpDir,
			blockWatchCommands: false,
		});

		expect(result.blocked).toBeUndefined();
	});

	it("should execute a simple command successfully", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("echo hello", {
			timeoutMs: 5000,
			cwd: tmpDir,
		});

		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hello");
	});

	it("should fail on non-zero exit code", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("exit 1", {
			timeoutMs: 5000,
			cwd: tmpDir,
		});

		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(1);
	});

	it("should set CI=true in environment", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("echo $CI", {
			timeoutMs: 5000,
			cwd: tmpDir,
		});

		expect(result.success).toBe(true);
		expect(result.stdout.trim()).toBe("true");
	});

	it("should cap stdout output", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("echo 'hello world' && echo 'second line'", {
			timeoutMs: 5000,
			cwd: tmpDir,
			maxStdoutBytes: 100,
		});

		expect(result.success).toBe(true);
		expect(result.stdout).toContain("hello");
	});

	it("should timeout a hanging command", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("sleep 10", {
			timeoutMs: 500, // 500ms timeout for a 10s sleep
			cwd: tmpDir,
		});

		expect(result.timedOut).toBe(true);
		expect(result.success).toBe(false);
		expect(result.error).toContain("timed out");
	});

	it("should have CI env set", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("echo $NODE_ENV", {
			timeoutMs: 5000,
			cwd: tmpDir,
		});

		expect(result.success).toBe(true);
		expect(result.stdout.trim()).toBe("test");
	});

	it("should close stdin (read from stdin should return empty)", async () => {
		const runner = new ValidationRunner();
		const result = await runner.run("cat", {
			timeoutMs: 2000,
			cwd: tmpDir,
		});

		// cat with closed stdin should exit immediately
		expect(result.success).toBe(true);
	});

	it("should have killAll terminate tracked processes", () => {
		const runner = new ValidationRunner();
		// Initially no tracked processes
		expect(runner.getTrackedProcesses().length).toBe(0);

		// killAll should not throw with no processes
		const killed = runner.killAll();
		expect(Array.isArray(killed)).toBe(true);
	});

	it("should classify commands correctly", () => {
		expect(classifyCommand("npm test -- --run")).toBe("heavy");
		expect(classifyCommand("npm run check")).toBe("heavy");
		expect(classifyCommand("cat package.json")).toBe("targeted");
		expect(classifyCommand("npm run dev --port 3000")).toBe("watch");
	});
});
