import { type AdmissionDecision, admitExecution } from "./admission-gate.js";

export type AdmissionEntrypoint =
	| "cli_plan_run"
	| "dashboard_run"
	| "api_plan_run"
	| "retry_endpoint"
	| "cleanup_rerun_endpoint"
	| "brain_worker_trigger"
	| "overnight_runner"
	| "proposal_executor";

export interface AdmissionDecisionRecord {
	entrypoint: AdmissionEntrypoint;
	decision: AdmissionDecision;
	reason: string;
	timestamp: number;
}

const admissionDecisionLog: AdmissionDecisionRecord[] = [];

export function guardExecutionEntrypoint(
	entrypoint: AdmissionEntrypoint,
	input: {
		postgresAvailable: boolean;
		production: boolean;
		jsonFallback: boolean;
		repairMode: boolean;
		autonomousMode: boolean;
		promotionGateSatisfied: boolean;
	},
): AdmissionDecisionRecord {
	const decision = admitExecution(input);
	const reason = !input.postgresAvailable
		? "postgres_unavailable"
		: input.production && input.jsonFallback
			? "json_fallback_forbidden_in_production"
			: input.repairMode && !input.autonomousMode
				? "repair_autonomous_mode_mismatch"
				: !input.promotionGateSatisfied
					? "promotion_gate_unsatisfied"
					: "allowed";
	const record: AdmissionDecisionRecord = {
		entrypoint,
		decision,
		reason,
		timestamp: Date.now(),
	};
	admissionDecisionLog.push(record);
	return record;
}

export function listAdmissionDecisions(): AdmissionDecisionRecord[] {
	return [...admissionDecisionLog];
}

export function resetAdmissionDecisions(): void {
	admissionDecisionLog.length = 0;
}
