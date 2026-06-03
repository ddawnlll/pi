/**
 * LocalReadinessPanel — Local Production Readiness Doctor UI panel (25.T).
 *
 * Displays results from the Local Production Readiness Doctor, including
 * environment health, git status, build health, dependency health,
 * config checks, linting/testing setup, and autonomous behavior safeguards.
 *
 * Acceptance Criteria:
 * 1. Shows overall verdict (PASS/WARN/FAIL) with appropriate visual indicator.
 * 2. Lists all checks grouped by category with status badges.
 * 3. Supports loading, empty, error, and data-present states.
 * 4. Evidence-backed diagnostics are shown for failures.
 * 5. Auto-run readiness flag is displayed.
 * 6. All autonomous checks show budget, cooldown, and loop-prevention status.
 * 7. Polling has explicit interval and stop-condition handling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	ExternalLink,
	Loader2,
	RefreshCw,
	Shield,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";

// ─── Style constants ──────────────────────────────────────────────────────────

const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BORD = "border-red-200 dark:border-red-800";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BORD = "border-amber-200 dark:border-amber-800";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const GOOD_BORD = "border-emerald-200 dark:border-emerald-800";
const INFO_BG = "bg-blue-50 dark:bg-blue-900/20";
const INFO_TXT = "text-blue-700 dark:text-blue-300";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReadinessVerdict = "PASS" | "WARN" | "FAIL";

interface ReadinessCheck {
	name: string;
	category: string;
	status: "PASS" | "WARN" | "FAIL";
	message: string;
	details?: string;
	resolution?: string;
}

interface ReadinessReport {
	verdict: ReadinessVerdict;
	checks: ReadinessCheck[];
	byCategory: Record<string, ReadinessCheck[]>;
	passCount: number;
	warnCount: number;
	failCount: number;
	autoRunReady: boolean;
	timestamp: string;
	diagnostics: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = "/api";
const POLL_INTERVAL_MS = 30_000; // 30s polling
const MAX_POLL_COUNT = 20; // max 20 polls (10 minutes)

const CATEGORY_LABELS: Record<string, string> = {
	environment: "Environment",
	git: "Git Status",
	build: "Build Health",
	dependencies: "Dependencies",
	config: "Configuration",
	linting: "Linting & Formatting",
	testing: "Testing",
	autonomous: "Autonomous Behavior",
	infrastructure: "Infrastructure",
	budget: "Budget Controls",
	cooldown: "Cooldowns",
	loop_prevention: "Loop Prevention",
};

const CATEGORY_ORDER: string[] = [
	"environment",
	"git",
	"build",
	"dependencies",
	"config",
	"linting",
	"testing",
	"budget",
	"cooldown",
	"loop_prevention",
	"autonomous",
	"infrastructure",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: string) {
	switch (status) {
		case "PASS":
			return <CheckCircle2 size={14} className={GOOD_TXT} />;
		case "WARN":
			return <AlertTriangle size={14} className={WARN_TXT} />;
		case "FAIL":
			return <XCircle size={14} className={ERR_TXT} />;
		default:
			return <AlertCircle size={14} className={MUT} />;
	}
}

function statusBadge(status: string) {
	switch (status) {
		case "PASS":
			return (
				<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${GOOD_BG} ${GOOD_TXT} border ${GOOD_BORD}`}>
					<CheckCircle2 size={10} />
					PASS
				</span>
			);
		case "WARN":
			return (
				<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${WARN_BG} ${WARN_TXT} border ${WARN_BORD}`}>
					<AlertTriangle size={10} />
					WARN
				</span>
			);
		case "FAIL":
			return (
				<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${ERR_BG} ${ERR_TXT} border ${ERR_BORD}`}>
					<AlertCircle size={10} />
					FAIL
				</span>
			);
		default:
			return null;
	}
}

function verdictConfig(verdict: ReadinessVerdict) {
	switch (verdict) {
		case "PASS":
			return { bg: GOOD_BG, txt: GOOD_TXT, bord: GOOD_BORD, icon: ShieldCheck, label: "Production Ready" };
		case "WARN":
			return { bg: WARN_BG, txt: WARN_TXT, bord: WARN_BORD, icon: ShieldAlert, label: "Needs Review" };
		case "FAIL":
			return { bg: ERR_BG, txt: ERR_TXT, bord: ERR_BORD, icon: ShieldAlert, label: "Not Ready" };
	}
}

// ─── XCircle icon (inline since lucide may not have it) ───────────────────────

function XCircle({ size, className }: { size: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<circle cx="12" cy="12" r="10" />
			<line x1="15" y1="9" x2="9" y2="15" />
			<line x1="9" y1="9" x2="15" y2="15" />
		</svg>
	);
}

// ─── useLocalReadiness hook ───────────────────────────────────────────────────

interface UseLocalReadinessOptions {
	poll?: boolean;
}

function useLocalReadiness({ poll = false }: UseLocalReadinessOptions = {}) {
	const [report, setReport] = useState<ReadinessReport | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const pollCountRef = useRef(0);
	const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fetchReport = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);

			const response = await fetch(`${API_BASE}/local-readiness/check`);
			if (!response.ok) {
				const body = await response.text();
				throw new Error(`Server returned ${response.status}: ${body.slice(0, 200)}`);
			}

			const data: ReadinessReport = await response.json();
			setReport(data);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial fetch
	useEffect(() => {
		fetchReport();
	}, [fetchReport]);

	// Polling with explicit interval and stop-condition handling
	useEffect(() => {
		if (!poll) return;

		pollTimerRef.current = setInterval(() => {
			pollCountRef.current += 1;

			// Stop-condition: max poll count reached
			if (pollCountRef.current >= MAX_POLL_COUNT) {
				if (pollTimerRef.current) {
					clearInterval(pollTimerRef.current);
					pollTimerRef.current = null;
				}
				return;
			}

			fetchReport();
		}, POLL_INTERVAL_MS);

		return () => {
			if (pollTimerRef.current) {
				clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
		};
	}, [poll, fetchReport]);

	return { report, loading, error, refresh: fetchReport };
}

// ─── LocalReadinessPanel component ────────────────────────────────────────────

interface LocalReadinessPanelProps {
	className?: string;
	autoPoll?: boolean;
}

export function LocalReadinessPanel({ className = "", autoPoll = false }: LocalReadinessPanelProps) {
	const { report, loading, error, refresh } = useLocalReadiness({ poll: autoPoll });
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

	const toggleCategory = useCallback((cat: string) => {
		setExpandedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(cat)) {
				next.delete(cat);
			} else {
				next.add(cat);
			}
			return next;
		});
	}, []);

	// Auto-expand categories with failures
	useEffect(() => {
		if (!report) return;
		const catWithIssues = new Set<string>();
		for (const check of report.checks) {
			if (check.status !== "PASS") {
				catWithIssues.add(check.category);
			}
		}
		setExpandedCategories(catWithIssues);
	}, [report]);

	const verdict = report ? verdictConfig(report.verdict) : null;
	const VerdictIcon = verdict?.icon ?? Shield;

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
				<h3 className={`text-sm font-semibold ${TXT} flex items-center gap-2`}>
					<Activity size={14} className="text-stone-500" />
					Local Production Readiness
				</h3>
				<div className="flex items-center gap-2">
					{loading && (
						<Loader2 size={12} className="animate-spin text-stone-400" />
					)}
					<button
						onClick={refresh}
						disabled={loading}
						className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${
							loading
								? `${MUT} cursor-not-allowed`
								: `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
						}`}
						title="Refresh"
					>
						<RefreshCw size={11} className={loading ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
			</div>

			{/* Content */}
			<div className="p-3">
				{/* Loading state */}
				{loading && !report && (
					<div className="flex flex-col items-center justify-center gap-2 py-6">
						<Loader2 size={24} className="animate-spin text-stone-400" />
						<p className={`text-sm ${MUT}`}>Running production readiness checks...</p>
					</div>
				)}

				{/* Error state */}
				{error && !loading && (
					<div className={`flex flex-col items-center justify-center gap-3 py-6 ${ERR_TXT}`}>
						<AlertCircle size={24} />
						<p className="text-sm font-medium">Failed to check readiness</p>
						<p className={`text-xs ${MUT} text-center max-w-md`}>{error}</p>
						<button
							onClick={refresh}
							className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
						>
							<RefreshCw size={11} />
							Retry
						</button>
					</div>
				)}

				{/* Empty state */}
				{!loading && !error && !report && (
					<div className="flex flex-col items-center justify-center gap-2 py-6">
						<Activity size={24} className="text-stone-300 dark:text-stone-600" />
						<p className={`text-sm ${MUT}`}>No readiness data available</p>
						<p className={`text-xs ${MUT} text-center max-w-sm`}>
							Run the local production readiness doctor to check if your development environment is
							ready for production execution.
						</p>
						<button
							onClick={refresh}
							className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] mt-1`}
						>
							<RefreshCw size={11} />
							Run Checks
						</button>
					</div>
				)}

				{/* Data state */}
				{report && !loading && (
					<div className="space-y-3">
						{/* Verdict banner */}
						{verdict && (
							<div className={`flex items-center gap-2 px-3 py-2 rounded border ${verdict.bg} ${verdict.txt} ${verdict.bord}`}>
								<VerdictIcon size={18} />
								<div className="flex-1">
									<div className="text-sm font-semibold">{verdict.label}</div>
									<div className="text-xs opacity-80">
										{report.passCount} passed &middot; {report.warnCount} warnings &middot;{" "}
										{report.failCount} failed
									</div>
								</div>
								<div className="text-right">
									<div className={`text-xs font-semibold font-mono ${verdict.txt}`}>
										{report.verdict}
									</div>
									<div className={`text-xs ${MUT}`}>
										{report.autoRunReady ? "Auto-run ready" : "Auto-run blocked"}
									</div>
								</div>
							</div>
						)}

						{/* Timestamp */}
						<div className={`flex items-center gap-1.5 text-xs ${MUT}`}>
							<Clock size={10} />
							Last checked: {new Date(report.timestamp).toLocaleString()}
						</div>

						{/* Checks by category */}
						{report.diagnostics.length > 0 && (
							<div className={`rounded-md p-2 border ${WARN_BORD} ${WARN_BG}`}>
								<div className={`text-xs font-semibold uppercase tracking-wider ${WARN_TXT} mb-1`}>
									Diagnostics
								</div>
								<ul className="space-y-0.5">
									{report.diagnostics.slice(0, 5).map((d, i) => (
										<li key={i} className={`text-xs ${WARN_TXT} flex items-start gap-1`}>
											<span>&bull;</span>
											<span>{d.length > 120 ? d.slice(0, 120) + "..." : d}</span>
										</li>
									))}
									{report.diagnostics.length > 5 && (
										<li className={`text-xs ${MUT}`}>
											...and {report.diagnostics.length - 5} more diagnostic(s)
										</li>
									)}
								</ul>
							</div>
						)}

						{/* Category groups */}
						{CATEGORY_ORDER.filter((cat) => report.byCategory[cat]?.length > 0).map((cat) => {
							const checks = report.byCategory[cat] ?? [];
							const isExpanded = expandedCategories.has(cat);
							const catPassCount = checks.filter((c) => c.status === "PASS").length;
							const catFailCount = checks.filter((c) => c.status === "FAIL").length;
							const catWarnCount = checks.filter((c) => c.status === "WARN").length;

							return (
								<div key={cat} className={`rounded-md border ${BORD} overflow-hidden`}>
									{/* Category header */}
									<button
										onClick={() => toggleCategory(cat)}
										className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors text-left`}
									>
										{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
										<span className="flex-1">{CATEGORY_LABELS[cat] ?? cat}</span>
										{catFailCount > 0 && (
											<span className={`text-xs font-semibold ${ERR_TXT} ml-1`}>
												{catFailCount} fail
											</span>
										)}
										{catWarnCount > 0 && (
											<span className={`text-xs font-semibold ${WARN_TXT} ml-1`}>
												{catWarnCount} warn
											</span>
										)}
										{catPassCount === checks.length && (
											<CheckCircle2 size={11} className={GOOD_TXT} />
										)}
									</button>

									{/* Category checks */}
									{isExpanded && (
										<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
											{checks.map((check, idx) => (
												<div key={`${cat}-${idx}`} className="px-3 py-2">
													<div className="flex items-start gap-2">
														<div className="mt-0.5 shrink-0">
															{statusIcon(check.status)}
														</div>
														<div className="flex-1 min-w-0">
															<div className={`text-xs font-medium ${TXT} flex items-center gap-1.5 flex-wrap`}>
																{check.name}
																{statusBadge(check.status)}
															</div>
															<p className={`text-xs ${MUT} mt-0.5`}>
																{check.message}
															</p>
															{check.details && (
																<details className="mt-1">
																	<summary className={`text-xs ${ACC_TXT} cursor-pointer hover:underline`}>
																		Details
																	</summary>
																	<p className={`text-xs ${MUT} mt-1 whitespace-pre-wrap`}>
																		{check.details}
																	</p>
																</details>
															)}
															{check.resolution && check.status !== "PASS" && (
																<div className={`mt-1 text-xs ${ACC_TXT} flex items-start gap-1`}>
																	<ExternalLink size={9} className="mt-0.5 shrink-0" />
																	<span>{check.resolution}</span>
																</div>
															)}
														</div>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
