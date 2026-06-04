/**
 * P43 Token Context Runtime - Core Types and Interfaces
 *
 * All P43 runtime components derive from these interfaces.
 * Adapters must implement SmartReadAdapter.
 * mutationSafe is mandatory on SmartReadResult.
 */

// ============================================================================
// Mode & Configuration
// ============================================================================

export type TokenContextMode = "disabled" | "observe_only" | "shadow" | "active_safe" | "active_experimental";

export interface TokenContextConfig {
	enabled: boolean;
	mode: TokenContextMode;
	rawCache: {
		maxBytes: number;
	};
	llmFallback: {
		maxTokens: number;
	};
	changeLedger: {
		maxDeltaChainBeforeCheckpoint: number;
	};
	providerCalibration: {
		requiredForP44: boolean;
	};
	/** P43.1: Minimum file size in bytes for smart read optimization. Files below this are returned raw. */
	tinyFileThresholdBytes: number;
	/** P43.3: Edit recovery config */
	editRecovery: {
		enabled: boolean;
		maxCandidates: number;
		contextLinesBefore: number;
		contextLinesAfter: number;
		maxCandidateLines: number;
		maxPacketTokensEstimate: number;
		autoApplyWhitespaceOnly: boolean;
		minAutoApplySimilarity: number;
		minCandidateSimilarity: number;
	};
	/** Extension source names for RTK detection */
	extensionSources?: string[];
}

export const DEFAULT_TOKEN_CONTEXT_CONFIG: TokenContextConfig = {
	enabled: false,
	mode: "observe_only",
	rawCache: {
		maxBytes: 50 * 1024 * 1024, // 50MB
	},
	llmFallback: {
		maxTokens: 2000,
	},
	changeLedger: {
		maxDeltaChainBeforeCheckpoint: 5,
	},
	providerCalibration: {
		requiredForP44: true,
	},
	tinyFileThresholdBytes: 64,
	/** P43.3: Edit recovery config */
	editRecovery: {
		enabled: true,
		maxCandidates: 3,
		contextLinesBefore: 8,
		contextLinesAfter: 8,
		maxCandidateLines: 40,
		maxPacketTokensEstimate: 800,
		autoApplyWhitespaceOnly: true,
		minAutoApplySimilarity: 0.985,
		minCandidateSimilarity: 0.7,
	},
};

// ============================================================================
// Savings Ledger Types
// ============================================================================

export type SavingsMechanism =
	| "smart_read"
	| "read_hash_cache"
	| "change_ledger"
	| "active_context_registry"
	| "raw_cache"
	| "rtk_bash"
	| "no_full_rewrite"
	| "llm_fallback"
	| "fallback";

export type SavingsConfidence = "actual" | "estimated" | "synthetic";

export interface TokenSavingEvent {
	/** Unique event ID */
	id: string;
	/** Session timestamp */
	timestamp: number;
	/** Which mechanism produced the saving */
	mechanism: SavingsMechanism;
	/** Which tool (read, edit, write, bash) */
	tool: string;
	/** Estimated tokens that would have been used without optimization */
	estimatedBaselineTokens: number;
	/** Estimated tokens actually used with optimization */
	estimatedOptimizedTokens: number;
	/** Estimated saving in tokens */
	estimatedSavingTokens: number;
	/** Actual provider-measured tokens if available */
	actualBaselineTokens?: number;
	/** Actual provider-measured tokens if available */
	actualOptimizedTokens?: number;
	/** Actual provider-measured saving if available */
	actualSavingTokens?: number;
	/** Confidence level of the saving measurement */
	confidence: SavingsConfidence;
	/** File path context if applicable */
	filePath?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

// ============================================================================
// Smart Read Types
// ============================================================================

export type SmartReadMode = "outline" | "symbols" | "symbol_exact" | "range_exact" | "changed" | "raw";

export interface SmartReadResult {
	/** The text content to return */
	content: string;
	/** Which smart read mode produced this result */
	mode: SmartReadMode;
	/** Whether this result is safe for mutation (editing/writing) */
	mutationSafe: boolean;
	/** Adapter confidence in this result (0.0-1.0) */
	adapterConfidence: number;
	/** Hash of the full file content at read time */
	fileHash?: string;
	/** Raw handle for raw cache fallback */
	rawHandle?: string;
	/** Suggested next reads for the model */
	suggestedNextReads?: string[];
	/** Adapter name that produced this result */
	adapterName: string;
	/** Whether this was a fallback (adapter failed, fell through) */
	isFallback: boolean;
	/** Error message if fallback was due to error */
	fallbackError?: string;
}

export interface SmartReadAdapter {
	/** Adapter name (e.g., "typescript", "python", "generic") */
	readonly name: string;
	/** Language/file extensions this adapter handles */
	readonly extensions: string[];
	/** Parse a file into outline mode */
	outline(content: string, filePath: string): Promise<SmartReadResult>;
	/** Parse a file into symbols mode */
	symbols(content: string, filePath: string): Promise<SmartReadResult>;
	/** Get exact content for a named symbol */
	symbolExact(content: string, filePath: string, symbol: string): Promise<SmartReadResult>;
	/** Get exact content for a line range */
	rangeExact(content: string, filePath: string, startLine: number, endLine: number): Promise<SmartReadResult>;
	/** Get changed content based on a delta */
	changed(content: string, filePath: string, delta: string): Promise<SmartReadResult>;
}

// ============================================================================
// Read Snapshot & Hash Cache
// ============================================================================

export interface ReadSnapshot {
	/** Snapshot ID */
	id: string;
	/** File path (absolute) */
	filePath: string;
	/** Hash of file content (SHA-256) */
	contentHash: string;
	/** File size in bytes */
	fileSize: number;
	/** File modification time (mtimeMs) */
	mtimeMs: number;
	/** Raw content stored in raw cache */
	rawContent?: string;
	/** Raw cache handle */
	rawHandle?: string;
	/** When the snapshot was taken */
	timestamp: number;
	/** Whether this snapshot was produced externally (not by our read tool) */
	externalSource?: boolean;
}

// ============================================================================
// Active Context Registry (ACR)
// ============================================================================

export type ACRState = "active" | "inactive" | "evicted" | "dirty" | "changed" | "unknown";

export interface ActiveContextEntry {
	/** File path (absolute) */
	filePath: string;
	/** Current ACR state */
	state: ACRState;
	/** When the entry was last accessed */
	lastAccessed: number;
	/** When the entry was created */
	created: number;
	/** Snapshot ID if one exists */
	snapshotId?: string;
	/** Turn number when last accessed (turn-based eviction) */
	lastTurn?: number;
	/** Whether this entry has been externally modified */
	externallyModified?: boolean;
}

// ============================================================================
// Change Ledger
// ============================================================================

export type LedgerState =
	| "no_entry"
	| "known_unchanged"
	| "changed_with_delta"
	| "changed_delta_chain_short"
	| "changed_delta_chain_long"
	| "checkpoint_required"
	| "stale_hash"
	| "external_mutation"
	| "raw_missing";

export interface ChangeLedgerEvent {
	/** Event ID */
	id: string;
	/** File path (absolute) */
	filePath: string;
	/** File hash before change */
	beforeHash: string;
	/** File hash after change */
	afterHash?: string;
	/** Changed line ranges */
	changedRanges?: Array<{ start: number; end: number }>;
	/** Changed symbols if available */
	changedSymbols?: string[];
	/** Delta/patch summary */
	delta?: string;
	/** Current ledger state */
	state: LedgerState;
	/** Number of entries in the delta chain */
	deltaChainLength: number;
	/** When the event was recorded */
	timestamp: number;
	/** Whether a checkpoint is required */
	checkpointRequired: boolean;
}

// ============================================================================
// Raw Cache
// ============================================================================

export interface RawCacheHandle {
	/** Handle ID */
	id: string;
	/** File path */
	filePath: string;
	/** Raw content */
	content: string;
	/** Content size in bytes */
	sizeBytes: number;
	/** When cached */
	timestamp: number;
	/** Content hash */
	contentHash: string;
}

export interface RawCacheStats {
	totalBytes: number;
	maxBytes: number;
	entryCount: number;
	evictionCount: number;
	hitCount: number;
	missCount: number;
}

// ============================================================================
// Provider Usage
// ============================================================================

export interface ProviderUsageRecord {
	/** Provider name */
	provider: string;
	/** Model ID */
	model: string;
	/** Actual input tokens from provider */
	actualInputTokens: number;
	/** Actual output tokens from provider */
	actualOutputTokens: number;
	/** Total tokens from provider */
	totalTokens: number;
	/** When recorded */
	timestamp: number;
	/** Request ID for correlation */
	requestId: string;
}

export interface TokenEstimate {
	/** Character-based token estimate */
	charEstimate: number;
	/** Whether this is a provider-calibrated value */
	isProviderCalibrated: boolean;
	/** Provider name if calibrated */
	providerName?: string;
	/** Raw character count */
	rawCharCount: number;
}

// ============================================================================
// ACR × Change Ledger Policy Matrix
// ============================================================================

export interface ACRLedgerPolicyResult {
	/** Whether unchanged content can be returned */
	returnUnchanged: boolean;
	/** Whether a compact summary is appropriate */
	returnCompactSummary: boolean;
	/** Whether delta is appropriate */
	returnDelta: boolean;
	/** Whether an exact symbol read is forced */
	forceExactSymbolRead: boolean;
	/** Whether a raw read is forced */
	forceRawRead: boolean;
	/** Whether mutation (edit/write) is blocked */
	blockMutation: boolean;
	/** Whether to mark dirty */
	markDirty: boolean;
	/** Whether this is a hard safety failure */
	hardFail: boolean;
}

/**
 * ACR × Change Ledger policy table.
 *
 * Maps ACR state × Ledger state → behavior.
 * Implements I005: dirty/changed/unknown/stale/raw-missing must never return unsafe content.
 */
export const ACR_LEDGER_POLICY: Record<ACRState, Partial<Record<LedgerState, ACRLedgerPolicyResult>>> = {
	active: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: true,
			returnCompactSummary: true,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: false,
			hardFail: true,
		},
	},
	inactive: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: false,
			returnCompactSummary: true,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: false,
			hardFail: true,
		},
	},
	evicted: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: false,
			markDirty: false,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: false,
			hardFail: true,
		},
	},
	dirty: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: true,
		},
	},
	changed: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: true,
			forceExactSymbolRead: false,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: true,
		},
	},
	unknown: {
		no_entry: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		known_unchanged: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_with_delta: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_short: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		changed_delta_chain_long: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		checkpoint_required: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		stale_hash: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: true,
			forceRawRead: false,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		external_mutation: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: false,
		},
		raw_missing: {
			returnUnchanged: false,
			returnCompactSummary: false,
			returnDelta: false,
			forceExactSymbolRead: false,
			forceRawRead: true,
			blockMutation: true,
			markDirty: true,
			hardFail: true,
		},
	},
};

/**
 * Look up the ACR × Change Ledger policy for a given state combination.
 */
export function getACRLedgerPolicy(acr: ACRState, ledger: LedgerState): ACRLedgerPolicyResult {
	const row = ACR_LEDGER_POLICY[acr];
	const cell = row[ledger];
	if (cell) return cell;
	// Default: force raw read, blocking unknown combinations
	return {
		returnUnchanged: false,
		returnCompactSummary: false,
		returnDelta: false,
		forceExactSymbolRead: false,
		forceRawRead: true,
		blockMutation: true,
		markDirty: true,
		hardFail: false,
	};
}
