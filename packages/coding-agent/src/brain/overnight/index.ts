export { OvernightOrchestrator } from "./orchestrator";
export type {
	OvernightConfig,
	OvernightStopCondition,
	OvernightStatus,
	PlanQueueRef,
	RunSession,
	RunStatus,
} from "./orchestrator";

export { MorningReportGenerator } from "./morning-report";
export type { MorningReport, PlanRunSummary } from "./morning-report";

export { FullLoopValidator } from "./validation";
export type { ScenarioResult, ValidationCheck, ValidationScenario } from "./validation";

export { TrustAssessor } from "./trust-assessment";
export type { TrustAssessment, TrustDimension, TrustFinding, TrustCriterion, TrustStatus, Trend, FindingSeverity } from "./trust-assessment";

export { DogfoodReportGenerator } from "./dogfood-report";
export type { DogfoodReport } from "./dogfood-report";

export const DEFAULT_OVERNIGHT_CONFIG = {
	maxDurationHours: 8,
	autonomyLevel: 3,
	stopConditions: ["max_duration_reached"],
	notificationEnabled: true,
	generateMorningReport: true,
	planExecIds: [],
};

export class SessionStore {
	private sessions: Map<string, unknown> = new Map();
	add(session: { id: string; [key: string]: unknown }): void {
		this.sessions.set(session.id, session);
	}
	get(id: string): unknown {
		return this.sessions.get(id);
	}
	list(): unknown[] {
		return Array.from(this.sessions.values());
	}
}
