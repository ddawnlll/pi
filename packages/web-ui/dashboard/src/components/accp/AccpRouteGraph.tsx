import { useMemo } from "react";
import { ArrowRight, GitBranch, FileText } from "lucide-react";

interface GraphNode {
	id: string;
	type: string;
}

interface GraphEdge {
	source: string;
	target: string;
	action: string;
	confidence: string;
}

interface AccpRouteGraphProps {
	nodes: GraphNode[];
	edges: GraphEdge[];
	className?: string;
}

/**
 * ACCP Route Graph — read-only display.
 * Shows a visual route graph of ACCP report nodes and their edge transitions.
 * Does not provide mutation affordances.
 */
export function AccpRouteGraph({ nodes, edges, className = "" }: AccpRouteGraphProps) {
	const nodeMap = useMemo(() => {
		const map = new Map<string, GraphNode>();
		for (const n of nodes) map.set(n.id, n);
		return map;
	}, [nodes]);

	// Group edges by source node for layout
	const edgesBySource = useMemo(() => {
		const map = new Map<string, GraphEdge[]>();
		for (const e of edges) {
			const list = map.get(e.source) ?? [];
			list.push(e);
			map.set(e.source, list);
		}
		return map;
	}, [edges]);

	const confidenceColor = (c: string): string => {
		switch (c) {
			case "high": return "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
			case "medium": return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
			case "low": return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
			default: return "text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700";
		}
	};

	if (nodes.length === 0 && edges.length === 0) {
		return (
			<div className={`rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 p-4 ${className}`}>
				<p className="text-xs text-stone-400 dark:text-stone-500 text-center">No route graph data</p>
			</div>
		);
	}

	return (
		<div className={`rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 ${className}`}>
			<div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-200 dark:border-stone-700">
				<GitBranch size={14} className="text-stone-400" />
				<h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
					ACCP Route Graph
				</h3>
				<span className="text-xs text-stone-400">
					{nodes.length} nodes, {edges.length} edges
				</span>
			</div>

			{/* Nodes */}
			{nodes.length > 0 && (
				<div className="p-4">
					<h4 className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
						<FileText size={12} />
						Reports
					</h4>
					<div className="flex flex-wrap gap-2">
						{nodes.map((n) => (
							<div
								key={n.id}
								className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs"
								title={n.id}
							>
								<span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
								<span className="font-mono text-stone-600 dark:text-stone-300">{n.id}</span>
								<span className="text-stone-400 dark:text-stone-500">({n.type})</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Edges */}
			{edges.length > 0 && (
				<div className="border-t border-stone-200 dark:border-stone-700 p-4">
					<h4 className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
						<ArrowRight size={12} />
						Routes
					</h4>
					<div className="space-y-2">
						{edges.map((e, i) => {
							const sourceNode = nodeMap.get(e.source);
							const targetNode = nodeMap.get(e.target);
							return (
								<div
									key={i}
									className="flex items-center gap-2 text-xs py-1.5 px-2.5 rounded bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-800"
								>
									<span className="font-mono text-stone-600 dark:text-stone-300 shrink-0">
										{sourceNode?.id ?? e.source}
									</span>
									<ArrowRight size={12} className="text-stone-400 shrink-0" />
									<span className={`px-1.5 py-0.5 rounded text-xs font-medium ${confidenceColor(e.confidence)} border`}>
										{e.action}
									</span>
									<ArrowRight size={12} className="text-stone-400 shrink-0" />
									<span className="font-mono text-stone-600 dark:text-stone-300 shrink-0">
										{targetNode?.id ?? e.target}
									</span>
									<span
										className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium border ${confidenceColor(e.confidence)}`}
									>
										{e.confidence}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
