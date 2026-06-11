import { describe, expect, it } from "vitest";
import {
	createSpecQualityHistoryStore,
	SpecQualityHistoryStore,
} from "../../src/core/assembly/spec-quality-history.js";
import {
	createSpecQualityLedger,
	type EvidenceClass,
	parseLedgerEntries,
	type SpecOutcomeType,
	type SpecQualityEntry,
	serializeLedgerEntries,
} from "../../src/core/assembly/spec-quality-ledger.js";

// =============================================================================
// Helpers
// =============================================================================

function makeEntry(overrides?: Partial<SpecQualityEntry>): SpecQualityEntry {
	return {
		id: `entry-${Math.random().toString(36).slice(2, 8)}`,
		contract: "test/contract.ts",
		namespace: "test-ns",
		predictedOutcome: "matched",
		actualOutcome: "matched",
		evidenceClass: "static_confirmation",
		recordedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeMatchedEntry(id: string, ns = "ns-a"): SpecQualityEntry {
	return {
		id,
		contract: `contract/${id}.ts`,
		namespace: ns,
		predictedOutcome: "matched",
		actualOutcome: "matched",
		evidenceClass: "static_confirmation",
		recordedAt: new Date().toISOString(),
	};
}

function makeBreakingEntry(id: string, ns = "ns-a"): SpecQualityEntry {
	return {
		id,
		contract: `contract/${id}.ts`,
		namespace: ns,
		predictedOutcome: "matched",
		actualOutcome: "breaking_drift",
		evidenceClass: "human_approval",
		recordedAt: new Date().toISOString(),
	};
}

function makeOverpredictedEntry(id: string, ns = "ns-a"): SpecQualityEntry {
	return {
		id,
		contract: `contract/${id}.ts`,
		namespace: ns,
		predictedOutcome: "matched",
		actualOutcome: "overpredicted",
		evidenceClass: "llm_only",
		recordedAt: new Date().toISOString(),
	};
}

// =============================================================================
// Positive Path Tests — Ledger
// =============================================================================

describe("SpecQualityLedger — positive path", () => {
	it("records a single entry", () => {
		const ledger = createSpecQualityLedger();
		const result = ledger.record(makeEntry({ id: "e1" }));
		expect(result.success).toBe(true);
		expect(ledger.getEntries()).toHaveLength(1);
	});

	it("records multiple entries", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1" }));
		ledger.record(makeEntry({ id: "e2" }));
		ledger.record(makeEntry({ id: "e3" }));
		expect(ledger.getEntries()).toHaveLength(3);
	});

	it("batch records with accept/reject counts", () => {
		const ledger = createSpecQualityLedger();
		const result = ledger.recordBatch([makeEntry({ id: "e1" }), makeEntry({ id: "e2" }), makeEntry({ id: "e3" })]);
		expect(result.accepted).toBe(3);
		expect(result.rejected).toBe(0);
		expect(ledger.getEntries()).toHaveLength(3);
	});

	it("computes metrics with all matched entries", () => {
		const ledger = createSpecQualityLedger();
		for (let i = 0; i < 10; i++) {
			ledger.record(makeMatchedEntry(`m${i}`));
		}
		const metrics = ledger.computeMetrics();
		expect(metrics).not.toBeNull();
		expect(metrics!.precision).toBe(1.0);
		expect(metrics!.recall).toBe(1.0);
		expect(metrics!.driftRatio).toBe(0);
		expect(metrics!.breakingDriftRatio).toBe(0);
		expect(metrics!.llmOnlyRatio).toBe(0);
	});

	it("computes metrics with mixed outcomes", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeMatchedEntry("m1"));
		ledger.record(makeMatchedEntry("m2"));
		ledger.record(makeMatchedEntry("m3"));
		ledger.record(makeBreakingEntry("b1"));
		ledger.record(makeOverpredictedEntry("o1"));

		const metrics = ledger.computeMetrics();
		expect(metrics).not.toBeNull();
		expect(metrics!.outcomeCounts.matched).toBe(3);
		expect(metrics!.outcomeCounts.breaking_drift).toBe(1);
		expect(metrics!.outcomeCounts.overpredicted).toBe(1);
		expect(metrics!.breakingDriftRatio).toBe(0.2);
		expect(metrics!.overpredictionRatio).toBe(0.2);
		expect(metrics!.llmOnlyRatio).toBe(0.2);
	});

	it("filters entries by namespace", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeMatchedEntry("m1", "ns-a"));
		ledger.record(makeMatchedEntry("m2", "ns-b"));
		ledger.record(makeMatchedEntry("m3", "ns-a"));

		expect(ledger.getEntriesByNamespace("ns-a")).toHaveLength(2);
		expect(ledger.getEntriesByNamespace("ns-b")).toHaveLength(1);
		expect(ledger.getEntriesByNamespace("ns-c")).toHaveLength(0);
	});

	it("filters entries by evidence class", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1", evidenceClass: "static_confirmation" }));
		ledger.record(makeEntry({ id: "e2", evidenceClass: "llm_only" }));
		ledger.record(makeEntry({ id: "e3", evidenceClass: "static_confirmation" }));

		expect(ledger.getEntriesByEvidenceClass("static_confirmation")).toHaveLength(2);
		expect(ledger.getEntriesByEvidenceClass("llm_only")).toHaveLength(1);
	});

	it("isReliable returns true when enough data", () => {
		const ledger = createSpecQualityLedger();
		for (let i = 0; i < 10; i++) {
			ledger.record(
				makeEntry({
					id: `e${i}`,
					evidenceClass: i % 2 === 0 ? "static_confirmation" : "human_approval",
				}),
			);
		}
		expect(ledger.isReliable(10, 2)).toBe(true);
	});

	it("isReliable returns false with insufficient data", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1" }));
		expect(ledger.isReliable(10, 2)).toBe(false);
	});

	it("clear removes all entries", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1" }));
		ledger.clear();
		expect(ledger.getEntries()).toHaveLength(0);
	});

	it("computing metrics on empty ledger returns null", () => {
		const ledger = createSpecQualityLedger();
		expect(ledger.computeMetrics()).toBeNull();
	});

	it("serializes to JSONL format", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1", contract: "a.ts" }));
		ledger.record(makeEntry({ id: "e2", contract: "b.ts" }));

		const jsonl = serializeLedgerEntries(ledger);
		expect(jsonl.split("\n").filter((l) => l.trim())).toHaveLength(2);
		expect(JSON.parse(jsonl.split("\n")[0]).id).toBe("e1");
	});

	it("parses valid JSONL entries", () => {
		const jsonl =
			[JSON.stringify(makeEntry({ id: "e1" })), JSON.stringify(makeEntry({ id: "e2" }))].join("\n") + "\n";

		const result = parseLedgerEntries(jsonl);
		expect(result.entries).toHaveLength(2);
		expect(result.errors).toHaveLength(0);
		expect(result.entries[0].id).toBe("e1");
	});
});

// =============================================================================
// Negative Path Tests — Ledger
// =============================================================================

describe("SpecQualityLedger — negative path", () => {
	it("rejects duplicate entry IDs", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1" }));
		const result = ledger.record(makeEntry({ id: "e1" }));
		expect(result.success).toBe(false);
		expect("reason" in result && result.reason).toContain("Duplicate");
	});

	it("batch record reports rejected duplicates", () => {
		const ledger = createSpecQualityLedger();
		const result = ledger.recordBatch([
			makeEntry({ id: "e1" }),
			makeEntry({ id: "e1" }), // duplicate
			makeEntry({ id: "e2" }),
		]);
		expect(result.accepted).toBe(2);
		expect(result.rejected).toBe(1);
		expect(ledger.getEntries()).toHaveLength(2);
	});

	it("parseLedgerEntries rejects invalid JSON lines", () => {
		const jsonl =
			[JSON.stringify(makeEntry({ id: "e1" })), "not valid json", JSON.stringify(makeEntry({ id: "e2" }))].join(
				"\n",
			) + "\n";

		const result = parseLedgerEntries(jsonl);
		expect(result.entries).toHaveLength(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("invalid JSON");
	});

	it("parseLedgerEntries rejects entries with invalid outcome types", () => {
		const bad = {
			id: "bad",
			contract: "x.ts",
			namespace: "ns",
			predictedOutcome: "invalid",
			actualOutcome: "matched",
			evidenceClass: "unknown",
			recordedAt: "now",
		};
		const jsonl = JSON.stringify(bad) + "\n";

		const result = parseLedgerEntries(jsonl);
		expect(result.entries).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("invalid SpecQualityEntry");
	});

	it("parseLedgerEntries rejects entries with invalid evidence classes", () => {
		const bad = {
			id: "bad",
			contract: "x.ts",
			namespace: "ns",
			predictedOutcome: "matched",
			actualOutcome: "matched",
			evidenceClass: "not_a_class",
			recordedAt: "now",
		};
		const jsonl = JSON.stringify(bad) + "\n";

		const result = parseLedgerEntries(jsonl);
		expect(result.entries).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
	});

	it("parseLedgerEntries rejects entries missing required fields", () => {
		const bad = { id: "bad" };
		const jsonl = JSON.stringify(bad) + "\n";

		const result = parseLedgerEntries(jsonl);
		expect(result.entries).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
	});

	it("metrics handle zero denominators (all breaking entries)", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeBreakingEntry("b1"));
		ledger.record(makeBreakingEntry("b2"));
		const metrics = ledger.computeMetrics();
		expect(metrics).not.toBeNull();
		expect(metrics!.precision).toBe(0); // matched=0 → 0/(0+1+...) = 0
		expect(metrics!.recall).toBe(0); // matched=0 → 0/(0+2+0) = 0
		expect(metrics!.breakingDriftRatio).toBe(1.0);
	});
});

// =============================================================================
// Positive Path Tests — History Store
// =============================================================================

describe("SpecQualityHistoryStore — positive path", () => {
	it("creates snapshots from ledger data", () => {
		const ledger = createSpecQualityLedger();
		for (let i = 0; i < 15; i++) {
			ledger.record(makeMatchedEntry(`m${i}`));
		}

		const store = createSpecQualityHistoryStore(ledger);
		const snapshot = store.snapshot(new Date().toISOString());
		expect(snapshot.entryCount).toBe(15);
		expect(snapshot.metrics).not.toBeNull();
		expect(snapshot.metrics!.precision).toBe(1.0);
	});

	it("snapshot returns null metrics when no entries in window", () => {
		const ledger = createSpecQualityLedger();
		// No entries
		const store = createSpecQualityHistoryStore(ledger, { windowMs: 1000 }); // 1 second window
		const snapshot = store.snapshot(new Date().toISOString());
		expect(snapshot.entryCount).toBe(0);
		expect(snapshot.metrics).toBeNull();
	});

	it("analyzes trend with improving direction", () => {
		const ledger = createSpecQualityLedger();

		// Old entries: mostly breaking
		const oldTime = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
		for (let i = 0; i < 5; i++) {
			ledger.record({ ...makeBreakingEntry(`old-b${i}`), recordedAt: oldTime });
		}

		// Recent entries: all matched
		for (let i = 0; i < 5; i++) {
			ledger.record(makeMatchedEntry(`new-m${i}`));
		}

		const store = createSpecQualityHistoryStore(ledger, { windowMs: 7 * 24 * 60 * 60 * 1000 });
		const trend = store.analyzeTrend(new Date().toISOString());

		expect(trend.direction).toBe("improving");
		expect(trend.current).not.toBeNull();
		expect(trend.riskScore).toBeLessThan(0.6);
	});

	it("analyzes trend with degrading direction", () => {
		const ledger = createSpecQualityLedger();

		// Old entries: all matched
		const oldTime = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
		for (let i = 0; i < 5; i++) {
			ledger.record({ ...makeMatchedEntry(`old-m${i}`), recordedAt: oldTime });
		}

		// Recent entries: mostly breaking
		for (let i = 0; i < 5; i++) {
			ledger.record(makeBreakingEntry(`new-b${i}`));
		}

		const store = createSpecQualityHistoryStore(ledger, { windowMs: 7 * 24 * 60 * 60 * 1000 });
		const trend = store.analyzeTrend(new Date().toISOString());

		expect(trend.direction).toBe("degrading");
		expect(trend.riskScore).toBeGreaterThan(0.3);
	});

	it("hasSufficientHistory delegates to ledger reliability", () => {
		const ledger = createSpecQualityLedger();
		for (let i = 0; i < 10; i++) {
			ledger.record(
				makeEntry({
					id: `e${i}`,
					evidenceClass: i % 2 === 0 ? "static_confirmation" : "human_approval",
				}),
			);
		}

		const store = createSpecQualityHistoryStore(ledger);
		expect(store.hasSufficientHistory(10)).toBe(true);
	});

	it("riskScore is 1.0 with insufficient data", () => {
		const ledger = createSpecQualityLedger();
		ledger.record(makeEntry({ id: "e1" }));
		const store = createSpecQualityHistoryStore(ledger);
		const trend = store.analyzeTrend(new Date().toISOString());
		expect(trend.riskScore).toBe(1.0);
	});
});

// =============================================================================
// Negative Path Tests — History Store
// =============================================================================

describe("SpecQualityHistoryStore — negative path", () => {
	it("trend with no data returns insufficient_data", () => {
		const ledger = createSpecQualityLedger();
		const store = createSpecQualityHistoryStore(ledger);
		const trend = store.analyzeTrend(new Date().toISOString());
		expect(trend.direction).toBe("insufficient_data");
		expect(trend.current).toBeNull();
	});

	it("snapshot with out-of-range entries returns empty", () => {
		const ledger = createSpecQualityLedger();
		const farPast = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
		ledger.record({ ...makeEntry({ id: "old" }), recordedAt: farPast });

		const store = createSpecQualityHistoryStore(ledger, { windowMs: 7 * 24 * 60 * 60 * 1000 });
		const snapshot = store.snapshot(new Date().toISOString());
		expect(snapshot.entryCount).toBe(0); // Entry is outside 7-day window
	});

	it("getEntriesInRange filters correctly", () => {
		const ledger = createSpecQualityLedger();
		const t1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
		const t2 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
		const t3 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

		ledger.record({ ...makeEntry({ id: "e1" }), recordedAt: t1 });
		ledger.record({ ...makeEntry({ id: "e2" }), recordedAt: t2 });
		ledger.record({ ...makeEntry({ id: "e3" }), recordedAt: t3 });

		const store = createSpecQualityHistoryStore(ledger);
		const entries = store.getEntriesInRange(
			new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
			new Date().toISOString(),
		);
		expect(entries).toHaveLength(2); // e2 and e3
		expect(entries.map((e) => e.id).sort()).toEqual(["e2", "e3"]);
	});
});
