/**
 * Watch-Mode Command Guard - P4.6.1
 *
 * Prevents watch-mode validation commands from being used during
 * plan/workspace execution. Watch-mode commands never exit on their
 * own, which would make validation hang or report false success.
 *
 * Provides:
 * - isWatchModeCommand(command) — detection
 * - rewriteToNonWatch(command) — rewrite to non-watch equivalent
 * - validateCommand(command) — full validation result
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of validating a command for watch-mode usage.
 */
export interface CommandValidationResult {
	/** Whether the command is allowed */
	valid: boolean;
	/** Whether the command is a watch-mode (forbidden) command */
	isWatchMode: boolean;
	/** If forbidden, the reason */
	reason: string | null;
	/** Suggested non-watch alternative, if applicable */
	suggestedAlternative: string | null;
}

// ---------------------------------------------------------------------------
// Forbidden watch-mode patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that identify watch-mode commands.
 * Each entry has: [regex to detect, replacement template, reason description]
 */
const WATCH_MODE_PATTERNS: readonly {
	/** Regex that matches the forbidden command */
	pattern: RegExp;
	/** Non-watch replacement */
	replacement: string;
	/** Why this is forbidden */
	reason: string;
}[] = [
	{
		pattern: /^vitest(?: +(?:--)?watch(?:All)?(?: +.*)?)$/,
		replacement: "vitest run",
		reason: "vitest --watch never exits; validation would hang",
	},
	{
		pattern: /^vitest(?: +--ui(?: +.*)?)$/,
		replacement: "vitest run",
		reason: "vitest --ui is interactive and never exits; use vitest run",
	},
	{
		pattern: /^npm test(?: +--(?: +--)?watch(?:All)?)$/,
		replacement: "npm test -- --run",
		reason: "npm test -- --watch is watch mode; use --run",
	},
	{
		pattern: /^npm run test(?: +--(?: +--)?watch(?:All)?)$/,
		replacement: "npm run test -- --run",
		reason: "npm run test -- --watch is watch mode; use --run",
	},
	{
		pattern: /^pnpm test(?: +--(?: +--)?watch(?:All)?)$/,
		replacement: "pnpm test -- --run",
		reason: "pnpm test -- --watch is watch mode; use --run",
	},
	{
		pattern: /^jest(?: +(?:--)?watch(?:All)?(?: +.*)?)$/,
		replacement: "jest --ci",
		reason: "jest --watch never exits; use --ci",
	},
	{
		pattern: /^npm run dev(?: +.*)?$/,
		replacement: "npm run build",
		reason: "npm run dev starts a dev server that never exits; use npm run build for validation",
	},
	{
		pattern: /^vite(?: +(?:dev|--host)(?: +.*)?)$/,
		replacement: "vite build",
		reason: "vite dev/--host starts a dev server that never exits; use vite build for validation",
	},
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Check if a command is a watch-mode (forbidden) command.
 *
 * @param command - The shell command to check
 * @returns True if the command is forbidden for validation
 */
export function isWatchModeCommand(command: string): boolean {
	const trimmed = command.trimStart();
	return WATCH_MODE_PATTERNS.some((p) => p.pattern.test(trimmed));
}

/**
 * Check whether a command is a validation command (for lock context).
 * This is a broad check; watch-mode detection is a stricter subset.
 *
 * Prefer isWatchModeCommand for rejection logic.
 */
export function isValidationLikeCommand(command: string): boolean {
	const trimmed = command.trimStart();
	return (
		isWatchModeCommand(trimmed) ||
		trimmed.startsWith("vitest") ||
		trimmed.startsWith("npm test") ||
		trimmed.startsWith("npm run test") ||
		trimmed.startsWith("npm run typecheck") ||
		trimmed.startsWith("pnpm test") ||
		trimmed.startsWith("tsc") ||
		trimmed.startsWith("npx tsgo") ||
		trimmed.startsWith("npm run build") ||
		trimmed.startsWith("vite build") ||
		trimmed.startsWith("jest")
	);
}

/**
 * Attempt to rewrite a watch-mode command to its non-watch equivalent.
 *
 * @param command - The shell command to rewrite
 * @returns Rewritten command, or null if no rewrite is known
 */
export function rewriteToNonWatch(command: string): string | null {
	const trimmed = command.trimStart();
	for (const p of WATCH_MODE_PATTERNS) {
		if (p.pattern.test(trimmed)) {
			return p.replacement;
		}
	}
	return null;
}

/**
 * Fully validate a command for workspace validation use.
 *
 * Returns a result object with:
 * - valid: whether the command is allowed
 * - isWatchMode: whether it was detected as watch-mode
 * - reason: why the command is forbidden (if applicable)
 * - suggestedAlternative: non-watch equivalent (if applicable)
 *
 * @param command - The shell command to validate
 * @returns Validation result
 */
export function validateCommand(command: string): CommandValidationResult {
	const trimmed = command.trimStart();

	for (const p of WATCH_MODE_PATTERNS) {
		if (p.pattern.test(trimmed)) {
			return {
				valid: false,
				isWatchMode: true,
				reason: p.reason,
				suggestedAlternative: p.replacement,
			};
		}
	}

	return {
		valid: true,
		isWatchMode: false,
		reason: null,
		suggestedAlternative: null,
	};
}
