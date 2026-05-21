export interface ClassificationContext {
	query: string;
}
export interface DecisionAuditEntry {
	id: string;
	decision: string;
	timestamp: number;
}
export class DecisionClassifier {
	classify(context: ClassificationContext): string {
		return "unknown";
	}
}
