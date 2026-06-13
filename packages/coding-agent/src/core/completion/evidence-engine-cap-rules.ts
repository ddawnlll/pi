/**
 * P49.31 FIX-008: Evidence Engine Cap Rules
 *
 * Defines hard credit caps for runtime completion requirements based on
 * the evidence type the requirement is satisfied with. These caps are
 * enforced by `enforceCapRule` and consulted by the PRR generator when
 * computing `p50Readiness.ready` and `promotion_decision.ready`.
 *
 * The motivation: the P49 PRR marked `p50Readiness.ready=true` with
 * 62.35% of runtime wiring missing because unit-test evidence was
 * credited at the same level as live runtime evidence. The cap rules
 * below make the cost explicit and machine-checkable.
 *
 * Rules:
 *   - source-only  : max credit 0.25
 *   - unit-only    : max credit 0.50
 *   - integration  : max credit 0.75
 *   - runtime/live : max credit 1.00
 *
 * Runtime/user-visible requirements cannot reach credit 1.00 without
 * runtime_call_site or live_tui evidence. The PRR cannot mark a plan
 * ready while any required runtime requirement is below 1.00.
 *
 * @packageDocumentation
 */

/** Evidence classes used to cap credit. */
export type EvidenceClass = "source" | "unit_test" | "integration_test" | "runtime_live";

/** A single requirement with its evidence class. */
export interface RequirementEvidence {
	requirementId: string;
	evidenceClass: EvidenceClass;
	/** Whether this requirement is runtime-affecting (cannot be satisfied by static evidence). */
	runtimeAffecting: boolean;
}

/** Result of enforcing the cap rule on a single requirement. */
export interface CapRuleResult {
	requirementId: string;
	requested: number;
	cap: number;
	granted: number;
	capped: boolean;
}

/** Maximum credit per evidence class. */
export const EVIDENCE_CLASS_CAPS: Readonly<Record<EvidenceClass, number>> = {
	source: 0.25,
	unit_test: 0.5,
	integration_test: 0.75,
	runtime_live: 1.0,
};

/**
 * Enforce the cap rule on a single requirement.
 *
 * If `runtimeAffecting` is true and the evidence class is not
 * `runtime_live`, the cap is the lower of the class cap and 0.5 (i.e.
 * runtime features cannot reach 1.00 with static evidence).
 */
export function enforceCapRule(req: RequirementEvidence, requested = 1.0): CapRuleResult {
	const classCap = EVIDENCE_CLASS_CAPS[req.evidenceClass];
	const cap = req.runtimeAffecting && req.evidenceClass !== "runtime_live" ? Math.min(classCap, 0.5) : classCap;
	const granted = Math.min(requested, cap);
	return {
		requirementId: req.requirementId,
		requested,
		cap,
		granted,
		capped: granted < requested,
	};
}

/**
 * Compute the weighted score of a list of requirements.
 *
 * Each requirement may declare a weight. The total is the sum of
 * `granted * weight` divided by the sum of weights.
 */
export function computeWeightedScore(requirements: Array<{ weight: number; granted: number }>): {
	total: number;
	weight: number;
	percent: number;
} {
	let weightedGranted = 0;
	let totalWeight = 0;
	for (const r of requirements) {
		weightedGranted += r.granted * r.weight;
		totalWeight += r.weight;
	}
	const percent = totalWeight > 0 ? (weightedGranted / totalWeight) * 100 : 0;
	return { total: weightedGranted, weight: totalWeight, percent };
}

/**
 * Convenience: returns true when the cap rules permit a plan to be
 * considered ready for promotion. Currently requires that all
 * runtime-affecting requirements have evidence class `runtime_live`.
 */
export function canPromoteP50(requirements: RequirementEvidence[]): boolean {
	return requirements.every((r) => !r.runtimeAffecting || r.evidenceClass === "runtime_live");
}
