#!/usr/bin/env node
/**
 * P49.5.04 — P49.5 Bridge Runner CLI
 *
 * Runs the full P49.5 bridge and writes the P45 readiness certificate.
 *
 * Usage:
 *   npx tsx scripts/run-p49-5-p45-readiness-gate.ts --output <path>
 */

import { runP495Bridge } from "../packages/coding-agent/src/core/p49_5/run-p45-readiness-gate.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

async function main() {
	const args = process.argv.slice(2);
	const outputIndex = args.indexOf("--output");
	const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "reports/p49_5_p45_readiness/p45-readiness-certificate.json";

	const repoRoot = process.cwd();
	const outputDir = path.dirname(path.resolve(outputPath));

	console.log(`[p49.5-bridge] Running P49.5 bridge from ${repoRoot}`);
	console.log(`[p49.5-bridge] Output: ${outputPath}`);

	const result = await runP495Bridge(repoRoot, outputDir);

	if (result.success) {
		console.log(`[p49.5-bridge] Bridge completed successfully`);
		console.log(`[p49.5-bridge] Decision: ${result.certificate?.decision}`);
		console.log(`[p49.5-bridge] Reports:`);
		for (const rp of result.reportPaths) {
			console.log(`  - ${rp}`);
		}
	} else {
		console.error(`[p49.5-bridge] Bridge failed: ${result.error}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("[p49.5-bridge] Fatal error:", err);
	process.exit(1);
});
