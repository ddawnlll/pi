export function stable1Preflight(input: {
	controllerActive: boolean;
	watchdogActive: boolean;
	postgresAuthority: boolean;
	admissionGate: boolean;
	legacyDirectWritesDisabled: boolean;
}): { ok: boolean; reasons: string[] } {
	const reasons: string[] = [];
	if (!input.controllerActive) reasons.push("controller_inactive");
	if (!input.watchdogActive) reasons.push("watchdog_inactive");
	if (!input.postgresAuthority) reasons.push("postgres_authority_required");
	if (!input.admissionGate) reasons.push("admission_gate_required");
	if (!input.legacyDirectWritesDisabled) reasons.push("legacy_direct_writes_enabled");
	return { ok: reasons.length === 0, reasons };
}
