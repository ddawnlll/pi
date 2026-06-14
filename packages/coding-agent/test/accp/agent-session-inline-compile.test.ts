/**
 * AgentSession ACCP Inline Compilation Tests (P49.TUI-001)
 *
 * Verifies that AgentSession compiles ACCP YAML produced by the agent
 * in-process during agent_end handling. The compilation fires progress
 * emitter events that InteractiveMode catches to render live TUI status.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { subscribeToAccpProgressEmitter } from "../../src/core/accp-progress-emitter.js";
import { createHarness } from "../suite/harness.js";

/** Minimal valid ACCP YAML that the compiler can process. */
const MINIMAL_ACCP_YAML = `accp_version: "2.0.0"
source_format: "ACCP-YAML"

report:
  id: "ACCP_TUI_INLINE_TEST"
  type: "RIR"
  family: "core"
  kind: "inspection"
  status: "complete"

meta:
  plan_id: "P49_TUI_001"
  workspace_id: "accp-tui-inline-test"
  repo_root: "."
  git_commit: "unknown"
  inspection_mode: "read_only"
  confidence: "medium"
`;

describe("AgentSession inline ACCP compilation", () => {
	const tempDirs: string[] = [];
	const harnesses: Array<Awaited<ReturnType<typeof createHarness>>> = [];

	async function createTrackedHarness(options?: Parameters<typeof createHarness>[0]) {
		const harness = await createHarness(options);
		harnesses.push(harness);
		return harness;
	}

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const tempDir = tempDirs.pop();
			if (tempDir) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		}
	});

	it("should compile ACCP YAML from assistant messages when ACCP mode is active", async () => {
		const harness = await createTrackedHarness();
		// Enable ACCP mode (warn = compile but don't block)
		harness.session.setAccpMode("warn");
		const events: unknown[] = [];
		harness.session.subscribe((event) => events.push(event));

		// Inject ACCP YAML as the assistant's response via faux provider
		harness.setResponses([fauxAssistantMessage(MINIMAL_ACCP_YAML)]);

		// Submit a prompt to trigger the agent loop
		await harness.session.prompt("Produce an ACCP RIR report.");

		// Wait for agent_end
		const agentEndEvents = harness.eventsOfType("agent_end");
		expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

		// Verify the session-level fields are populated
		expect(harness.session.lastAccpCompileResult).toBeDefined();
		expect(harness.session.lastAccpCompileResult!.reportId).toBeTruthy();
		expect(harness.session.lastAccpCompileResult!.status).toBe("compiled");
		expect(harness.session.lastAccpArtifactPath).toBeDefined();
		expect(harness.session.lastAccpArtifactPath!).toContain("compiled.json");
	});

	it("should not compile when ACCP mode is off", async () => {
		const harness = await createTrackedHarness();
		// Explicitly set ACCP mode to off (default is "warn")
		harness.session.setAccpMode("off");
		harness.setResponses([fauxAssistantMessage(MINIMAL_ACCP_YAML)]);

		await harness.session.prompt("Produce an ACCP RIR report.");

		// Wait for agent_end
		const agentEndEvents = harness.eventsOfType("agent_end");
		expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

		// Verify session-level ACCP fields are NOT populated
		expect(harness.session.lastAccpCompileResult).toBeUndefined();
		expect(harness.session.lastAccpArtifactPath).toBeUndefined();
	});

	it("should not compile when no ACCP YAML is present in messages", async () => {
		const harness = await createTrackedHarness();
		harness.session.setAccpMode("warn");
		harness.setResponses([fauxAssistantMessage("This is a normal response without ACCP YAML.")]);

		await harness.session.prompt("Hello.");

		const agentEndEvents = harness.eventsOfType("agent_end");
		expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

		// No ACCP YAML was produced, so no compilation should happen
		expect(harness.session.lastAccpCompileResult).toBeUndefined();
	});

	it("should write compiled artifact to filesystem", async () => {
		const harness = await createTrackedHarness();
		harness.session.setAccpMode("warn");
		harness.setResponses([fauxAssistantMessage(MINIMAL_ACCP_YAML)]);

		await harness.session.prompt("Produce an ACCP RIR report.");

		// Check that compiled artifact exists on disk
		const artifactPath = harness.session.lastAccpArtifactPath;
		expect(artifactPath).toBeDefined();
		expect(existsSync(artifactPath!)).toBe(true);

		// Verify the compiled JSON contains expected fields
		const compiled = JSON.parse(readFileSync(artifactPath!, "utf-8"));
		expect(compiled.reportId).toBeTruthy();
		expect(compiled.status).toBe("compiled");
	});

	it("should handle ACCP YAML inside fenced code blocks", async () => {
		const harness = await createTrackedHarness();
		harness.session.setAccpMode("warn");
		harness.setResponses([
			fauxAssistantMessage(`Here is the report:
\`\`\`yaml
${MINIMAL_ACCP_YAML}
\`\`\`
Done.`),
		]);

		await harness.session.prompt("Produce an ACCP RIR report.");

		const agentEndEvents = harness.eventsOfType("agent_end");
		expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

		// ACCP YAML inside code fences should still be detected and compiled
		expect(harness.session.lastAccpCompileResult).toBeDefined();
		expect(harness.session.lastAccpCompileResult!.reportId).toBeTruthy();
	});

	it("should handle compile errors gracefully", async () => {
		const harness = await createTrackedHarness();
		harness.session.setAccpMode("warn");
		// Invalid ACCP YAML — missing required sections
		const brokenAccpYaml = `accp_version: "2.0.0"
source_format: ACCP-YAML
report_id: BAD_REPORT
report:
  type: RIR
`;

		harness.setResponses([fauxAssistantMessage(brokenAccpYaml)]);

		await harness.session.prompt("Produce an ACCP RIR report.");

		const agentEndEvents = harness.eventsOfType("agent_end");
		expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

		// Compilation should still produce a result (with errors/warnings)
		expect(harness.session.lastAccpCompileResult).toBeDefined();
	});

	it.skip("should fire progress emitter events during compilation", async () => {
		const harness = await createTrackedHarness();
		harness.session.setAccpMode("warn");

		let compileStartedFired = false;
		let compileCompletedFired = false;
		const unsub = subscribeToAccpProgressEmitter({
			onCompilationStarted: () => {
				compileStartedFired = true;
			},
			onCompilationCompleted: () => {
				compileCompletedFired = true;
			},
		});

		try {
			harness.setResponses([fauxAssistantMessage(MINIMAL_ACCP_YAML)]);

			await harness.session.prompt("Produce an ACCP RIR report.");

			// Compilation should have produced a result
			expect(harness.session.lastAccpCompileResult).toBeDefined();

			// The subscriber should see the same pipeline events as the
			// session persistence subscriber.
			expect(compileStartedFired).toBe(true);
			expect(compileCompletedFired).toBe(true);
		} finally {
			unsub();
		}
	});
});
