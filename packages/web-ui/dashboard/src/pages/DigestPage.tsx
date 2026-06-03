import React from "react";
import { useDigest } from "../hooks/useDigest";
import { MorningCard } from "../components/digest/MorningCard";
import { SignalFeed } from "../components/digest/SignalFeed";
import { ProposalNudge } from "../components/digest/ProposalNudge";
import { LoadingSkeleton, ErrorState } from "../components/brain/common";

export function DigestPage() {
	const { digest, loading, error, refresh } = useDigest();

	// Full-page loading state (first load only)
	if (loading && !digest) {
		return (
			<div className="p-6 max-w-5xl mx-auto space-y-4">
				<LoadingSkeleton variant="card" count={1} />
				<LoadingSkeleton variant="row" count={4} />
				<LoadingSkeleton variant="card" count={2} />
			</div>
		);
	}

	// Full-page error state (no data to show)
	if (error && !digest) {
		return (
			<div className="p-6 max-w-5xl mx-auto">
				<ErrorState
					message="Unable to load morning digest"
					details={error}
					onRetry={refresh}
				/>
			</div>
		);
	}

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
					Morning Digest
				</h1>
				<span className="text-xs text-stone-400 dark:text-stone-500">
					{new Date().toLocaleDateString([], {
						weekday: "long",
						month: "long",
						day: "numeric",
					})}
				</span>
			</div>

			{/* Inline error banner */}
			{error && digest && (
				<div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
					Failed to refresh: {error}
				</div>
			)}

			{/* Morning overview card */}
			<MorningCard
				digest={digest}
				loading={loading}
				error={error}
				onRefresh={refresh}
			/>

			{/* Two-column layout for signals and proposals */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<SignalFeed
					signals={digest?.topSignals ?? null}
					loading={loading}
					error={error}
					onRefresh={refresh}
				/>
				<ProposalNudge
					proposals={digest?.pendingProposals ?? null}
					loading={loading}
					error={error}
					onRefresh={refresh}
				/>
			</div>

			{/* Goal progress strip */}
			{digest?.goalProgress && digest.goalProgress.length > 0 && (
				<div className="border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-[#1E1E1E]">
					<div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200 dark:border-stone-700">
						<h2 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
							Goal Progress
						</h2>
					</div>
					<div className="divide-y divide-stone-100 dark:divide-stone-800">
						{digest.goalProgress.map((goal) => (
							<div key={goal.id} className="flex items-center gap-3 px-4 py-2.5">
								<div className="flex-1 min-w-0">
									<div className="flex items-center justify-between mb-1">
										<span className="text-xs text-stone-800 dark:text-stone-200 truncate">
											{goal.title}
										</span>
										<span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums ml-2">
											{goal.progress}%
										</span>
									</div>
									<div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
										<div
											className={`h-full rounded-full transition-all ${
												goal.status === "complete"
													? "bg-emerald-400"
													: goal.status === "paused"
														? "bg-amber-400"
														: "bg-blue-400"
											}`}
											style={{ width: `${goal.progress}%` }}
										/>
									</div>
								</div>
								<span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
									goal.status === "active"
										? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20"
										: goal.status === "complete"
											? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
											: goal.status === "paused"
												? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"
												: "text-stone-400 bg-stone-100 dark:bg-stone-800"
								}`}>
									{goal.status}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Reflection summary */}
			{digest?.reflectionCounts && (
				<div className="flex items-center gap-4 text-xs text-stone-400 dark:text-stone-500">
					<span>{digest.reflectionCounts.total} total reflections</span>
					<span>{digest.reflectionCounts.today} today</span>
					<span>{digest.reflectionCounts.newMemories} new memories created</span>
				</div>
			)}
		</div>
	);
}
