/**
 * InitialRouteIndicator and AccpTaskEnvelope (P49.23)
 *
 * Bridges TUI user selection into the compiled route signal pipeline.
 * InitialRouteIndicator does NOT authorize execution — it only bridges
 * free-form input into structured initial task routing.
 *
 * @packageDocumentation
 */

import type { AccpReportType, AccpTaskEnvelope, InitialRouteIndicator } from "@earendil-works/pi-execution-contracts";

/** Default initial action description for unknown selections. */
const DEFAULT_INITIAL_ACTION = "explore";

/**
 * Create an InitialRouteIndicator from a user selection.
 *
 * @param initialAction - User-selected initial action (from TUI mode picker).
 * @returns InitialRouteIndicator with runtimeAuthorityRequired=true.
 */
export function createInitialRouteIndicator(initialAction: string): InitialRouteIndicator {
	return {
		initialAction: initialAction || DEFAULT_INITIAL_ACTION,
		confidence: "high",
		runtimeAuthorityRequired: true,
		isAdvisory: false,
	};
}

/**
 * Create an AccpTaskEnvelope from an InitialRouteIndicator.
 *
 * @param taskId - Task ID.
 * @param indicator - The initial route indicator.
 * @param targetReportTypes - Report types to produce.
 * @returns AccpTaskEnvelope.
 */
export function createAccpTaskEnvelope(
	taskId: string,
	indicator: InitialRouteIndicator,
	targetReportTypes: AccpReportType[],
): AccpTaskEnvelope {
	return {
		taskId,
		initialRoute: indicator,
		targetReportTypes,
	};
}
