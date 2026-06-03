/**
 * P43 Token Estimator & Provider Usage Calibration - W005 / P43.03
 *
 * Estimates tokens using chars/4 fallback and ingests
 * provider usage where available. Keeps estimated vs actual
 * fields separate (I006). Reports divergence when calibration exists.
 */

import type { ProviderUsageRecord, TokenEstimate } from "./types.js";

export interface CalibrationReport {
	/** Whether any provider calibration data exists */
	hasCalibration: boolean;
	/** Per-provider calibration status */
	byProvider: Record<string, ProviderCalibrationStatus>;
	/** Total estimated tokens (from chars/4) */
	totalEstimated: number;
	/** Total actual provider tokens */
	totalActual: number;
	/** Divergence ratio (actual/estimated) */
	divergenceRatio: number | null;
	/** Whether estimates are promotion-grade (P44 eligible) */
	isPromotionGrade: boolean;
	/** Minimum required coverage ratio for promotion */
	requiredCoverageRatio: number;
	/** Current coverage ratio (actual-backed turns / total turns) */
	coverageRatio: number;
	/** Warning messages */
	warnings: string[];
}

export interface ProviderCalibrationStatus {
	provider: string;
	model: string;
	actualInputTokens: number;
	actualOutputTokens: number;
	totalActualTokens: number;
	sampleCount: number;
	isCalibrated: boolean;
}

export class TokenEstimator {
	private providerUsage: ProviderUsageRecord[] = [];
	private hasProviderCalibration = false;
	private estimatedCharTotal = 0;
	private estimatedTurnCount = 0;
	private actualBackedTurnCount = 0;

	/**
	 * Estimate tokens from string content using chars/4 heuristic.
	 */
	estimate(content: string): TokenEstimate {
		return {
			charEstimate: Math.ceil(content.length / 4),
			isProviderCalibrated: false,
			rawCharCount: content.length,
		};
	}

	/**
	 * Record estimated character count for a turn.
	 */
	recordEstimatedChars(chars: number): void {
		this.estimatedCharTotal += chars;
		this.estimatedTurnCount++;
	}

	/**
	 * Record actual provider usage.
	 */
	recordProviderUsage(record: ProviderUsageRecord): void {
		this.providerUsage.push(record);
		this.hasProviderCalibration = true;
		this.actualBackedTurnCount++;
	}

	/**
	 * Record a turn with provider usage (for coverage tracking).
	 */
	recordCalibratedTurn(): void {
		this.actualBackedTurnCount++;
	}

	/**
	 * Check if any provider calibration data exists.
	 * Required for P44 eligibility.
	 */
	get isCalibrated(): boolean {
		return this.hasProviderCalibration;
	}

	/**
	 * Compute estimated saving percent between two token counts.
	 */
	computeSavingPercent(baseline: number, optimized: number): number {
		if (baseline <= 0) return 0;
		return Math.round(((baseline - optimized) / baseline) * 1000) / 10;
	}

	/**
	 * Get all provider usage records.
	 */
	getProviderUsage(): ProviderUsageRecord[] {
		return [...this.providerUsage];
	}

	/**
	 * Compute divergence between estimated and actual provider usage.
	 */
	computeDivergence(): { estimatedTotal: number; actualTotal: number; divergencePercent: number } | undefined {
		if (!this.hasProviderCalibration || this.providerUsage.length === 0) return undefined;

		const actualTotal = this.providerUsage.reduce((sum, r) => sum + r.totalTokens, 0);
		const estimatedTokens = Math.ceil(this.estimatedCharTotal / 4);

		return {
			estimatedTotal: estimatedTokens,
			actualTotal,
			divergencePercent:
				estimatedTokens > 0
					? Math.round(Math.abs((actualTotal - estimatedTokens) / estimatedTokens) * 1000) / 10
					: 0,
		};
	}

	/**
	 * Generate a full calibration report.
	 */
	generateCalibrationReport(requiredCoverageRatio = 0.8): CalibrationReport {
		const byProvider: Record<string, ProviderCalibrationStatus> = {};
		let totalActual = 0;

		for (const record of this.providerUsage) {
			const key = `${record.provider}/${record.model}`;
			if (!byProvider[key]) {
				byProvider[key] = {
					provider: record.provider,
					model: record.model,
					actualInputTokens: 0,
					actualOutputTokens: 0,
					totalActualTokens: 0,
					sampleCount: 0,
					isCalibrated: true,
				};
			}
			byProvider[key].actualInputTokens += record.actualInputTokens;
			byProvider[key].actualOutputTokens += record.actualOutputTokens;
			byProvider[key].totalActualTokens += record.totalTokens;
			byProvider[key].sampleCount++;
			totalActual += record.totalTokens;
		}

		const totalEstimated = Math.ceil(this.estimatedCharTotal / 4);
		const coverageRatio = this.estimatedTurnCount > 0 ? this.actualBackedTurnCount / this.estimatedTurnCount : 0;
		const isPromotionGrade = this.hasProviderCalibration && coverageRatio >= requiredCoverageRatio;

		const divergence: ReturnType<typeof this.computeDivergence> = this.computeDivergence();

		const warnings: string[] = [];
		if (!this.hasProviderCalibration) {
			warnings.push("No provider calibration data available. All savings are estimated (chars/4).");
		}
		if (coverageRatio < requiredCoverageRatio && this.hasProviderCalibration) {
			warnings.push(
				`Coverage ratio ${Math.round(coverageRatio * 100)}% below required ${Math.round(requiredCoverageRatio * 100)}%. P44 promotion blocked.`,
			);
		}
		if (divergence && divergence.divergencePercent > 30) {
			warnings.push(
				`High divergence: estimated ${divergence.estimatedTotal} vs actual ${divergence.actualTotal} tokens (${divergence.divergencePercent}%).`,
			);
		}

		return {
			hasCalibration: this.hasProviderCalibration,
			byProvider,
			totalEstimated,
			totalActual,
			divergenceRatio: divergence ? divergence.divergencePercent : null,
			isPromotionGrade,
			requiredCoverageRatio,
			coverageRatio,
			warnings,
		};
	}

	/**
	 * Clear usage records.
	 */
	clear(): void {
		this.providerUsage = [];
		this.hasProviderCalibration = false;
		this.estimatedCharTotal = 0;
		this.estimatedTurnCount = 0;
		this.actualBackedTurnCount = 0;
	}
}
