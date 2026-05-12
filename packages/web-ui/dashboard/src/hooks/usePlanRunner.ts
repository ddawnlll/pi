import { useState, useCallback } from "react";
import type { PlanExecution } from "../types";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types for plan upload/validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
	success: boolean;
	parseResult?: {
		title: string;
		phase: string;
		workspaceCount: number;
		maxParallel: number;
	};
	safety?: {
		safe: boolean;
		critical: Array<{ type: string; message: string }>;
		warnings: Array<{ type: string; message: string }>;
	};
	errors?: string[];
	warnings?: string[];
}

export interface RunPlanResult {
	success: boolean;
	planExecutionId?: string;
	execution?: {
		projectId: string;
		planExecId: string;
		title: string;
		phase: string;
		status: string;
		startedAt: number;
		completedAt: number | null;
	};
	errors?: string[];
	warnings?: string[];
}

export interface ActiveExecution {
	projectId: string;
	planExecId: string;
	title: string;
	phase: string;
	status: string;
	startedAt: number;
	completedAt: number | null;
	error?: string;
}

// ---------------------------------------------------------------------------
// Validate plan
// ---------------------------------------------------------------------------

async function validatePlanContent(
	projectId: string,
	planContent: string,
): Promise<ValidationResult> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/validate`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent }),
			},
		);
		return await response.json();
	} catch (error) {
		return {
			success: false,
			errors: [String(error)],
		};
	}
}

// ---------------------------------------------------------------------------
// Run plan
// ---------------------------------------------------------------------------

async function runPlanContent(
	projectId: string,
	planContent: string,
	planFileName?: string,
): Promise<RunPlanResult> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/run`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent, planFileName }),
			},
		);
		return await response.json();
	} catch (error) {
		return {
			success: false,
			errors: [String(error)],
		};
	}
}

// ---------------------------------------------------------------------------
// Get active executions
// ---------------------------------------------------------------------------

async function fetchActiveExecutions(
	projectId: string,
): Promise<ActiveExecution[]> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/active`,
		);
		if (!response.ok) return [];
		const data = await response.json();
		return data.executions ?? [];
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlanRunner(projectId: string | null) {
	const [validating, setValidating] = useState(false);
	const [running, setRunning] = useState(false);
	const [validationResult, setValidationResult] =
		useState<ValidationResult | null>(null);
	const [runResult, setRunResult] = useState<RunPlanResult | null>(null);

	const validate = useCallback(
		async (planContent: string): Promise<ValidationResult | null> => {
			if (!projectId) return null;
			setValidating(true);
			try {
				const result = await validatePlanContent(projectId, planContent);
				setValidationResult(result);
				return result;
			} finally {
				setValidating(false);
			}
		},
		[projectId],
	);

	const run = useCallback(
		async (
			planContent: string,
			planFileName?: string,
		): Promise<RunPlanResult | null> => {
			if (!projectId) return null;
			setRunning(true);
			try {
				const result = await runPlanContent(
					projectId,
					planContent,
					planFileName,
				);
				setRunResult(result);
				return result;
			} finally {
				setRunning(false);
			}
		},
		[projectId],
	);

	const clearResults = useCallback(() => {
		setValidationResult(null);
		setRunResult(null);
	}, []);

	return {
		validating,
		running,
		validationResult,
		runResult,
		validate,
		run,
		clearResults,
		fetchActiveExecutions: () =>
			projectId ? fetchActiveExecutions(projectId) : Promise.resolve([]),
	};
}
