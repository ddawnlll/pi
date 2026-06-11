/**
 * P45.10 — Targeted Replay Engine, Cascade Circuit Breaker, and Route Signal Integration
 *
 * Replays only namespaces affected by spec drift or assembly errors.
 * Cascade circuit breaker prevents replay storms.
 * Integrates with ACCP route signals for targeted replay decisions.
 */

import type { ArtifactManifest } from "./artifact-manifest.js";
import type { SpecDriftDetection, DriftReport } from "./spec-drift-detector.js";

// =============================================================================
// Types
// =============================================================================

export interface ReplayTarget {
	/** Namespace to replay. */
	namespace: string;
	/** Reason for replay. */
	reason: "drift" | "assembly_error" | "route_signal" | "dependency_changed";
	/** Contract that triggered the replay. */
	trigger?: string;
	/** Affected artifacts. */
	artifacts: string[];
}

export interface ReplayPlan {
	/** Ordered list of namespaces to replay. */
	targets: ReplayTarget[];
	/** Total namespaces affected. */
	totalAffected: number;
	/** Whether the cascade breaker was triggered. */
	cascadeBlocked: boolean;
	/** Reason for cascade block (if any). */
	cascadeReason?: string;
}

export interface CascadeBreakerConfig {
	/** Max consecutive replays per namespace. */
	maxReplaysPerNamespace: number;
	/** Max total replays per assembly run. */
	maxTotalReplays: number;
	/** Max cascade depth (replay chains). */
	maxCascadeDepth: number;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_CASCADE_CONFIG: CascadeBreakerConfig = {
	maxReplaysPerNamespace: 3,
	maxTotalReplays: 20,
	maxCascadeDepth: 5,
};

// =============================================================================
// Replay Engine
// =============================================================================

export class TargetedReplayEngine {
	private replayCounts = new Map<string, number>();
	private totalReplays = 0;
	private cascadeDepth = 0;
	private config: CascadeBreakerConfig;

	constructor(config?: Partial<CascadeBreakerConfig>) {
		this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
	}

	/**
	 * Build a targeted replay plan from a drift report.
	 */
	buildReplayPlan(
		driftReport: DriftReport,
		manifests: ArtifactManifest[],
	): ReplayPlan {
		const targets: ReplayTarget[] = [];
		const affectedFiles = new Set<string>();

		// Collect drifts
		for (const drift of [...driftReport.bySeverity.breaking, ...driftReport.bySeverity.compatible]) {
			affectedFiles.add(drift.contract);
		}

		// Map affected files to namespaces
		const namespaceFiles = new Map<string, string[]>();
		for (const manifest of manifests) {
			for (const artifact of manifest.artifacts) {
				if (affectedFiles.has(artifact.file)) {
					if (!namespaceFiles.has(manifest.namespace)) {
						namespaceFiles.set(manifest.namespace, []);
					}
					namespaceFiles.get(manifest.namespace)!.push(artifact.file);
				}
			}
		}

		// Build targets
		for (const [ns, files] of namespaceFiles) {
			targets.push({
				namespace: ns,
				reason: "drift",
				trigger: files[0],
				artifacts: files,
			});
		}

		return {
			targets,
			totalAffected: targets.length,
			cascadeBlocked: false,
		};
	}

	/**
	 * Check if replay is allowed for a namespace given cascade breaker state.
	 */
	canReplay(namespace: string): { allowed: boolean; reason?: string } {
		// Check per-namespace limit
		const nsCount = this.replayCounts.get(namespace) ?? 0;
		if (nsCount >= this.config.maxReplaysPerNamespace) {
			return {
				allowed: false,
				reason: `Namespace ${namespace} exceeded max replays (${nsCount}/${this.config.maxReplaysPerNamespace})`,
			};
		}

		// Check total replay limit
		if (this.totalReplays >= this.config.maxTotalReplays) {
			return {
				allowed: false,
				reason: `Total replays exceeded (${this.totalReplays}/${this.config.maxTotalReplays})`,
			};
		}

		// Check cascade depth
		if (this.cascadeDepth >= this.config.maxCascadeDepth) {
			return {
				allowed: false,
				reason: `Cascade depth exceeded (${this.cascadeDepth}/${this.config.maxCascadeDepth})`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Record a replay execution.
	 */
	recordReplay(namespace: string): void {
		this.replayCounts.set(namespace, (this.replayCounts.get(namespace) ?? 0) + 1);
		this.totalReplays++;
		this.cascadeDepth++;
	}

	/**
	 * Reset cascade depth (call between cascade chains).
	 */
	resetCascadeDepth(): void {
		this.cascadeDepth = 0;
	}

	/**
	 * Get current replay statistics.
	 */
	getStats(): { totalReplays: number; perNamespace: Map<string, number>; cascadeDepth: number } {
		return {
			totalReplays: this.totalReplays,
			perNamespace: new Map(this.replayCounts),
			cascadeDepth: this.cascadeDepth,
		};
	}

	/**
	 * Reset all replay state.
	 */
	reset(): void {
		this.replayCounts.clear();
		this.totalReplays = 0;
		this.cascadeDepth = 0;
	}
}
