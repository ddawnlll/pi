/**
 * TrustDashboard — P11.T (Trust Dashboard UI)
 *
 * Dashboard surface for trust metrics, policy stops, safety interventions,
 * approval requests, and overall trust health of the platform.
 *
 * Data sourced from the PlatformAuditLedger via /api/trust/* endpoints.
 */

import {
	Shield,
	ShieldCheck,
	ShieldAlert,
	ShieldX,
	Activity,
	User,
	Target,
	Filter,
	Loader2,
	AlertTriangle,
	RefreshCw,
	TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import type { FC } from "react";

const OK = "text-emerald-600 dark:text-emerald-400";
const WARN = "text-amber-500";
const ERR = "text-red-500";
const INFO = "text-blue-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrustMetrics {
	totalAuditEntries: number;
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;
	totalApproved: number;
	totalDenied: number;
	totalPending: number;
	eventsByCategory: Record<string, number>;
	eventsByOutcome: Record<string, number>;
	eventsBySeverity: Record<string, number>;
	topActors: Array<{ actor: string; count: number }>;
	protectedSystems: string[];
	trustScore: number;
	trustScoreHistory: Array<{ date: string; score: number }>;
}

interface TrustEvent {
	id: string;
	category: string;
	severity: string;
	outcome: string;
	timestamp: string;
	actor: string;
	target: string;
	message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSeverityColor(severity: string): string {
	switch (severity) {
		case "critical":
		case "error":
			return ERR;
		case "warning":
			return WARN;
		default:
			return MUT;
	}
}

function getOutcomeBadge(outcome: string): { color: string; bg: string } {
	switch (outcome) {
		case "denied":
		case "rejected":
			return { color: ERR, bg: "bg-red-50 dark:bg-red-900/20" };
		case "approved":
		case "allowed":
			return { color: OK, bg: "bg-emerald-50 dark:bg-emerald-900/20" };
		case "pending_approval":
			return { color: WARN, bg: "bg-amber-50 dark:bg-amber-900/20" };
		case "failed":
			return { color: ERR, bg: "bg-red-50 dark:bg-red-900/20" };
		default:
			return { color: MUT, bg: "bg-stone-50 dark:bg-stone-900/20" };
	}
}

function getTrustScoreColor(score: number): string {
	if (score >= 80) return OK;
	if (score >= 50) return WARN;
	return ERR;
}

function getTrustScoreLabel(score: number): string {
	if (score >= 90) return "Excellent";
	if (score >= 80) return "Good";
	if (score >= 60) return "Fair";
	if (score >= 40) return "Poor";
	return "Critical";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TrustDashboardProps {
	className?: string;
}

export const TrustDashboard: FC<TrustDashboardProps> = ({ className = "" }) => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [metrics, setMetrics] = useState<TrustMetrics | null>(null);
	const [events, setEvents] = useState<TrustEvent[]>([]);
	const [activeTab, setActiveTab] = useState<"overview" | "history" | "actors" | "protected">("overview");

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [metricsResp, eventsResp] = await Promise.all([
				fetch("/api/trust/metrics", { signal: AbortSignal.timeout(5000) }),
				fetch("/api/trust/events?limit=100", { signal: AbortSignal.timeout(5000) }),
			]);

			if (metricsResp.ok) {
				const metricsData = await metricsResp.json();
				setMetrics(metricsData);
			} else {
				setMetrics(null);
			}

			if (eventsResp.ok) {
				const eventsData = await eventsResp.json();
				setEvents(eventsData.events ?? []);
			} else {
				setEvents([]);
			}
		} catch {
			setMetrics(null);
			setEvents([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Derived: category breakdown sorted by count descending
	const categoryBreakdown = useMemo(() => {
		if (!metrics) return [];
		return Object.entries(metrics.eventsByCategory)
			.sort((a, b) => b[1] - a[1])
			.map(([category, count]) => ({ category, count }));
	}, [metrics]);

	// Derived: event counts by outcome
	const outcomeBreakdown = useMemo(() => {
		if (!metrics) return [];
		return Object.entries(metrics.eventsByOutcome)
			.sort((a, b) => b[1] - a[1])
			.map(([outcome, count]) => ({ outcome, count }));
	}, [metrics]);

	if (loading) {
		return (
			<div className={`${SURF} h-full flex items-center justify-center gap-3 ${className}`}>
				<Loader2 size={18} className="animate-spin text-stone-400" />
				<span className={`text-xs ${MUT}`}>Loading trust data...</span>
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
			<div className={`flex items-center justify-between px-4 py-3 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<Shield size={16} className={ACCENT} />
					<h3 className={`text-xs font-semibold ${TXT}`}>Trust Dashboard</h3>
				</div>
				<button
					onClick={fetchData}
					className={`text-xs px-2 py-1 rounded border ${BORD} ${ACCENT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					<RefreshCw size={12} />
				</button>
			</div>

			{/* Trust Score Banner */}
			{metrics && (
				<div className={`mx-4 mt-3 p-3 rounded-lg border ${BORD} flex items-center gap-4`}>
					<div className={`flex flex-col items-center justify-center w-16 h-16 rounded-full border-2 ${getTrustScoreColor(metrics.trustScore)}`}>
						<span className={`text-lg font-bold ${getTrustScoreColor(metrics.trustScore)}`}>
							{metrics.trustScore}
						</span>
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<TrendingUp size={14} className={getTrustScoreColor(metrics.trustScore)} />
							<span className={`text-sm font-semibold ${TXT}`}>
								{getTrustScoreLabel(metrics.trustScore)}
							</span>
						</div>
						<p className={`text-xs ${MUT} mt-0.5`}>
							Based on {metrics.totalAuditEntries} audit entries
						</p>
					</div>
				</div>
			)}

			{/* Summary Cards */}
			{metrics && (
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
					<div className={`p-3 rounded-lg border ${BORD}`}>
						<div className="flex items-center gap-1.5 mb-1">
							<Activity size={12} className={ACCENT} />
							<span className={`text-xs ${MUT}`}>Audit Entries</span>
						</div>
						<p className={`text-lg font-semibold ${TXT}`}>{metrics.totalAuditEntries}</p>
					</div>
					<div className={`p-3 rounded-lg border ${BORD}`}>
						<div className="flex items-center gap-1.5 mb-1">
							<ShieldAlert size={12} className={ERR} />
							<span className={`text-xs ${MUT}`}>Safety Interventions</span>
						</div>
						<p className={`text-lg font-semibold ${ERR}`}>{metrics.safetyInterventions}</p>
					</div>
					<div className={`p-3 rounded-lg border ${BORD}`}>
						<div className="flex items-center gap-1.5 mb-1">
							<Shield size={12} className={WARN} />
							<span className={`text-xs ${MUT}`}>Policy Stops</span>
						</div>
						<p className={`text-lg font-semibold ${WARN}`}>{metrics.policyStops}</p>
					</div>
					<div className={`p-3 rounded-lg border ${BORD}`}>
						<div className="flex items-center gap-1.5 mb-1">
							<ShieldCheck size={12} className={OK} />
							<span className={`text-xs ${MUT}`}>Approvals</span>
						</div>
						<p className={`text-lg font-semibold ${OK}`}>{metrics.totalApproved}</p>
					</div>
				</div>
			)}

			{/* Tabs */}
			<div className={`flex border-b ${BORD} px-4`}>
				{(["overview", "history", "actors", "protected"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`text-xs px-3 py-2 border-b-2 transition-colors capitalize ${
							activeTab === tab
								? `${ACCENT} border-stone-600 dark:border-stone-400`
								: `${MUT} border-transparent hover:${ACCENT}`
						}`}
					>
						{tab === "overview" ? "Event Timeline" : tab}
					</button>
				))}
			</div>

			<div className="flex-1 overflow-y-auto">
				{/* Tab: Overview / Event Timeline */}
				{activeTab === "overview" && (
					<>
						{/* Category breakdown */}
						{categoryBreakdown.length > 0 && (
							<div className={`p-3 border-b ${BORD}`}>
								<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
									Events by Category
								</h4>
								<div className="space-y-1.5">
									{categoryBreakdown.map(({ category, count }) => {
										const total = metrics?.totalAuditEntries ?? 1;
										const pct = Math.round((count / total) * 100);
										return (
											<div key={category} className="flex items-center gap-2">
												<span className={`text-xs ${MUT} w-28 truncate capitalize`}>
													{category.replace(/_/g, " ")}
												</span>
												<div className="flex-1 h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
													<div
														className="h-full rounded-full bg-stone-400 dark:bg-stone-500"
														style={{ width: `${pct}%` }}
													/>
												</div>
												<span className={`text-xs font-medium ${TXT} w-8 text-right`}>
													{count}
												</span>
											</div>
										);
									})}
								</div>
							</div>
						)}

						{/* Outcome breakdown */}
						{outcomeBreakdown.length > 0 && (
							<div className={`p-3 border-b ${BORD}`}>
								<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
									Events by Outcome
								</h4>
								<div className="space-y-1.5">
									{outcomeBreakdown.map(({ outcome, count }) => {
										const badge = getOutcomeBadge(outcome);
										return (
											<div key={outcome} className="flex items-center justify-between">
												<span className={`text-xs capitalize ${TXT}`}>
													{outcome.replace(/_/g, " ")}
												</span>
												<span className={`text-xs font-medium ${badge.color}`}>{count}</span>
											</div>
										);
									})}
								</div>
							</div>
						)}

						{/* Recent events */}
						<div className={`divide-y ${BORD}`}>
							{events.length === 0 ? (
								<div className="flex flex-col items-center justify-center gap-2 py-8">
									<Shield size={24} className={MUT} />
									<p className={`text-xs ${MUT}`}>No trust events recorded yet.</p>
								</div>
							) : (
								events.map((event) => {
									const badge = getOutcomeBadge(event.outcome);
									return (
										<div key={event.id} className={`p-3 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}>
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-1.5">
														{event.outcome === "denied" || event.outcome === "rejected" ? (
															<ShieldX size={12} className={ERR} />
														) : event.outcome === "approved" || event.outcome === "allowed" ? (
															<ShieldCheck size={12} className={OK} />
														) : event.outcome === "pending_approval" ? (
															<ShieldAlert size={12} className={WARN} />
														) : (
															<Shield size={12} className={MUT} />
														)}
														<span className={`text-xs font-medium ${TXT}`}>
															{event.category.replace(/_/g, " ")}
														</span>
														<span className={`text-xs ${MUT}`}>&middot;</span>
														<span className={`text-xs ${getSeverityColor(event.severity)}`}>
															{event.severity}
														</span>
													</div>
													<p className={`text-xs ${TXT} mt-0.5`}>{event.message}</p>
													<div className="flex items-center gap-2 mt-1">
														<User size={10} className={MUT} />
														<span className={`text-xs ${MUT}`}>{event.actor}</span>
														<Target size={10} className={MUT} />
														<span className={`text-xs ${MUT}`}>{event.target}</span>
														<Activity size={10} className={MUT} />
														<span className={`text-xs ${MUT}`}>
															{new Date(event.timestamp).toLocaleString()}
														</span>
													</div>
												</div>
												<span className={`text-xs px-1.5 py-0.5 rounded ${badge.color} ${badge.bg}`}>
													{event.outcome.replace(/_/g, " ")}
												</span>
											</div>
										</div>
									);
								})
							)}
						</div>
					</>
				)}

				{/* Tab: History */}
				{activeTab === "history" && (
					<div className="p-4 space-y-3">
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Trust Score History
							</h4>
							<p className={`text-xs ${MUT} mb-3`}>
								Trust score over time (data available when score history is recorded).
							</p>
							{metrics && metrics.trustScoreHistory.length > 0 ? (
								<div className="space-y-1">
									{metrics.trustScoreHistory.map((point, i) => (
										<div key={i} className="flex items-center justify-between">
											<span className={`text-xs ${MUT}`}>{point.date}</span>
											<span className={`text-xs font-semibold ${getTrustScoreColor(point.score)}`}>
												{point.score}
											</span>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col items-center justify-center gap-2 py-6">
									<TrendingUp size={20} className={MUT} />
									<p className={`text-xs ${MUT}`}>
										No history data yet. Trust score will be tracked over time.
									</p>
								</div>
							)}
						</div>

						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Summary
							</h4>
							{metrics && (
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Total Audit Entries</span>
										<span className={`text-xs font-semibold ${TXT}`}>{metrics.totalAuditEntries}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Approved / Allowed</span>
										<span className={`text-xs font-semibold ${OK}`}>{metrics.totalApproved}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Denied / Rejected</span>
										<span className={`text-xs font-semibold ${ERR}`}>{metrics.totalDenied}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Pending Approvals</span>
										<span className={`text-xs font-semibold ${WARN}`}>{metrics.totalPending}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Safety Interventions</span>
										<span className={`text-xs font-semibold ${ERR}`}>{metrics.safetyInterventions}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className={`text-xs ${TXT}`}>Policy Stops</span>
										<span className={`text-xs font-semibold ${WARN}`}>{metrics.policyStops}</span>
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Tab: Actors */}
				{activeTab === "actors" && (
					<div className="p-4 space-y-3">
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Top Actors
							</h4>
							<p className={`text-xs ${MUT} mb-3`}>
								Most active actors triggering audit events.
							</p>
							{metrics && metrics.topActors.length > 0 ? (
								<div className="space-y-2">
									{metrics.topActors.map(({ actor, count }, i) => (
										<div
											key={actor}
											className={`flex items-center gap-3 p-2 rounded-lg border ${BORD}`}
										>
											<span className={`text-xs font-mono font-bold ${MUT} w-5 text-right`}>
												#{i + 1}
											</span>
											<User size={12} className={ACCENT} />
											<div className="flex-1 min-w-0">
												<p className={`text-xs font-medium ${TXT}`}>{actor}</p>
											</div>
											<span className={`text-xs font-semibold ${TXT}`}>{count}</span>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col items-center justify-center gap-2 py-6">
									<User size={20} className={MUT} />
									<p className={`text-xs ${MUT}`}>No actor data available.</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Tab: Protected Systems */}
				{activeTab === "protected" && (
					<div className="p-4 space-y-3">
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-xs font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Protected Systems
							</h4>
							<p className={`text-xs ${MUT} mb-3`}>
								Changes to these systems require explicit self-modification approval.
							</p>
							<div className="space-y-2">
								{(metrics?.protectedSystems ?? [
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
											<p className={`text-xs ${MUT}`}>Self-modification approval required</p>
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
