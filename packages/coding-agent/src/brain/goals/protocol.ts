export interface DecisionExplanation { reason: string; }
export interface NeedsApprovalEntry { action: string; }
export interface NightProtocolConfig { }
export interface NightProtocolStopCondition { reason: string; }
export interface RejectionRecord { action: string; reason: string; }
export interface WhatCompletedEntry { id: string; }
export class UserProtocol {
  constructor(config?: NightProtocolConfig) {}
}
export const ALL_NIGHT_PROTOCOL_STOP_CONDITIONS: NightProtocolStopCondition[] = [];
export const DEFAULT_NIGHT_MAX_DURATION_HOURS = 8;
export const DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS: NightProtocolStopCondition[] = [];
