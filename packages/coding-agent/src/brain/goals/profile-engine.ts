export interface AuthorizationEvent { type: string; }
export interface AuthorizationResult { allowed: boolean; }
export interface AutonomyEngineConfig { }
export interface AutonomyEngineEvent { type: string; }
export interface ProfileLevelChangeEvent { from: number; to: number; }
export class AutonomyEngine {
  constructor(config?: AutonomyEngineConfig) {}
}
export const DEFAULT_AUTONOMY_CONFIG = {};
export const DEFAULT_DECISION_RULES: Array<{ id: string; action: string }> = [];
