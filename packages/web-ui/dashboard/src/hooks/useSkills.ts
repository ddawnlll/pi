/**
 * useSkills — Hook for interacting with the Skills API.
 *
 * P11.P — Extensions and Skills Manager UI
 *
 * Provides queries and mutations for:
 * - Listing installed skills
 * - Getting skill details
 * - Install, test, invoke, uninstall
 * - Audit events
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillEntry {
	name: string;
	description: string;
	filePath: string;
	valid: boolean;
	required: boolean;
	manifestSource?: string;
}

export interface SkillDetail {
	name: string;
	description: string;
	filePath: string;
	baseDir?: string;
	valid: boolean;
	validationMessages?: string[];
	required: boolean;
	disableModelInvocation?: boolean;
	content?: string;
}

export interface SkillListResponse {
	success: boolean;
	skills: SkillEntry[];
	diagnostics: Array<{
		skillName?: string;
		severity: "error" | "warning" | "info";
		message: string;
	}>;
	count: number;
}

export interface SkillDetailResponse {
	success: boolean;
	skill: SkillDetail;
}

export interface SkillInstallResponse {
	success: boolean;
	installation: {
		id: string;
		name: string;
		description: string;
		version: string;
		source: string;
		skillPath: string;
		installedAt: string;
	};
}

export interface SkillTestResult {
	id: string;
	skillName: string;
	status: "passed" | "failed" | "error" | "skipped";
	qualityStatus: "compliant" | "non_compliant" | "unknown";
	output: string;
	errorMessage?: string;
	executionTimeMs: number;
	startedAt: string;
	completedAt: string;
}

export interface SkillTestResponse {
	success: boolean;
	testResult: SkillTestResult;
	logs: string;
}

export interface SkillAuditEvent {
	id: string;
	skillName: string;
	action: string;
	verdict: string;
	reason: string;
	actor?: string;
	policyRuleId?: string;
	protectionLevel?: string;
	planExecutionId?: string;
	workspaceId?: string;
	occurredAt: string;
}

export interface SkillAuditEventsResponse {
	success: boolean;
	events: SkillAuditEvent[];
	count: number;
	total: number;
}

export interface SkillDeleteResponse {
	success: boolean;
	message: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function fetchSkills(): Promise<SkillListResponse> {
	const r = await fetch(`${API_BASE}/api/skills`);
	if (!r.ok) throw new Error(`Failed to fetch skills: ${r.statusText}`);
	return r.json();
}

async function fetchSkillDetail(name: string): Promise<SkillDetailResponse> {
	const r = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}`);
	if (!r.ok) {
		if (r.status === 404) throw new Error(`Skill "${name}" not found`);
		throw new Error(`Failed to fetch skill detail: ${r.statusText}`);
	}
	return r.json();
}

async function installSkill(params: {
	name: string;
	description?: string;
	version?: string;
	source?: string;
	url?: string;
	content?: string;
	path?: string;
}): Promise<SkillInstallResponse> {
	const r = await fetch(`${API_BASE}/api/skills/install`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	const data = await r.json();
	if (!r.ok) throw new Error(data.error || "Failed to install skill");
	return data;
}

async function testSkill(name: string, testCommand?: string, timeout?: number): Promise<SkillTestResponse> {
	const r = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}/test`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ testCommand, timeout }),
	});
	const data = await r.json();
	if (!r.ok) throw new Error(data.error || "Failed to test skill");
	return data;
}

async function uninstallSkill(name: string): Promise<SkillDeleteResponse> {
	const r = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}`, {
		method: "DELETE",
	});
	const data = await r.json();
	if (!r.ok) throw new Error(data.error || "Failed to uninstall skill");
	return data;
}

async function fetchAuditEvents(params?: {
	skillName?: string;
	action?: string;
	verdict?: string;
	limit?: number;
	offset?: number;
}): Promise<SkillAuditEventsResponse> {
	const searchParams = new URLSearchParams();
	if (params?.skillName) searchParams.set("skillName", params.skillName);
	if (params?.action) searchParams.set("action", params.action);
	if (params?.verdict) searchParams.set("verdict", params.verdict);
	if (params?.limit) searchParams.set("limit", String(params.limit));
	if (params?.offset) searchParams.set("offset", String(params.offset));

	const qs = searchParams.toString();
	const url = `${API_BASE}/api/skills/audit-events${qs ? `?${qs}` : ""}`;
	const r = await fetch(url);
	if (!r.ok) throw new Error(`Failed to fetch audit events: ${r.statusText}`);
	return r.json();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useSkills() {
	const queryClient = useQueryClient();

	const listQuery = useQuery<SkillListResponse>({
		queryKey: ["skills"],
		queryFn: fetchSkills,
		staleTime: 30_000,
	});

	const installMutation = useMutation({
		mutationFn: installSkill,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
		},
	});

	const testMutation = useMutation({
		mutationFn: ({ name, testCommand, timeout }: { name: string; testCommand?: string; timeout?: number }) =>
			testSkill(name, testCommand, timeout),
	});

	const uninstallMutation = useMutation({
		mutationFn: (name: string) => uninstallSkill(name),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
		},
	});

	return {
		skills: listQuery.data?.skills ?? [],
		diagnostics: listQuery.data?.diagnostics ?? [],
		count: listQuery.data?.count ?? 0,
		isLoading: listQuery.isLoading,
		error: listQuery.error,
		refetch: () => listQuery.refetch(),
		install: installMutation.mutateAsync,
		isInstalling: installMutation.isPending,
		installError: installMutation.error,
		test: testMutation.mutateAsync,
		isTesting: testMutation.isPending,
		testData: testMutation.data ?? null,
		testError: testMutation.error,
		resetTest: () => testMutation.reset(),
		uninstall: uninstallMutation.mutateAsync,
		isUninstalling: uninstallMutation.isPending,
	};
}

export function useSkillDetail(name: string | null) {
	const query = useQuery<SkillDetailResponse>({
		queryKey: ["skills", name],
		queryFn: () => fetchSkillDetail(name!),
		enabled: !!name,
		staleTime: 30_000,
	});

	return {
		skill: query.data?.skill ?? null,
		isLoading: query.isLoading,
		error: query.error,
		refetch: () => query.refetch(),
	};
}

export function useAuditEvents(params?: {
	skillName?: string;
	action?: string;
	verdict?: string;
	limit?: number;
}) {
	const query = useQuery<SkillAuditEventsResponse>({
		queryKey: ["skills", "audit-events", params],
		queryFn: () => fetchAuditEvents(params),
		staleTime: 30_000,
	});

	return {
		events: query.data?.events ?? [],
		count: query.data?.count ?? 0,
		total: query.data?.total ?? 0,
		isLoading: query.isLoading,
		error: query.error,
		refetch: () => query.refetch(),
	};
}
