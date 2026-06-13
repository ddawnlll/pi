#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
	{ id: "writegate-probe", cmd: "node scripts/p0-writegate-probe.mjs" },
	{ id: "tui-smoke", cmd: "node scripts/p0-tui-smoke.mjs" },
	{ id: "p0-audit-harness", cmd: "node reports/tmp/gate-sanity/P0/run-sanity-check.mjs" },
	{ id: "p0.1-chain-compile", cmd: "node scripts/p0-1-compile-chain.mjs" },
	{ id: "p0.1-onefile-evidence", cmd: "node scripts/p0-1-generate-onefile-evidence.mjs" },
];

const results = [];
for (const s of steps) {
	process.stdout.write(`\n=== ${s.id} ===\n$ ${s.cmd}\n`);
	try {
		const t0 = performance.now();
		execSync(s.cmd, { cwd: REPO_ROOT, stdio: "inherit", timeout: 60_000 });
		const dur = (performance.now() - t0).toFixed(0);
		process.stdout.write(`  ok (${dur}ms)\n`);
		results.push({ id: s.id, ok: true });
	} catch (e) {
		const dur = e.exitCode !== undefined ? e.exitCode : -1;
		process.stdout.write(`  FAILED (exit=${e.status ?? e.exitCode ?? -1})\n`);
		results.push({ id: s.id, ok: false, code: e.status ?? -1 });
		if (e.status === null && e.signal) {
			process.stderr.write(`  terminated by signal: ${e.signal}\n`);
		}
	}
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
	process.stderr.write("\nFAILED STEPS:\n");
	for (const f of failed) {
		process.stderr.write(`  - ${f.id}: exit=${f.code}\n`);
	}
	process.exit(1);
}

process.stdout.write("\n=== P0.1 RUNNER COMPLETE ===\nAll steps passed.\n");
process.exit(0);
