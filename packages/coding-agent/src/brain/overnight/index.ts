/**
 * Overnight — P20 Overnight Autonomous Execution.
 *
 * This module provides the overnight run orchestrator for scheduling
 * and managing autonomous plan queue execution with automatic stop
 * conditions, progress tracking, and session lifecycle, plus the
 * morning report generator for summarizing overnight sessions.
 *
 * @packageDocumentation
 */

export type {
	ArtifactLink,
	MorningReport,
	MorningReportAuditLedger,
	MorningReportData,
	MorningReportMemoryStore,
	MorningReportObservationEngine,
	MorningReportReflectionEngine,
	TopProposal,
	WhatRanEntry,
	WhatStoppedEntry,
} from "./morning-report.js";
export { MorningReportGenerator } from "./morning-report.js";
export type {
	OvernightConfig,
	OvernightStopCondition,
	PlanQueueRef,
	RunProgress,
	RunSession,
	RunStatus,
} from "./orchestrator.js";
export {
	DEFAULT_OVERNIGHT_CONFIG,
	OvernightOrchestrator,
	SessionStore,
} from "./orchestrator.js";
