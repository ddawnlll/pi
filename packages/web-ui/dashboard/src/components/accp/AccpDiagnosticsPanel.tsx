import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

interface AccpDiagnosticsPanelProps {
	diagnostics: AccpDiagnostic[];
}

/**
 * ACCP Diagnostics Panel — read-only display.
 * Renders structured ACCP diagnostics.
 */
export function AccpDiagnosticsPanel({ diagnostics }: AccpDiagnosticsPanelProps) {
	if (!diagnostics || diagnostics.length === 0) {
		return <div className="accp-diagnostics-panel"><p>No ACCP diagnostics</p></div>;
	}

	return (
		<div className="accp-diagnostics-panel">
			<h3>ACCP Diagnostics ({diagnostics.length})</h3>
			<ul>
				{diagnostics.map((d, i) => (
					<li key={i} className={`accp-diagnostic accp-diagnostic-${d.severity}`}>
						<span className="accp-diagnostic-code">{d.code}</span>
						<span className="accp-diagnostic-message">{d.message}</span>
						{d.fatal && <span className="accp-diagnostic-fatal">FATAL</span>}
					</li>
				))}
			</ul>
		</div>
	);
}
