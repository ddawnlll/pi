/**
 * Regression tests for scripts/run-mini-execution-correctness-e2e.ts.
 *
 * These tests execute the actual mini E2E script in deterministic mode and
 * verify that required suite artifacts and central bug ledger outputs exist.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const scriptPath = path.join(repoRoot, "scripts", "run-mini-execution-correctness-e2e.ts");
const diagnosticsDir = path.join(repoRoot, "reports", "execution-diagnostics");

function runMiniE2E(env: Record<string, string>): { stdout: string; reportDir: string } {
	const stdout = execFileSync("npx", ["tsx", scriptPath], {
		cwd: repoRoot,
		env: {
			...process.env,
			PI_MINI_E2E_MODE: "deterministic",
			...env,
		},
		encoding: "utf-8",
	});
	const reportLine = stdout.split("\n").find((line) => line.startsWith("Report dir: "));
	expect(reportLine).toBeTruthy();
	const reportDir = reportLine?.replace("Report dir: ", "").trim() ?? "";
	return { stdout, reportDir };
}

describe("mini execution correctness E2E script", () => {
	it("runs the official deterministic suite and writes required artifacts", () => {
		const { stdout, reportDir } = runMiniE2E({ PI_MINI_E2E_FAULT: "none" });

		expect(stdout).toContain("Final verdict: PASS");
		expect(existsSync(path.join(reportDir, "suite-final-report.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "suite-final-report.md"))).toBe(true);
		expect(existsSync(path.join(reportDir, "suite-invariant-results.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "plan-a-wide6", "final-report.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "plan-b-narrow3", "final-report.json"))).toBe(true);
		expect(existsSync(path.join(reportDir, "plan-c-task-execution", "task-events.ndjson"))).toBe(true);
		expect(existsSync(path.join(diagnosticsDir, "bug-ledger.json"))).toBe(true);
		expect(existsSync(path.join(diagnosticsDir, "bug-ledger.ndjson"))).toBe(true);
		expect(existsSync(path.join(diagnosticsDir, "mini-e2e-bug-hunt-report.md"))).toBe(true);
	});

	it("handles lease_leak_simulation and records recovered lease evidence", () => {
		const { stdout, reportDir } = runMiniE2E({
			PI_MINI_E2E_FAULT: "lease_leak_simulation",
			PI_MINI_E2E_PLAN_SET: "wide6",
		});

		expect(stdout).toContain("Final verdict: PASS");
		const worktreeEvents = readFileSync(path.join(reportDir, "plan-a-wide6", "worktree-events.ndjson"), "utf-8");
		expect(worktreeEvents).toContain("stale_lease_recovered");
		const ledger = readFileSync(path.join(diagnosticsDir, "bug-ledger.ndjson"), "utf-8");
		expect(ledger).toContain("Stale worktree lease recovered");
	});
});
