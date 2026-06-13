/**
 * P45.S6 — Contract Amendment Protocol
 *
 * Manages amendments to frozen predictive spec contracts.
 * Breaking amendments require explicit approval (never auto-approved).
 * Non-breaking amendments can be auto-applied if evidence-backed.
 * DCR (contract conflict) or CAR (correcting) reports may be required.
 *
 * Amendment types:
 * - add_contract: add a new predicted contract
 * - remove_contract: remove an obsolete prediction
 * - change_outcome: change the predicted outcome
 * - change_evidence: update evidence class
 */

// =============================================================================
// Types
// =============================================================================

export type AmendmentKind = "add_contract" | "remove_contract" | "change_outcome" | "change_evidence";

export type AmendmentBreaking = "breaking" | "non_breaking";

export interface ContractAmendment {
	/** Unique amendment identifier. */
	id: string;
	/** The contract being amended. */
	contract: string;
	/** Kind of amendment. */
	kind: AmendmentKind;
	/** Whether the amendment is breaking. */
	breaking: AmendmentBreaking;
	/** The namespace proposing the amendment. */
	proposer: string;
	/** ISO timestamp. */
	proposedAt: string;
	/** Evidence backing the amendment. */
	evidence: string[];
	/** Whether this amendment has been approved. */
	approved: boolean;
	/** Who/what approved it (empty if not approved). */
	approvedBy: string;
	/** ISO timestamp of approval. */
	approvedAt?: string;
	/** Whether a DCR report is required. */
	dcrRequired: boolean;
	/** Whether a CAR report is required. */
	carRequired: boolean;
	/** Human-readable reason for the amendment. */
	reason: string;
}

export interface AmendmentBatch {
	amendments: ContractAmendment[];
	accepted: number;
	rejected: number;
	rejectionReasons: string[];
}

export interface AmendmentProtocolVerdict {
	/** Whether all amendments in the batch were accepted. */
	allAccepted: boolean;
	/** How many were auto-approved. */
	autoApproved: number;
	/** How many require human review. */
	requireHumanReview: number;
	/** Amendments that need DCR reports. */
	dcrNeeded: ContractAmendment[];
	/** Amendments that need CAR reports. */
	carNeeded: ContractAmendment[];
	/** Blocking reasons if any amendments were rejected. */
	blockingReasons: string[];
}

// =============================================================================
// Protocol
// =============================================================================

export class ContractAmendmentProtocol {
	private amendments: ContractAmendment[] = [];

	/**
	 * Propose a new amendment.
	 *
	 * Rules:
	 * - Breaking amendments are NEVER auto-approved.
	 * - Non-breaking amendments backed by static_confirmation or human_approval
	 *   can be auto-approved.
	 * - Amendments removing contracts require CAR.
	 * - Amendments changing outcomes to "breaking_drift" require DCR.
	 * - Amendments without evidence are always rejected.
	 */
	propose(
		amendment: Omit<ContractAmendment, "approved" | "approvedBy" | "dcrRequired" | "carRequired">,
	): { success: true; amendment: ContractAmendment } | { success: false; reason: string } {
		// Duplicate check
		if (this.amendments.some((a) => a.id === amendment.id)) {
			return { success: false, reason: `Duplicate amendment ID: ${amendment.id}` };
		}

		// Evidence check
		if (amendment.evidence.length === 0) {
			return { success: false, reason: `Amendment ${amendment.id} has no evidence` };
		}

		// Determine if DCR and CAR are needed
		const dcrRequired = amendment.kind === "change_outcome" || amendment.breaking === "breaking";
		const carRequired = amendment.kind === "remove_contract" || amendment.kind === "change_evidence";

		// Breaking amendments: never auto-approved
		let approved = false;
		let approvedBy = "";

		if (amendment.breaking === "non_breaking") {
			// Check if evidence is strong enough for auto-approval
			const hasStaticEvidence = amendment.evidence.some(
				(e) => e.toLowerCase().includes("static") || e.toLowerCase().includes("compiler"),
			);
			const hasHumanEvidence = amendment.evidence.some(
				(e) => e.toLowerCase().includes("human") || e.toLowerCase().includes("approved"),
			);

			if (hasStaticEvidence || hasHumanEvidence) {
				approved = true;
				approvedBy = "auto";
			}
		}

		const fullAmendment: ContractAmendment = {
			...amendment,
			approved,
			approvedBy,
			dcrRequired,
			carRequired,
		};

		this.amendments.push(fullAmendment);
		return { success: true, amendment: fullAmendment };
	}

	/**
	 * Manually approve an amendment (human or runtime authority).
	 */
	approve(id: string, approver: string): boolean {
		const amendment = this.amendments.find((a) => a.id === id);
		if (!amendment) return false;
		amendment.approved = true;
		amendment.approvedBy = approver;
		amendment.approvedAt = new Date().toISOString();
		return true;
	}

	/**
	 * Get all proposed amendments.
	 */
	getAmendments(): ContractAmendment[] {
		return [...this.amendments];
	}

	/**
	 * Get all pending (not yet approved) amendments.
	 */
	getPendingAmendments(): ContractAmendment[] {
		return this.amendments.filter((a) => !a.approved);
	}

	/**
	 * Build a protocol verdict for a batch of newly proposed amendments.
	 */
	buildVerdict(amendmentIds: string[]): AmendmentProtocolVerdict {
		const dcrNeeded: ContractAmendment[] = [];
		const carNeeded: ContractAmendment[] = [];
		const blockingReasons: string[] = [];
		let autoApproved = 0;
		let requireHumanReview = 0;

		for (const id of amendmentIds) {
			const a = this.amendments.find((am) => am.id === id);
			if (!a) continue;

			if (a.approved && a.approvedBy === "auto") {
				autoApproved++;
			} else if (!a.approved) {
				requireHumanReview++;
				if (a.breaking === "breaking") {
					blockingReasons.push(`Breaking amendment ${a.id} requires human approval`);
				}
			}

			if (a.dcrRequired) dcrNeeded.push(a);
			if (a.carRequired) carNeeded.push(a);
		}

		return {
			allAccepted: blockingReasons.length === 0,
			autoApproved,
			requireHumanReview,
			dcrNeeded,
			carNeeded,
			blockingReasons,
		};
	}

	/**
	 * Clear all amendments.
	 */
	clear(): void {
		this.amendments = [];
	}
}
