export interface GoalIndex {
	entries: GoalIndexEntry[];
}
export interface GoalIndexEntry {
	id: string;
}
export interface GoalStoreConfig {
	path: string;
}
export class GoalStore {
	async index(): Promise<GoalIndex> {
		return { entries: [] };
	}
}
