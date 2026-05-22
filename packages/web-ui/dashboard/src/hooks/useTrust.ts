import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type { PolicyRule, ApprovalRequest, ApprovalStats, AuditEntry, AuditStats, AutonomyProfile } from "../types-brain";

export interface UseTrustReturn {
	rules: PolicyRule[];
	approvals: ApprovalRequest[];
	approvalStats: ApprovalStats | null;
	auditEntries: AuditEntry[];
	auditStats: AuditStats | null;
	autonomy: AutonomyProfile | null;
	loading: boolean;
	error: string | null;
	toggleRule: (id: string) => Promise<void>;
	approve: (id: string) => Promise<void>;
	rejectApproval: (id: string, reason?: string) => Promise<void>;
	emergencyStop: () => Promise<void>;
	releaseStop: () => Promise<void>;
	emergencyStopped: boolean;
	explainDecision: (targetId: string) => Promise<string>;
	refresh: () => Promise<void>;
}

export function useTrust(): UseTrustReturn {
	const [rules, setRules] = useState<PolicyRule[]>([]);
	const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
	const [approvalStats, setApprovalStats] = useState<ApprovalStats | null>(null);
	const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
	const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
	const [autonomy, setAutonomy] = useState<AutonomyProfile | null>(null);
	const [emergencyStopped, setEmergencyStopped] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		try {
			const [
				rulesData,
				approvalsData,
				aStatsData,
				auditData,
				auditStatsData,
				autonomyData,
				emergencyData,
			] = await Promise.all([
				brainClient.getPolicyRules().catch(() => []),
				brainClient.getApprovals({ limit: 20 }).catch(() => ({ approvals: [], total: 0 })),
				brainClient.getApprovalStats().catch(() => null),
				brainClient.getAuditEntries({ limit: 20 }).catch(() => ({ entries: [], total: 0 })),
				brainClient.getAuditStats().catch(() => null),
				brainClient.getAutonomyProfile().catch(() => null),
				brainClient.getEmergencyStatus().catch(() => ({ stopped: false })),
			]);
			setRules(rulesData);
			setApprovals(approvalsData.approvals);
			setApprovalStats(aStatsData);
			setAuditEntries(auditData.entries);
			setAuditStats(auditStatsData);
			setAutonomy(autonomyData);
			setEmergencyStopped(emergencyData.stopped);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load trust data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const toggleRule = useCallback(
		async (id: string) => {
			await brainClient.toggleRule(id);
			await fetch();
		},
		[fetch],
	);

	const approve = useCallback(
		async (id: string) => {
			await brainClient.approve(id);
			await fetch();
		},
		[fetch],
	);

	const rejectApproval = useCallback(
		async (id: string, reason?: string) => {
			await brainClient.rejectApproval(id, reason);
			await fetch();
		},
		[fetch],
	);

	const emergencyStop = useCallback(async () => {
		await brainClient.emergencyStop();
		setEmergencyStopped(true);
	}, []);

	const releaseStop = useCallback(async () => {
		await brainClient.releaseStop();
		setEmergencyStopped(false);
	}, []);

	const explainDecision = useCallback(async (targetId: string) => {
		return brainClient.explainDecision(targetId);
	}, []);

	return {
		rules, approvals, approvalStats, auditEntries, auditStats, autonomy,
		loading, error,
		toggleRule, approve, rejectApproval,
		emergencyStop, releaseStop, emergencyStopped,
		explainDecision, refresh: fetch,
	};
}
