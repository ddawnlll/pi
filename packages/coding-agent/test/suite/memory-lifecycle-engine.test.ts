/**
 * Memory Lifecycle Engine (P14.C) test suite.
 *
 * Tests lifecycle state transitions, policy-based operations,
 * configuration, and event emission.
 */

import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type LifecycleTransition,
	MemoryLifecycleEngine,
	type MemoryRecord,
	MemoryStore,
} from "../../src/brain/memory/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-memory-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	return dir;
}

function createTestRecord(overrides?: Partial<MemoryRecord>): MemoryRecord {
	return {
		id: overrides?.id ?? "test-record-1",
		type: overrides?.type ?? "project_memory",
		title: overrides?.title ?? "Test Memory",
		content: overrides?.content ?? "Test content",
		summary: overrides?.summary,
		lifecycle: overrides?.lifecycle ?? "candidate",
		confidence: overrides?.confidence ?? 0.5,
		provenance: overrides?.provenance ?? {
			sourceRefs: [{ type: "observation", path: "/test/path", id: "obs-1" }],
			validatedBy: "system",
		},
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
		expiresAt: overrides?.expiresAt,
		supersededBy: overrides?.supersededBy,
		affectedBy: overrides?.affectedBy,
		tags: overrides?.tags ?? ["test"],
		category: overrides?.category,
		metadata: overrides?.metadata ?? {},
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MemoryLifecycleEngine", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanups) {
			cleanup();
		}
		cleanups.length = 0;
	});

	async function createEngine(
		engineConfig?: Partial<import("../../src/brain/memory/index.js").LifecycleConfig>,
	): Promise<{ engine: MemoryLifecycleEngine; store: MemoryStore; tempDir: string }> {
		const tempDir = createTempDir();
		const store = new MemoryStore({ basePath: tempDir });
		await store.initialize();
		const engine = new MemoryLifecycleEngine(store, engineConfig);

		cleanups.push(() => {
			if (existsSync(tempDir)) {
				try {
					rmSync(tempDir, { recursive: true });
				} catch {
					// Ignore cleanup errors
				}
			}
		});

		return { engine, store, tempDir };
	}

	// -----------------------------------------------------------------------
	// Construction
	// -----------------------------------------------------------------------

	describe("construction", () => {
		it("should construct with defaults", async () => {
			const { engine } = await createEngine();
			const config = engine.getConfig();

			expect(config.autoActivateConfidence).toBe(0.8);
			expect(config.defaultTtlDays).toBe(90);
			expect(config.needsReviewConfidence).toBe(0.5);
			expect(config.checkIntervalHours).toBe(24);
		});

		it("should accept partial config overrides", async () => {
			const { engine } = await createEngine({
				autoActivateConfidence: 0.9,
				defaultTtlDays: 30,
			});
			const config = engine.getConfig();

			expect(config.autoActivateConfidence).toBe(0.9);
			expect(config.defaultTtlDays).toBe(30);
			expect(config.needsReviewConfidence).toBe(0.5); // default
			expect(config.checkIntervalHours).toBe(24); // default
		});
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("configuration", () => {
		it("should update config at runtime via setConfig", async () => {
			const { engine } = await createEngine();

			engine.setConfig({ autoActivateConfidence: 0.6, defaultTtlDays: 45 });

			const config = engine.getConfig();
			expect(config.autoActivateConfidence).toBe(0.6);
			expect(config.defaultTtlDays).toBe(45);
			expect(config.needsReviewConfidence).toBe(0.5); // unchanged
		});

		it("should not change other fields on partial setConfig", async () => {
			const { engine } = await createEngine({ autoActivateConfidence: 0.7 });

			engine.setConfig({ defaultTtlDays: 60 });

			const config = engine.getConfig();
			expect(config.autoActivateConfidence).toBe(0.7);
			expect(config.defaultTtlDays).toBe(60);
		});
	});

	// -----------------------------------------------------------------------
	// State Transitions: activate
	// -----------------------------------------------------------------------

	describe("activate", () => {
		it("should promote a candidate record to active", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.lifecycle).toBe("active");
		});

		it("should set expiresAt when activating without one", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.lifecycle).toBe("active");
			expect(updated.expiresAt).toBeDefined();
			const expiresMs = new Date(updated.expiresAt!).getTime();
			expect(expiresMs).toBeGreaterThan(Date.now());
		});

		it("should not overwrite existing expiresAt", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const future = new Date(Date.now() + 999 * 86400000).toISOString();
			const record = createTestRecord({
				lifecycle: "candidate",
				confidence: 0.9,
				expiresAt: future,
			});
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.expiresAt).toBe(future);
		});

		it("should transition to needs_review when confidence is too low", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.8 });
			const record = createTestRecord({
				id: "low-conf",
				lifecycle: "candidate",
				confidence: 0.3,
			});
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.lifecycle).toBe("needs_review");
		});

		it("should promote needs_review to active", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ id: "review-1", lifecycle: "needs_review", confidence: 0.9 });
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.lifecycle).toBe("active");
		});

		it("should promote disputed to active", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ id: "disp-1", lifecycle: "disputed", confidence: 0.9 });
			await store.create(record);

			const updated = await engine.activate(record.id);

			expect(updated.lifecycle).toBe("active");
		});

		it("should throw for non-existent record", async () => {
			const { engine } = await createEngine();
			await expect(engine.activate("non-existent")).rejects.toThrow("not found");
		});

		it("should throw for invalid transition (active -> active)", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "already-active", lifecycle: "active" });
			await store.create(record);

			await expect(engine.activate(record.id)).rejects.toThrow("cannot transition");
		});

		it("should throw for expired -> active", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "exp-1", lifecycle: "expired" });
			await store.create(record);

			await expect(engine.activate(record.id)).rejects.toThrow("cannot transition");
		});

		it("should throw for rejected -> active", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rej-1", lifecycle: "rejected_by_user" });
			await store.create(record);

			await expect(engine.activate(record.id)).rejects.toThrow("cannot transition");
		});
	});

	// -----------------------------------------------------------------------
	// State Transitions: deactivate
	// -----------------------------------------------------------------------

	describe("deactivate", () => {
		it("should demote an active record to candidate", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "deact-1", lifecycle: "active" });
			await store.create(record);

			const updated = await engine.deactivate(record.id);

			expect(updated.lifecycle).toBe("candidate");
		});

		it("should clear expiresAt on deactivation", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({
				id: "deact-2",
				lifecycle: "active",
				expiresAt: new Date(Date.now() + 86400000).toISOString(),
			});
			await store.create(record);

			await engine.deactivate(record.id);

			const retrieved = await store.get(record.id);
			expect(retrieved!.expiresAt).toBeUndefined();
		});

		it("should throw for non-active record", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "deact-3", lifecycle: "candidate" });
			await store.create(record);

			await expect(engine.deactivate(record.id)).rejects.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// State Transitions: reject
	// -----------------------------------------------------------------------

	describe("reject", () => {
		it("should reject a candidate record", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ lifecycle: "candidate" });
			await store.create(record);

			const updated = await engine.reject(record.id, "User rejected this");

			expect(updated.lifecycle).toBe("rejected_by_user");
		});

		it("should reject an active record", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rej-1", lifecycle: "active" });
			await store.create(record);

			await engine.reject(record.id);

			const retrieved = await store.get(record.id);
			expect(retrieved!.lifecycle).toBe("rejected_by_user");
		});

		it("should reject a needs_review record", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rej-2", lifecycle: "needs_review" });
			await store.create(record);

			await engine.reject(record.id);

			const retrieved = await store.get(record.id);
			expect(retrieved!.lifecycle).toBe("rejected_by_user");
		});

		it("should throw for superseded -> rejected_by_user", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rej-3", lifecycle: "superseded" });
			await store.create(record);

			await expect(engine.reject(record.id)).rejects.toThrow("cannot transition");
		});

		it("should throw for expired -> rejected_by_user", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rej-4", lifecycle: "expired" });
			await store.create(record);

			await expect(engine.reject(record.id)).rejects.toThrow("cannot transition");
		});
	});

	// -----------------------------------------------------------------------
	// State Transitions: supersede
	// -----------------------------------------------------------------------

	describe("supersede", () => {
		it("should supersede an active record with a replacement", async () => {
			const { engine, store } = await createEngine();
			const old = createTestRecord({ id: "old-1", lifecycle: "active", title: "Old Memory" });
			const replacement = createTestRecord({ id: "new-1", lifecycle: "active", title: "New Memory" });
			await store.create(old);
			await store.create(replacement);

			const updated = await engine.supersede(old.id, replacement.id);

			expect(updated.lifecycle).toBe("superseded");
			const retrieved = await store.get(old.id);
			expect(retrieved!.supersededBy).toBe(replacement.id);
		});

		it("should annotate replacement metadata with supersedes info", async () => {
			const { engine, store } = await createEngine();
			const old = createTestRecord({ id: "old-2", lifecycle: "active" });
			const replacement = createTestRecord({ id: "new-2", lifecycle: "active", metadata: {} });
			await store.create(old);
			await store.create(replacement);

			await engine.supersede(old.id, replacement.id);

			const replaced = await store.get(replacement.id);
			expect(replaced!.metadata?.supersedes).toContain(old.id);
		});

		it("should throw if replacement is not found", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "old-3", lifecycle: "active" });
			await store.create(record);

			await expect(engine.supersede(record.id, "non-existent")).rejects.toThrow("not found");
		});

		it("should throw if replacement is already superseded", async () => {
			const { engine, store } = await createEngine();
			const old = createTestRecord({ id: "old-4", lifecycle: "active" });
			const replacement = createTestRecord({ id: "new-4", lifecycle: "superseded" });
			await store.create(old);
			await store.create(replacement);

			await expect(engine.supersede(old.id, replacement.id)).rejects.toThrow("already superseded");
		});
	});

	// -----------------------------------------------------------------------
	// State Transitions: restore
	// -----------------------------------------------------------------------

	describe("restore", () => {
		it("should restore an expired record to candidate", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rest-1", lifecycle: "expired" });
			await store.create(record);

			const updated = await engine.restore(record.id);

			expect(updated.lifecycle).toBe("candidate");
		});

		it("should restore a rejected record to candidate", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rest-2", lifecycle: "rejected_by_user" });
			await store.create(record);

			const updated = await engine.restore(record.id);

			expect(updated.lifecycle).toBe("candidate");
		});

		it("should restore a superseded record to candidate", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({
				id: "rest-3",
				lifecycle: "superseded",
				supersededBy: "some-other",
			});
			await store.create(record);

			const updated = await engine.restore(record.id);

			expect(updated.lifecycle).toBe("candidate");
			const retrieved = await store.get(record.id);
			expect(retrieved!.supersededBy).toBeUndefined();
		});

		it("should clear expiresAt on restore", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({
				id: "rest-4",
				lifecycle: "needs_review",
				expiresAt: new Date(Date.now() + 86400000).toISOString(),
			});
			await store.create(record);

			await engine.restore(record.id);

			const retrieved = await store.get(record.id);
			expect(retrieved!.expiresAt).toBeUndefined();
		});

		it("should throw for active -> candidate (use deactivate instead)", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "rest-5", lifecycle: "active" });
			await store.create(record);

			await expect(engine.restore(record.id)).rejects.toThrow("cannot transition");
		});
	});

	// -----------------------------------------------------------------------
	// Scheduled Operations: checkExpired
	// -----------------------------------------------------------------------

	describe("checkExpired", () => {
		it("should expire records past their expiresAt", async () => {
			const { engine, store } = await createEngine();
			const past = new Date(Date.now() - 86400000).toISOString();
			const future = new Date(Date.now() + 86400000).toISOString();

			const expiring = createTestRecord({
				id: "exp-1",
				lifecycle: "active",
				expiresAt: past,
			});
			const valid = createTestRecord({
				id: "val-1",
				lifecycle: "active",
				expiresAt: future,
			});
			await store.create(expiring);
			await store.create(valid);

			const expired = await engine.checkExpired();

			expect(expired).toHaveLength(1);
			expect(expired[0].id).toBe("exp-1");
			expect(expired[0].lifecycle).toBe("expired");

			const stillActive = await store.get("val-1");
			expect(stillActive!.lifecycle).toBe("active");
		});

		it("should clear expiresAt on expired records", async () => {
			const { engine, store } = await createEngine();
			const past = new Date(Date.now() - 86400000).toISOString();
			const record = createTestRecord({ id: "exp-clr", lifecycle: "active", expiresAt: past });
			await store.create(record);

			await engine.checkExpired();

			const retrieved = await store.get("exp-clr");
			expect(retrieved!.expiresAt).toBeUndefined();
		});

		it("should not affect records without expiresAt", async () => {
			const { engine, store } = await createEngine();
			const record = createTestRecord({ id: "no-exp", lifecycle: "active" });
			await store.create(record);

			const expired = await engine.checkExpired();

			expect(expired).toHaveLength(0);
			const retrieved = await store.get("no-exp");
			expect(retrieved!.lifecycle).toBe("active");
		});
	});

	// -----------------------------------------------------------------------
	// Scheduled Operations: checkNeedsReview
	// -----------------------------------------------------------------------

	describe("checkNeedsReview", () => {
		it("should flag active records with confidence below threshold", async () => {
			const { engine, store } = await createEngine({ needsReviewConfidence: 0.5 });
			const low = createTestRecord({
				id: "low-cr",
				lifecycle: "active",
				confidence: 0.3,
			});
			const high = createTestRecord({
				id: "high-cr",
				lifecycle: "active",
				confidence: 0.9,
			});
			await store.create(low);
			await store.create(high);

			const flagged = await engine.checkNeedsReview();

			expect(flagged).toHaveLength(1);
			expect(flagged[0].id).toBe("low-cr");
			expect(flagged[0].lifecycle).toBe("needs_review");
		});

		it("should not flag non-active records", async () => {
			const { engine, store } = await createEngine({ needsReviewConfidence: 0.5 });
			const candidate = createTestRecord({
				id: "cand-cr",
				lifecycle: "candidate",
				confidence: 0.2,
			});
			await store.create(candidate);

			const flagged = await engine.checkNeedsReview();

			expect(flagged).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// Scheduled Operations: runExpirationCheck
	// -----------------------------------------------------------------------

	describe("runExpirationCheck", () => {
		it("should return all transitions from the sweep", async () => {
			const { engine, store } = await createEngine({ needsReviewConfidence: 0.5 });

			const past = new Date(Date.now() - 86400000).toISOString();
			const expiring = createTestRecord({
				id: "run-exp",
				lifecycle: "active",
				expiresAt: past,
			});
			const lowConf = createTestRecord({
				id: "run-low",
				lifecycle: "active",
				confidence: 0.2,
			});
			await store.create(expiring);
			await store.create(lowConf);

			const transitions = await engine.runExpirationCheck();

			expect(transitions.length).toBeGreaterThanOrEqual(2);
			const types = transitions.map((t) => `${t.fromState}->${t.toState}`).sort();
			expect(types).toContain("active->expired");
			expect(types).toContain("active->needs_review");
		});
	});

	// -----------------------------------------------------------------------
	// Event Emission
	// -----------------------------------------------------------------------

	describe("onTransition events", () => {
		it("should emit transition events on state changes", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			const transitions: LifecycleTransition[] = [];
			engine.onTransition((t) => {
				transitions.push(t);
			});

			await engine.activate(record.id);

			expect(transitions).toHaveLength(1);
			expect(transitions[0].memoryId).toBe(record.id);
			expect(transitions[0].fromState).toBe("candidate");
			expect(transitions[0].toState).toBe("active");
			expect(transitions[0].triggeredBy).toBe("user");
			expect(transitions[0].reason).toBeTruthy();
			expect(transitions[0].timestamp).toBeTruthy();
		});

		it("should allow multiple subscribers", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ id: "multi-sub", lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			let count = 0;
			engine.onTransition(() => {
				count++;
			});
			engine.onTransition(() => {
				count++;
			});

			await engine.activate(record.id);

			expect(count).toBe(2);
		});

		it("should not propagate callback errors", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ id: "err-cb", lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			engine.onTransition(() => {
				throw new Error("Callback error");
			});

			const updated = await engine.activate(record.id);
			expect(updated.lifecycle).toBe("active");
		});
	});

	// -----------------------------------------------------------------------
	// Transition Matrix Validation
	// -----------------------------------------------------------------------

	describe("transition matrix", () => {
		it("should validate allowed activate transitions", async () => {
			const { engine, store } = await createEngine({ autoActivateConfidence: 0.0 });
			const record = createTestRecord({ lifecycle: "candidate", confidence: 0.9 });
			await store.create(record);

			const updated = await engine.activate(record.id);
			expect(updated.lifecycle).toBe("active");
		});

		it("should reject forbidden activate transitions", async () => {
			const { engine, store } = await createEngine();
			const forbidden: Array<{ id: string; lifecycle: MemoryRecord["lifecycle"] }> = [
				{ id: "forbid-1", lifecycle: "active" },
				{ id: "forbid-2", lifecycle: "superseded" },
				{ id: "forbid-3", lifecycle: "expired" },
				{ id: "forbid-4", lifecycle: "rejected_by_user" },
			];

			for (const tc of forbidden) {
				await store.create(createTestRecord(tc));
				await expect(engine.activate(tc.id)).rejects.toThrow();
			}
		});
	});
});
