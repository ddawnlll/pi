/**
 * Signal & Anomaly Engine — Tests (V5.06)
 *
 * Acceptance criteria:
 * 1. Repeated validation signature after threshold creates validation_repeat signal.
 * 2. A memory conflict that affects a proposal creates a decision-impact warning signal.
 * 3. Signals dedupe through cooldown keys and do not spam.
 * 4. Signals can feed proposals, push, overview, and Ask Pi answers.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { createSignalEngine, type SignalEngine } from "../../src/brain/signals/engine.js";
import { InMemoryBrainTimelineStore } from "../../src/brain/timeline-store.js";
import { V5MutationGuard } from "../../src/brain/v5/mutation-guard.js";
import type { BrainV5Config } from "../../src/brain/v5/types.js";
import { InMemoryActorEventSink } from "../../src/execution-kernel/actor-events.js";

const ADVISORY_CONFIG: BrainV5Config = {
	enabled: true,
	readOnlyMode: false,
	pushEnabled: false,
	overnightOperatorEnabled: false,
	mode: "ADVISORY",
};

const DRAFTING_CONFIG: BrainV5Config = {
	enabled: true,
	readOnlyMode: false,
	pushEnabled: true,
	overnightOperatorEnabled: false,
	mode: "DRAFTING",
};

describe("SignalEngine", () => {
	let timelineStore: InMemoryBrainTimelineStore;
	let actorSink: InMemoryActorEventSink;
	let mutationGuard: V5MutationGuard;
	let engine: SignalEngine;

	beforeEach(() => {
		timelineStore = new InMemoryBrainTimelineStore();
		actorSink = new InMemoryActorEventSink();
		mutationGuard = new V5MutationGuard(ADVISORY_CONFIG, timelineStore, actorSink);
		engine = createSignalEngine(timelineStore, mutationGuard, {
			validationRepeat: { threshold: 3, windowMs: 60_000 },
			cooldown: {
				defaultCooldownMs: 300_000,
				perTypeCooldownMs: { validation_repeat: 500, decision_impact: 500 },
			},
		});
	});

	// ===================================================================
	// AC1: Repeated validation signature after threshold
	// ===================================================================
	describe("AC1: Validation Repeat Detection", () => {
		test("should NOT emit a signal below the repeat threshold", async () => {
			await engine.recordValidation("src/foo.ts:e-42", "Foo error 42");
			await engine.recordValidation("src/foo.ts:e-42", "Foo error 42");

			const events = await timelineStore.list({ eventTypes: ["signal"], limit: 100 });
			expect(events).toHaveLength(0);
		});

		test("should emit a validation_repeat signal at threshold", async () => {
			await engine.recordValidation("src/bar.ts:e-99", "Bar error 99");
			await engine.recordValidation("src/bar.ts:e-99", "Bar error 99");
			const signal = await engine.recordValidation("src/bar.ts:e-99", "Bar error 99");

			expect(signal).not.toBeNull();
			expect(signal!.pattern).toBe("validation_repeat:src/bar.ts:e-99");
			expect(signal!.severity).toBe("info");
			expect(signal!.metadata?.count).toBe(3);

			const events = await timelineStore.list({ eventTypes: ["signal"], limit: 100 });
			expect(events.length).toBeGreaterThanOrEqual(1);
			const signalEvent = events.find((e) => {
				const d = e.data as Record<string, unknown>;
				return d.pattern === "validation_repeat:src/bar.ts:e-99";
			});
			expect(signalEvent).toBeDefined();
		});

		test("should create signal events for different signatures independently", async () => {
			const s1 = await engine.recordValidation("src/a.ts:e-1", "Error A");
			expect(s1).toBeNull(); // only 1 call
			const s2 = await engine.recordValidation("src/a.ts:e-1", "Error A");
			expect(s2).toBeNull(); // 2 calls
			const s3 = await engine.recordValidation("src/b.ts:e-2", "Error B");
			expect(s3).toBeNull(); // only 1 call for B

			const s4 = await engine.recordValidation("src/a.ts:e-1", "Error A");
			expect(s4).not.toBeNull(); // A hits threshold
			expect(s4!.pattern).toContain("validation_repeat:src/a.ts:e-1");

			// B should still need more
			const s5 = await engine.recordValidation("src/b.ts:e-2", "Error B");
			expect(s5).toBeNull(); // B only at 2
		});
	});

	// ===================================================================
	// AC2: Memory conflict affecting a proposal creates decision_impact
	// ===================================================================
	describe("AC2: Decision-Impact Detection", () => {
		test("should emit decision_impact when memory conflict affects a proposal", async () => {
			const signal = await engine.recordMemoryConflictDecisionImpact({
				conflictingMemoryIds: ["mem-1", "mem-2"],
				conflictType: "contradiction",
				memoryTitles: ["Mem A says X", "Mem B says not X"],
				affectedProposalId: "prop-123",
				affectedProposalTitle: "Important Proposal",
				impactSummary: "Memory conflict between A and B undermines the evidence for Proposal X",
			});

			expect(signal).not.toBeNull();
			expect(signal!.pattern).toContain("decision_impact");
			expect(signal!.severity).toBe("warning");
			expect(signal!.summary).toBe("Memory conflict between A and B undermines the evidence for Proposal X");

			const events = await timelineStore.list({ eventTypes: ["signal"], limit: 100 });
			const impactEvent = events.find((e) => {
				const d = e.data as Record<string, unknown>;
				return typeof d.pattern === "string" && d.pattern.includes("decision_impact");
			});
			expect(impactEvent).toBeDefined();
		});

		test("should emit decision_impact even without a specific proposal ID", async () => {
			const signal = await engine.recordMemoryConflictDecisionImpact({
				conflictingMemoryIds: ["mem-3", "mem-4"],
				conflictType: "staleness",
				memoryTitles: ["Old config", "New config"],
				impactSummary: "Stale memory contradicts current configuration knowledge",
			});

			expect(signal).not.toBeNull();
			expect(signal!.severity).toBe("warning");
			expect(signal!.metadata?.conflictType).toBe("staleness");
		});
	});

	// ===================================================================
	// AC3: Signals dedupe through cooldown keys
	// ===================================================================
	describe("AC3: Cooldown Deduplication", () => {
		test("should suppress duplicate signals within cooldown window", async () => {
			// First signal at threshold
			await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			const first = await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			expect(first).not.toBeNull();

			// After reset: within cooldown, 3 more records → hits threshold but suppressed
			await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			const suppressed = await engine.recordValidation("src/dedup.ts:e-1", "Dedup error");
			expect(suppressed).toBeNull();
		});

		test("should deduplicate decision_impact signals for the same proposal", async () => {
			const ctx = {
				conflictingMemoryIds: ["mem-a", "mem-b"] as [string, string],
				conflictType: "contradiction" as const,
				memoryTitles: ["A says yes", "B says no"] as [string, string],
				affectedProposalId: "prop-same",
				affectedProposalTitle: "Same Proposal",
				impactSummary: "Conflict between A and B impacts Same Proposal",
			};

			const first = await engine.recordMemoryConflictDecisionImpact(ctx);
			expect(first).not.toBeNull();
			const second = await engine.recordMemoryConflictDecisionImpact(ctx);
			expect(second).toBeNull();
		});

		test("should allow signals with different dedup keys", async () => {
			const ctx1 = {
				conflictingMemoryIds: ["mem-x", "mem-y"] as [string, string],
				conflictType: "contradiction" as const,
				memoryTitles: ["X", "Y"] as [string, string],
				affectedProposalId: "prop-one",
				affectedProposalTitle: "One",
				impactSummary: "Conflict 1",
			};
			const ctx2 = {
				conflictingMemoryIds: ["mem-z", "mem-w"] as [string, string],
				conflictType: "duplicate" as const,
				memoryTitles: ["Z", "W"] as [string, string],
				affectedProposalId: "prop-two",
				affectedProposalTitle: "Two",
				impactSummary: "Conflict 2",
			};

			expect(await engine.recordMemoryConflictDecisionImpact(ctx1)).not.toBeNull();
			expect(await engine.recordMemoryConflictDecisionImpact(ctx2)).not.toBeNull();
		});

		test("should track cooldown state correctly", async () => {
			await engine.recordValidation("src/cooldown.ts:e-1", "Cooldown error");
			await engine.recordValidation("src/cooldown.ts:e-1", "Cooldown error");
			await engine.recordValidation("src/cooldown.ts:e-1", "Cooldown error");

			const state = await engine.getState();
			expect(state.totalEmitted).toBe(1);
			expect(state.activeCooldowns.length).toBeGreaterThanOrEqual(1);
			expect(state.activeCooldowns[0].key).toContain("validation_repeat");
		});
	});

	// ===================================================================
	// AC4: Signal feeding
	// ===================================================================
	describe("AC4: Signal Feeding", () => {
		test("should mark signals for proposal when configured", async () => {
			const dmGuard = new V5MutationGuard(DRAFTING_CONFIG, timelineStore, actorSink);
			const feedEngine = createSignalEngine(timelineStore, dmGuard, {
				validationRepeat: { threshold: 2, windowMs: 60_000 },
				cooldown: { defaultCooldownMs: 500, perTypeCooldownMs: { validation_repeat: 100 } },
				feedRouting: { validation_repeat: ["proposal", "overview", "ask_pi"] },
			});

			await feedEngine.recordValidation("src/feed.ts:e-1", "Feed test");
			const signal = await feedEngine.recordValidation("src/feed.ts:e-1", "Feed test");
			expect(signal).not.toBeNull();

			const events = await timelineStore.list({ eventTypes: ["observation"], limit: 100 });
			const marker = events.find((e) => {
				const d = e.data as Record<string, unknown>;
				return d.markerType === "signal_feed_proposal";
			});
			expect(marker).toBeDefined();
			if (marker) {
				const d = marker.data as Record<string, unknown>;
				expect(d.signalPattern).toContain("validation_repeat:src/feed.ts:e-1");
			}
		});

		test("should push signal to kernel when configured with push target", async () => {
			const dmGuard = new V5MutationGuard(DRAFTING_CONFIG, timelineStore, actorSink);
			const pushEngine = createSignalEngine(timelineStore, dmGuard, {
				validationRepeat: { threshold: 2, windowMs: 60_000 },
				cooldown: { defaultCooldownMs: 500, perTypeCooldownMs: { validation_repeat: 100 } },
				feedRouting: { validation_repeat: ["push"] },
			});

			await pushEngine.recordValidation("src/push.ts:e-1", "Push test");
			const signal = await pushEngine.recordValidation("src/push.ts:e-1", "Push test");
			expect(signal).not.toBeNull();

			expect(actorSink.events.length).toBeGreaterThanOrEqual(1);
			const pushEvent = actorSink.events.find((e) => e.type === "proposal_submitted");
			expect(pushEvent).toBeDefined();
			if (pushEvent) {
				const payload = pushEvent.payload as Record<string, unknown>;
				expect(payload.pattern).toContain("validation_repeat:src/push.ts:e-1");
			}
		});

		test("should feed all active signals", async () => {
			const dmGuard = new V5MutationGuard(DRAFTING_CONFIG, timelineStore, actorSink);
			const feedEngine = createSignalEngine(timelineStore, dmGuard, {
				validationRepeat: { threshold: 2, windowMs: 60_000 },
				cooldown: { defaultCooldownMs: 100, perTypeCooldownMs: { validation_repeat: 50 } },
				feedRouting: { validation_repeat: ["proposal"] },
			});

			await feedEngine.recordValidation("src/feed-a.ts:e-1", "Feed A");
			const sigA = await feedEngine.recordValidation("src/feed-a.ts:e-1", "Feed A");
			expect(sigA).not.toBeNull();

			await new Promise((r) => setTimeout(r, 60));

			await feedEngine.recordValidation("src/feed-b.ts:e-2", "Feed B");
			const sigB = await feedEngine.recordValidation("src/feed-b.ts:e-2", "Feed B");
			expect(sigB).not.toBeNull();

			await feedEngine.feedAllActiveSignals();

			const markerEvents = await timelineStore.list({ eventTypes: ["observation"], limit: 100 });
			const proposalMarkers = markerEvents.filter((e) => {
				const d = e.data as Record<string, unknown>;
				return d.markerType === "signal_feed_proposal";
			});
			expect(proposalMarkers.length).toBeGreaterThanOrEqual(2);
		}, 10_000);
	});

	// ===================================================================
	// Engine State & Resolution
	// ===================================================================
	describe("Engine State & Signal Resolution", () => {
		test("should resolve a signal by ID", async () => {
			await engine.recordValidation("src/resolve.ts:e-1", "Resolve test");
			await engine.recordValidation("src/resolve.ts:e-1", "Resolve test");
			const signal = await engine.recordValidation("src/resolve.ts:e-1", "Resolve test");
			expect(signal).not.toBeNull();

			const ok = await engine.resolveSignal(signal!.id);
			expect(ok).toBe(true);
		});

		test("should return false when resolving non-existent signal", async () => {
			const ok = await engine.resolveSignal("non-existent-id");
			expect(ok).toBe(false);
		});

		test("getState should report accurate counts", async () => {
			const state = await engine.getState();
			expect(state.totalEmitted).toBe(0);
			expect(state.suppressedByCooldown).toBe(0);

			await engine.recordValidation("src/state.ts:e-1", "State test");
			await engine.recordValidation("src/state.ts:e-1", "State test");
			await engine.recordValidation("src/state.ts:e-1", "State test");

			const stateAfter = await engine.getState();
			expect(stateAfter.totalEmitted).toBe(1);
			expect(stateAfter.activeCount).toBe(1);
		});

		test("should prune expired cooldowns", async () => {
			const quickEngine = createSignalEngine(timelineStore, mutationGuard, {
				validationRepeat: { threshold: 3, windowMs: 60_000 },
				cooldown: { defaultCooldownMs: 50, perTypeCooldownMs: { validation_repeat: 50 } },
			});

			await quickEngine.recordValidation("src/prune.ts:e-1", "Prune test");
			await quickEngine.recordValidation("src/prune.ts:e-1", "Prune test");
			await quickEngine.recordValidation("src/prune.ts:e-1", "Prune test");

			let state = await quickEngine.getState();
			expect(state.totalEmitted).toBe(1);
			expect(state.activeCooldowns.length).toBeGreaterThanOrEqual(1);

			await new Promise((r) => setTimeout(r, 60));
			quickEngine.prune();

			state = await quickEngine.getState();
			expect(state.activeCooldowns.length).toBe(0);
		}, 10_000);
	});
});
