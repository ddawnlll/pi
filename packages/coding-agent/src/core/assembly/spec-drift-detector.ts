/**
 * P45.09 — Spec Versioning and ACCP-Aware Spec Drift Detector
 *
 * Detects spec drift by comparing the current assembly state against
 * the frozen predictive spec. Computes drift metrics used by the DriftBudgetGate.
 */

import { createHash } from "node:crypto";
import type { ArtifactManifest } from "./artifact-manifest.js";
import type { PredictiveSpec } from "./predictive-spec-input.js";
import { freezeSpec, type FrozenContract } from "./contract-freeze.js";

// =============================================================================
// Types
// =============================================================================

export type DriftSeverity = "none" | "compatible" | "breaking";

export interface SpecDriftDetection {
	/** The contract/namespace that drifted. */
	contract: string;
	/** Severity of the drift. */
	severity: DriftSeverity;
	/** What was predicted. */
	predicted: string;
	/** What actually occurred. */
	actual: string;
	/** Human-readable description. */
	description: string;
	/** Whether this drift was previously detected. */
	previouslyDetected: boolean;
}

export interface DriftReport {
	/** Total drift events detected. */
	totalDrifts: number;
	/** Drift events by severity. */
	bySeverity: Record<DriftSeverity, SpecDriftDetection[]>;
	/** Whether any breaking drifts were detected. */
	hasBreakingDrifts: boolean;
	/** Whether the spec version has changed. */
	specVersionChanged: boolean;
}

export interface SpecVersion {
	/** Version string (semver-like). */
	version: string;
	/** Hash of the spec at this version. */
	specHash: string;
	/** ISO timestamp. */
	createdAt: string;
}

// =============================================================================
// Drift Detector
// =============================================================================

export class SpecDriftDetector {
	private frozenContract: FrozenContract | null = null;
	private versionHistory: SpecVersion[] = [];
	private previousDetections = new Map<string, SpecDriftDetection>();

	/**
	 * Freeze a spec for drift comparison.
	 */
	freeze(spec: PredictiveSpec): void {
		this.frozenContract = freezeSpec(spec);
		this.versionHistory.push({
			version: `v${this.versionHistory.length + 1}.0.0`,
			specHash: this.frozenContract.specHash,
			createdAt: new Date().toISOString(),
		});
	}

	/**
	 * Detect drift between the frozen spec and current assembly manifests.
	 */
	detectDrift(manifests: ArtifactManifest[]): DriftReport {
		if (!this.frozenContract) {
			return emptyDriftReport();
		}

		const detections: SpecDriftDetection[] = [];
		const frozenPrediction = this.frozenContract.spec;

		for (const manifest of manifests) {
			const nsPrediction = frozenPrediction.namespaces.find(
				(ns) => ns.namespace === manifest.namespace,
			);

			for (const artifact of manifest.artifacts) {
				const contract = nsPrediction?.contracts.find(
					(c) => c.contract === artifact.file,
				);

				if (!contract) {
					// New file not in prediction → missing prediction
					const detection: SpecDriftDetection = {
						contract: artifact.file,
						severity: "compatible",
						predicted: "not predicted",
						actual: `created by ${manifest.namespace}`,
						description: `File "${artifact.file}" was not predicted by the spec`,
						previouslyDetected: this.previousDetections.has(artifact.file),
					};
					detections.push(detection);
					this.previousDetections.set(artifact.file, detection);
				}
			}

			// Check for predicted files that were not produced
			if (nsPrediction) {
				const producedFiles = new Set(manifest.artifacts.map((a) => a.file));
				for (const contract of nsPrediction.contracts) {
					if (!producedFiles.has(contract.contract)) {
						const detection: SpecDriftDetection = {
							contract: contract.contract,
							severity: "breaking",
							predicted: contract.predictedOutcome,
							actual: "not produced",
							description: `Predicted contract "${contract.contract}" was not produced by ${manifest.namespace}`,
							previouslyDetected: this.previousDetections.has(contract.contract),
						};
						detections.push(detection);
						this.previousDetections.set(contract.contract, detection);
					}
				}
			}
		}

		// Group by severity
		const bySeverity: Record<DriftSeverity, SpecDriftDetection[]> = {
			none: [],
			compatible: [],
			breaking: [],
		};

		for (const d of detections) {
			bySeverity[d.severity].push(d);
		}

		return {
			totalDrifts: detections.length,
			bySeverity,
			hasBreakingDrifts: bySeverity.breaking.length > 0,
			specVersionChanged: this.versionHistory.length > 1,
		};
	}

	/**
	 * Get the current frozen contract.
	 */
	getFrozenContract(): FrozenContract | null {
		return this.frozenContract;
	}

	/**
	 * Get version history.
	 */
	getVersionHistory(): SpecVersion[] {
		return [...this.versionHistory];
	}

	/**
	 * Clear all state.
	 */
	reset(): void {
		this.frozenContract = null;
		this.versionHistory = [];
		this.previousDetections.clear();
	}
}

function emptyDriftReport(): DriftReport {
	return {
		totalDrifts: 0,
		bySeverity: { none: [], compatible: [], breaking: [] },
		hasBreakingDrifts: false,
		specVersionChanged: false,
	};
}
