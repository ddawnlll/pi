/**
 * P43.3 Edit Recovery Types and Config
 */

import type { TokenSavingEvent } from "./types.js";

// ============================================================================
// Config
// ============================================================================

export interface EditRecoveryConfig {
	enabled: boolean;
	maxCandidates: number;
	contextLinesBefore: number;
	contextLinesAfter: number;
	maxCandidateLines: number;
	maxPacketTokensEstimate: number;
	autoApplyWhitespaceOnly: boolean;
	minAutoApplySimilarity: number;
	minCandidateSimilarity: number;
}

export const DEFAULT_EDIT_RECOVERY_CONFIG: EditRecoveryConfig = {
	enabled: true,
	maxCandidates: 3,
	contextLinesBefore: 8,
	contextLinesAfter: 8,
	maxCandidateLines: 40,
	maxPacketTokensEstimate: 800,
	autoApplyWhitespaceOnly: true,
	minAutoApplySimilarity: 0.985,
	minCandidateSimilarity: 0.7,
};

// ============================================================================
// Recovery Packet
// ============================================================================

export type CandidateKind =
	| "exact_normalized"
	| "whitespace_drift"
	| "nearby_text"
	| "partial_match"
	| "low_confidence";

export interface EditRecoveryCandidate {
	candidateId: number;
	startLine: number;
	endLine: number;
	similarity: number;
	normalizedSimilarity: number;
	sameIndentFamily: boolean;
	snippetHash: string;
	candidateKind: CandidateKind;
	preview: string;
}

export interface EditRecoveryPacket {
	recoveryType: "EDIT_MISMATCH_RECOVERY";
	path: string;
	reason: "oldText_not_found";
	currentFileHash: string;
	expectedBaseHash: string;
	oldTextHash: string;
	oldTextLineCount: number;
	fullRereadAvoided: boolean;
	estimatedFullRereadTokens: number;
	recoveryPacketTokensEstimate: number;
	estimatedTokensSaved: number;
	candidates: EditRecoveryCandidate[];
	suggestedNextActions: string[];
	autoApplyStatus: "applied" | "blocked" | "no_candidates" | "ambiguous" | "semantic_diff" | "disabled";
}

// ============================================================================
// Recovery Metrics
// ============================================================================

export interface EditRecoveryMetrics {
	exactOldTextMissCount: number;
	recoveryPacketsReturned: number;
	fullRereadsAvoided: number;
	recoveryPacketTokens: number;
	estimatedFullRereadTokensAvoided: number;
	estimatedTokensSavedByEditRecovery: number;
	fuzzyAutoApplyCount: number;
	fuzzyAutoApplyBlockedCount: number;
	ambiguousCandidateCount: number;
	noCandidateFoundCount: number;
}

export class EditRecoveryMetricsTracker {
	metrics: EditRecoveryMetrics = {
		exactOldTextMissCount: 0,
		recoveryPacketsReturned: 0,
		fullRereadsAvoided: 0,
		recoveryPacketTokens: 0,
		estimatedFullRereadTokensAvoided: 0,
		estimatedTokensSavedByEditRecovery: 0,
		fuzzyAutoApplyCount: 0,
		fuzzyAutoApplyBlockedCount: 0,
		ambiguousCandidateCount: 0,
		noCandidateFoundCount: 0,
	};

	recordMiss(): void {
		this.metrics.exactOldTextMissCount++;
	}

	recordRecoveryPacket(tokensEstimate: number, fullRereadTokens: number): void {
		this.metrics.recoveryPacketsReturned++;
		this.metrics.fullRereadsAvoided++;
		this.metrics.recoveryPacketTokens += tokensEstimate;
		this.metrics.estimatedFullRereadTokensAvoided += fullRereadTokens;
		this.metrics.estimatedTokensSavedByEditRecovery += fullRereadTokens - tokensEstimate;
	}

	recordAutoApply(applied: boolean): void {
		if (applied) {
			this.metrics.fuzzyAutoApplyCount++;
		} else {
			this.metrics.fuzzyAutoApplyBlockedCount++;
		}
	}

	recordAmbiguousCandidates(): void {
		this.metrics.ambiguousCandidateCount++;
	}

	recordNoCandidate(): void {
		this.metrics.noCandidateFoundCount++;
	}

	toLedgerEvent(filePath: string, savingsRecordFn: (event: Omit<TokenSavingEvent, "id" | "timestamp">) => void): void {
		if (this.metrics.estimatedTokensSavedByEditRecovery > 0) {
			savingsRecordFn({
				mechanism: "fallback",
				tool: "edit",
				estimatedBaselineTokens: this.metrics.estimatedFullRereadTokensAvoided,
				estimatedOptimizedTokens: this.metrics.recoveryPacketTokens,
				estimatedSavingTokens: this.metrics.estimatedTokensSavedByEditRecovery,
				confidence: "estimated",
				filePath,
				metadata: {
					mechanism: "edit_recovery",
					missCount: this.metrics.exactOldTextMissCount,
					autoApplies: this.metrics.fuzzyAutoApplyCount,
				},
			});
		}
	}

	reset(): void {
		this.metrics = {
			exactOldTextMissCount: 0,
			recoveryPacketsReturned: 0,
			fullRereadsAvoided: 0,
			recoveryPacketTokens: 0,
			estimatedFullRereadTokensAvoided: 0,
			estimatedTokensSavedByEditRecovery: 0,
			fuzzyAutoApplyCount: 0,
			fuzzyAutoApplyBlockedCount: 0,
			ambiguousCandidateCount: 0,
			noCandidateFoundCount: 0,
		};
	}
}
