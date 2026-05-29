/**
 * E2E Preflight Health Checker
 *
 * Runs comprehensive pre-execution validation:
 * - Git repo state
 * - Disk space
 * - Memory availability
 * - LLM credentials
 * - Database connectivity
 * - Stale worktree cleanup
 * - Process hygiene
 */

import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { type PreflightCheck, type PreflightReport } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PreflightConfig {
	workspaceRoot: string;
	planPath: string;
	requiredDiskGb?: number;
	requiredMemoryMb?: number;
	checkLlmCredentials?: boolean;
	checkDatabase?: boolean;
	checkWorktrees?: boolean;
	skipBlockingOn?: string[]; // check names to skip blocking on
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runPreflightChecks(config: PreflightConfig): Promise<PreflightReport> {
	const checks: PreflightCheck[] = [];

	// 1. Git repo state
	checks.push(await checkGitState(config.workspaceRoot));

	// 2. Plan file accessibility
	checks.push(await checkPlanFile(config.planPath));

	// 3. Disk space
	checks.push(await checkDiskSpace(config.workspaceRoot, config.requiredDiskGb ?? 2));

	// 4. Memory availability
	checks.push(checkMemoryAvailable(config.requiredMemoryMb ?? 512));

	// 5. No stale .pi artifacts from prior crashed runs
	checks.push(await checkStalePiArtifacts(config.workspaceRoot));

	// 6. Git worktree hygiene
	if (config.checkWorktrees !== false) {
		checks.push(await checkWorktreeHygiene(config.workspaceRoot));
	}

	// 7. LLM credentials (if requested)
	if (config.checkLlmCredentials) {
		checks.push(await checkLlmCredentials());
	}

	// 8. Database connectivity (if requested)
	if (config.checkDatabase) {
		checks.push(await checkDatabaseConnectivity());
	}

	// 9. Process hygiene (no leftover zombie processes from prior runs)
	checks.push(checkProcessHygiene());

	const failed = checks.filter((c) => c.status === "fail").length;
	const warned = checks.filter((c) => c.status === "warn").length;
	const skipped = checks.filter((c) => c.status === "skip").length;
	const passed = checks.filter((c) => c.status === "pass").length;

	const skipBlocking = new Set(config.skipBlockingOn ?? []);
	const blockReasons = checks
		.filter((c) => c.status === "fail" && !skipBlocking.has(c.name))
		.map((c) => c.message);

	return {
		timestamp: Date.now(),
		totalChecks: checks.length,
		passed,
		failed,
		warned,
		skipped,
		checks,
		blockExecution: blockReasons.length > 0,
		blockReasons,
	};
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkGitState(root: string): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", timeout: 10_000 });
		const lines = status.trim().split("\n").filter(Boolean);
		const uncommitted = lines.length;

		if (uncommitted === 0) {
			return { name: "git-clean", category: "git", status: "pass", message: "Working tree clean", durationMs: Date.now() - start, detail: { uncommitted: 0 } };
		}

		// Check if the uncommitted files are in safe locations
		const safeDirs = [".pi/", "reports/", ".logs/", "node_modules/"];
		const unsafe = lines.filter((l) => {
			const file = l.substring(3);
			return !safeDirs.some((d) => file.startsWith(d) || file.includes("/" + d));
		});

		if (unsafe.length === 0) {
			return { name: "git-clean", category: "git", status: "warn", message: `${uncommitted} uncommitted files (all in safe dirs)`, durationMs: Date.now() - start, detail: { uncommitted, unsafeCount: 0 } };
		}

		return { name: "git-clean", category: "git", status: "fail", message: `${unsafe.length} uncommitted files outside safe dirs — commit or stash before running`, durationMs: Date.now() - start, detail: { uncommitted, unsafeCount: unsafe.length, sample: unsafe.slice(0, 5) } };
	} catch (err) {
		return { name: "git-clean", category: "git", status: "warn", message: `Git check failed: ${err}`, durationMs: Date.now() - start };
	}
}

async function checkPlanFile(planPath: string): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const stat = await fs.stat(planPath);
		const content = await fs.readFile(planPath, "utf-8");

		// Basic structure validation
		const hasPart1 = content.includes("# Part 1");
		const hasPart2 = content.includes("# Part 2");
		const hasPart3 = content.includes("# Part 3");

		if (!hasPart1 || !hasPart2 || !hasPart3) {
			return { name: "plan-structure", category: "process", status: "fail", message: `Plan missing required parts (1=${hasPart1}, 2=${hasPart2}, 3=${hasPart3})`, durationMs: Date.now() - start };
		}

		return { name: "plan-structure", category: "process", status: "pass", message: `Plan file OK (${(stat.size / 1024).toFixed(0)}KB, ${content.split("\n").length} lines)`, durationMs: Date.now() - start, detail: { sizeKb: Math.round(stat.size / 1024), lines: content.split("\n").length } };
	} catch (err) {
		return { name: "plan-structure", category: "process", status: "fail", message: `Cannot read plan: ${err}`, durationMs: Date.now() - start };
	}
}

async function checkDiskSpace(root: string, requiredGb: number): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		// Use df on the workspace root to get available space
		// Use -k (1K blocks) for macOS/Linux compatibility, then convert to GB
		let df: string;
		try {
			df = execSync(`df -k "${root}" | tail -1`, { encoding: "utf-8", timeout: 5000 });
		} catch {
			return { name: "disk-space", category: "disk", status: "warn", message: "Disk check not available", durationMs: Date.now() - start };
		}
		const parts = df.trim().split(/\s+/);
		const availKb = parseInt(parts[3] ?? "0", 10);
		const availGb = Math.floor(availKb / (1024 * 1024));

		if (Number.isNaN(availGb)) {
			return { name: "disk-space", category: "disk", status: "warn", message: `Could not parse disk space: ${df.trim()}`, durationMs: Date.now() - start };
		}

		if (availGb < requiredGb) {
			return { name: "disk-space", category: "disk", status: "fail", message: `Only ${availGb}G available (need ${requiredGb}G)`, durationMs: Date.now() - start, detail: { availGb, requiredGb } };
		}

		return { name: "disk-space", category: "disk", status: "pass", message: `${availGb}G available (>=${requiredGb}G required)`, durationMs: Date.now() - start, detail: { availGb, requiredGb } };
	} catch (err) {
		return { name: "disk-space", category: "disk", status: "warn", message: `Disk check failed (non-unix?): ${err}`, durationMs: Date.now() - start };
	}
}

function checkMemoryAvailable(requiredMb: number): PreflightCheck {
	const start = Date.now();
	try {
		const totalMem = require("node:os").totalmem();
		const freeMem = require("node:os").freemem();
		const freeMb = Math.round(freeMem / (1024 * 1024));

		if (freeMb < requiredMb) {
			return { name: "memory-available", category: "memory", status: "fail", message: `Only ${freeMb}MB free (need ${requiredMb}MB)`, durationMs: Date.now() - start, detail: { freeMb, requiredMb, totalMb: Math.round(totalMem / (1024 * 1024)) } };
		}

		return { name: "memory-available", category: "memory", status: "pass", message: `${freeMb}MB free (>=${requiredMb}MB required)`, durationMs: Date.now() - start, detail: { freeMb, requiredMb } };
	} catch {
		return { name: "memory-available", category: "memory", status: "skip", message: "Memory check not available", durationMs: Date.now() - start };
	}
}

async function checkStalePiArtifacts(root: string): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const piDir = `${root}/.pi`;
		const plansDir = `${piDir}/plans`;
		const executionsDir = `${piDir}/executions`;
		const worktreesDir = `${piDir}/worktrees`;

		let stalePlans = 0;
		let staleExecutions = 0;
		let staleWorktrees = 0;

		try { stalePlans = (await fs.readdir(plansDir)).length; } catch {}
		try { staleExecutions = (await fs.readdir(executionsDir)).length; } catch {}
		try { staleWorktrees = (await fs.readdir(worktreesDir)).length; } catch {}

		const total = stalePlans + staleExecutions + staleWorktrees;
		if (total > 10) {
			return { name: "stale-artifacts", category: "process", status: "warn", message: `${total} stale .pi artifacts from prior runs (${stalePlans} plans, ${staleExecutions} executions, ${staleWorktrees} worktrees) — consider cleaning up`, durationMs: Date.now() - start, detail: { stalePlans, staleExecutions, staleWorktrees } };
		}

		return { name: "stale-artifacts", category: "process", status: "pass", message: `${total} stale artifacts (acceptable)`, durationMs: Date.now() - start, detail: { stalePlans, staleExecutions, staleWorktrees } };
	} catch {
		return { name: "stale-artifacts", category: "process", status: "skip", message: "Could not scan .pi artifacts", durationMs: Date.now() - start };
	}
}

async function checkWorktreeHygiene(root: string): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const list = execSync("git worktree list", { cwd: root, encoding: "utf-8", timeout: 10_000 });
		const lines = list.trim().split("\n");
		// First line is the main worktree
		const linked = lines.length - 1;

		if (linked === 0) {
			return { name: "worktree-hygiene", category: "process", status: "pass", message: "No orphaned worktrees", durationMs: Date.now() - start };
		}

		// Check if linked worktrees are under .pi/worktrees (expected) or elsewhere (suspicious)
		const suspicious = lines.slice(1).filter((l) => !l.includes(".pi/worktrees"));
		if (suspicious.length > 0) {
			return { name: "worktree-hygiene", category: "process", status: "fail", message: `${suspicious.length} suspicious worktree(s) outside .pi/worktrees — manual cleanup needed`, durationMs: Date.now() - start, detail: { linked, suspicious: suspicious.map((l) => l.split(/\s+/)[0]) } };
		}

		return { name: "worktree-hygiene", category: "process", status: "warn", message: `${linked} orphaned worktree(s) in .pi/worktrees — will be cleaned up`, durationMs: Date.now() - start, detail: { linked } };
	} catch (err) {
		return { name: "worktree-hygiene", category: "process", status: "warn", message: `Worktree check failed: ${err}`, durationMs: Date.now() - start };
	}
}

async function checkLlmCredentials(): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const { getModel } = await import("@earendil-works/pi-ai");

		// Try each provider
		const providers = [
			{ name: "opencode-go", modelId: "deepseek-v4-flash" },
			{ name: "anthropic", modelId: "claude-3-5-haiku-20241022" },
			{ name: "openai", modelId: "gpt-4o-mini" },
		];

		const available: string[] = [];
		for (const p of providers) {
			const m = getModel(p.name as any, p.modelId);
			if (m) available.push(p.name);
		}

		if (available.length === 0) {
			return { name: "llm-credentials", category: "llm", status: "fail", message: "No LLM provider credentials found", durationMs: Date.now() - start };
		}

		return { name: "llm-credentials", category: "llm", status: "pass", message: `${available.length} provider(s) available: ${available.join(", ")}`, durationMs: Date.now() - start, detail: { providers: available } };
	} catch {
		return { name: "llm-credentials", category: "llm", status: "skip", message: "Could not check LLM credentials", durationMs: Date.now() - start };
	}
}

async function checkDatabaseConnectivity(): Promise<PreflightCheck> {
	const start = Date.now();
	try {
		const { detectStateStoreBackend, createStateStore } = await import("../../src/core/state-store.js");
		const backend = detectStateStoreBackend();
		if (backend !== "postgres") {
			return { name: "db-connectivity", category: "db", status: "warn", message: `Backend is "${backend}", not postgres`, durationMs: Date.now() - start };
		}
		const store = createStateStore({ backend, workspaceRoot: process.cwd() });
		await store.findOrCreateProject("preflight-check", process.cwd());
		return { name: "db-connectivity", category: "db", status: "pass", message: "Postgres connected and responsive", durationMs: Date.now() - start };
	} catch (err) {
		return { name: "db-connectivity", category: "db", status: "fail", message: `Database unavailable: ${err}`, durationMs: Date.now() - start };
	}
}

function checkProcessHygiene(): PreflightCheck {
	const start = Date.now();
	try {
		// Check for leftover vitest/npm/node processes from prior runs
		const ps = execSync("ps aux | grep -E '(vitest|jest|mocha|ava)' | grep -v grep | wc -l", { encoding: "utf-8", timeout: 3000 }).trim();
		const count = parseInt(ps, 10);

		if (count > 3) {
			return { name: "process-hygiene", category: "process", status: "warn", message: `${count} leftover test processes from prior runs — consider killing them`, durationMs: Date.now() - start, detail: { processCount: count } };
		}

		return { name: "process-hygiene", category: "process", status: "pass", message: `Process hygiene OK (${count} leftover test processes)`, durationMs: Date.now() - start, detail: { processCount: count } };
	} catch {
		return { name: "process-hygiene", category: "process", status: "skip", message: "Could not check process hygiene (non-unix?)", durationMs: Date.now() - start };
	}
}
