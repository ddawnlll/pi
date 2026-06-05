export type AdmissionDecision = "allow" | "reject";

export function admitExecution(input: {
	postgresAvailable: boolean;
	production: boolean;
	jsonFallback: boolean;
	repairMode: boolean;
	autonomousMode: boolean;
	promotionGateSatisfied: boolean;
	tokenContextMode?: string;
	tokenContextEnabled?: boolean;
}): AdmissionDecision {
	if (!input.postgresAvailable) return "reject";
	if (input.production && input.jsonFallback) return "reject";
	// Repair mode requires autonomous mode; non-repair plans can run either way
	if (input.repairMode && !input.autonomousMode) return "reject";
	if (!input.promotionGateSatisfied) return "reject";
	// P44/Production requires active_safe token context mode
	if (input.tokenContextEnabled !== undefined || input.tokenContextMode !== undefined) {
		const enabled = input.tokenContextEnabled ?? true;
		const mode = input.tokenContextMode ?? "active_safe";
		if (!enabled) return "reject";
		if (mode !== "active_safe") return "reject";
	}
	return "allow";
}
