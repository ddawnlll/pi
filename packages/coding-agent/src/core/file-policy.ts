/**
 * Large File Context Policy - P1 Workstream 7.D
 *
 * Provides file classification and chunking policy to prevent
 * large files from being fully injected into context.
 */

import { estimateTokensFromString } from "./token-metering.js";

/**
 * File size classification
 */
export type FileClassification = "small" | "medium" | "large" | "huge";

/**
 * File policy settings
 */
export interface FilePolicySettings {
	/** Max lines for full read of small files */
	smallFileFullReadMaxLines: number;
	/** Max lines for outline mode (medium files) */
	mediumFileOutlineMaxLines: number;
	/** Min lines to require chunking (large files) */
	largeFileChunkOnlyMinLines: number;
	/** Min lines to require manual approval (huge files) */
	hugeFileManualApprovalMinLines: number;
	/** Default chunk size in lines */
	defaultChunkLines: number;
	/** Maximum chunk size in lines */
	maxChunkLines: number;
	/** Overlap between chunks in lines */
	overlapLines: number;
	/** Maximum chunks per packet */
	maxChunksPerPacket: number;
}

/**
 * Default file policy settings from P1 spec
 */
export const DEFAULT_FILE_POLICY: FilePolicySettings = {
	smallFileFullReadMaxLines: 800,
	mediumFileOutlineMaxLines: 2500,
	largeFileChunkOnlyMinLines: 2501,
	hugeFileManualApprovalMinLines: 8000,
	defaultChunkLines: 120,
	maxChunkLines: 300,
	overlapLines: 30,
	maxChunksPerPacket: 6,
};

/**
 * File chunk with line range
 */
export interface FileChunk {
	/** Chunk content */
	content: string;
	/** Start line (1-indexed) */
	startLine: number;
	/** End line (1-indexed, inclusive) */
	endLine: number;
	/** Estimated tokens for this chunk */
	estimatedTokens: number;
}

/**
 * File outline (for medium files)
 */
export interface FileOutline {
	/** File path */
	path: string;
	/** Total lines */
	totalLines: number;
	/** Outline content (function signatures, class definitions, etc.) */
	outline: string;
	/** Estimated tokens for outline */
	estimatedTokens: number;
}

/**
 * Result of file policy check
 */
export interface FilePolicyCheckResult {
	/** File classification */
	classification: FileClassification;
	/** Whether full read is allowed */
	canReadFull: boolean;
	/** Whether chunking is required */
	requiresChunking: boolean;
	/** Whether manual approval is required */
	requiresApproval: boolean;
	/** Recommended action */
	recommendedAction: "full_read" | "outline" | "chunks" | "manual_approval";
	/** Reason for the recommendation */
	reason: string;
}

/**
 * File policy enforcer
 *
 * Classifies files by size and enforces reading policies
 * to prevent large files from being fully injected into context.
 */
export class FilePolicy {
	constructor(private settings: FilePolicySettings = DEFAULT_FILE_POLICY) {}

	/**
	 * Classify a file by line count
	 *
	 * @param lineCount - Number of lines in the file
	 * @returns File classification
	 */
	classifyFile(lineCount: number): FileClassification {
		if (lineCount <= this.settings.smallFileFullReadMaxLines) {
			return "small";
		}
		if (lineCount <= this.settings.mediumFileOutlineMaxLines) {
			return "medium";
		}
		if (lineCount < this.settings.hugeFileManualApprovalMinLines) {
			return "large";
		}
		return "huge";
	}

	/**
	 * Check if a file can be read in full
	 *
	 * @param lineCount - Number of lines in the file
	 * @param availableBudget - Available token budget (optional)
	 * @returns True if full read is allowed
	 */
	canReadFull(lineCount: number, availableBudget?: number): boolean {
		const classification = this.classifyFile(lineCount);

		// Only small files can be read in full by default
		if (classification !== "small") {
			return false;
		}

		// If budget is provided, check if file fits
		if (availableBudget !== undefined) {
			// Estimate ~80 chars per line on average
			const estimatedTokens = Math.ceil((lineCount * 80) / 4);
			return estimatedTokens <= availableBudget;
		}

		return true;
	}

	/**
	 * Check file policy and get recommendation
	 *
	 * @param lineCount - Number of lines in the file
	 * @param availableBudget - Available token budget (optional)
	 * @returns Policy check result
	 */
	checkPolicy(lineCount: number, availableBudget?: number): FilePolicyCheckResult {
		const classification = this.classifyFile(lineCount);

		switch (classification) {
			case "small": {
				const canRead = this.canReadFull(lineCount, availableBudget);
				return {
					classification,
					canReadFull: canRead,
					requiresChunking: false,
					requiresApproval: false,
					recommendedAction: canRead ? "full_read" : "chunks",
					reason: canRead
						? `File is small (${lineCount} lines) and can be read in full`
						: `File is small but exceeds available budget, use chunks`,
				};
			}
			case "medium":
				return {
					classification,
					canReadFull: false,
					requiresChunking: false,
					requiresApproval: false,
					recommendedAction: "outline",
					reason: `File is medium-sized (${lineCount} lines), use outline + targeted chunks`,
				};
			case "large":
				return {
					classification,
					canReadFull: false,
					requiresChunking: true,
					requiresApproval: false,
					recommendedAction: "chunks",
					reason: `File is large (${lineCount} lines), chunking required`,
				};
			case "huge":
				return {
					classification,
					canReadFull: false,
					requiresChunking: true,
					requiresApproval: true,
					recommendedAction: "manual_approval",
					reason: `File is huge (${lineCount} lines), manual approval required`,
				};
		}
	}

	/**
	 * Generate chunks for a file
	 *
	 * @param content - File content
	 * @param chunkSize - Chunk size in lines (uses default if not provided)
	 * @returns Array of file chunks
	 */
	getChunks(content: string, chunkSize?: number): FileChunk[] {
		const lines = content.split("\n");
		const effectiveChunkSize = Math.min(chunkSize || this.settings.defaultChunkLines, this.settings.maxChunkLines);
		const overlap = this.settings.overlapLines;
		const chunks: FileChunk[] = [];

		let startLine = 0;
		while (startLine < lines.length) {
			const endLine = Math.min(startLine + effectiveChunkSize, lines.length);
			const chunkLines = lines.slice(startLine, endLine);
			const chunkContent = chunkLines.join("\n");

			chunks.push({
				content: chunkContent,
				startLine: startLine + 1, // 1-indexed
				endLine: endLine, // 1-indexed, inclusive
				estimatedTokens: estimateTokensFromString(chunkContent),
			});

			// Move to next chunk with overlap
			startLine = endLine - overlap;
			if (startLine >= lines.length) break;
		}

		// Limit to max chunks per packet
		return chunks.slice(0, this.settings.maxChunksPerPacket);
	}

	/**
	 * Generate chunks by line range
	 *
	 * @param content - File content
	 * @param startLine - Start line (1-indexed)
	 * @param endLine - End line (1-indexed, inclusive)
	 * @returns File chunk
	 */
	getChunkByRange(content: string, startLine: number, endLine: number): FileChunk {
		const lines = content.split("\n");
		const chunkLines = lines.slice(startLine - 1, endLine);
		const chunkContent = chunkLines.join("\n");

		return {
			content: chunkContent,
			startLine,
			endLine,
			estimatedTokens: estimateTokensFromString(chunkContent),
		};
	}

	/**
	 * Generate a simple outline for a file
	 *
	 * This is a basic implementation that extracts:
	 * - Function definitions
	 * - Class definitions
	 * - Interface/type definitions
	 * - Import statements
	 *
	 * @param content - File content
	 * @param path - File path
	 * @returns File outline
	 */
	generateOutline(content: string, path: string): FileOutline {
		const lines = content.split("\n");
		const outlineLines: string[] = [];

		// Simple regex patterns for common code structures
		const patterns = [
			/^\s*import\s+/, // imports
			/^\s*export\s+/, // exports
			/^\s*(export\s+)?(class|interface|type|enum)\s+\w+/, // types
			/^\s*(export\s+)?(async\s+)?function\s+\w+/, // functions
			/^\s*(public|private|protected)?\s*\w+\s*\([^)]*\)\s*[:{]/, // methods
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (patterns.some((pattern) => pattern.test(line))) {
				outlineLines.push(`${i + 1}: ${line.trim()}`);
			}
		}

		const outline = outlineLines.join("\n");
		return {
			path,
			totalLines: lines.length,
			outline,
			estimatedTokens: estimateTokensFromString(outline),
		};
	}

	/**
	 * Update policy settings
	 *
	 * @param settings - New settings (partial update)
	 */
	updateSettings(settings: Partial<FilePolicySettings>): void {
		this.settings = { ...this.settings, ...settings };
	}

	/**
	 * Get current policy settings
	 *
	 * @returns Current settings
	 */
	getSettings(): Readonly<FilePolicySettings> {
		return { ...this.settings };
	}
}

/**
 * Create a file policy instance
 *
 * @param settings - Policy settings (uses defaults if not provided)
 * @returns File policy instance
 */
export function createFilePolicy(settings?: Partial<FilePolicySettings>): FilePolicy {
	const fullSettings = settings ? { ...DEFAULT_FILE_POLICY, ...settings } : DEFAULT_FILE_POLICY;
	return new FilePolicy(fullSettings);
}
