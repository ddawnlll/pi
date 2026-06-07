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

import {
	type SmartReadSnapshotOptions,
	type SmartReadSnapshotResult,
	SmartReadSnapshotService,
} from "../smart-read-snapshot.js";
import { ActiveContextRegistry } from "./active-context-registry.js";
import { GenericFallbackAdapter } from "./adapters/fallback.js";
import { JsonYamlAdapter } from "./adapters/json-yaml.js";
import { PythonAdapter } from "./adapters/python.js";
import { RustAdapter } from "./adapters/rust.js";
import { TypeScriptAdapter } from "./adapters/typescript.js";
import { ChangeLedger } from "./change-ledger.js";
import { JsonNativeProvider } from "./providers/json-native-provider.js";
import { PyrightProvider } from "./providers/pyright-provider.js";
import { TreeSitterWasmProvider } from "./providers/tree-sitter-wasm-provider.js";
import { TypeScriptCompilerProvider } from "./providers/typescript-compiler-provider.js";
import { YamlNativeProvider } from "./providers/yaml-native-provider.js";
import { RawCache } from "./raw-cache.js";
import { ReadHashCache } from "./read-hash-cache.js";
import { SavingsLedger } from "./savings-ledger.js";
import { SmartReadCore } from "./smart-read-core.js";
import { SmartReadDiskCache } from "./smart-read-disk-cache.js";
import { TokenEstimator } from "./token-estimator.js";
import type {
	ACRLedgerPolicyResult,
	ReadSnapshot,
	SavingsMechanism,
	SmartReadParseSource,
	SmartReadResult,
	TokenContextConfig,
	TokenContextMode,
} from "./types.js";
import { getACRLedgerPolicy } from "./types.js";

export interface SmartReadAuditTrace {
	/** Settings mode at read time */
	settingsMode: TokenContextMode;
	/** Runtime mode at read time */
	runtimeMode: TokenContextMode;
	/** Token context enabled flag */
	tokenContextEnabled: boolean;
	/** Whether the read tool path is wrapped */
	readPathWrapped: boolean;
	/** Whether beforeRead was called */
	beforeReadCalled: boolean;
	/** Whether beforeRead returned intercept=true */
	beforeReadIntercept: boolean;
	/** Whether beforeRead produced compact output */
	beforeReadIsCompact: boolean;
	/** Mechanism used (read_hash_cache, smart_read, fallback) */
	mechanism: string;
	/** Adapter name if smart read was used */
	adapterName?: string;
	/** Adapter confidence (0.0-1.0) */
	adapterConfidence?: number;
	/** Whether result is mutationSafe */
	mutationSafe?: boolean;
	/** Whether tiny file passthrough was applied */
	tinyFilePassthrough: boolean;
	/** Cache status at read time */
	cacheStatus: string;
	/** Raw content token estimate (chars/4) */
	rawTokensEstimate: number;
	/** Optimized/intercepted content token estimate */
	optimizedTokensEstimate: number;
	/** Estimated savings in tokens */
	savedTokensEstimate: number;
	/** Token estimate of the actual returned tool result */
	returnedToolResultTokensEstimate: number;
	/** Provider payload estimate before (estimated) */
	providerPayloadTokensEstimateBefore?: number;
	/** Provider payload estimate after (estimated) */
	providerPayloadTokensEstimateAfter?: number;
	/** Whether provider payload contained raw file body */
	providerPayloadContainsRawFileBody?: boolean;
	/** Whether provider payload contained compact marker */
	providerPayloadContainsCompactMarker?: boolean;
	/** Whether raw content leaked to provider */
	rawLeakDetected: boolean;
	/** Fallback reason if applicable */
	fallbackReason?: string;
	/** Event ID */
	eventId?: string;
	/** File path */
	filePath?: string;
}

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
	/** Global smart read disk cache (persistent across sessions) */
	globalSmartReadCache: SmartReadDiskCache;
	/** Current turn number */
	turn: number;
	/** Extension source names for RTK detection */
	extensionSources: string[];
	/** Last read audit trace */
	lastReadAudit?: SmartReadAuditTrace;
	/** Session ID for ledger scoping */
	sessionId?: string;

	/**
	 * Called before a read tool executes.
	 * May transform or replace the read result based on mode.
	 * Pass options.offset/limit to skip cache intercept for targeted reads.
	 * Returns a promise because hash cache may use smart read for better compact output.
	 */
	beforeRead(filePath: string, options?: { offset?: number; limit?: number }): Promise<ReadInterceptResult>;

	/**
	 * Called after a read completes successfully with raw content.
	 * In active_safe mode, may produce a smart-read compact result.
	 */
	afterRead(filePath: string, content: string, baselineTokens: number): AfterReadResult;

	/**
	 * Try to produce a smart-read compact result for a first read (no cache hit).
	 * Returns the smart-read compact content or undefined if raw should be used.
	 */
	trySmartRead(
		filePath: string,
		rawContent: string,
		options?: { offset?: number; limit?: number },
	): Promise<SmartReadInterceptResult | undefined>;

	/**
	 * Record a smart read skip event for savings analysis.
	 */
	recordSmartReadSkip(filePath: string, rawContent: string, reason: string): void;

	/**
	 * Get smart read skip statistics for savings report.
	 */
	getSmartReadSkips(): Array<{ filePath: string; reason: string; charLength: number }>;

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
	 * Get a savings summary report (default: current session).
	 */
	getSavingsReport(allTime?: boolean): string;

	/**
	 * Get the last read audit trace for /savings status.
	 */
	getLastReadAudit(): SmartReadAuditTrace | undefined;

	/**
	 * Get a provider payload token audit breakdown.
	 */
	getAuditStatus(): string;

	/**
	 * Audit a provider payload for raw content leak detection.
	 * Called from onPayload hook before provider request.
	 */
	auditProviderPayload(payload: unknown): void;

	/**
	 * Run a snapshot warm-cache operation for the given directory.
	 * Scans all eligible source files and pre-caches smart read outlines.
	 */
	snapshotDirectory(options: SmartReadSnapshotOptions): Promise<SmartReadSnapshotResult>;
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

export interface SmartReadInterceptResult {
	/** Compact content to use instead of raw */
	compactContent: string;
	/** Mechanism used */
	mechanism: string;
	/** Adapter name */
	adapterName: string;
	/** Adapter confidence */
	adapterConfidence: number;
	/** Whether mutationSafe */
	mutationSafe: boolean;
	/** Parse source (v2) */
	parseSource?: SmartReadParseSource;
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
	const ledger = new SavingsLedger(config.storeDir);
	const smartRead = new SmartReadCore();

	// Register v2 providers (high priority first)
	smartRead.registerProvider(new TypeScriptCompilerProvider());
	smartRead.registerProvider(new JsonNativeProvider());
	smartRead.registerProvider(new YamlNativeProvider());
	smartRead.registerProvider(new TreeSitterWasmProvider());
	smartRead.registerProvider(new PyrightProvider());

	// Register legacy adapters (as fallback when providers unavailable)
	const generic = new GenericFallbackAdapter();
	smartRead.registerAdapter(new TypeScriptAdapter());
	smartRead.registerAdapter(new PythonAdapter());
	smartRead.registerAdapter(new JsonYamlAdapter());
	smartRead.registerAdapter(new RustAdapter());
	smartRead.setFallbackAdapter(generic);

	const audit: SmartReadAuditTrace = {
		settingsMode: config.mode,
		runtimeMode: config.mode,
		tokenContextEnabled: config.enabled,
		readPathWrapped: true,
		beforeReadCalled: false,
		beforeReadIntercept: false,
		beforeReadIsCompact: false,
		mechanism: "raw",
		tinyFilePassthrough: false,
		cacheStatus: "empty",
		rawTokensEstimate: 0,
		optimizedTokensEstimate: 0,
		savedTokensEstimate: 0,
		returnedToolResultTokensEstimate: 0,
		rawLeakDetected: false,
	};

	const smartReadSkips: Array<{ filePath: string; reason: string; charLength: number }> = [];

	// Global smart read disk cache — persistent across sessions
	const globalSmartReadCache = new SmartReadDiskCache();

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
		globalSmartReadCache,
		turn: 0,
		extensionSources: config.extensionSources ?? [],
		lastReadAudit: audit,

		recordSmartReadSkip(filePath: string, rawContent: string, reason: string): void {
			smartReadSkips.push({ filePath, reason, charLength: rawContent.length });
		},

		getSmartReadSkips() {
			return smartReadSkips;
		},

		async beforeRead(filePath: string, options?: { offset?: number; limit?: number }): Promise<ReadInterceptResult> {
			if (this.mode === "disabled") {
				this.lastReadAudit = {
					...audit,
					beforeReadCalled: true,
					mechanism: "raw",
					cacheStatus: "disabled",
					filePath,
				};
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
				this.lastReadAudit = {
					...audit,
					beforeReadCalled: true,
					mechanism: "fallback",
					tinyFilePassthrough: true,
					cacheStatus: "tiny_file",
					filePath,
				};
				this.recordSmartReadSkip(filePath, snapshot.rawContent ?? "", "tiny_file_raw_passthrough");
				return { intercept: false, isCompact: false, policy };
			}

			// Try read hash cache for unchanged content
			// Skip cache intercept when LLM explicitly asks for a specific range (offset/limit)
			if (
				this.mode === "active_safe" &&
				(acrState === "active" || acrState === "inactive") &&
				(ledgerState === "no_entry" || ledgerState === "known_unchanged") &&
				options?.offset === undefined &&
				options?.limit === undefined
			) {
				const snap = readHashCache.getSnapshot(filePath);
				if (snap && readHashCache.isUnchanged(snap)) {
					const cachedContent = readHashCache.getRawContent(filePath);
					if (cachedContent) {
						const baselineEstimate = estimator.estimate(cachedContent);
						// Generate a useful compact response: try global disk cache first, then parse
						let compactContent: string;
						try {
							// Check global disk cache first
							const diskEntry = globalSmartReadCache.get(filePath, cachedContent);
							if (diskEntry) {
								compactContent = diskEntry.outline;
							} else {
								const sr = await smartRead.smartRead(cachedContent, filePath, "outline");
								compactContent =
									sr?.content && sr.content.length < cachedContent.length
										? sr.content
										: `[cached] ${filePath.split("/").pop() ?? filePath} (${(cachedContent.length / 4).toFixed(0)} est. tokens)`;
								// Persist to disk cache if parse succeeded
								if (sr && sr.content.length < cachedContent.length) {
									globalSmartReadCache.set(filePath, cachedContent, sr);
								}
							}
						} catch {
							compactContent = `[cached] ${filePath.split("/").pop() ?? filePath} (${(cachedContent.length / 4).toFixed(0)} est. tokens)`;
						}

						// Only intercept if compact is actually smaller
						if (compactContent.length < cachedContent.length) {
							const eid = ledger.record({
								mechanism: "read_hash_cache",
								tool: "read",
								estimatedBaselineTokens: baselineEstimate.charEstimate,
								estimatedOptimizedTokens: estimator.estimate(compactContent).charEstimate,
								estimatedSavingTokens:
									baselineEstimate.charEstimate - estimator.estimate(compactContent).charEstimate,
								confidence: "estimated",
								filePath,
								metadata: { sessionId: this.sessionId },
							});

							this.lastReadAudit = {
								...audit,
								beforeReadCalled: true,
								beforeReadIntercept: true,
								beforeReadIsCompact: true,
								mechanism: "read_hash_cache",
								cacheStatus: "hit",
								rawTokensEstimate: baselineEstimate.charEstimate,
								optimizedTokensEstimate: estimator.estimate(compactContent).charEstimate,
								savedTokensEstimate:
									baselineEstimate.charEstimate - estimator.estimate(compactContent).charEstimate,
								returnedToolResultTokensEstimate: estimator.estimate(compactContent).charEstimate,
								eventId: eid.id,
								filePath,
							};

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
				this.lastReadAudit = {
					...audit,
					beforeReadCalled: true,
					mechanism: "raw",
					cacheStatus: this.mode === "shadow" ? "shadow" : "observe",
					filePath,
				};
				return { intercept: false, isCompact: false };
			}

			// active_safe first read: no cache hit, will try smart read after reading file
			this.lastReadAudit = {
				...audit,
				beforeReadCalled: true,
				mechanism: "raw",
				cacheStatus: "miss",
				filePath,
			};
			return { intercept: false, isCompact: false, policy };
		},

		afterRead(filePath: string, content: string, baselineTokens: number): AfterReadResult {
			if (this.mode === "disabled") {
				return { estimatedSaving: 0 };
			}

			// Take snapshot for hash cache
			const _snapshot = readHashCache.takeSnapshot(filePath, content);

			// Estimate tokens
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

		async trySmartRead(
			filePath: string,
			rawContent: string,
			options?: { offset?: number; limit?: number },
		): Promise<SmartReadInterceptResult | undefined> {
			if (this.mode !== "active_safe") {
				this.recordSmartReadSkip(filePath, rawContent, "mode_not_active_safe");
				return undefined;
			}

			const isTiny = rawContent.length <= this.config.tinyFileThresholdBytes;
			if (isTiny) {
				this.recordSmartReadSkip(filePath, rawContent, "tiny_file_below_threshold");
				return undefined;
			}

			// Don't intercept if user specified offset/limit (targeted read)
			// Smart read assumes a full file overview, not a targeted slice
			if (options?.offset !== undefined || options?.limit !== undefined) {
				this.recordSmartReadSkip(filePath, rawContent, "targeted_read_offset_limit_specified");
				return undefined;
			}

			try {
				// Check global disk cache first
				const cachedEntry = globalSmartReadCache.get(filePath, rawContent);
				if (cachedEntry) {
					// Disk cache hit — skip the parse entirely
					const rawEstimate = estimator.estimate(rawContent);
					const compactEstimate = estimator.estimate(cachedEntry.outline);
					const saving = Math.max(0, rawEstimate.charEstimate - compactEstimate.charEstimate);

					const eid = ledger.record({
						mechanism: "smart_read",
						tool: "read",
						estimatedBaselineTokens: rawEstimate.charEstimate,
						estimatedOptimizedTokens: compactEstimate.charEstimate,
						estimatedSavingTokens: saving,
						confidence: "estimated",
						filePath,
						metadata: {
							mechanism: "smart_read",
							adapter: cachedEntry.adapterName,
							cacheHit: "disk",
							sessionId: this.sessionId,
						},
					});

					this.lastReadAudit = {
						...audit,
						mechanism: "smart_read",
						adapterName: cachedEntry.adapterName,
						adapterConfidence: cachedEntry.adapterConfidence,
						mutationSafe: false,
						cacheStatus: "disk_hit",
						rawTokensEstimate: rawEstimate.charEstimate,
						optimizedTokensEstimate: compactEstimate.charEstimate,
						savedTokensEstimate: saving,
						returnedToolResultTokensEstimate: compactEstimate.charEstimate,
						eventId: eid.id,
						filePath,
					};

					return {
						compactContent: cachedEntry.outline,
						mechanism: "smart_read",
						adapterName: cachedEntry.adapterName,
						adapterConfidence: cachedEntry.adapterConfidence,
						mutationSafe: false,
						parseSource: cachedEntry.parseSource,
					};
				}

				const smartResult = await smartRead.smartRead(rawContent, filePath, "outline");

				// P43 v2: Acceptance gate for compact smart read output
				const acceptance = isSmartReadCompactAcceptable(smartResult, rawContent, filePath);
				if (!acceptance.ok) {
					this.lastReadAudit = {
						...audit,
						mechanism: "raw",
						cacheStatus: "miss",
						fallbackReason: `smart_read compact rejected: ${acceptance.reason}`,
						filePath,
					};
					this.recordSmartReadSkip(filePath, rawContent, acceptance.reason ?? "acceptance_gate_rejected");
					return undefined;
				}

				// Persist to global disk cache for future sessions
				globalSmartReadCache.set(filePath, rawContent, smartResult);

				const rawEstimate = estimator.estimate(rawContent);
				const compactEstimate = estimator.estimate(smartResult.content);
				const saving = Math.max(0, rawEstimate.charEstimate - compactEstimate.charEstimate);

				const eid = ledger.record({
					mechanism: "smart_read",
					tool: "read",
					estimatedBaselineTokens: rawEstimate.charEstimate,
					estimatedOptimizedTokens: compactEstimate.charEstimate,
					estimatedSavingTokens: saving,
					confidence: "estimated",
					filePath,
					metadata: {
						mechanism: "smart_read",
						adapter: smartResult.adapterName,
						cacheHit: "miss",
						sessionId: this.sessionId,
					},
				});

				this.lastReadAudit = {
					...audit,
					mechanism: "smart_read",
					adapterName: smartResult.adapterName,
					adapterConfidence: smartResult.adapterConfidence,
					mutationSafe: smartResult.mutationSafe,
					cacheStatus: "miss",
					rawTokensEstimate: rawEstimate.charEstimate,
					optimizedTokensEstimate: compactEstimate.charEstimate,
					savedTokensEstimate: saving,
					returnedToolResultTokensEstimate: compactEstimate.charEstimate,
					eventId: eid.id,
					filePath,
				};

				return {
					compactContent: smartResult.content,
					mechanism: "smart_read",
					adapterName: smartResult.adapterName,
					adapterConfidence: smartResult.adapterConfidence,
					mutationSafe: smartResult.mutationSafe,
					parseSource: smartResult.parseSource,
				};
			} catch (error) {
				// I008: fail-open, fall back to raw
				this.lastReadAudit = {
					...audit,
					mechanism: "raw",
					cacheStatus: "miss",
					fallbackReason: `smart_read error: ${(error as Error).message}`,
					filePath,
				};
				this.recordSmartReadSkip(filePath, rawContent, `error: ${(error as Error).message}`);
				return undefined;
			}
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

			// Invalidate global smart read disk cache
			globalSmartReadCache.invalidate(filePath);
		},

		advanceTurn(): void {
			this.turn++;
			acr.advanceTurn();
		},

		getLastReadAudit(): SmartReadAuditTrace | undefined {
			return this.lastReadAudit;
		},

		async snapshotDirectory(options: SmartReadSnapshotOptions): Promise<SmartReadSnapshotResult> {
			const snapshotService = new SmartReadSnapshotService({
				diskCache: globalSmartReadCache,
				smartReadCore: smartRead,
			});
			return snapshotService.run(options);
		},

		getAuditStatus(): string {
			const a = this.lastReadAudit;
			const lines: string[] = [];
			lines.push("=== P43 Read Audit Status ===");
			if (!a) {
				lines.push("No read audit data available.");
			} else {
				lines.push(`Mode: ${a.runtimeMode}`);
				lines.push(`Settings Mode: ${a.settingsMode}`);
				lines.push(`beforeRead Called: ${a.beforeReadCalled}`);
				lines.push(`beforeRead Intercept: ${a.beforeReadIntercept}`);
				lines.push(`Mechanism: ${a.mechanism}`);
				if (a.adapterName) lines.push(`Adapter: ${a.adapterName} (confidence: ${a.adapterConfidence ?? "?"})`);
				lines.push(`Cache: ${a.cacheStatus}`);
				lines.push(
					`Raw Est: ${a.rawTokensEstimate} | Optimized Est: ${a.optimizedTokensEstimate} | Saved: ${a.savedTokensEstimate}`,
				);
				lines.push(`Returned Result Est: ${a.returnedToolResultTokensEstimate}`);
				const pct =
					a.rawTokensEstimate > 0 ? Math.round((a.savedTokensEstimate / a.rawTokensEstimate) * 1000) / 10 : 0;
				lines.push(`Token Reduction: ${pct}%`);
				lines.push(`Raw Leak Detected: ${a.rawLeakDetected}`);
				if (a.providerPayloadContainsRawFileBody !== undefined) {
					lines.push(`Provider Payload Has Raw: ${a.providerPayloadContainsRawFileBody}`);
				}
				if (a.providerPayloadContainsCompactMarker !== undefined) {
					lines.push(`Provider Payload Has Compact: ${a.providerPayloadContainsCompactMarker}`);
				}
				if (a.fallbackReason) lines.push(`Fallback: ${a.fallbackReason}`);
				if (a.filePath) lines.push(`File: ${a.filePath}`);
				if (a.eventId) lines.push(`Event ID: ${a.eventId}`);
			}

			// Add calibration report
			const cal = estimator.generateCalibrationReport(config.providerCalibration.requiredForP44 ? 0.8 : 0.5);
			lines.push("");
			lines.push("--- Provider Calibration ---");
			lines.push(`P44 Eligible: ${estimator.isCalibrated ? "YES" : "NO (no provider calibration)"}`);
			if (estimator.isCalibrated) {
				lines.push(`Total Provider Tokens: ${cal.totalActual}`);
				for (const [key, status] of Object.entries(cal.byProvider)) {
					lines.push(
						`  ${key}: ${status.actualInputTokens} in / ${status.actualOutputTokens} out (${status.sampleCount} calls)`,
					);
				}
				if (cal.divergenceRatio !== null) {
					lines.push(`Estimate vs Actual Divergence: ${cal.divergenceRatio}%`);
				}
				lines.push(
					`Coverage Ratio: ${Math.round(cal.coverageRatio * 100)}%${cal.isPromotionGrade ? " (PROMOTION GRADE)" : " (below threshold)"}`,
				);
			}
			for (const w of cal.warnings) {
				lines.push(`  Warning: ${w}`);
			}

			return lines.join("\n");
		},

		auditProviderPayload(payload: unknown): void {
			const a = this.lastReadAudit;
			if (!a || !a.filePath) return;

			// Only audit when a smart read or cache intercept happened (non-raw reads)
			if (a.mechanism !== "smart_read" && a.mechanism !== "read_hash_cache") return;

			try {
				// Serialize payload to string for inspection
				const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);

				// Estimate total provider input tokens
				a.providerPayloadTokensEstimateBefore = estimator.estimate(payloadStr).charEstimate;

				// Check if raw content leaked: the audit trace stores the rawTokensEstimate
				// We detect a leak if the payload is significantly larger than the compact result
				const _hasRawBodyLarge =
					a.returnedToolResultTokensEstimate > 0 &&
					a.providerPayloadTokensEstimateBefore > a.returnedToolResultTokensEstimate * 2;

				// Check for compact markers in payload
				const hasCompactMarker =
					payloadStr.includes("lines total") ||
					payloadStr.includes("[cached]") ||
					payloadStr.includes("smart read");

				// Check for raw file body: look for large contiguous text that matches typical raw read patterns
				a.providerPayloadContainsCompactMarker = hasCompactMarker;
				a.providerPayloadContainsRawFileBody =
					!hasCompactMarker &&
					a.rawTokensEstimate > 0 &&
					a.providerPayloadTokensEstimateBefore > a.rawTokensEstimate * 0.5;

				// Leak detection: compact result chosen but raw content is in provider payload
				a.rawLeakDetected =
					(a.mechanism === "smart_read" || a.mechanism === "read_hash_cache") &&
					a.providerPayloadTokensEstimateBefore > a.returnedToolResultTokensEstimate * 5;

				// Updated estimate after
				a.providerPayloadTokensEstimateAfter = a.providerPayloadTokensEstimateBefore;
			} catch {
				// I008: fail-open
			}
		},

		getSavingsReport(allTime = false): string {
			const allEvents = ledger.getEvents();
			// Filter to current session if not all-time
			const events =
				this.sessionId && !allTime ? allEvents.filter((e) => e.metadata?.sessionId === this.sessionId) : allEvents;

			const tinyFileCount = events.filter((e) => e.metadata?.reason === "tiny_file_raw_passthrough").length;

			// Compute totals from actual events (no fake baselines)
			let totalEstimBaseline = 0;
			let totalEstimOptimized = 0;
			let totalEstimSaving = 0;
			let totalActualSaving = 0;
			const byMechanism: Record<string, { saving: number; count: number }> = {};
			const byTool: Record<string, { saving: number; count: number }> = {};
			let fallbackCount = 0;

			for (const e of events) {
				totalEstimBaseline += e.estimatedBaselineTokens;
				totalEstimOptimized += e.estimatedOptimizedTokens;
				totalEstimSaving += e.estimatedSavingTokens;
				totalActualSaving += e.actualSavingTokens ?? 0;

				const mech = e.mechanism;
				if (!byMechanism[mech]) byMechanism[mech] = { saving: 0, count: 0 };
				byMechanism[mech].saving += e.estimatedSavingTokens;
				byMechanism[mech].count++;

				const tool = e.tool;
				if (!byTool[tool]) byTool[tool] = { saving: 0, count: 0 };
				byTool[tool].saving += e.estimatedSavingTokens;
				byTool[tool].count++;

				if (e.mechanism === "fallback" || e.mechanism === "llm_fallback") fallbackCount++;
			}

			const pct = totalEstimBaseline > 0 ? Math.round((totalEstimSaving / totalEstimBaseline) * 1000) / 10 : 0;
			const barLen = 20;
			const filledBars = Math.round((Math.min(pct, 100) / 100) * barLen);
			const emptyBars = barLen - filledBars;
			const bar = `[${"█".repeat(filledBars)}${"░".repeat(emptyBars)}]`;

			let effectiveness: string;
			if (pct >= 80) effectiveness = "Excellent";
			else if (pct >= 50) effectiveness = "Good";
			else if (pct >= 20) effectiveness = "Moderate";
			else if (pct > 0) effectiveness = "Low";
			else effectiveness = "None";

			// Distinguish actual vs estimated savings
			const actualSavingPct =
				totalEstimBaseline > 0 ? Math.round((totalActualSaving / totalEstimBaseline) * 1000) / 10 : undefined;

			const lines: string[] = [];
			const scope = this.sessionId && !allTime ? " (current session)" : " (all time)";
			lines.push(`=== P43 Token Context Savings Report${scope} ===`);
			lines.push("");
			lines.push(`Mode: ${this.mode}`);
			lines.push(`P44 Eligible: ${estimator.isCalibrated ? "YES" : "NO (no provider calibration)"}`);
			const rtkStatus = detectRtkHook(this.extensionSources);
			lines.push(`RTK Status: ${rtkStatus}`);
			if (this.sessionId) lines.push(`Session: ${this.sessionId.slice(0, 8)}`);
			lines.push("");
			lines.push("--- Savings Summary ---");
			lines.push(`Total Events: ${events.length}`);
			lines.push(`Estimated Saving: ${pct}% ${bar}`);
			lines.push(`Effectiveness: ${effectiveness}`);
			if (actualSavingPct !== undefined && actualSavingPct > 0) {
				lines.push(`Actual Saving (provider-backed): ${actualSavingPct}%`);
			}
			lines.push(`Estimated Tokens Saved: ${totalEstimSaving.toLocaleString()}`);
			lines.push(`Estimated Baseline: ${totalEstimBaseline.toLocaleString()}`);
			lines.push(`Estimated Optimized: ${totalEstimOptimized.toLocaleString()}`);
			if (totalActualSaving > 0) {
				lines.push(`Actual Provider Tokens Saved: ${totalActualSaving.toLocaleString()}`);
			}
			lines.push(`Fallback Count: ${fallbackCount}`);
			lines.push(`Tiny-File Passthrough: ${tinyFileCount}`);
			lines.push("");
			lines.push("--- By Mechanism ---");
			if (Object.keys(byMechanism).length === 0) {
				lines.push("  (no events)");
			} else {
				for (const [mech, stats] of Object.entries(byMechanism)) {
					lines.push(`  ${mech}: ${stats.saving.toLocaleString()} est. tokens (${stats.count} events)`);
				}
			}
			lines.push("");
			lines.push("--- By Tool ---");
			if (Object.keys(byTool).length === 0) {
				lines.push("  (no events)");
			} else {
				for (const [tool, stats] of Object.entries(byTool)) {
					lines.push(`  ${tool}: ${stats.saving.toLocaleString()} est. tokens (${stats.count} events)`);
				}
			}
			lines.push("");
			lines.push(`--- Mode Report ---`);
			if (this.mode === "observe_only") {
				lines.push("  Actual provider savings: 0 (observe_only records only, no interception)");
			} else if (this.mode === "shadow") {
				lines.push("  Actual provider savings: 0 (shadow computes but returns raw)");
			} else if (this.mode === "active_safe") {
				lines.push("  Savings are estimated unless provider-backed (actual).");
			}

			// Raw cache stats
			const cacheStats = rawCache.getStats();
			lines.push("");
			lines.push("--- Raw Cache ---");
			lines.push(`  Entries: ${cacheStats.entryCount}`);
			lines.push(`  Size: ${cacheStats.totalBytes} / ${cacheStats.maxBytes} bytes`);
			lines.push(`  Hits: ${cacheStats.hitCount}, Misses: ${cacheStats.missCount}`);
			lines.push(`  Evictions: ${cacheStats.evictionCount}`);

			// Global smart read disk cache stats
			const diskCacheStats = globalSmartReadCache.getStats();
			lines.push("");
			lines.push("--- Global Smart Read Disk Cache ---");
			lines.push(`  Cached entries: ${diskCacheStats.entryCount}`);
			lines.push(`  Cache dir: ${diskCacheStats.cacheDir}`);
			lines.push(`  Disk files exist: ${diskCacheStats.diskFilesExist ? "yes" : "no"}`);

			// Smart read skip analysis
			const skips = smartReadSkips;
			if (skips.length > 0) {
				lines.push("");
				lines.push("--- Skipped Reads (raw fallback) ---");
				lines.push(`  Total skipped: ${skips.length}`);
				const totalSkippedBytes = skips.reduce((sum, s) => sum + s.charLength, 0);
				lines.push(`  Total raw bytes skipped: ${totalSkippedBytes.toLocaleString()}`);

				// Group by reason
				const byReason: Record<string, { count: number; bytes: number }> = {};
				for (const s of skips) {
					if (!byReason[s.reason]) byReason[s.reason] = { count: 0, bytes: 0 };
					byReason[s.reason].count++;
					byReason[s.reason].bytes += s.charLength;
				}
				lines.push("");
				lines.push("  By reason:");
				for (const [reason, stats] of Object.entries(byReason)) {
					lines.push(`    ${reason}: ${stats.count}x (${stats.bytes.toLocaleString()} bytes)`);
				}
			} else {
				lines.push("");
				lines.push("--- Skipped Reads ---");
				lines.push("  (none)");
			}

			return lines.join("\n");
		},
	};
}

let _rtkCachedResult: ReturnType<typeof detectRtkHook> | null = null;

/**
 * P43.1: Detect RTK hook status.
 * Checks for RTK binary and hook installation.
 * Does NOT install anything.
 * Caches result after first call to avoid execSync on every report.
 */
export function detectRtkHook(
	extensionSources?: string[],
	invalidateCache = false,
): "not_installed" | "installed_no_hook" | "hook_installed" | "unknown" {
	if (_rtkCachedResult !== null && !invalidateCache) {
		return _rtkCachedResult;
	}

	// Check if RTK extension is loaded
	if (extensionSources && extensionSources.length > 0) {
		const hasRtkExtension = extensionSources.some(
			(source) => source.toLowerCase().includes("rtk") || source.toLowerCase().includes("replay-toolkit"),
		);
		if (hasRtkExtension) {
			_rtkCachedResult = "hook_installed";
			return "hook_installed";
		}
	}

	try {
		// Check if RTK is available on PATH
		const { execSync } = require("node:child_process");
		let rtkPath: string;
		try {
			rtkPath = execSync("which rtk", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
			console.log(`[RTK] Found RTK at: ${rtkPath}`);
			_rtkCachedResult = "hook_installed";
			return "hook_installed";
		} catch {
			_rtkCachedResult = "not_installed";
			return "not_installed";
		}
	} catch (error) {
		// Log the actual error for debugging
		console.error("[RTK Detection Error]:", error instanceof Error ? error.message : String(error));
		_rtkCachedResult = "unknown";
		return "unknown";
	}
}

// ============================================================================
// P43 v2: Smart Read Compact Acceptance Gates
// ============================================================================

function isCodeFile(filePath: string): boolean {
	return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|pyw|rs)$/i.test(filePath);
}

function isDataFile(filePath: string): boolean {
	return /\.(json|jsonc|json5|yaml|yml|toml|xml|html|css|scss|less)$/i.test(filePath);
}

function isSmartReadCompactAcceptable(
	result: SmartReadResult,
	rawContent: string,
	filePath: string,
): { ok: boolean; reason?: string } {
	// Null/undefined result
	if (!result) {
		return { ok: false, reason: "result is null/undefined" };
	}

	// Fallback results are never acceptable as compact
	if (result.isFallback === true) {
		return { ok: false, reason: "result is fallback" };
	}

	// Content too short to be useful
	if (result.content.length < 50) {
		return { ok: false, reason: "compact content too short (< 50 chars)" };
	}

	// Compact must be actually shorter than raw
	if (result.content.length >= rawContent.length) {
		return { ok: false, reason: "compact content not shorter than raw" };
	}

	// Check for error/not-found markers
	if (
		result.content.includes('[Symbol "') ||
		result.content.includes("not found via") ||
		result.content.includes("[Error:") ||
		result.content.includes("not found in") ||
		result.content.includes("(no symbols detected)") ||
		result.content.includes("(no symbols found)")
	) {
		return { ok: false, reason: "compact content contains error/not-found marker" };
	}

	// For code files, reject outlines with too few symbols relative to file size.
	// A 1000-byte file with only 1-2 symbols is better served as raw content.
	if (isCodeFile(filePath)) {
		const symbolLineCount = result.content
			.split("\n")
			.filter((l) => !l.startsWith("Symbol Outline:") && !l.startsWith("==============") && l.trim() !== "").length;
		if (symbolLineCount === 0 && result.content.length < 100) {
			return { ok: false, reason: "code file outline has zero symbols" };
		}
	}

	// For code files, must have high confidence and proper parse source
	if (isCodeFile(filePath)) {
		const parseSource = result.parseSource;

		// Reject regex/generic/LLM fallback parse sources
		if (parseSource === "regex_fallback" || parseSource === "generic_fallback" || parseSource === "llm_fallback") {
			return { ok: false, reason: `code file rejected ${parseSource} compact` };
		}

		// Require high confidence for code files
		if (result.adapterConfidence < 0.75) {
			return { ok: false, reason: `code file confidence ${result.adapterConfidence} < 0.75` };
		}

		// Must have meaningful parse source for code
		if (!parseSource || parseSource === "raw") {
			return { ok: false, reason: "code file missing meaningful parse source" };
		}
	}

	// For data files (JSON/YAML), require native parser or tree-sitter
	if (isDataFile(filePath)) {
		const parseSource = result.parseSource;
		if (parseSource === "regex_fallback" || parseSource === "generic_fallback") {
			return { ok: false, reason: `data file rejected ${parseSource} compact` };
		}

		if (result.adapterConfidence < 0.75) {
			return { ok: false, reason: `data file confidence ${result.adapterConfidence} < 0.75` };
		}
	}

	return { ok: true };
}
