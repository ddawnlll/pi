/**
 * Truncation Detector - Detects truncated file writes and edit failures.
 *
 * P4.5 Workstream 4.5.C: Detects when a write or edit strategy is failing
 * by scanning tool output for truncation markers and exact-match failure
 * patterns. Truncation forces fallback to patch mode in all modes.
 * Exact-match failures increment the same-file edit failure counter.
 */

import type { EditFailureType } from "./edit-strategy-types.js";

// ---------------------------------------------------------------------------
// Truncation Markers
// ---------------------------------------------------------------------------

/**
 * Known truncation markers that indicate a full write was truncated.
 * These are patterns found in tool output or model reasoning text.
 */
const TRUNCATION_MARKERS: readonly string[] = [
	"truncated",
	"The file got truncated",
	"write is truncating",
	"Let me write the complete file again",
	"complete file in parts",
	"... more lines",
] as const;

/**
 * Known exact-match failure patterns from tool output.
 */
const EXACT_MATCH_FAILURE_MARKERS: readonly string[] = [
	"Could not find the exact text",
	"old text must match exactly",
] as const;

/**
 * Additional failure patterns for other edit failure types.
 */
const OUTPUT_TOO_LARGE_MARKERS: readonly string[] = [
	"output too large",
	"content exceeds maximum",
	"output budget exceeded",
] as const;

const MALFORMED_PATCH_MARKERS: readonly string[] = [
	"malformed patch",
	"invalid edit format",
	"patch could not be applied",
] as const;

const VALIDATION_FAILED_MARKERS: readonly string[] = [
	"validation failed after edit",
	"typecheck failed after edit",
	"lint errors after edit",
] as const;

// ---------------------------------------------------------------------------
// Detection Results
// ---------------------------------------------------------------------------

/**
 * Result of truncation detection.
 */
export interface TruncationDetectionResult {
	/** Whether truncation was detected */
	detected: boolean;
	/** The specific marker that matched (if detected) */
	matchedMarker: string | undefined;
	/** The detected failure type */
	failureType: EditFailureType | undefined;
}

// ---------------------------------------------------------------------------
// TruncationDetector
// ---------------------------------------------------------------------------

/**
 * Detects truncation and edit failures from tool output text.
 *
 * Scans text for known markers that indicate:
 * - Truncation during a full write
 * - Exact-match edit failure
 * - Output too large
 * - Malformed patch
 * - Validation failed after edit
 *
 * Truncation always forces fallback to patch mode in all edit strategy modes.
 */
export class TruncationDetector {
	/**
	 * Detect whether the given text contains truncation markers.
	 *
	 * @param text - Tool output or model reasoning text to scan
	 * @returns Detection result indicating whether truncation was found
	 */
	detectTruncation(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		const lowerText = text.toLowerCase();

		for (const marker of TRUNCATION_MARKERS) {
			if (lowerText.includes(marker.toLowerCase())) {
				return {
					detected: true,
					matchedMarker: marker,
					failureType: "truncation",
				};
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}

	/**
	 * Detect whether the given text contains exact-match failure markers.
	 *
	 * @param text - Tool output text to scan
	 * @returns Detection result indicating whether exact-match failure was found
	 */
	detectExactMatchFailure(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		const lowerText = text.toLowerCase();

		for (const marker of EXACT_MATCH_FAILURE_MARKERS) {
			if (lowerText.includes(marker.toLowerCase())) {
				return {
					detected: true,
					matchedMarker: marker,
					failureType: "exact_match_failed",
				};
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}

	/**
	 * Detect whether the given text contains output-too-large markers.
	 *
	 * @param text - Tool output text to scan
	 * @returns Detection result indicating whether output-too-large was found
	 */
	detectOutputTooLarge(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		const lowerText = text.toLowerCase();

		for (const marker of OUTPUT_TOO_LARGE_MARKERS) {
			if (lowerText.includes(marker.toLowerCase())) {
				return {
					detected: true,
					matchedMarker: marker,
					failureType: "output_too_large",
				};
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}

	/**
	 * Detect whether the given text contains malformed patch markers.
	 *
	 * @param text - Tool output text to scan
	 * @returns Detection result indicating whether malformed patch was found
	 */
	detectMalformedPatch(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		const lowerText = text.toLowerCase();

		for (const marker of MALFORMED_PATCH_MARKERS) {
			if (lowerText.includes(marker.toLowerCase())) {
				return {
					detected: true,
					matchedMarker: marker,
					failureType: "malformed_patch",
				};
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}

	/**
	 * Detect whether the given text contains validation-failed-after-edit markers.
	 *
	 * @param text - Tool output text to scan
	 * @returns Detection result
	 */
	detectValidationFailed(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		const lowerText = text.toLowerCase();

		for (const marker of VALIDATION_FAILED_MARKERS) {
			if (lowerText.includes(marker.toLowerCase())) {
				return {
					detected: true,
					matchedMarker: marker,
					failureType: "validation_failed_after_edit",
				};
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}

	/**
	 * Detect any failure type from the given text.
	 * Checks all marker categories and returns the first match.
	 *
	 * @param text - Tool output text to scan
	 * @returns Detection result with the first matching failure type
	 */
	detectAny(text: string): TruncationDetectionResult {
		if (!text || text.length === 0) {
			return { detected: false, matchedMarker: undefined, failureType: undefined };
		}

		// Check in priority order: truncation > exact_match > output_too_large > malformed > validation
		const checks: Array<() => TruncationDetectionResult> = [
			() => this.detectTruncation(text),
			() => this.detectExactMatchFailure(text),
			() => this.detectOutputTooLarge(text),
			() => this.detectMalformedPatch(text),
			() => this.detectValidationFailed(text),
		];

		for (const check of checks) {
			const result = check();
			if (result.detected) {
				return result;
			}
		}

		return { detected: false, matchedMarker: undefined, failureType: undefined };
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TruncationDetector instance.
 *
 * @returns TruncationDetector instance
 */
export function createTruncationDetector(): TruncationDetector {
	return new TruncationDetector();
}
