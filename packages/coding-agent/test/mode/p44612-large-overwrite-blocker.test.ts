import { describe, expect, it } from "vitest";
import { EngineMode, type WriteConfig } from "../../src/core/mode/engine-mode.js";
import { addConstraint, createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import {
	evaluateLargeOverwrite,
	LARGE_REWRITE_THRESHOLD_BYTES,
} from "../../src/core/write-gate/large-overwrite-blocker.js";

describe("evaluateLargeOverwrite", () => {
	it("permits write of small files", () => {
		const config: WriteConfig = { mode: EngineMode.Write, targetPath: "/tmp/small.ts", overwritePolicy: "allow" };
		const result = evaluateLargeOverwrite(config, createTaskIntentEnvelope("write small"), 100);
		expect(result.permitted).toBe(true);
	});

	it("blocks large rewrite without scope grant", () => {
		const config: WriteConfig = { mode: EngineMode.Write, targetPath: "/tmp/large.ts", overwritePolicy: "allow" };
		const result = evaluateLargeOverwrite(
			config,
			createTaskIntentEnvelope("write large"),
			LARGE_REWRITE_THRESHOLD_BYTES + 1,
		);
		expect(result.permitted).toBe(false);
		expect(result.diagnostics.some((d) => d.code === "BLOCKED_LARGE_OVERWRITE")).toBe(true);
	});

	it("permits large rewrite with scope grant and preservation evidence", () => {
		const config: WriteConfig = { mode: EngineMode.Write, targetPath: "/tmp/large.ts", overwritePolicy: "allow" };
		let envelope = createTaskIntentEnvelope("rewrite large file");
		envelope = addConstraint(envelope, { domain: "scope", description: "full rewrite permitted", hardness: "hard" });
		envelope = addConstraint(envelope, {
			domain: "preserve",
			description: "Keep copyright header",
			hardness: "hard",
		});
		const result = evaluateLargeOverwrite(config, envelope, LARGE_REWRITE_THRESHOLD_BYTES + 1);
		expect(result.permitted).toBe(true);
		expect(result.rewriteScopeGranted).toBe(true);
		expect(result.preservationEvidencePresent).toBe(true);
	});

	it("passes through for non-write modes", () => {
		const config = { mode: EngineMode.Edit, targetPath: "/tmp/large.ts" } as any;
		const result = evaluateLargeOverwrite(
			config,
			createTaskIntentEnvelope("edit"),
			LARGE_REWRITE_THRESHOLD_BYTES + 1,
		);
		expect(result.permitted).toBe(true);
	});
});
