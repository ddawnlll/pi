import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Hook for trust/approvals/audit data. Supports project-scoped API calls.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 */
export function useTrust(projectId?: string | null): UseTrustReturn {
	const [rules, setRules] = useState<PolicyRule[]>([]);
	const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
	const [approvalStats, setApprovalStats] = useState<ApprovalStats | null>(null);
	const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
	const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
	const [autonomy, setAutonomy] = useState<AutonomyProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [emergencyStopped, setEmergencyStopped] = useState(false);
	const projectIdRef = useRef(projectId);
	projectIdRef.current = projectId;

	const fetch = useCallback(async () => {
		const pid = projectIdRef.current;
		try {
			const [rulesData, approvalsData, apprStatsData, auditData, audStatsData, autData, emergData] =
				await Promise.all([
					brainClient.getPolicyRules(pid).catch(() => []),
					brainClient.getApprovals({ limit: 20 }, pid).catch(() => ({ approvals: [], total: 0 })),
					brainClient.getApprovalStats(pid).catch(() => null),
					brainClient.getAuditEntries({ limit: 20 }, pid).catch(() => ({ entries: [], total: 0 })),
					brainClient.getAuditStats(pid).catch(() => null),
					brainClient.getAutonomyProfile(pid).catch(() => null),
					brainClient.getEmergencyStatus(pid).catch(() => ({ stopped: false })),
				]);
			setRules(rulesData);
			setApprovals(approvalsData.approvals);
			setApprovalStats(apprStatsData);
			setAuditEntries(auditData.entries);
			setAuditStats(audStatsData);
			setAutonomy(autData);
			setEmergencyStopped(emergData.stopped);
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

	const toggleRule = useCallback(async (id: string) => {
		await brainClient.toggleRule(id, projectIdRef.current);
		await fetch();
	}, [fetch]);

	const approve = useCallback(async (id: string) => {
		await brainClient.approve(id, projectIdRef.current);
		await fetch();
	}, [fetch]);

	const rejectApproval = useCallback(async (id: string, reason?: string) => {
		await brainClient.rejectApproval(id, reason, projectIdRef.current);
		await fetch();
	}, [fetch]);

	const emergencyStop = useCallback(async () => {
		await brainClient.emergencyStop(projectIdRef.current);
		setEmergencyStopped(true);
	}, []);

	const releaseStop = useCallback(async () => {
		await brainClient.releaseStop(projectIdRef.current);
		setEmergencyStopped(false);
	}, []);

	const explainDecision = useCallback(async (targetId: string) => {
		return brainClient.explainDecision(targetId, projectIdRef.current);
	}, []);

	return {
		rules,
		approvals,
		approvalStats,
		auditEntries,
		auditStats,
		autonomy,
		loading,
		error,
		toggleRule,
		approve,
		rejectApproval,
		emergencyStop,
		releaseStop,
		emergencyStopped,
		explainDecision,
		refresh: fetch,
	};
}
