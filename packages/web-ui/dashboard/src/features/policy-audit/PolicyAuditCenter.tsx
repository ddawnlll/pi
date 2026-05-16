/**
 * PolicyAndAuditCenter — P11.R (Policy and Audit Center UI)
 *
 * Dashboard surface for permissions, protected systems, approvals,
 * policy decisions, denied actions, audit timeline, and rollback pointers.
 */

import {
	Shield,
	ShieldCheck,
	ShieldAlert,
	ShieldX,
	Clock,
	User,
	Target,
	Filter,
	Loader2,
	CheckCircle,
	XCircle,
	AlertTriangle,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACCENT = "text-stone-600 dark:text-stone-400";
const OK = "text-green-500";
const WARN = "text-amber-500";
const ERR = "text-red-500";
const INFO = "text-blue-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuditCategory = "orchestrator" | "plan_intake" | "optimizer" | "extension" | "skill" | "memory" | "policy" | "registry" | "self_improvement" | "dashboard" | "approval";

type AuditSeverity = "info" | "warning" | "error" | "critical";

type AuditOutcome = "allowed" | "denied" | "pending_approval" | "approved" | "rejected" | "rolled_back" | "completed" | "failed" | "skipped";

interface AuditEvent {
	id: string;
	category: AuditCategory;
	severity: AuditSeverity;
	outcome: AuditOutcome;
	timestamp: string;
	actor: string;
	target: string;
	project?: string;
	phase?: string;
	message: string;
	approvalId?: string;
}

interface PolicySummary {
	totalEvents: number;
	totalApproved: number;
	totalDenied: number;
	totalPending: number;
	protectedSystems: string[];
	activeApprovals: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PolicyAuditCenterProps {
	className?: string;
}

export const PolicyAuditCenter: FC<PolicyAuditCenterProps> = ({ className = "" }) => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [summary, setSummary] = useState<PolicySummary | null>(null);
	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [selectedCategory, setSelectedCategory] = useState<AuditCategory | "all">("all");
	const [selectedOutcome, setSelectedOutcome] = useState<AuditOutcome | "all">("all");
	const [activeTab, setActiveTab] = useState<"timeline" | "policy" | "protected">("timeline");

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const resp = await fetch("/api/policy-audit/events?limit=100", {
				signal: AbortSignal.timeout(5000),
			});
			if (resp.ok) {
				const data = await resp.json();
				setSummary(data.summary);
				setEvents(data.events ?? []);
			} else {
				setSummary({
					totalEvents: 0,
					totalApproved: 0,
					totalDenied: 0,
					totalPending: 0,
					protectedSystems: ["Executor", "Validator", "Policy Engine", "Queue Manager", "Planner", "Orchestrator Runtime"],
					activeApprovals: 0,
				});
				setEvents([]);
			}
		} catch {
			setSummary({
				totalEvents: 0,
				totalApproved: 0,
				totalDenied: 0,
				totalPending: 0,
				protectedSystems: ["Executor", "Validator", "Policy Engine", "Queue Manager", "Planner", "Orchestrator Runtime"],
				activeApprovals: 0,
			});
			setEvents([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const filteredEvents = useMemo(() => {
		return events.filter((e) => {
			if (selectedCategory !== "all" && e.category !== selectedCategory) return false;
			if (selectedOutcome !== "all" && e.outcome !== selectedOutcome) return false;
			return true;
		});
	}, [events, selectedCategory, selectedOutcome]);

	if (loading) {
		return (
			<div className={`${SURF} h-full flex items-center justify-center gap-3 ${className}`}>
				<Loader2 size={18} className="animate-spin text-stone-400" />
				<span className={`text-xs ${MUT}`}>Loading...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
				<AlertTriangle size={28} className={ERR} />
				<p className={`text-xs ${MUT}`}>{error}</p>
				<button
					onClick={fetchData}
					className={`text-xs px-3 py-1.5 rounded-lg border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div className={`${SURF} h-full flex flex-col ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b ${BORD}">
				<div className="flex items-center gap-2">
					<Shield size={16} className={ACCENT} />
					<h3 className={`text-xs font-semibold ${TXT}`}>Policy &amp; Audit</h3>
				</div>
				<button
					onClick={fetchData}
					className={`text-xs px-2 py-1 rounded border ${BORD} ${ACCENT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					<RefreshCw size={12} />
				</button>
			</div>

			{/* Tabs */}
			<div className="flex border-b ${BORD} px-4">
				{(["timeline", "policy", "protected"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`text-xs px-3 py-2 border-b-2 transition-colors capitalize ${
							activeTab === tab
								? `${ACCENT} border-stone-600 dark:border-stone-400`
								: `${MUT} border-transparent hover:${ACCENT}`
						}`}
					>
						{tab}
					</button>
				))}
			</div>

			<div className="flex-1 overflow-y-auto">
				{activeTab === "timeline" && (
					<>
						{/* Summary */}
						{summary && (
							<div className={`p-3 border-b ${BORD} grid grid-cols-4 gap-3`}>
								<div>
									<span className={`text-[10px] ${MUT}`}>Total Events</span>
									<p className={`text-sm font-semibold ${TXT}`}>{summary.totalEvents}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Approved</span>
									<p className={`text-sm font-semibold ${OK}`}>{summary.totalApproved}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Denied</span>
									<p className={`text-sm font-semibold ${ERR}`}>{summary.totalDenied}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Pending</span>
									<p className={`text-sm font-semibold ${WARN}`}>{summary.totalPending}</p>
								</div>
							</div>
						)}

						{/* Filters */}
						<div className={`flex gap-2 p-3 border-b ${BORD}`}>
							<div className="flex items-center gap-1.5">
								<Filter size={12} className={MUT} />
								<select
									value={selectedCategory}
									onChange={(e) => setSelectedCategory(e.target.value as AuditCategory | "all")}
									className={`text-xs bg-transparent border ${BORD} rounded px-1.5 py-1 ${TXT}`}
								>
									<option value="all">All Categories</option>
									{["orchestrator", "plan_intake", "optimizer", "extension", "skill", "memory", "policy", "registry", "self_improvement", "dashboard", "approval"].map((c) => (
										<option key={c} value={c}>{c.replace("_", " ")}</option>
									))}
								</select>
							</div>
							<select
								value={selectedOutcome}
								onChange={(e) => setSelectedOutcome(e.target.value as AuditOutcome | "all")}
								className={`text-xs bg-transparent border ${BORD} rounded px-1.5 py-1 ${TXT}`}
							>
								<option value="all">All Outcomes</option>
								{["allowed", "denied", "pending_approval", "approved", "rejected", "completed", "failed"].map((o) => (
									<option key={o} value={o}>{o.replace("_", " ")}</option>
								))}
							</select>
						</div>

						{/* Events list */}
						<div className="divide-y ${BORD}">
							{filteredEvents.length === 0 ? (
								<div className="flex flex-col items-center justify-center gap-2 py-8">
									<Shield size={24} className={MUT} />
									<p className={`text-xs ${MUT}`}>No events found.</p>
								</div>
							) : (
								filteredEvents.map((event) => (
									<div key={event.id} className={`p-3 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}>
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-1.5">
													{event.outcome === "denied" || event.outcome === "rejected" ? (
														<ShieldX size={12} className={ERR} />
													) : event.outcome === "approved" || event.outcome === "allowed" ? (
														<ShieldCheck size={12} className={OK} />
													) : event.outcome === "pending_approval" ? (
														<Clock size={12} className={WARN} />
													) : (
														<Shield size={12} className={MUT} />
													)}
													<span className={`text-xs font-medium ${TXT}`}>
														{event.category.replace("_", " ")}
													</span>
													<span className={`text-[10px] ${MUT}`}>&middot;</span>
													<span className={`text-[10px] ${
														event.severity === "critical" || event.severity === "error"
															? ERR
															: event.severity === "warning"
																? WARN
																: MUT
													}`}>
														{event.severity}
													</span>
												</div>
												<p className={`text-xs ${TXT} mt-0.5`}>{event.message}</p>
												<div className="flex items-center gap-2 mt-1">
													<User size={10} className={MUT} />
													<span className={`text-[10px] ${MUT}`}>{event.actor}</span>
													<Target size={10} className={MUT} />
													<span className={`text-[10px] ${MUT}`}>{event.target}</span>
													<Clock size={10} className={MUT} />
													<span className={`text-[10px] ${MUT}`}>
														{new Date(event.timestamp).toLocaleString()}
													</span>
												</div>
											</div>
											<span className={`text-[10px] px-1.5 py-0.5 rounded ${
												event.outcome === "denied" || event.outcome === "rejected"
													? `${ERR} bg-red-50 dark:bg-red-900/20`
													: event.outcome === "approved" || event.outcome === "allowed"
														? `${OK} bg-green-50 dark:bg-green-900/20`
														: `${WARN} bg-amber-50 dark:bg-amber-900/20`
											}`}>
												{event.outcome.replace("_", " ")}
											</span>
										</div>
									</div>
								))
							)}
						</div>
					</>
				)}

				{activeTab === "policy" && (
					<div className="p-4 space-y-3">
						{summary && (
							<>
								<div className={`p-3 rounded-lg border ${BORD}`}>
									<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider mb-2`}>
										Permission Summary
									</h4>
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<span className={`text-xs ${TXT}`}>Approved Actions</span>
											<span className={`text-xs font-semibold ${OK}`}>{summary.totalApproved}</span>
										</div>
										<div className="flex items-center justify-between">
											<span className={`text-xs ${TXT}`}>Denied Actions</span>
											<span className={`text-xs font-semibold ${ERR}`}>{summary.totalDenied}</span>
										</div>
										<div className="flex items-center justify-between">
											<span className={`text-xs ${TXT}`}>Pending Approvals</span>
											<span className={`text-xs font-semibold ${WARN}`}>{summary.activeApprovals}</span>
										</div>
									</div>
								</div>

								<div className={`p-3 rounded-lg border ${BORD}`}>
									<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider mb-2`}>
										Default Policy
									</h4>
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<ShieldX size={12} className={ERR} />
											<span className={`text-xs ${TXT}`}>Extensions: Deny by default</span>
										</div>
										<div className="flex items-center gap-2">
											<ShieldX size={12} className={ERR} />
											<span className={`text-xs ${TXT}`}>Skills: Deny by default</span>
										</div>
										<div className="flex items-center gap-2">
											<Clock size={12} className={WARN} />
											<span className={`text-xs ${TXT}`}>Self-modification: Requires explicit approval</span>
										</div>
									</div>
								</div>
							</>
						)}
					</div>
				)}

				{activeTab === "protected" && (
					<div className="p-4 space-y-3">
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Protected Systems
							</h4>
							<p className={`text-xs ${MUT} mb-3`}>
								Changes to these systems require explicit self-modification approval.
							</p>
							<div className="space-y-2">
								{(summary?.protectedSystems ?? [
									"Executor",
									"Validator",
									"Policy Engine",
									"Queue Manager",
									"Planner",
									"Orchestrator Runtime",
								]).map((sys) => (
									<div key={sys} className={`p-2 rounded-lg border ${BORD} flex items-center gap-2`}>
										<ShieldAlert size={14} className={ERR} />
										<div>
											<p className={`text-xs font-medium ${TXT}`}>{sys}</p>
											<p className={`text-[10px] ${MUT}`}>Self-modification approval required</p>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
