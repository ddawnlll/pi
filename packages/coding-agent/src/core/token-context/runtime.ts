/**
 * P43 Tool Event Mode Wiring - W004
 *
 * Wires disabled/observe_only/shadow/active_safe modes into
 * read/edit/write/bash tool event paths.
 *
 * - observe_only: records events, no behavior change
 * - shadow: computes optimized output, returns raw
 * - active_safe: enables cache/smart-read/change-ledger
 * - write/edit: telemetry-only for P43 (except no_full_rewrite estimation)
 */

import { ActiveContextRegistry } from "./active-context-registry.js";
import { GenericFallbackAdapter } from "./adapters/fallback.js";
import { JsonYamlAdapter } from "./adapters/json-yaml.js";
import { PythonAdapter } from "./adapters/python.js";
import { RustAdapter } from "./adapters/rust.js";
import { TypeScriptAdapter } from "./adapters/typescript.js";
import { ChangeLedger } from "./change-ledger.js";
import { RawCache } from "./raw-cache.js";
import { ReadHashCache } from "./read-hash-cache.js";
import { SavingsLedger } from "./savings-ledger.js";
import { SmartReadCore } from "./smart-read-core.js";
import { TokenEstimator } from "./token-estimator.js";
import type {
	ACRLedgerPolicyResult,
	ReadSnapshot,
	SavingsMechanism,
	TokenContextConfig,
	TokenContextMode,
} from "./types.js";
import { getACRLedgerPolicy } from "./types.js";

export interface TokenContextRuntime {
	/** Current mode */
	mode: TokenContextMode;
	/** Configuration */
	config: TokenContextConfig;
	/** Savings ledger */
	ledger: SavingsLedger;
	/** Token estimator */
	estimator: TokenEstimator;
	/** Raw cache */
	rawCache: RawCache;
	/** Read hash cache */
	readHashCache: ReadHashCache;
	/** Active context registry */
	acr: ActiveContextRegistry;
	/** Change ledger */
	changeLedger: ChangeLedger;
	/** Smart read core */
	smartRead: SmartReadCore;
	/** Current turn number */
	turn: number;

	/**
	 * Called before a read tool executes.
	 * May transform or replace the read result based on mode.
	 */
	beforeRead(filePath: string): ReadInterceptResult;

	/**
	 * Called after a read completes successfully.
	 */
	afterRead(filePath: string, content: string, baselineTokens: number): AfterReadResult;

	/**
	 * Called before an edit/write operation.
	 */
	beforeMutation(filePath: string, content: string): MutationCheckResult;

	/**
	 * Called after an edit/write operation.
	 */
	afterMutation(filePath: string, beforeContent: string, afterContent: string): void;

	/**
	 * Advance to the next turn.
	 */
	advanceTurn(): void;

	/**
	 * Get a savings summary report.
	 */
	getSavingsReport(): string;
}

export interface ReadInterceptResult {
	/** Whether the read should be intercepted (replaced) */
	intercept: boolean;
	/** Replacement content if intercepting */
	replacementContent?: string;
	/** Whether this is a compact (optimized) read */
	isCompact: boolean;
	/** The raw content (for shadow mode) */
	rawContent?: string;
	/** Snapshot if one was taken */
	snapshot?: ReadSnapshot;
	/** Policy result from ACR × Change Ledger */
	policy?: ACRLedgerPolicyResult;
}

export interface AfterReadResult {
	/** Estimated token saving from optimization */
	estimatedSaving: number;
	/** Mechanism that produced the saving */
	mechanism?: SavingsMechanism;
}

export interface MutationCheckResult {
	/** Whether the mutation is blocked */
	blocked: boolean;
	/** Reason for blocking */
	reason?: string;
}

/**
 * Create a token context runtime with the given configuration.
 */
export function createTokenContextRuntime(config: TokenContextConfig): TokenContextRuntime {
	const estimator = new TokenEstimator();
	const rawCache = new RawCache({ maxBytes: config.rawCache.maxBytes });
	const acr = new ActiveContextRegistry();
	const readHashCache = new ReadHashCache({ rawCache, acr });
	const changeLedger = new ChangeLedger({
		maxDeltaChainBeforeCheckpoint: config.changeLedger.maxDeltaChainBeforeCheckpoint,
	});
	const ledger = new SavingsLedger();
	const smartRead = new SmartReadCore();

	// Register built-in adapters
	const generic = new GenericFallbackAdapter();
	smartRead.registerAdapter(new TypeScriptAdapter());
	smartRead.registerAdapter(new PythonAdapter());
	smartRead.registerAdapter(new JsonYamlAdapter());
	smartRead.registerAdapter(new RustAdapter());
	smartRead.setFallbackAdapter(generic);

	return {
		mode: config.mode,
		config,
		ledger,
		estimator,
		rawCache,
		readHashCache,
		acr,
		changeLedger,
		smartRead,
		turn: 0,

		beforeRead(filePath: string): ReadInterceptResult {
			if (this.mode === "disabled") {
				return { intercept: false, isCompact: false };
			}

			// Get ACR state and ledger state
			const acrState = acr.getState(filePath);
			const ledgerState = changeLedger.getState(filePath);
			const policy = getACRLedgerPolicy(acrState, ledgerState);

			// P43.1: Tiny-file threshold - small files return raw directly
			// Only check if we have a snapshot to measure
			const snapshot = readHashCache.getSnapshot(filePath);
			if (
				snapshot &&
				snapshot.fileSize <= this.config.tinyFileThresholdBytes &&
				(this.mode === "active_safe" || this.mode === "shadow")
			) {
				ledger.record({
					mechanism: "fallback",
					tool: "read",
					estimatedBaselineTokens: estimator.estimate(snapshot.rawContent ?? "").charEstimate,
					estimatedOptimizedTokens: estimator.estimate(snapshot.rawContent ?? "").charEstimate,
					estimatedSavingTokens: 0,
					confidence: "estimated",
					filePath,
					metadata: { reason: "tiny_file_raw_passthrough" },
				});
				return { intercept: false, isCompact: false, policy };
			}

			// Try read hash cache for unchanged content
			if (
				this.mode === "active_safe" &&
				(acrState === "active" || acrState === "inactive") &&
				(ledgerState === "no_entry" || ledgerState === "known_unchanged")
			) {
				const snap = readHashCache.getSnapshot(filePath);
				if (snap && readHashCache.isUnchanged(snap)) {
					const cachedContent = readHashCache.getRawContent(filePath);
					if (cachedContent) {
						const baselineEstimate = estimator.estimate(cachedContent);
						// P43.1: improved compact message - shorter for active context
						const compactContent = `[cached] ${filePath.split("/").pop() ?? filePath}`;

						// Only intercept if compact is actually smaller
						if (compactContent.length < cachedContent.length) {
							ledger.record({
								mechanism: "read_hash_cache",
								tool: "read",
								estimatedBaselineTokens: baselineEstimate.charEstimate,
								estimatedOptimizedTokens: estimator.estimate(compactContent).charEstimate,
								estimatedSavingTokens:
									baselineEstimate.charEstimate - estimator.estimate(compactContent).charEstimate,
								confidence: "estimated",
								filePath,
							});

							return {
								intercept: true,
								replacementContent: compactContent,
								isCompact: true,
								rawContent: cachedContent,
								snapshot: snap,
								policy,
							};
						}
					}
				}
			}

			// For observe_only and shadow, just track
			if (this.mode === "observe_only" || this.mode === "shadow") {
				return { intercept: false, isCompact: false };
			}

			return { intercept: false, isCompact: false, policy };
		},

		afterRead(filePath: string, content: string, baselineTokens: number): AfterReadResult {
			if (this.mode === "disabled") {
				return { estimatedSaving: 0 };
			}

			// Take snapshot for hash cache
			const _snapshot = readHashCache.takeSnapshot(filePath, content);

			// Estimate smart read saving
			const estimate = estimator.estimate(content);

			if (this.mode === "observe_only") {
				ledger.record({
					mechanism: "read_hash_cache",
					tool: "read",
					estimatedBaselineTokens: baselineTokens,
					estimatedOptimizedTokens: estimate.charEstimate,
					estimatedSavingTokens: 0,
					confidence: "estimated",
					filePath,
				});
				return { estimatedSaving: 0 };
			}

			return { estimatedSaving: 0, mechanism: "read_hash_cache" };
		},

		beforeMutation(filePath: string, _content: string): MutationCheckResult {
			if (this.mode === "disabled" || this.mode === "observe_only") {
				return { blocked: false };
			}

			const acrState = acr.getState(filePath);
			const ledgerState = changeLedger.getState(filePath);
			const policy = getACRLedgerPolicy(acrState, ledgerState);

			if (policy.blockMutation) {
				return {
					blocked: true,
					reason: `Mutation blocked: ACR=${acrState}, Ledger=${ledgerState}. Force raw read first.`,
				};
			}

			return { blocked: false };
		},

		afterMutation(filePath: string, beforeContent: string, afterContent: string): void {
			if (this.mode === "disabled" || this.mode === "observe_only") return;

			// Record change in ledger
			changeLedger.recordChange(filePath, beforeContent, afterContent);

			// Mark dirty in ACR
			acr.markDirty(filePath);

			// Invalidate read hash cache
			readHashCache.invalidate(filePath);
		},

		advanceTurn(): void {
			this.turn++;
			acr.advanceTurn();
		},

		getSavingsReport(): string {
			const summary = ledger.summarize();
			const rtkStatus = detectRtkHook();
			const tinyFileCount = ledger
				.getEvents()
				.filter((e) => e.metadata?.reason === "tiny_file_raw_passthrough").length;

			const lines: string[] = [];
			lines.push("=== P43 Token Context Savings Report ===");
			lines.push("");
			lines.push(`Mode: ${this.mode}`);
			lines.push(`P44 Eligible: ${estimator.isCalibrated ? "YES" : "NO (no provider calibration)"}`);
			lines.push(`RTK Status: ${rtkStatus}`);
			lines.push("");
			lines.push("--- Savings Summary ---");
			lines.push(`Total Events: ${summary.totalEvents}`);
			lines.push(`Estimated Saving: ${summary.estimatedSavingPercent}%`);
			if (summary.actualSavingPercent !== undefined) {
				lines.push(`Actual Saving: ${summary.actualSavingPercent}%`);
			}
			lines.push(`Fallback Count: ${summary.fallbackCount}`);
			lines.push(`Tiny-File Passthrough: ${tinyFileCount}`);
			lines.push(`Hard Safety Count: ${summary.hardSafetyCount}`);
			lines.push("");
			lines.push("--- By Mechanism ---");
			for (const [mech, stats] of Object.entries(summary.byMechanism)) {
				lines.push(`  ${mech}: ${stats.estimatedSaving} est. tokens (${stats.eventCount} events)`);
			}
			lines.push("");
			lines.push("--- By Tool ---");
			for (const [tool, stats] of Object.entries(summary.byTool)) {
				lines.push(`  ${tool}: ${stats.estimatedSaving} est. tokens (${stats.eventCount} events)`);
			}
			lines.push("");
			lines.push("--- Confidence Breakdown ---");
			lines.push(`  actual: ${summary.confidenceBreakdown.actual ?? 0}`);
			lines.push(`  estimated: ${summary.confidenceBreakdown.estimated ?? 0}`);
			lines.push(`  synthetic: ${summary.confidenceBreakdown.synthetic ?? 0}`);
			lines.push("");

			// Raw cache stats
			const cacheStats = rawCache.getStats();
			lines.push("--- Raw Cache ---");
			lines.push(`  Entries: ${cacheStats.entryCount}`);
			lines.push(`  Size: ${cacheStats.totalBytes} / ${cacheStats.maxBytes} bytes`);
			lines.push(`  Hits: ${cacheStats.hitCount}, Misses: ${cacheStats.missCount}`);
			lines.push(`  Evictions: ${cacheStats.evictionCount}`);

			return lines.join("\n");
		},
	};
}

/**
 * P43.1: Detect RTK hook status.
 * Checks for RTK binary and hook installation.
 * Does NOT install anything.
 */
export function detectRtkHook(): "not_installed" | "installed_no_hook" | "hook_installed" | "unknown" {
	try {
		// Check if RTK is available on PATH
		const { execSync } = require("node:child_process");
		try {
			execSync("which rtk", { stdio: "ignore" });
		} catch {
			return "not_installed";
		}

		// Check if RTK hook is installed (rtk hook status)
		try {
			const output = execSync("rtk hook status 2>/dev/null || echo NO_HOOK", {
				encoding: "utf-8",
				timeout: 3000,
			});
			if (output.includes("active") || output.includes("installed") || output.includes("enabled")) {
				return "hook_installed";
			}
			return "installed_no_hook";
		} catch {
			return "installed_no_hook";
		}
	} catch {
		return "unknown";
	}
}
