const API_BASE = "";

export async function sendControlCommand(
	action: "pause" | "stop" | "cancel" | "resume" | "force-kill",
	planExecId: string | null,
): Promise<{ success: boolean; error?: string }> {
	try {
		const url = planExecId
			? `${API_BASE}/api/executions/${planExecId}/control`
			: `${API_BASE}/api/control`;
		const body = planExecId
			? { action }
			: { action, requestedAt: new Date().toISOString(), requestedBy: "dashboard" };
		const r = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return (await r.json()) as { success: boolean; error?: string };
	} catch (e) {
		return { success: false, error: String(e) };
	}
}

export async function sendRerunCommand(
	projectId: string,
	planExecId: string,
): Promise<{ success: boolean; error?: string; planExecutionId?: string }> {
	try {
		const r = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/${planExecId}/rerun`,
			{ method: "POST" },
		);
		return (await r.json()) as {
			success: boolean;
			error?: string;
			planExecutionId?: string;
		};
	} catch (e) {
		return { success: false, error: String(e) };
	}
}
