import { useMemo } from "react";

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
}

/**
 * ACCP Route Graph — read-only display.
 * Shows a simple table of route graph nodes and edges.
 * Does not provide mutation affordances.
 */
export function AccpRouteGraph({ nodes, edges }: AccpRouteGraphProps) {
	const nodeMap = useMemo(() => {
		const map = new Map<string, GraphNode>();
		for (const n of nodes) map.set(n.id, n);
		return map;
	}, [nodes]);

	if (nodes.length === 0 && edges.length === 0) {
		return <div className="accp-route-graph"><p>No route graph data</p></div>;
	}

	return (
		<div className="accp-route-graph">
			<h3>ACCP Route Graph</h3>
			{nodes.length > 0 && (
				<div>
					<h4>Reports ({nodes.length})</h4>
					<ul>
						{nodes.map((n) => (
							<li key={n.id}>{n.id} ({n.type})</li>
						))}
					</ul>
				</div>
			)}
			{edges.length > 0 && (
				<div>
					<h4>Routes ({edges.length})</h4>
					<ul>
						{edges.map((e, i) => {
							const sourceNode = nodeMap.get(e.source);
							const targetNode = nodeMap.get(e.target);
							return (
								<li key={i}>
									{sourceNode?.id ?? e.source} → {targetNode?.id ?? e.target}
									<span className="accp-route-action">: {e.action}</span>
									<span className={`accp-route-confidence accp-confidence-${e.confidence}`}>
										({e.confidence})
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}
