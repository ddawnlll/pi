/**
 * Repo Scanner v2 — V5.05
 *
 * Read-only project scanner that produces evidence-backed findings:
 * - Hotspots (high-change-frequency areas)
 * - Risky diffs (large/complex changes)
 * - Failure correlations (files linked to execution failures)
 * - Stale plan areas (untouched plans)
 * - Proposal candidates (improvement opportunities)
 *
 * The scanner never calls git push or mutates repo state. All output
 * is backed by EvidenceRef references for provenance.
 *
 * @packageDocumentation
 */

export { createFailureCorrelator, FailureCorrelator } from "./failure-correlator.js";
// Sub-scanners
export { createGitDiffScanner, GitDiffScanner } from "./git-diff-scanner.js";
export { createHotspotDetector, HotspotDetector } from "./hotspot-detector.js";
export { createProposalCandidateGenerator, ProposalCandidateGenerator } from "./proposal-candidate-generator.js";
// Main scanner orchestrator
export { createRepoScanner, RepoScanner } from "./scanner.js";
export { createStaleAreaDetector, StaleAreaDetector } from "./stale-area-detector.js";
// Scanner output types
// Scanner signal types
export type {
	FailureCorrelation,
	Hotspot,
	ProposalCandidate,
	RiskyDiff,
	ScannerOptions,
	ScannerSignalType,
	ScanRequest,
	ScanResult,
	ScanTarget,
	StalePlanArea,
} from "./types.js";
// Scanner helper utilities
// Defaults
export {
	ALL_SCANNER_SIGNAL_TYPES,
	correlationSeverity,
	DEFAULT_SCANNER_OPTIONS,
	hotspotSeverity,
	riskScoreToSeverity,
	scoreToPriority,
} from "./types.js";
