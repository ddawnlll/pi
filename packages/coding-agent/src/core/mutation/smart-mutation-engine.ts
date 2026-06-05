/**
 * Smart Mutation Engine — P43.8C
 *
 * Central mutation engine that wraps edit/create/write behavior with safety gates:
 *   - WriteSet / path validation
 *   - Large-file overwrite prevention
 *   - New file create safety
 *   - Edit recovery (exact, normalized, candidate-based)
 *   - Atomic write
 *   - Backup / rollback
 *   - Parser validation
 *   - Structured mutation reports
 */

import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import {
	atomicWriteFile,
	computeFileHash,
	computeFileHashFromPath,
	createBackup,
	fileExists,
	getFileByteCount,
	getFileLineCount,
	restoreBackup,
} from "./atomic-file-writer.js";
import {
	DEFAULT_MUTATION_ENGINE_CONFIG,
	type EditRecoveryResult,
	isSourceLikeFile,
	type MutationMode,
	type MutationRequest,
	type MutationResult,
	type MutationSafetyLevel,
	type ParserValidationResult,
	type SmartMutationEngineConfig,
	type WriteSetCheckResult,
} from "./mutation-types.js";
import { validateFileContent } from "./parser-validation.js";
import { checkWriteSet, normalizeRepoPath } from "./write-set-guard.js";

// =========================================================================
// Smart Mutation Engine
// =========================================================================

export class SmartMutationEngine {
	private readonly config: SmartMutationEngineConfig;

	constructor(config?: Partial<SmartMutationEngineConfig>) {
		this.config = { ...DEFAULT_MUTATION_ENGINE_CONFIG, ...config };
	}

	/**
	 * Execute a mutation with full safety checks.
	 */
	async mutate(request: MutationRequest): Promise<MutationResult> {
		// Normalize
		const absPath = path.resolve(request.repoRoot, request.path);
		const repoRelativePath = normalizeRepoPath(absPath, request.repoRoot);
		if (!repoRelativePath) {
			return this.blocked(request, "blocked", "path_outside_repo", "Path is outside the repository root");
		}

		// WriteSet check
		const writeSetCheck = checkWriteSet(
			absPath,
			request.repoRoot,
			request.allowedWriteSet,
			request.allowlistedArtifactGlobs,
		);

		// Check file existence
		const exists = await fileExists(absPath);

		// Route to mode-specific handler
		switch (request.mode) {
			case "create":
				return this.handleCreate(request, absPath, repoRelativePath, exists, writeSetCheck);
			case "edit":
				return this.handleEdit(request, absPath, repoRelativePath, exists, writeSetCheck);
			case "overwrite":
				return this.handleOverwrite(request, absPath, repoRelativePath, exists, writeSetCheck);
			default:
				return this.blocked(request, "blocked", "unsupported_mode", `Unsupported mutation mode: ${request.mode}`);
		}
	}

	// ===================================================================
	// Create
	// ===================================================================

	private async handleCreate(
		request: MutationRequest,
		absPath: string,
		_repoRelativePath: string,
		exists: boolean,
		writeSetCheck: WriteSetCheckResult,
	): Promise<MutationResult> {
		// File must not already exist
		if (exists) {
			return this.blocked(
				request,
				"blocked",
				"file_already_exists",
				"Cannot create: file already exists. Use edit or overwrite mode.",
			);
		}

		// Path guard
		if (!writeSetCheck.ok) {
			return this.blocked(
				request,
				"blocked",
				writeSetCheck.reason ?? "path_not_allowed",
				"Path not allowed by writeSet or artifact policy",
			);
		}

		const content = request.content ?? "";
		const validationPolicy = request.validationPolicy ?? {
			parserValidation: "best_effort" as const,
			rollbackOnParserFailure: this.config.defaultRollbackOnParserFailure,
		};

		// Content guard: block placeholder-only source files
		if (isSourceLikeFile(absPath) && this.isPlaceholderContent(content)) {
			const manifest = request.manifest;
			if (
				!manifest ||
				(manifest.expectedFileKind !== "doc" &&
					manifest.expectedFileKind !== "report" &&
					manifest.expectedFileKind !== "config" &&
					manifest.expectedFileKind !== "generated")
			) {
				return this.blocked(
					request,
					"blocked",
					"placeholder_content",
					"Source file content appears to be a placeholder. Provide a real implementation or set manifest.expectedFileKind appropriately.",
				);
			}
		}

		// Parser validation
		const parserResult = validateFileContent(
			absPath,
			content,
			validationPolicy.parserValidation,
			validationPolicy.allowParserUnavailable,
		);

		if (!parserResult.ok && validationPolicy.rollbackOnParserFailure) {
			return {
				...this.blocked(request, "blocked", "parser_validation_failed", this.formatParserErrors(parserResult)),
				parserValidation: parserResult,
			};
		}

		// Atomic write
		const writeResult = await atomicWriteFile(absPath, content);
		if (!writeResult.success) {
			return this.blocked(request, "dangerous", "write_failed", writeResult.error ?? "Write failed");
		}

		return {
			ok: true,
			path: absPath,
			mode: "create",
			safetyLevel: "safe",
			createdFile: true,
			postHash: writeResult.postHash ?? undefined,
			parserValidation: parserResult,
			writeSetCheck,
		};
	}

	// ===================================================================
	// Edit
	// ===================================================================

	private async handleEdit(
		request: MutationRequest,
		absPath: string,
		_repoRelativePath: string,
		exists: boolean,
		writeSetCheck: WriteSetCheckResult,
	): Promise<MutationResult> {
		if (!exists) {
			return this.blocked(request, "blocked", "file_not_found", "Cannot edit: file does not exist");
		}

		if (!writeSetCheck.ok) {
			return this.blocked(
				request,
				"blocked",
				writeSetCheck.reason ?? "path_not_allowed",
				"Path not allowed by writeSet or artifact policy",
			);
		}

		if (!request.oldText || request.newText === undefined) {
			return this.blocked(request, "blocked", "missing_edit_text", "Edit requires oldText and newText");
		}

		// Read existing content
		const rawContent = await fsPromises.readFile(absPath, "utf-8");
		const preHash = computeFileHash(rawContent);

		// Try exact match
		const firstIndex = rawContent.indexOf(request.oldText);
		if (firstIndex !== -1) {
			// Check if unique
			const secondIndex = rawContent.indexOf(request.oldText, firstIndex + 1);
			if (secondIndex !== -1) {
				return this.blocked(
					request,
					"blocked",
					"ambiguous_oldText",
					`oldText appears multiple times (${this.countOccurrences(rawContent, request.oldText)} times). Provide unique context.`,
				);
			}

			// Single exact match — apply edit
			const newContent =
				rawContent.slice(0, firstIndex) + request.newText + rawContent.slice(firstIndex + request.oldText.length);
			const editResult = await this.applyWithRollback(absPath, preHash, newContent, request.validationPolicy);
			return {
				...editResult,
				path: absPath,
				safetyLevel: editResult.ok ? ("safe" as const) : ("blocked" as const),
				mode: "edit",
				editRecovery: { attempted: true, strategy: "exact" },
			};
		}

		// Exact not found — try recovery strategies
		return this.editWithRecovery(request, absPath, rawContent, preHash);
	}

	private async editWithRecovery(
		request: MutationRequest,
		absPath: string,
		rawContent: string,
		preHash: string,
	): Promise<MutationResult> {
		const oldText = request.oldText ?? "";
		const newText = request.newText ?? "";
		let recoveryStrategy: EditRecoveryResult["strategy"] = "failed";
		let candidateSimilarity = 0;

		// 1. Normalized whitespace match
		const normalizedContent = rawContent.replace(/\r\n/g, "\n").replace(/\t/g, "  ").trimEnd();
		const normalizedOld = oldText.replace(/\r\n/g, "\n").replace(/\t/g, "  ").trimEnd();

		const normIndex = normalizedContent.indexOf(normalizedOld);
		if (normIndex !== -1) {
			const secondNormIndex = normalizedContent.indexOf(normalizedOld, normIndex + 1);
			if (secondNormIndex === -1) {
				// Unique normalized match — find the original equivalent
				const originalSubstring = rawContent.substring(normIndex, normIndex + normalizedOld.length);
				if (originalSubstring) {
					const newContent =
						rawContent.slice(0, normIndex) + newText + rawContent.slice(normIndex + originalSubstring.length);
					const editResult = await this.applyWithRollback(absPath, preHash, newContent, request.validationPolicy);
					return {
						...editResult,
						path: absPath,
						safetyLevel: editResult.ok ? ("safe" as const) : ("blocked" as const),
						mode: "edit",
						editRecovery: { attempted: true, strategy: "normalized_whitespace", candidateSimilarity: 0.98 },
					};
				}
			}
		}

		// 2. Find best matching line range (candidate-based)
		const oldLines = oldText.split("\n").filter((l) => l.trim().length > 0);
		const contentLines = rawContent.split("\n");
		let bestMatchStart = -1;
		let bestMatchScore = 0;

		if (oldLines.length > 0) {
			const firstKeyLine = oldLines[0] ?? "";
			const _lastKeyLine = oldLines[oldLines.length - 1] ?? "";

			for (let i = 0; i < contentLines.length; i++) {
				const line = contentLines[i] ?? "";
				if (line.includes(firstKeyLine.trim().substring(0, Math.min(40, firstKeyLine.length)))) {
					// Check how many old lines match sequentially
					let matchCount = 0;
					for (let j = 0; j < Math.min(oldLines.length, contentLines.length - i); j++) {
						const oldLine = oldLines[j] ?? "";
						const contentLine = contentLines[i + j] ?? "";
						if (contentLine.trim() === oldLine.trim()) {
							matchCount++;
						} else if (contentLine.includes(oldLine.trim().substring(0, Math.min(30, oldLine.length)))) {
							matchCount += 0.5;
						} else {
							break;
						}
					}

					const score = matchCount / oldLines.length;
					if (score > bestMatchScore) {
						bestMatchScore = score;
						bestMatchStart = i;
					}
				}
			}
		}

		if (bestMatchScore >= this.config.minCandidateSimilarity && bestMatchStart >= 0) {
			const endLine = Math.min(bestMatchStart + oldLines.length, contentLines.length);
			candidateSimilarity = bestMatchScore;
			recoveryStrategy = "candidate_range";

			// Replace candidate range with new text
			const before = contentLines.slice(0, bestMatchStart).join("\n");
			const after = contentLines.slice(endLine).join("\n");
			const newContent = before + (before.length > 0 ? "\n" : "") + newText + (after.length > 0 ? "\n" : "") + after;

			const editResult = await this.applyWithRollback(absPath, preHash, newContent, request.validationPolicy);
			return {
				...editResult,
				path: absPath,
				safetyLevel: editResult.ok ? ("safe" as const) : ("blocked" as const),
				mode: "edit",
				editRecovery: {
					attempted: true,
					strategy: recoveryStrategy,
					candidateSimilarity,
					range: { startLine: bestMatchStart + 1, endLine: endLine },
				},
			};
		}

		// No recovery possible
		return {
			ok: false,
			path: absPath,
			mode: "edit",
			safetyLevel: "blocked",
			blocked: true,
			blockReason: `oldText_not_found. No high-confidence recovery candidate found (best match: ${(bestMatchScore * 100).toFixed(1)}%)`,
			preHash,
			editRecovery: {
				attempted: true,
				strategy: "failed",
				candidateSimilarity: bestMatchScore,
				reason: `No recovery candidate above threshold ${(this.config.minCandidateSimilarity * 100).toFixed(0)}%`,
			},
		};
	}

	// ===================================================================
	// Overwrite / Write
	// ===================================================================

	private async handleOverwrite(
		request: MutationRequest,
		absPath: string,
		_repoRelativePath: string,
		exists: boolean,
		writeSetCheck: WriteSetCheckResult,
	): Promise<MutationResult> {
		if (!writeSetCheck.ok) {
			return this.blocked(
				request,
				"blocked",
				writeSetCheck.reason ?? "path_not_allowed",
				"Path not allowed by writeSet or artifact policy",
			);
		}

		const mode: MutationMode = exists ? "overwrite" : "create";
		const content = request.content ?? "";
		const preHash = await computeFileHashFromPath(absPath);
		const lineCount = await getFileLineCount(absPath);
		const _byteCount = await getFileByteCount(absPath);

		// Large file overwrite prevention
		const isSource = isSourceLikeFile(absPath);
		if (exists && isSource && mode === "overwrite") {
			// Check size thresholds
			if (lineCount > this.config.hugeFileLineThreshold) {
				if (!request.allowLargeOverwrite || !request.destructiveOverwriteJustification) {
					return this.blocked(
						request,
						"blocked",
						"large_existing_file_overwrite_blocked",
						`File has ${lineCount} lines (threshold: ${this.config.hugeFileLineThreshold}). ` +
							"Full overwrite blocked for large source files. Use edit for targeted changes, or " +
							"set allowLargeOverwrite=true with destructiveOverwriteJustification.",
					);
				}
			} else if (lineCount > this.config.veryLargeFileLineThreshold) {
				if (!request.allowLargeOverwrite) {
					return this.blocked(
						request,
						"dangerous",
						"large_existing_file_overwrite_blocked",
						`File has ${lineCount} lines (threshold: ${this.config.veryLargeFileLineThreshold}). ` +
							"Full overwrite requires allowLargeOverwrite=true and expectedHash.",
					);
				}
			} else if (lineCount > this.config.largeFileLineThreshold) {
				if (!request.allowLargeOverwrite) {
					// Block with suggestion to use edit
					return this.blocked(
						request,
						"guarded",
						"existing_file_requires_edit_not_write",
						`File has ${lineCount} lines. Use edit for targeted changes instead of full overwrite. ` +
							"Set allowLargeOverwrite=true to override.",
					);
				}
			}

			// Line delta check
			const newLineCount = content.split("\n").length;
			if (lineCount > 0) {
				const lineDropRatio = (lineCount - newLineCount) / lineCount;
				if (lineDropRatio > this.config.maxOverwriteLineDropRatio) {
					return this.blocked(
						request,
						"dangerous",
						"line_delta_too_large",
						`Overwrite would reduce file from ${lineCount} to ${newLineCount} lines (drop ratio: ${(lineDropRatio * 100).toFixed(0)}%). ` +
							`Maximum allowed drop ratio: ${(this.config.maxOverwriteLineDropRatio * 100).toFixed(0)}%.`,
					);
				}
			}
		}

		// Create backup if overwriting existing file
		let backup: { backupPath: string; preHash: string } | null = null;
		if (exists) {
			backup = await createBackup(absPath);
		}

		// Parser validation
		const validationPolicy = request.validationPolicy ?? {
			parserValidation: "best_effort" as const,
			rollbackOnParserFailure: this.config.defaultRollbackOnParserFailure,
		};

		const parserResult = validateFileContent(
			absPath,
			content,
			validationPolicy.parserValidation,
			validationPolicy.allowParserUnavailable,
		);

		// Atomic write
		const writeResult = await atomicWriteFile(absPath, content);
		if (!writeResult.success) {
			return {
				...this.blocked(request, "dangerous", "write_failed", writeResult.error ?? "Write failed"),
				preHash: preHash ?? undefined,
			};
		}

		// Rollback if parser validation failed
		if (!parserResult.ok && validationPolicy.rollbackOnParserFailure && backup) {
			await restoreBackup(backup.backupPath, absPath);
			return {
				ok: false,
				path: absPath,
				mode: mode,
				safetyLevel: "blocked",
				blocked: true,
				blockReason: this.formatParserErrors(parserResult),
				preHash: preHash ?? undefined,
				postHash: writeResult.postHash ?? undefined,
				backupPath: backup.backupPath,
				rolledBack: true,
				rollbackReason: "Parser validation failed after overwrite",
				parserValidation: parserResult,
				writeSetCheck,
			};
		}

		return {
			ok: true,
			path: absPath,
			mode,
			safetyLevel: "safe",
			preHash: preHash ?? undefined,
			postHash: writeResult.postHash ?? undefined,
			modifiedFile: exists,
			createdFile: !exists,
			backupPath: backup?.backupPath,
			parserValidation: parserResult,
			writeSetCheck,
		};
	}

	// ===================================================================
	// Helpers
	// ===================================================================

	/**
	 * Apply content with rollback on parser failure.
	 */
	private async applyWithRollback(
		filePath: string,
		preHash: string,
		newContent: string,
		validationPolicy?: MutationRequest["validationPolicy"],
	): Promise<{
		ok: boolean;
		preHash?: string;
		postHash?: string;
		parserValidation?: ParserValidationResult;
		backupPath?: string;
		rolledBack?: boolean;
		rollbackReason?: string;
	}> {
		const backup = await createBackup(filePath);
		const writeResult = await atomicWriteFile(filePath, newContent);

		if (!writeResult.success) {
			return {
				ok: false,
				preHash,
				postHash: undefined,
			};
		}

		const policy = validationPolicy ?? {
			parserValidation: "best_effort" as const,
			rollbackOnParserFailure: true,
		};

		const parserResult = validateFileContent(
			filePath,
			newContent,
			policy.parserValidation,
			policy.allowParserUnavailable,
		);

		if (!parserResult.ok && policy.rollbackOnParserFailure && backup) {
			await restoreBackup(backup.backupPath, filePath);
			return {
				ok: false,
				preHash,
				postHash: writeResult.postHash ?? undefined,
				parserValidation: parserResult,
				backupPath: backup.backupPath,
				rolledBack: true,
				rollbackReason: "Parser validation failed after edit",
			};
		}

		return {
			ok: true,
			preHash,
			postHash: writeResult.postHash ?? undefined,
			parserValidation: parserResult,
			backupPath: backup?.backupPath,
		};
	}

	private blocked(
		request: MutationRequest,
		safetyLevel: MutationSafetyLevel,
		blockReason: string,
		message: string,
	): MutationResult {
		return {
			ok: false,
			path: path.resolve(request.repoRoot, request.path),
			mode: request.mode,
			safetyLevel,
			blocked: true,
			blockReason: `${blockReason}: ${message}`,
		};
	}

	private isPlaceholderContent(content: string): boolean {
		const trimmed = content.trim();
		if (trimmed.length === 0) return true;
		const placeholders = [
			'throw new Error("not implemented");',
			"throw new Error('not implemented');",
			"TODO",
			"FIXME",
			"return null;",
			"placeholder",
			"stub",
		];
		// Check if the file is mostly placeholder
		const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
		if (lines.length <= 3) {
			return placeholders.some((p) => trimmed.includes(p));
		}
		return false;
	}

	private countOccurrences(content: string, sub: string): number {
		let count = 0;
		let pos = -1;
		for (;;) {
			pos = content.indexOf(sub, pos + 1);
			if (pos === -1) break;
			count++;
		}
		return count;
	}

	private formatParserErrors(result: ParserValidationResult): string {
		const errors = result.diagnostics.filter((d) => d.severity === "error");
		if (errors.length === 0) return "Parser validation failed";
		return `Parser validation failed: ${errors.map((e) => e.message).join("; ")}`;
	}
}
