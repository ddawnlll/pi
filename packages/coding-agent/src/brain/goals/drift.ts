export interface DriftCheckState {
	lastCheck: number;
}
export interface DriftDetectorConfig {
	intervalMs: number;
}
export class GoalDriftDetector {
	constructor(config: DriftDetectorConfig) {}
	check(): DriftCheckState[] {
		return [];
	}
}
