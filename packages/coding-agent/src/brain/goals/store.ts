export interface GoalIndex { entries: GoalIndexEntry[]; }
export interface GoalIndexEntry { id: string; }
export interface GoalStoreConfig { path: string; }
export class GoalStore {
  constructor(config: GoalStoreConfig) {}
  async index(): Promise<GoalIndex> { return { entries: [] }; }
}
