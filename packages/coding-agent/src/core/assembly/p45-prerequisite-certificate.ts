/**
 * P49.5.05 — P45 Prerequisite Certificate
 *
 * The certificate produced by the P45 prerequisite gate.
 * Consumed by P45 to determine admission mode.
 */

import type { P45PrerequisiteVerdict } from "./p45-prerequisite-gate.js";

/**
 * The machine-readable prerequisite certificate that P45 trusts.
 * P49.5 installs this; P45 reads it.
 */
export interface P45PrerequisiteCertificate {
	schemaVersion: string;
	generatedAt: string;
	p495CertificateHash: string;
	verdict: P45PrerequisiteVerdict;
}

/**
 * Build a P45 prerequisite certificate from a gate verdict.
 */
export function buildPrerequisiteCertificate(
	p495CertificateHash: string,
	verdict: P45PrerequisiteVerdict,
): P45PrerequisiteCertificate {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		p495CertificateHash,
		verdict,
	};
}
