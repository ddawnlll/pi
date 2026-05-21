export interface DriftCheckState {
	lastCheck: number;
}
export interface DriftDetectorConfig {
	intervalMs: number;
}
export class GoalDriftDetector {
	check(): DriftCheckState[] {
		return [];
	}
}
