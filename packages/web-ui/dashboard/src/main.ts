import { html, render } from "lit";
import type { PlanState, WorkerInfo, ExecutionEvent, LogStream } from "./types.js";
import "./tailwind.css";

// ============================================================================
// STATE
// ============================================================================
let planState: PlanState | null = null;
let selectedWorkerId: string | null = null;
let recentEvents: ExecutionEvent[] = [];
let eventFilter: "all" | "errors" = "all";
let activeLogStream: LogStream = "stdout";
let workerLogs: string[] = [];

// ============================================================================
// API CLIENT
// ============================================================================
const API_BASE = "";

async function fetchPlanState(): Promise<PlanState | null> {
	try {
		const response = await fetch(`${API_BASE}/api/plan-state`);
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch plan state:", error);
		return null;
	}
}

async function sendControlCommand(action: "pause" | "stop" | "cancel" | "resume"): Promise<{ success: boolean; error?: string }> {
	try {
		const response = await fetch(`${API_BASE}/api/control`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action,
				requestedAt: new Date().toISOString(),
				requestedBy: "dashboard",
			}),
		});
		return await response.json();
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

// ============================================================================
// SSE CONNECTIONS
// ============================================================================
let eventsSource: EventSource | null = null;
let logsSource: EventSource | null = null;

function connectEventStream() {
	if (eventsSource) eventsSource.close();
	
	eventsSource = new EventSource(`${API_BASE}/api/events`);
	
	eventsSource.onmessage = (event) => {
		try {
			const executionEvent: ExecutionEvent = JSON.parse(event.data);
			recentEvents.unshift(executionEvent);
			if (recentEvents.length > 50) recentEvents.pop();
			renderApp();
		} catch (error) {
			console.error("Failed to parse event:", error);
		}
	};
	
	eventsSource.onerror = () => {
		console.error("Event stream error, reconnecting...");
		setTimeout(connectEventStream, 5000);
	};
}

function connectLogStream(workspaceId: string, attempt: number, stream: LogStream) {
	if (logsSource) logsSource.close();
	
	workerLogs = [];
	logsSource = new EventSource(`${API_BASE}/api/logs/${workspaceId}/${attempt}/${stream}`);
	
	logsSource.onmessage = (event) => {
		workerLogs.push(event.data);
		renderApp();
	};
	
	logsSource.onerror = () => {
		console.error("Log stream error");
	};
}

// ============================================================================
// POLLING
// ============================================================================
let pollInterval: number | null = null;

function startPolling() {
	if (pollInterval) clearInterval(pollInterval);
	
	const poll = async () => {
		const state = await fetchPlanState();
		if (state) {
			planState = state;
			renderApp();
		}
	};
	
	poll();
	pollInterval = window.setInterval(poll, 500);
}

function stopPolling() {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
	}
}

// ============================================================================
// CONTROL HANDLERS
// ============================================================================
async function handleControl(action: "pause" | "stop" | "cancel" | "resume") {
	const confirmed = confirm(`Are you sure you want to ${action} the plan execution?`);
	if (!confirmed) return;
	
	const result = await sendControlCommand(action);
	if (!result.success) {
		alert(`Failed to ${action}: ${result.error || "Unknown error"}`);
	}
}

function selectWorker(workerId: string) {
	selectedWorkerId = workerId;
	const worker = planState?.workers.find(w => w.id === workerId);
	if (worker) {
		connectLogStream(workerId, worker.attempt, activeLogStream);
	}
	renderApp();
}

function switchLogStream(stream: LogStream) {
	activeLogStream = stream;
	const worker = planState?.workers.find(w => w.id === selectedWorkerId);
	if (worker && selectedWorkerId) {
		connectLogStream(selectedWorkerId, worker.attempt, stream);
	}
}

// ============================================================================
// RENDER
// ============================================================================
function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function getStatusColor(status: string): string {
	switch (status) {
		case "running": return "text-green-500";
		case "paused": return "text-yellow-500";
		case "completed": return "text-blue-500";
		case "failed": return "text-red-500";
		default: return "text-gray-500";
	}
}

function renderApp() {
	const app = document.getElementById("app");
	if (!app) return;
	
	if (!planState) {
		render(html`
			<div class="w-full h-screen flex items-center justify-center bg-background text-foreground">
				<div class="text-muted-foreground">Loading plan state...</div>
			</div>
		`, app);
		return;
	}
	
	const selectedWorker = planState.workers.find(w => w.id === selectedWorkerId);
	const activeWorkers = planState.workers.filter(w => w.stage === "active");
	const filteredEvents = eventFilter === "all" 
		? recentEvents 
		: recentEvents.filter(e => e.type === "failed" || e.type === "retry");
	
	const appHtml = html`
		<div class="w-full h-screen flex flex-col bg-background text-foreground">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
				<h1 class="text-lg font-semibold">Pi Plan Dashboard</h1>
				<div class="flex gap-2">
					${planState.status === "paused" ? html`
						<button 
							@click=${() => handleControl("resume")}
							class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
						>Resume</button>
					` : ""}
					<button 
						@click=${() => handleControl("pause")}
						?disabled=${planState.status !== "running"}
						class="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm disabled:opacity-50"
					>Pause</button>
					<button 
						@click=${() => handleControl("stop")}
						class="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm"
					>Stop</button>
					<button 
						@click=${() => handleControl("cancel")}
						class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
					>Cancel</button>
				</div>
			</div>
			
			<!-- Main Content -->
			<div class="flex-1 flex overflow-hidden">
				<!-- Left Sidebar -->
				<div class="w-64 border-r border-border flex flex-col overflow-hidden">
					<!-- Plan Summary -->
					<div class="p-4 border-b border-border">
						<h2 class="text-sm font-semibold mb-2">PLAN SUMMARY</h2>
						<div class="text-xs space-y-1">
							<div><span class="text-muted-foreground">Title:</span> ${planState.title}</div>
							<div><span class="text-muted-foreground">Phase:</span> ${planState.phase}</div>
							<div><span class="text-muted-foreground">Status:</span> <span class="${getStatusColor(planState.status)}">${planState.status}</span></div>
							<div><span class="text-muted-foreground">Elapsed:</span> ${formatElapsed(planState.elapsed)}</div>
						</div>
					</div>
					
					<!-- Queue -->
					<div class="p-4 flex-1 overflow-auto">
						<h2 class="text-sm font-semibold mb-2">QUEUE</h2>
						<div class="text-xs space-y-1">
							<div>Pending: ${planState.queue.pending}</div>
							<div>Active: ${planState.queue.active}</div>
							<div>Blocked: ${planState.queue.blocked}</div>
							<div>Complete: ${planState.queue.complete}</div>
							<div>Failed: ${planState.queue.failed}</div>
						</div>
					</div>
				</div>
				
				<!-- Center Content -->
				<div class="flex-1 flex flex-col overflow-hidden">
					<!-- Active Workers -->
					<div class="border-b border-border p-4">
						<h2 class="text-sm font-semibold mb-2">ACTIVE WORKERS</h2>
						<div class="space-y-1">
							${activeWorkers.length === 0 ? html`
								<div class="text-xs text-muted-foreground">No active workers</div>
							` : activeWorkers.map((worker, index) => html`
								<button
									@click=${() => selectWorker(worker.id)}
									class="w-full text-left px-2 py-1 text-xs rounded hover:bg-secondary ${selectedWorkerId === worker.id ? "bg-secondary" : ""}"
								>
									[${index + 1}] ${worker.id} - stage: ${worker.stage} - attempt: ${worker.attempt}
								</button>
							`)}
						</div>
					</div>
					
					<!-- Selected Workspace Detail -->
					${selectedWorker ? html`
						<div class="border-b border-border p-4">
							<h2 class="text-sm font-semibold mb-2">SELECTED WORKSPACE DETAIL</h2>
							<div class="text-xs space-y-1">
								<div><span class="text-muted-foreground">ID:</span> ${selectedWorker.id}</div>
								<div><span class="text-muted-foreground">Stage:</span> ${selectedWorker.stage}</div>
								<div><span class="text-muted-foreground">Attempts:</span> ${selectedWorker.attempt}</div>
								<div><span class="text-muted-foreground">Retries:</span> ${selectedWorker.retries}</div>
								${selectedWorker.snapshotPath ? html`
									<div><span class="text-muted-foreground">Snapshot:</span> ${selectedWorker.snapshotPath}</div>
								` : ""}
								${selectedWorker.reportPath ? html`
									<div><span class="text-muted-foreground">Report:</span> ${selectedWorker.reportPath}</div>
								` : ""}
							</div>
						</div>
						
						<!-- Worker Logs -->
						<div class="flex-1 flex flex-col overflow-hidden p-4">
							<div class="flex items-center justify-between mb-2">
								<h2 class="text-sm font-semibold">WORKER LOGS</h2>
								<div class="flex gap-1">
									${(["stdout", "stderr", "error"] as LogStream[]).map(stream => html`
										<button
											@click=${() => switchLogStream(stream)}
											class="px-2 py-1 text-xs rounded ${activeLogStream === stream ? "bg-primary text-primary-foreground" : "bg-secondary"}"
										>${stream}</button>
									`)}
								</div>
							</div>
							<div class="flex-1 overflow-auto bg-black text-green-400 p-2 rounded font-mono text-xs">
								${workerLogs.length === 0 ? html`
									<div class="text-gray-500">No logs yet...</div>
								` : workerLogs.map(log => html`<div>${log}</div>`)}
							</div>
						</div>
					` : html`
						<div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
							Select a worker to view details and logs
						</div>
					`}
				</div>
				
				<!-- Right Sidebar - Recent Events -->
				<div class="w-80 border-l border-border flex flex-col overflow-hidden">
					<div class="p-4 border-b border-border flex items-center justify-between">
						<h2 class="text-sm font-semibold">RECENT EVENTS</h2>
						<select 
							@change=${(e: Event) => { eventFilter = (e.target as HTMLSelectElement).value as "all" | "errors"; renderApp(); }}
							class="text-xs bg-secondary border border-border rounded px-2 py-1"
						>
							<option value="all">all</option>
							<option value="errors">failed+retry only</option>
						</select>
					</div>
					<div class="flex-1 overflow-auto p-4">
						<div class="space-y-2">
							${filteredEvents.length === 0 ? html`
								<div class="text-xs text-muted-foreground">No events yet</div>
							` : filteredEvents.map(event => html`
								<div class="text-xs border-b border-border pb-2">
									<div class="text-muted-foreground">${event.timestamp}</div>
									<div class="${event.type === "failed" ? "text-red-500" : event.type === "completed" ? "text-green-500" : ""}">
										${event.type === "completed" ? "✓" : event.type === "failed" ? "✗" : event.type === "retry" ? "⟳" : "→"} ${event.message}
									</div>
								</div>
							`)}
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
	
	render(appHtml, app);
}

// ============================================================================
// INIT
// ============================================================================
async function initApp() {
	startPolling();
	connectEventStream();
	renderApp();
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
	stopPolling();
	if (eventsSource) eventsSource.close();
	if (logsSource) logsSource.close();
});

initApp();
