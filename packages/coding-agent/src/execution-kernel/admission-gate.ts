export type AdmissionDecision = "allow" | "reject";

export function admitExecution(input: {
	postgresAvailable: boolean;
	production: boolean;
	jsonFallback: boolean;
	repairMode: boolean;
	autonomousMode: boolean;
	promotionGateSatisfied: boolean;
}): AdmissionDecision {
	if (!input.postgresAvailable) return "reject";
	if (input.production && input.jsonFallback) return "reject";
	if (input.repairMode !== input.autonomousMode) return "reject";
	if (!input.promotionGateSatisfied) return "reject";
	return "allow";
}
