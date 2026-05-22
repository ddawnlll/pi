import React, { useState } from "react";
import { useReflections } from "../hooks/useReflections";
import { ReflectionTimeline, ReflectionDetail } from "../components/brain/reflections";

export function BrainReflectionsPage() {
	const { reflections, stats, loading, error, refresh } = useReflections();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId ? reflections.find((r) => r.planExecId === selectedId) ?? null : null;

	return (
		<div className="p-6 max-w-3xl mx-auto space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">Reflections</h1>
				<button onClick={refresh} className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700">
					Refresh
				</button>
			</div>

			<ReflectionTimeline
				reflections={reflections}
				stats={stats}
				loading={loading}
				error={error}
				onSelect={setSelectedId}
				onRefresh={refresh}
			/>

			{selected && (
				<ReflectionDetail
					reflection={selected}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</div>
	);
}
