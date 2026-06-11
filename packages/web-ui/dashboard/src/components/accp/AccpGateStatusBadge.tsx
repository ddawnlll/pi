import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";

interface AccpGateStatusBadgeProps {
	verdict?: AccpGateVerdict;
	modeRequired: boolean;
}

/**
 * ACCP Gate Status Badge — read-only display.
 * Shows gate pass/block status without providing UI affordances
 * that trigger mutation or route advancement.
 */
export function AccpGateStatusBadge({ verdict, modeRequired }: AccpGateStatusBadgeProps) {
	if (!verdict) {
		return <span className="accp-gate-badge accp-gate-unknown">ACCP: Unknown</span>;
	}

	if (!modeRequired) {
		return <span className="accp-gate-badge accp-gate-advisory">ACCP: Advisory</span>;
	}

	if (!verdict.valid) {
		return (
			<span className="accp-gate-badge accp-gate-blocked" title={verdict.fatalErrors.join("; ")}>
				ACCP: Blocked ({verdict.fatalErrors.length} errors)
			</span>
		);
	}

	return <span className="accp-gate-badge accp-gate-passed">ACCP: Pass</span>;
}
