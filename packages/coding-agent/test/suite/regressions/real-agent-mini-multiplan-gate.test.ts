/**
 * Regression tests for scripts/run-real-agent-mini-multiplan-gate.ts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const scriptPath = path.join(repoRoot, "scripts", "run-real-agent-mini-multiplan-gate.ts");

type GateRun = { stdout: string; reportDir: string };

const cache = new Map<string, GateRun>();

function runGate(fault: string, extraEnv: Record<string, string> = {}): GateRun {
	const key = `${fault}:${JSON.stringify(extraEnv)}`;
	const cached = cache.get(key);
	if (cached) return cached;
	const stdout = execFileSync("npx", ["tsx", scriptPath], {
		cwd: repoRoot,
		env: {
			...process.env,
			PI_REAL_AGENT_GATE_MODE: "commit",
			PI_REAL_AGENT_GATE_FAULT: fault,
			...extraEnv,
		},
		encoding: "utf-8",
	});
	const reportLine = stdout.split("\n").find((line) => line.startsWith("Report dir: "));
	expect(reportLine).toBeTruthy();
	const reportDir = reportLine?.replace("Report dir: ", "").trim() ?? "";
	const result = { stdout, reportDir };
	cache.set(key, result);
	return result;
}

function readJson<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function failedCommandOutput(error: unknown): string {
	if (!error || typeof error !== "object") return String(error);
	const record = error as Record<string, unknown>;
	const stdout =
		typeof record.stdout === "string"
			? record.stdout
			: Buffer.isBuffer(record.stdout)
				? record.stdout.toString("utf-8")
				: "";
	const stderr =
		typeof record.stderr === "string"
			? record.stderr
			: Buffer.isBuffer(record.stderr)
				? record.stderr.toString("utf-8")
				: "";
	return `${stdout}\n${stderr}`;
}

describe("real-agent mini multi-plan gate", () => {
	it("Plan A builds a 6-wide first dependency-ready batch", () => {
		const { stdout, reportDir } = runGate("none");
		expect(stdout).toContain("Final verdict: PASS");
		const report = readJson<{ initialDependencyReadyCount: number; observedMaxParallelism: number }>(
			path.join(reportDir, "plan-a-wide6", "final-report.json"),
		);
		expect(report.initialDependencyReadyCount).toBeGreaterThanOrEqual(6);
		expect(report.observedMaxParallelism).toBeGreaterThanOrEqual(6);
	});

	it("Plan B builds a 3-wide first dependency-ready batch", () => {
		const { reportDir } = runGate("none");
		const report = readJson<{ initialDependencyReadyCount: number; observedMaxParallelism: number }>(
			path.join(reportDir, "plan-b-narrow3", "final-report.json"),
		);
		expect(report.initialDependencyReadyCount).toBeGreaterThanOrEqual(3);
		expect(report.observedMaxParallelism).toBeGreaterThanOrEqual(3);
	});

	it("Plan C uses task/plan mapping", () => {
		const { reportDir } = runGate("none");
		const mapping = readJson<{ taskId: string; planExecIds: string[]; plans: Record<string, string> }>(
			path.join(reportDir, "task-plan-mapping.json"),
		);
		expect(mapping.taskId).toContain("task-");
		expect(mapping.planExecIds).toHaveLength(3);
		expect(mapping.plans["plan-c-task-execution"]).toBeTruthy();
	});

	it("file_lock_contention records wait and release events", () => {
		const { reportDir } = runGate("file_lock_contention");
		const lockEvents = readFileSync(path.join(reportDir, "plan-a-wide6", "lock-events.ndjson"), "utf-8");
		expect(lockEvents).toContain("file_lock_wait");
		expect(lockEvents).toContain("file_lock_released");
	});

	it("pause_resume_midflight prevents new launches while paused", () => {
		const { reportDir } = runGate("pause_resume_midflight");
		const taskEvents = readFileSync(path.join(reportDir, "plan-c-task-execution", "task-events.ndjson"), "utf-8");
		expect(taskEvents).toContain("pause_recorded");
		expect(taskEvents).toContain("preventedLaunch");
		expect(taskEvents).toContain("resume_recorded");
	});

	it("restart_after_plan_a does not duplicate completed workspaces", () => {
		const { reportDir } = runGate("restart_after_plan_a");
		const restartEvents = readFileSync(
			path.join(reportDir, "plan-c-task-execution", "restart-events.ndjson"),
			"utf-8",
		);
		expect(restartEvents).toContain("restart_recovered");
		expect(restartEvents).toContain("completedWorkspacesNotDuplicated");
	});

	it("worker_hang triggers watchdog and terminalizes explicitly", () => {
		const { reportDir } = runGate("worker_hang");
		const report = readJson<{ faultHandled: boolean; planStatus: string }>(
			path.join(reportDir, "plan-a-wide6", "final-report.json"),
		);
		expect(report.faultHandled).toBe(true);
		expect(report.planStatus).toBe("failed");
		expect(readFileSync(path.join(reportDir, "plan-a-wide6", "hang-analysis.md"), "utf-8")).toContain("stalled");
	});

	it("failed_dependency does not leave downstream pending", () => {
		const { reportDir } = runGate("failed_dependency");
		const report = readJson<{ counts: { pending: number; blocked: number }; faultHandled: boolean }>(
			path.join(reportDir, "plan-b-narrow3", "final-report.json"),
		);
		expect(report.faultHandled).toBe(true);
		expect(report.counts.pending).toBe(0);
		expect(report.counts.blocked).toBeGreaterThan(0);
	});

	it("validation_hang kills validation process and releases lock", () => {
		const { reportDir } = runGate("validation_hang");
		const validationEvents = readFileSync(
			path.join(reportDir, "plan-c-task-execution", "validation-events.ndjson"),
			"utf-8",
		);
		expect(validationEvents).toContain("validation_timeout_killed");
		expect(validationEvents).toContain("childKilled");
	});

	it("double_start prevents duplicate execution", () => {
		const { reportDir } = runGate("double_start");
		const taskEvents = readFileSync(path.join(reportDir, "plan-c-task-execution", "task-events.ndjson"), "utf-8");
		expect(taskEvents).toContain("double_start_prevented");
	});

	it("stale_completion_signal is ignored", () => {
		const { reportDir } = runGate("stale_completion_signal");
		const restartEvents = readFileSync(
			path.join(reportDir, "plan-c-task-execution", "restart-events.ndjson"),
			"utf-8",
		);
		expect(restartEvents).toContain("stale_completion_signal_ignored");
	});

	it("state_write_race does not lose terminal transitions", () => {
		const { reportDir } = runGate("state_write_race");
		const report = readJson<{ counts: { complete: number; active: number; pending: number }; verdict: string }>(
			path.join(reportDir, "plan-c-task-execution", "final-report.json"),
		);
		expect(report.verdict).toBe("PASS");
		expect(report.counts.active).toBe(0);
		expect(report.counts.pending).toBe(0);
	});

	it("bug ledger writes entries in expected schema", () => {
		const { reportDir } = runGate("worker_hang");
		const ledger = readJson<Array<{ id: string; status: string; evidenceArtifacts: string[] }>>(
			path.join(reportDir, "bug-ledger.json"),
		);
		expect(ledger.length).toBeGreaterThan(0);
		expect(ledger[0].id).toContain("EXEC-BUG");
		expect(ledger[0].status).toBeTruthy();
		expect(Array.isArray(ledger[0].evidenceArtifacts)).toBe(true);
	});

	it("invariant failure exits non-zero", () => {
		expect(() => runGate("none", { PI_REAL_AGENT_GATE_FORCE_INVARIANT_FAIL: "1" })).toThrow();
	});

	it("resolves PI_E2E_DATABASE_URL for postgres preflight without leaking secrets", () => {
		const stdout = execFileSync("npx", ["tsx", scriptPath], {
			cwd: repoRoot,
			env: {
				...process.env,
				DATABASE_URL: "",
				POSTGRES_URL: "",
				PGHOST: "",
				PGDATABASE: "",
				PGUSER: "",
				PGPASSWORD: "",
				PI_REAL_AGENT_GATE_MODE: "real-llm",
				PI_DIAG_RUN_REAL_LLM: "1",
				PI_STATE_STORE_BACKEND: "postgres",
				PI_REAL_AGENT_GATE_DB_PREFLIGHT_ONLY: "1",
				PI_E2E_DATABASE_URL: "postgres://gate_user:super-secret-password@localhost:5544/pi_gate_test",
			},
			encoding: "utf-8",
		});
		expect(stdout).toContain("source=PI_E2E_DATABASE_URL");
		expect(stdout).toContain("localhost:5544/pi_gate_test as gate_user");
		expect(stdout).not.toContain("super-secret-password");
	});

	it("prints sanitized postgres connectivity diagnostics", () => {
		try {
			execFileSync("npx", ["tsx", scriptPath], {
				cwd: repoRoot,
				env: {
					...process.env,
					DATABASE_URL: "",
					PI_E2E_DATABASE_URL: "",
					POSTGRES_URL: "",
					PGPASSWORD: "secret-password-that-must-not-leak",
					PGHOST: "127.0.0.1",
					PGPORT: "9",
					PGDATABASE: "pi_missing_test",
					PGUSER: "pi_missing_user",
					PGCONN_TIMEOUT: "250",
					PI_REAL_AGENT_GATE_MODE: "real-llm",
					PI_DIAG_RUN_REAL_LLM: "1",
					PI_STATE_STORE_BACKEND: "postgres",
				},
				encoding: "utf-8",
			});
			throw new Error("Expected postgres preflight to fail");
		} catch (error) {
			const output = failedCommandOutput(error);
			expect(output).toContain("Postgres connectivity check failed");
			expect(output).toContain("Error code:");
			expect(output).toContain("message:");
			expect(output).toContain("Postgres is not listening there or the port is not published");
			expect(output).toContain("127.0.0.1:9/pi_missing_test as pi_missing_user");
			expect(output).toContain('psql -c "select 1;"');
			expect(output).not.toContain("secret-password-that-must-not-leak");
		}
	});

	it("writes required suite artifacts", () => {
		const { reportDir } = runGate("none");
		expect(existsSync(path.join(reportDir, "suite-final-report.md"))).toBe(true);
		expect(existsSync(path.join(reportDir, "suite-final-report.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "suite-invariant-results.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "suite-summary.ndjson"))).toBe(true);
	});
});
