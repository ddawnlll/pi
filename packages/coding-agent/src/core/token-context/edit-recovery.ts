/**
 * P43.3 Edit Recovery - Candidate Finder & Recovery Packet Builder (W003/W004)
 *
 * Finds nearest text candidates when exact oldText match fails,
 * builds compact recovery packets to avoid expensive full-file rereads.
 */

import { createHash } from "node:crypto";
import type {
	CandidateKind,
	EditRecoveryCandidate,
	EditRecoveryConfig,
	EditRecoveryPacket,
} from "./edit-recovery-types.js";
import { DEFAULT_EDIT_RECOVERY_CONFIG } from "./edit-recovery-types.js";

// ============================================================================
// Candidate Finder
// ============================================================================

export interface CandidateSearchInput {
	fileContent: string;
	oldText: string;
	config?: Partial<EditRecoveryConfig>;
	filePath?: string;
	expectedBaseHash?: string;
}

export interface CandidateSearchResult {
	packet: EditRecoveryPacket;
	couldAutoApply: boolean;
	autoApplyCandidate?: EditRecoveryCandidate;
}

/**
 * Build a recovery packet when oldText is not found.
 * Returns a structured packet with nearest candidates.
 */
export function buildEditRecoveryPacket(input: CandidateSearchInput): CandidateSearchResult {
	const config = { ...DEFAULT_EDIT_RECOVERY_CONFIG, ...input.config };
	const fileLines = input.fileContent.split("\n");
	const oldTextLines = input.oldText.split("\n");
	const oldTextLineCount = oldTextLines.length;

	const fileHash = hashContent(input.fileContent);
	const oldTextHash = hashContent(input.oldText);
	const fullRereadTokens = Math.ceil(input.fileContent.length / 4);

	const candidates = findCandidates(fileLines, input.oldText, config);

	let autoApplyCandidate: EditRecoveryCandidate | undefined;
	let autoApplyStatus: EditRecoveryPacket["autoApplyStatus"] = "disabled";
	let couldAutoApply = false;

	if (config.autoApplyWhitespaceOnly && candidates.length === 1) {
		const candidate = candidates[0];
		const snippet = fileLines.slice(candidate.startLine - 1, candidate.endLine).join("\n");
		const isWhitespaceOnly = detectWhitespaceOnlyDiff(input.oldText, snippet);

		if (isWhitespaceOnly && candidate.normalizedSimilarity >= config.minAutoApplySimilarity) {
			couldAutoApply = true;
			autoApplyCandidate = candidate;
			autoApplyStatus = "applied";
		} else if (candidates.length === 1 && !isWhitespaceOnly) {
			autoApplyStatus = "semantic_diff";
		} else {
			autoApplyStatus = "ambiguous";
		}
	} else if (candidates.length > 1) {
		autoApplyStatus = "ambiguous";
	} else if (candidates.length === 0) {
		autoApplyStatus = "no_candidates";
	}

	const suggestedActions = buildSuggestedActions(candidates, fileLines.length, oldTextLineCount);

	const packetTokens = Math.ceil(candidates.reduce((sum, c) => sum + c.preview.length, 0) / 4 + 200);

	const packet: EditRecoveryPacket = {
		recoveryType: "EDIT_MISMATCH_RECOVERY",
		path: input.filePath ?? "unknown",
		reason: "oldText_not_found",
		currentFileHash: fileHash,
		expectedBaseHash: input.expectedBaseHash ?? "unknown",
		oldTextHash,
		oldTextLineCount,
		fullRereadAvoided: true,
		estimatedFullRereadTokens: fullRereadTokens,
		recoveryPacketTokensEstimate: Math.min(packetTokens, config.maxPacketTokensEstimate),
		estimatedTokensSaved: Math.max(0, fullRereadTokens - Math.min(packetTokens, config.maxPacketTokensEstimate)),
		candidates,
		suggestedNextActions: suggestedActions,
		autoApplyStatus,
	};

	return { packet, couldAutoApply, autoApplyCandidate };
}

// ============================================================================
// Candidate Search
// ============================================================================

function findCandidates(fileLines: string[], oldText: string, config: EditRecoveryConfig): EditRecoveryCandidate[] {
	const oldLines = oldText.split("\n");
	const oldLineCount = oldLines.length;
	const raw: Array<{ startLine: number; endLine: number; similarity: number; normalizedSimilarity: number }> = [];

	// Slide windows of oldLineCount through the file
	for (let i = 0; i <= fileLines.length - oldLineCount; i++) {
		const windowLines = fileLines.slice(i, i + oldLineCount);
		const windowText = windowLines.join("\n");

		const similarity = computeSimilarity(oldText, windowText);
		const normOld = normalizeForCompare(oldText);
		const normWindow = normalizeForCompare(windowText);
		const normalizedSimilarity = computeSimilarity(normOld, normWindow);

		const maxSim = Math.max(similarity, normalizedSimilarity);
		if (maxSim >= config.minCandidateSimilarity) {
			raw.push({
				startLine: i + 1,
				endLine: i + oldLineCount,
				similarity,
				normalizedSimilarity,
			});
		}
	}

	// Also search with expanded windows (+/- 5 lines)
	for (let i = 0; i <= fileLines.length - Math.max(oldLineCount - 5, 1); i++) {
		for (const expand of [2, 3, 5]) {
			const windowLines = fileLines.slice(i, i + oldLineCount + expand);
			const windowText = windowLines.join("\n");
			const normOld = normalizeForCompare(oldText);
			const normWindow = normalizeForCompare(windowText);
			const normalizedSimilarity = computeSimilarity(normOld, normWindow);

			if (normalizedSimilarity >= config.minCandidateSimilarity + 0.05) {
				raw.push({
					startLine: i + 1,
					endLine: i + oldLineCount + expand,
					similarity: computeSimilarity(oldText, windowText),
					normalizedSimilarity,
				});
			}
		}
	}

	// Sort by normalizedSimilarity descending
	raw.sort((a, b) => b.normalizedSimilarity - a.normalizedSimilarity);

	// Deduplicate by start line
	const seen = new Set<number>();
	const top: typeof raw = [];
	for (const r of raw) {
		if (!seen.has(r.startLine)) {
			seen.add(r.startLine);
			top.push(r);
			if (top.length >= config.maxCandidates) break;
		}
	}

	return top.map((r, idx) => {
		const startLine = Math.max(1, r.startLine - config.contextLinesBefore);
		const endLine = Math.min(fileLines.length, r.endLine + config.contextLinesAfter);
		const previewLines = fileLines.slice(startLine - 1, endLine);
		// Clip to maxCandidateLines
		const clipped = previewLines.slice(0, config.maxCandidateLines);
		const preview = clipped.map((l, i) => `${String(startLine + i).padStart(4, " ")}| ${l}`).join("\n");

		const kind = classifyCandidate(
			r.similarity,
			r.normalizedSimilarity,
			oldText,
			fileLines.slice(r.startLine - 1, r.endLine).join("\n"),
		);

		return {
			candidateId: idx + 1,
			startLine,
			endLine: startLine + clipped.length - 1,
			similarity: Math.round(r.similarity * 1000) / 10,
			normalizedSimilarity: Math.round(r.normalizedSimilarity * 1000) / 10,
			sameIndentFamily: detectSameIndentFamily(oldText, fileLines.slice(r.startLine - 1, r.endLine).join("\n")),
			snippetHash: hashContent(preview),
			candidateKind: kind,
			preview: preview || "(empty preview)",
		};
	});
}

// ============================================================================
// Similarity & Classification Helpers
// ============================================================================

function computeSimilarity(a: string, b: string): number {
	if (!a && !b) return 1;
	if (!a || !b) return 0;

	const aLines = a.split("\n");
	const bLines = b.split("\n");
	const maxLen = Math.max(aLines.length, bLines.length);
	if (maxLen === 0) return 1;

	let matches = 0;
	for (let i = 0; i < maxLen; i++) {
		const al = i < aLines.length ? aLines[i].trim() : "";
		const bl = i < bLines.length ? bLines[i].trim() : "";
		if (al === bl) matches++;
		else if (al && bl) {
			// Partial line match
			const minLen = Math.min(al.length, bl.length);
			if (minLen > 0) {
				let charMatches = 0;
				for (let j = 0; j < minLen; j++) {
					if (al[j] === bl[j]) charMatches++;
				}
				matches += charMatches / Math.max(al.length, bl.length);
			}
		}
	}
	return matches / maxLen;
}

function normalizeForCompare(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((l) => l.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201C\u201D]/g, "'")
		.replace(/[\u2013\u2014]/g, "-")
		.trim();
}

function detectWhitespaceOnlyDiff(oldText: string, candidate: string): boolean {
	const normOld = normalizeForCompare(oldText);
	const normCand = normalizeForCompare(candidate);

	// After full normalization, they should be identical for whitespace-only
	if (normOld === normCand) return true;

	// Check if the only differences are whitespace characters
	const _oldChars = oldText.replace(/\S/g, "");
	const _candChars = candidate.replace(/\S/g, "");
	if (oldText.replace(/\s+/g, " ") === candidate.replace(/\s+/g, " ")) return true;

	return false;
}

function detectSameIndentFamily(oldText: string, candidate: string): boolean {
	const oldIndent = detectIndent(oldText);
	const candIndent = detectIndent(candidate);
	return oldIndent === candIndent;
}

function detectIndent(text: string): string {
	const lines = text.split("\n");
	for (const line of lines) {
		const m = line.match(/^(\s+)/);
		if (m) return m[1][0] === "\t" ? "tab" : `space${m[1].length}`;
	}
	return "none";
}

function classifyCandidate(
	_similarity: number,
	normalizedSimilarity: number,
	oldText: string,
	candidate: string,
): CandidateKind {
	if (normalizedSimilarity >= 0.99) return "exact_normalized";
	if (normalizedSimilarity >= 0.97 && detectWhitespaceOnlyDiff(oldText, candidate)) return "whitespace_drift";
	if (normalizedSimilarity >= 0.85) return "nearby_text";
	if (normalizedSimilarity >= 0.7) return "partial_match";
	return "low_confidence";
}

// ============================================================================
// Suggested Actions
// ============================================================================

function buildSuggestedActions(
	candidates: EditRecoveryCandidate[],
	totalFileLines: number,
	_oldTextLineCount: number,
): string[] {
	const actions: string[] = [];

	if (candidates.length > 0) {
		const c = candidates[0];
		actions.push(`read exact range ${c.startLine}-${c.endLine + 10}`);
		actions.push("retry edit using candidate 1 if semantically correct");
	}

	if (candidates.length > 1) {
		actions.push("compare candidates before retrying — select only one");
	}

	actions.push("avoid full file reread unless candidates are insufficient");

	if (totalFileLines > 200) {
		const mid = Math.floor(totalFileLines / 2);
		actions.push(`if unsure, scan file in chunks: offset=1 limit=${mid}, offset=${mid + 1} limit=${mid}`);
	}

	return actions;
}

// ============================================================================
// Format Recovery Packet for Agent Output
// ============================================================================

export function formatRecoveryPacket(packet: EditRecoveryPacket): string {
	const lines: string[] = [];
	lines.push("EDIT_MISMATCH_RECOVERY");
	lines.push("");
	lines.push(`Path: ${packet.path}`);
	lines.push(`Reason: ${packet.reason}`);
	lines.push(`FileHash: ${packet.currentFileHash}`);
	lines.push(`OldTextHash: ${packet.oldTextHash}`);
	lines.push(`OldTextLines: ${packet.oldTextLineCount}`);
	lines.push(`FullRereadAvoided: ${packet.fullRereadAvoided}`);
	lines.push(`EstFullRereadTokens: ${packet.estimatedFullRereadTokens}`);
	lines.push(`RecoveryTokens: ${packet.recoveryPacketTokensEstimate}`);
	lines.push(`EstTokensSaved: ${packet.estimatedTokensSaved}`);
	lines.push(`AutoApply: ${packet.autoApplyStatus}`);
	lines.push("");

	if (packet.candidates.length > 0) {
		lines.push("Candidates:");
		for (const c of packet.candidates) {
			lines.push("");
			lines.push(`${c.candidateId}. lines ${c.startLine}-${c.endLine}`);
			lines.push(`   similarity: ${c.similarity}%`);
			lines.push(`   normalizedSimilarity: ${c.normalizedSimilarity}%`);
			lines.push(`   sameIndentFamily: ${c.sameIndentFamily}`);
			lines.push(`   kind: ${c.candidateKind}`);
			lines.push(`   snippetHash: ${c.snippetHash}`);
			lines.push(`   preview:`);
			lines.push(c.preview);
		}
	} else {
		lines.push("No candidates found above similarity threshold.");
		lines.push("Consider reading the file to locate the target text.");
	}

	lines.push("");
	lines.push("Suggested next actions:");
	for (const action of packet.suggestedNextActions) {
		lines.push(`  - ${action}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Hash Helpers
// ============================================================================

function hashContent(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16)}`;
}
