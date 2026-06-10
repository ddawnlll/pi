/**
 * P44.5.09 — WorkspaceTruthStatus Web Component
 *
 * Renders the workspace truth status in the dashboard.
 * Displays separate runtime, implementation, validation, and durability
 * status fields. Never shows verifiedComplete from runtime complete alone.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceTruthStatusProps {
	/** Runtime execution status */
	runtimeStatus: string;
	/** Implementation existence status */
	implementationStatus: string;
	/** Validation pass/fail status */
	validationStatus: string;
	/** Durability/commit status */
	durabilityStatus: string;
	/** Whether the workspace is fully verified complete (all 4 dimensions) */
	verifiedComplete: boolean;
	/** Backfill status for legacy workspaces */
	backfillStatus?: string;
	/** Commit hash (if committed) */
	commitHash?: string;
	/** Files verified in the commit */
	verifiedFiles?: string[];
	/** Blockers preventing completion */
	blockers?: string[];
	/** Warnings (non-blocking) */
	warnings?: string[];
	/** Recommended recovery route */
	recoveryState?: string;
	/** Current rollout mode */
	rolloutMode?: string;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render the workspace truth status as an HTML string.
 * This is a plain string-based renderer that can be embedded in any UI framework.
 */
export function renderWorkspaceTruthStatus(props: WorkspaceTruthStatusProps): string {
	const parts: string[] = [];

	// Badge
	const badgeClass = props.verifiedComplete ? "complete" : "incomplete";
	parts.push(`<div class="workspace-truth-status">`);
	parts.push(
		`  <div class="status-badge ${badgeClass}">${props.verifiedComplete ? "Verified Complete" : "Not Verified"}</div>`,
	);

	// Dimensions
	parts.push(`  <div class="status-dimensions">`);
	parts.push(
		`    <div class="status-dimension"><span class="dimension-label">Runtime</span><span class="dimension-value">${escapeHtml(props.runtimeStatus)}</span></div>`,
	);
	parts.push(
		`    <div class="status-dimension"><span class="dimension-label">Implementation</span><span class="dimension-value">${escapeHtml(props.implementationStatus)}</span></div>`,
	);
	parts.push(
		`    <div class="status-dimension"><span class="dimension-label">Validation</span><span class="dimension-value">${escapeHtml(props.validationStatus)}</span></div>`,
	);
	parts.push(
		`    <div class="status-dimension"><span class="dimension-label">Durability</span><span class="dimension-value">${escapeHtml(props.durabilityStatus)}</span></div>`,
	);
	parts.push(`  </div>`);

	// Backfill
	if (props.backfillStatus && props.backfillStatus !== "not_applicable") {
		parts.push(`  <div class="backfill-status">Backfill: ${escapeHtml(props.backfillStatus)}</div>`);
	}

	// Commit
	if (props.commitHash) {
		parts.push(`  <div class="commit-info">Commit: ${escapeHtml(props.commitHash.slice(0, 7))}</div>`);
	}

	// Files
	if (props.verifiedFiles && props.verifiedFiles.length > 0) {
		parts.push(`  <div class="verified-files">Files (${props.verifiedFiles.length}):`);
		parts.push(`    <ul>`);
		for (const file of props.verifiedFiles) {
			parts.push(`      <li>${escapeHtml(file)}</li>`);
		}
		parts.push(`    </ul>`);
		parts.push(`  </div>`);
	}

	// Blockers
	if (props.blockers && props.blockers.length > 0) {
		parts.push(`  <div class="blockers"><span class="blocker-title">Blockers:</span>`);
		parts.push(`    <ul>`);
		for (const blocker of props.blockers) {
			parts.push(`      <li class="blocker-item">${escapeHtml(blocker)}</li>`);
		}
		parts.push(`    </ul>`);
		parts.push(`  </div>`);
	}

	// Warnings
	if (props.warnings && props.warnings.length > 0) {
		parts.push(`  <div class="warnings"><span class="warning-title">Warnings:</span>`);
		parts.push(`    <ul>`);
		for (const warning of props.warnings) {
			parts.push(`      <li class="warning-item">${escapeHtml(warning)}</li>`);
		}
		parts.push(`    </ul>`);
		parts.push(`  </div>`);
	}

	// Recovery
	if (props.recoveryState) {
		parts.push(`  <div class="recovery-state">Recovery: ${escapeHtml(props.recoveryState)}</div>`);
	}

	// Rollout
	if (props.rolloutMode) {
		parts.push(`  <div class="rollout-mode">Mode: ${escapeHtml(props.rolloutMode)}</div>`);
	}

	parts.push(`</div>`);
	return parts.join("\n");
}

/**
 * Simple HTML escape to prevent XSS.
 */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * WorkspaceTruthStatus static renderer.
 * Use renderWorkspaceTruthStatus() to get an HTML string.
 */
export const WorkspaceTruthStatus = {
	render: renderWorkspaceTruthStatus,
};

export default WorkspaceTruthStatus;
