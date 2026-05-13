import { useMemo, useState } from "react";
import { Terminal, Cpu, Timer, Clock, Filter, X, ChevronDown, Search } from "lucide-react";
import type { ToolCallEvent } from "../hooks/useToolCallEvents";
import { formatElapsed } from "../utils/format";

// ─── constants ───────────────────────────────────────────────────────────────

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-700 dark:text-stone-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Extract a short summary from the tool input (first 60 chars) */
function toolSummary(input: string): string {
	if (!input) return "\u2014";
	try {
		const parsed = JSON.parse(input);
		const keys = Object.keys(parsed);
		if (keys.length === 0) return "{}";
		// Show key=value for single-key, or key list for multi-key
		if (keys.length === 1) {
			const val = parsed[keys[0]];
			const str = typeof val === "string" ? val : JSON.stringify(val);
			return `${keys[0]}=${str.slice(0, 40)}`;
		}
		return keys.join(", ").slice(0, 60);
	} catch {
		// Not valid JSON, show raw input truncated
		return input.slice(0, 60);
	}
}

/** Determine status label and color for a tool call event */
function toolCallStatus(event: ToolCallEvent): {
	label: string;
	color: string;
	bg: string;
	darkColor: string;
	darkBg: string;
} {
	if (event.errorMessage) {
		return { label: "Error", color: "text-red-600", bg: "bg-red-50", darkColor: "dark:text-red-400", darkBg: "dark:bg-red-950/40" };
	}
	if (event.result !== undefined && event.result !== "error") {
		return { label: "Done", color: "text-emerald-600", bg: "bg-emerald-50", darkColor: "dark:text-emerald-400", darkBg: "dark:bg-emerald-950/40" };
	}
	if (event.duration !== null) {
		return { label: "Done", color: "text-emerald-600", bg: "bg-emerald-50", darkColor: "dark:text-emerald-400", darkBg: "dark:bg-emerald-950/40" };
	}
	return { label: "Running", color: "text-blue-600", bg: "bg-blue-50", darkColor: "dark:text-blue-400", darkBg: "dark:bg-blue-950/40" };
}

/** Display-friendly tool name (strip mcp: prefix for display) */
function displayToolName(toolName: string): string {
	if (toolName.startsWith("mcp:")) {
		const parts = toolName.split(":");
		// mcp:server:toolName → server/toolName
		return `${parts[1]}/${parts.slice(2).join(":")}`;
	}
	return toolName;
}

/** Format a millisecond timestamp to hh:mm:ss */
function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// ─── component ───────────────────────────────────────────────────────────────

interface CommandsPanelProps {
	toolCalls: ToolCallEvent[];
	workspaceIds?: string[];
}

export function CommandsPanel({ toolCalls, workspaceIds = [] }: CommandsPanelProps) {
	const [filterWorkspace, setFilterWorkspace] = useState<string | null>(null);
	const [filterTool, setFilterTool] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");

	// Derive unique workspace IDs and tool names for filter dropdowns
	const allWorkspaceIds = useMemo(() => {
		const set = new Set(workspaceIds);
		for (const tc of toolCalls) {
			if (tc.workspaceId) set.add(tc.workspaceId);
		}
		return Array.from(set).sort();
	}, [toolCalls, workspaceIds]);

	const allToolNames = useMemo(() => {
		const set = new Set<string>();
		for (const tc of toolCalls) {
			// Show base tool name for filtering (without mcp: prefix)
			const display = tc.isMcp ? `mcp:${tc.mcpServer ?? "?"}` : tc.toolName;
			set.add(display);
		}
		return Array.from(set).sort();
	}, [toolCalls]);

	// Filter tool calls
	const filtered = useMemo(() => {
		let result = toolCalls;

		if (filterWorkspace) {
			result = result.filter((tc) => tc.workspaceId === filterWorkspace);
		}

		if (filterTool) {
			result = result.filter((tc) => {
				if (filterTool.startsWith("mcp:")) {
					return tc.isMcp;
				}
				return tc.toolName === filterTool;
			});
		}

		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			result = result.filter(
				(tc) =>
					tc.toolName.toLowerCase().includes(q) ||
					tc.input.toLowerCase().includes(q) ||
					tc.workspaceId?.toLowerCase().includes(q),
			);
		}

		return result;
	}, [toolCalls, filterWorkspace, filterTool, searchQuery]);

	// ── render ──

	return (
		<div className="flex flex-col gap-0 overflow-hidden" style={{ maxHeight: "70vh" }}>
			{/* ── filters toolbar ── */}
			<div className={`shrink-0 flex items-center gap-2 px-1 pb-3 flex-wrap`}>
				{/* workspace filter */}
				<div className="relative">
					<select
						value={filterWorkspace ?? ""}
						onChange={(e) => setFilterWorkspace(e.target.value || null)}
						className={`appearance-none text-xs pl-7 pr-6 py-1.5 rounded-md border ${BORD} ${SURF} ${TXT} cursor-pointer outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600`}
					>
						<option value="">All workspaces</option>
						{allWorkspaceIds.map((id) => (
							<option key={id} value={id}>{id}</option>
						))}
					</select>
					<Cpu size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${MUT}`} />
					<ChevronDown size={10} className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${MUT}`} />
				</div>

				{/* tool type filter */}
				<div className="relative">
					<select
						value={filterTool ?? ""}
						onChange={(e) => setFilterTool(e.target.value || null)}
						className={`appearance-none text-xs pl-7 pr-6 py-1.5 rounded-md border ${BORD} ${SURF} ${TXT} cursor-pointer outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600`}
					>
						<option value="">All tools</option>
						{allToolNames.map((name) => (
							<option key={name} value={name}>{name}</option>
						))}
					</select>
					<Terminal size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${MUT}`} />
					<ChevronDown size={10} className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${MUT}`} />
				</div>

				{/* search */}
				<div className="relative flex-1 min-w-[120px]">
					<input
						type="text"
						placeholder="Search..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className={`w-full text-xs pl-7 pr-2 py-1.5 rounded-md border ${BORD} ${SURF} ${TXT} outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600 placeholder:text-stone-400 dark:placeholder:text-stone-500`}
					/>
					<Search size={12} className={`absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${MUT}`} />
				</div>

				{/* clear filters */}
				{(filterWorkspace || filterTool || searchQuery) && (
					<button
						onClick={() => { setFilterWorkspace(null); setFilterTool(null); setSearchQuery(""); }}
						className={`flex items-center gap-1 text-xs ${MUT} hover:text-stone-600 dark:hover:text-stone-300 px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
					>
						<X size={11} /> Clear
					</button>
				)}

				<span className={`text-xs ${MUT} ml-auto`}>
					{filtered.length} {filtered.length === 1 ? "command" : "commands"}
				</span>
			</div>

			{/* ── table ── */}
			{filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center h-40 gap-2 text-stone-300 dark:text-stone-600">
					<Terminal size={24} strokeWidth={1.2} />
					<p className="text-xs">No commands found</p>
					{toolCalls.length === 0 && (
						<p className="text-[11px] text-stone-300 dark:text-stone-600">
							Tool calls will appear here as the plan executes
						</p>
					)}
				</div>
			) : (
				<div
					className={`overflow-y-auto border ${BORD} rounded-lg ${SURF}`}
					style={{ maxHeight: "50vh" }}
				>
					<table className="w-full text-xs">
						<thead className={`sticky top-0 ${SURF} border-b ${BORD}`}>
							<tr className="text-left">
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Time</th>
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Workspace</th>
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Tool</th>
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Summary</th>
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Status</th>
								<th className={`px-3 py-2 font-medium ${MUT} text-[10px] uppercase tracking-wider`}>Duration</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((tc, i) => {
								const status = toolCallStatus(tc);
								return (
									<tr
										key={`${tc.timestamp}-${tc.toolName}-${i}`}
										className={`border-b ${BORD} last:border-b-0 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors`}
									>
										{/* Time */}
										<td className={`px-3 py-2.5 whitespace-nowrap ${MUT}`}>
											<span className="flex items-center gap-1">
												<Clock size={10} />
												{formatTime(tc.timestamp)}
											</span>
										</td>

										{/* Workspace */}
										<td className={`px-3 py-2.5 ${TXT}`}>
											{tc.workspaceId ? (
												<span className="font-mono text-[10px]">{tc.workspaceId.slice(0, 12)}</span>
											) : (
												<span className={MUT}>global</span>
											)}
										</td>

										{/* Tool */}
										<td className="px-3 py-2.5">
											{tc.isMcp ? (
												<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
													{displayToolName(tc.toolName)}
												</span>
											) : (
												<span className={`font-mono text-[10px] ${TXT}`}>
													{tc.toolName}
												</span>
											)}
										</td>

										{/* Summary */}
										<td className={`px-3 py-2.5 ${TXT} max-w-[200px] truncate`} title={tc.input}>
											{toolSummary(tc.input)}
										</td>

										{/* Status */}
										<td className="px-3 py-2.5">
											<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${status.color} ${status.bg} ${status.darkColor} ${status.darkBg}`}>
												{status.label}
											</span>
										</td>

										{/* Duration */}
										<td className={`px-3 py-2.5 whitespace-nowrap ${MUT}`}>
											{tc.duration !== null ? (
												<span className="flex items-center gap-1">
													<Timer size={10} />
													{formatElapsed(tc.duration)}
												</span>
											) : (
												<span className="text-blue-500 dark:text-blue-400">\u2022</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
