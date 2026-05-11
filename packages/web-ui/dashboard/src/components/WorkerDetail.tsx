import type { WorkerInfo } from "../types";

interface WorkerDetailProps {
	worker: WorkerInfo;
}

/**
 * Detail panel for the selected worker workspace.
 */
export function WorkerDetail({ worker }: WorkerDetailProps) {
	return (
		<div className="border-b border-gray-700 p-4">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
				Selected Workspace Detail
			</h2>
			<div className="text-xs space-y-1 text-gray-400">
				<DetailRow label="ID" value={worker.id} />
				<DetailRow label="Stage" value={worker.stage} />
				<DetailRow label="Attempts" value={String(worker.attempt)} />
				<DetailRow label="Retries" value={String(worker.retries)} />
				{worker.snapshotPath && (
					<DetailRow label="Snapshot" value={worker.snapshotPath} />
				)}
				{worker.reportPath && (
					<DetailRow label="Report" value={worker.reportPath} />
				)}
			</div>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-gray-500 w-20 shrink-0">{label}:</span>
			<span className="text-gray-200 truncate">{value}</span>
		</div>
	);
}
