#!/usr/bin/env node
/**
 * P49.5.07 — Large-Plan Readiness Probe CLI
 *
 * Probes whether the repo supports guarded large-plan P45 mode.
 *
 * Usage:
 *   npx tsx scripts/run-p49-5-large-plan-readiness-probe.ts --output <path>
 */

import { runLargePlanReadinessProbe } from "../packages/coding-agent/src/core/p49_5/large-plan-readiness-probe.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

async function main() {
	const args = process.argv.slice(2);
	const outputIndex = args.indexOf("--output");
	const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "reports/p49_5_p45_readiness/large-plan-readiness.json";

	const repoRoot = process.cwd();
	const workspaceCount = parseInt(args[args.indexOf("--workspaces") + 1] ?? "42", 10);

	console.log(`[large-plan-probe] Probing large-plan readiness from ${repoRoot}`);
	console.log(`[large-plan-probe] Estimated workspace count: ${workspaceCount}`);

	const result = await runLargePlanReadinessProbe(repoRoot, workspaceCount);

	const absPath = path.resolve(outputPath);
	await fs.mkdir(path.dirname(absPath), { recursive: true });
	await fs.writeFile(absPath, JSON.stringify(result, null, 2));

	console.log(`[large-plan-probe] Verdict: ${result.verdict}`);
	console.log(`[large-plan-probe] Written to: ${absPath}`);

	if (result.verdict === "large_plan_blocked") {
		console.log(`[large-plan-probe] Blocking reasons: ${result.blockingReasons.join("; ")}`);
		process.exit(0); // Non-fatal — it's a probe result
	}
}

main().catch((err) => {
	console.error("[large-plan-probe] Fatal error:", err);
	process.exit(1);
});
