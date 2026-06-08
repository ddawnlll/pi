/**
 * Worker Report Echo Extraction — ACCP 1.2 / PlanSpec v5
 *
 * Extracts structured completion claims from worker output.
 * Supports multiple formats:
 * - Structured WorkerCompletionReport JSON
 * - ACCP report metadata blocks
 * - Explicit completion blocks in worker output
 *
 * The extracted claim must include:
 * - workspaceId
 * - planLockHash
 * - workspaceLockHash
 * - verdict/claim
 * - evidence references if present
 */

export interface WorkerEchoClaim {
	/** Workspace ID */
	workspaceId: string;
	/** Plan lock hash */
	planLockHash: string;
	/** Workspace lock hash */
	workspaceLockHash: string;
	/** Verdict or claim */
	verdict: "complete" | "failed" | "blocked";
	/** Optional evidence references */
	evidenceRefs?: string[];
	/** Optional validation command refs */
	validationCommandRefs?: string[];
	/** Optional report paths */
	reportPaths?: string[];
}

/**
 * Result of extracting echo from worker output.
 */
export interface WorkerEchoExtractionResult {
	/** Whether extraction was successful */
	success: boolean;
	/** Extracted claim (if successful) */
	claim?: WorkerEchoClaim;
	/** Error message (if failed) */
	error?: string;
	/** Raw text that was attempted to parse */
	rawText?: string;
}

// ---------------------------------------------------------------------------
// Extraction Functions
// ---------------------------------------------------------------------------

/**
 * Try to parse structured JSON from worker output.
 * Looks for JSON blocks containing lock hashes.
 */
function tryParseStructuredJson(output: string): WorkerEchoClaim | null {
	// Try to find JSON objects in the output
	const jsonRegex = /\{[^{}]*"planLockHash"[^{}]*\}/g;
	let match: RegExpExecArray | null;

	match = jsonRegex.exec(output);
	while (match !== null) {
		try {
			const parsed = JSON.parse(match[0]);
			if (parsed.planLockHash && parsed.workspaceLockHash && parsed.workspaceId) {
				return {
					workspaceId: parsed.workspaceId,
					planLockHash: parsed.planLockHash,
					workspaceLockHash: parsed.workspaceLockHash,
					verdict: parsed.verdict || "complete",
					evidenceRefs: Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs : undefined,
					validationCommandRefs: Array.isArray(parsed.validationCommandRefs)
						? parsed.validationCommandRefs
						: undefined,
					reportPaths: Array.isArray(parsed.reportPaths) ? parsed.reportPaths : undefined,
				};
			}
		} catch {
			// Invalid JSON, try next match
		}
		match = jsonRegex.exec(output);
	}

	return null;
}

/**
 * Try to parse ACCP report metadata block.
 * Looks for patterns like:
 * ```
 * ## Completion Claim
 * - workspaceId: WS-01
 * - planLockHash: abc123...
 * - workspaceLockHash: def456...
 * - verdict: complete
 * ```
 */
function tryParseAccpMetadataBlock(output: string): WorkerEchoClaim | null {
	const lines = output.split("\n");
	let workspaceId: string | undefined;
	let planLockHash: string | undefined;
	let workspaceLockHash: string | undefined;
	let verdict: string | undefined;

	for (const line of lines) {
		const trimmed = line.trim();

		// Match key-value patterns
		if (trimmed.startsWith("- workspaceId:") || trimmed.startsWith("workspaceId:")) {
			workspaceId = trimmed.split(":")[1]?.trim();
		} else if (trimmed.startsWith("- planLockHash:") || trimmed.startsWith("planLockHash:")) {
			planLockHash = trimmed.split(":")[1]?.trim();
		} else if (trimmed.startsWith("- workspaceLockHash:") || trimmed.startsWith("workspaceLockHash:")) {
			workspaceLockHash = trimmed.split(":")[1]?.trim();
		} else if (trimmed.startsWith("- verdict:") || trimmed.startsWith("verdict:")) {
			verdict = trimmed.split(":")[1]?.trim();
		}
	}

	if (workspaceId && planLockHash && workspaceLockHash) {
		return {
			workspaceId,
			planLockHash,
			workspaceLockHash,
			verdict: (verdict as any) || "complete",
		};
	}

	return null;
}

/**
 * Try to parse explicit completion block.
 * Looks for patterns like:
 * ```
 * [COMPLETION]
 * workspaceId=WS-01
 * planLockHash=abc123...
 * workspaceLockHash=def456...
 * [/COMPLETION]
 * ```
 */
function tryParseExplicitCompletionBlock(output: string): WorkerEchoClaim | null {
	const completionRegex = /\[COMPLETION\]([\s\S]*?)\[\/COMPLETION\]/;
	const match = output.match(completionRegex);

	if (!match) {
		return null;
	}

	const block = match[1];
	const lines = block.split("\n");
	let workspaceId: string | undefined;
	let planLockHash: string | undefined;
	let workspaceLockHash: string | undefined;
	let verdict: string | undefined;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("workspaceId=")) {
			workspaceId = trimmed.split("=")[1]?.trim();
		} else if (trimmed.startsWith("planLockHash=")) {
			planLockHash = trimmed.split("=")[1]?.trim();
		} else if (trimmed.startsWith("workspaceLockHash=")) {
			workspaceLockHash = trimmed.split("=")[1]?.trim();
		} else if (trimmed.startsWith("verdict=")) {
			verdict = trimmed.split("=")[1]?.trim();
		}
	}

	if (workspaceId && planLockHash && workspaceLockHash) {
		return {
			workspaceId,
			planLockHash,
			workspaceLockHash,
			verdict: (verdict as any) || "complete",
		};
	}

	return null;
}

/**
 * Extract worker echo claim from raw worker output.
 *
 * Tries multiple parsing strategies in order:
 * 1. Structured JSON
 * 2. ACCP metadata block
 * 3. Explicit completion block
 *
 * @param output - Raw worker output text
 * @returns Extraction result
 */
export function extractWorkerEcho(output: string): WorkerEchoExtractionResult {
	if (!output || output.trim().length === 0) {
		return {
			success: false,
			error: "Empty worker output",
			rawText: output,
		};
	}

	// Strategy 1: Structured JSON
	let claim = tryParseStructuredJson(output);
	if (claim) {
		return { success: true, claim, rawText: output };
	}

	// Strategy 2: ACCP metadata block
	claim = tryParseAccpMetadataBlock(output);
	if (claim) {
		return { success: true, claim, rawText: output };
	}

	// Strategy 3: Explicit completion block
	claim = tryParseExplicitCompletionBlock(output);
	if (claim) {
		return { success: true, claim, rawText: output };
	}

	return {
		success: false,
		error: "Could not extract lock hashes from worker output",
		rawText: output,
	};
}

/**
 * Verify that extracted echo matches expected values.
 *
 * @param claim - Extracted claim
 * @param expectedPlanLockHash - Expected plan lock hash
 * @param expectedWorkspaceLockHash - Expected workspace lock hash
 * @param expectedWorkspaceId - Expected workspace ID
 * @returns Verification result
 */
export function verifyWorkerEcho(
	claim: WorkerEchoClaim,
	expectedPlanLockHash: string,
	expectedWorkspaceLockHash: string,
	expectedWorkspaceId: string,
): { valid: boolean; error?: string } {
	if (claim.planLockHash !== expectedPlanLockHash) {
		return {
			valid: false,
			error: `Plan lock hash mismatch: expected ${expectedPlanLockHash}, got ${claim.planLockHash}`,
		};
	}

	if (claim.workspaceLockHash !== expectedWorkspaceLockHash) {
		return {
			valid: false,
			error: `Workspace lock hash mismatch: expected ${expectedWorkspaceLockHash}, got ${claim.workspaceLockHash}`,
		};
	}

	if (claim.workspaceId !== expectedWorkspaceId) {
		return {
			valid: false,
			error: `Workspace ID mismatch: expected ${expectedWorkspaceId}, got ${claim.workspaceId}`,
		};
	}

	return { valid: true };
}
