import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationRunner } from "../src/core/validation-runner.js";
import { InMemoryActorEventSink } from "../src/execution-kernel/actor-events.js";

describe("P29 validation runner event-only", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p29-validation-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it("emits validation_started and validation_passed", async () => {
		const sink = new InMemoryActorEventSink();
		const runner = new ValidationRunner(sink);

		const result = await runner.run("echo hello", { timeoutMs: 5000, cwd: tmpDir });

		expect(result.success).toBe(true);
		expect(sink.events.map((e) => e.type)).toEqual(["validation_started", "validation_passed"]);
	});

	it("emits validation_timed_out on timeout", async () => {
		const sink = new InMemoryActorEventSink();
		const runner = new ValidationRunner(sink);

		const result = await runner.run("sleep 10", { timeoutMs: 100, cwd: tmpDir });

		expect(result.timedOut).toBe(true);
		expect(sink.events.some((e) => e.type === "validation_timed_out")).toBe(true);
	});
});
