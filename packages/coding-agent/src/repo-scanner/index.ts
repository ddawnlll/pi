/**
 * Repo Scanner - P8.C Repo Scanning & Analysis
 *
 * A read-only repository health scanner that produces health signals
 * with linked evidence and actionable proposals.
 *
 * Exports:
 * - RepoHealthScanner class
 * - createRepoHealthScanner factory function
 * - formatScanResult / formatScanResultJson formatting helpers
 * - All signal types for consumers
 */

export {
	createRepoHealthScanner,
	formatScanResult,
	formatScanResultJson,
	RepoHealthScanner,
} from "./repo-health-scanner.js";
export * from "./repo-health-signal.js";
