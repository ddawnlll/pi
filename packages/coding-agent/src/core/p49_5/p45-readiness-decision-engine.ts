/**
 * P49.5.03 — P45 Readiness Decision Engine (re-export)
 *
 * The decision engine is colocated with the certificate schema in
 * p45-readiness-certificate.ts. This file re-exports for clean imports.
 */

export {
	type DecisionEngineInput,
	evaluateP45Readiness,
	type P45Decision,
	type P45ReadinessCertificate,
	type P45ReadinessChecks,
} from "./p45-readiness-certificate.js";
