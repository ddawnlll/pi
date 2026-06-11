import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runP495Bridge } from "../../src/core/p49_5/run-p45-readiness-gate.js";

// Repo root is 2 levels up from packages/coding-agent
const repoRoot = path.resolve(process.cwd(), "../..");

describe("P495BridgeRunner", () => {
	it("runs bridge and produces certificate", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p495-test-"));
		const result = await runP495Bridge(repoRoot, tmpDir);
		expect(result.success).toBe(true);
		expect(result.certificate).toBeDefined();
		expect(["allow_p45", "allow_fixture_only", "block_p45"]).toContain(result.certificate!.decision);
		expect(result.reportPaths.length).toBeGreaterThan(0);

		// Cleanup
		await fs.rm(tmpDir, { recursive: true, force: true });
	}, 30000);
});
