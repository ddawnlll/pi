/**
 * MultiDagViewer — P22.F Interactive Multi-DAG Viewer
 *
 * Renders dependency graphs for multi-phase tasks with zoom/pan controls,
 * color-coded status indicators, mini-map, and node click navigation.
 *
 * Features:
 * - SVG-based DAG layout with auto-layered positioning
 * - Mouse wheel zoom, click-drag pan, fit-to-view
 * - Mini-map for orientation with large DAGs
 * - Color-coded by phase status (pending, running, complete, failed, blocked, skipped)
 * - Running phase nodes link to file explorer view
 * - Completed phase nodes link to diff summary view
 * - Auto-refresh every 10s while any phase is running
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AlertCircle,
	Maximize2,
	Minus,
	Plus,
	RefreshCw,
} from "lucide-react";
import type { MultiPhaseTask, PhasePlan, PhaseStatus } from "../types";

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const LAYER_GAP_X = 40;
const NODE_GAP_Y = 24;
const MINI_MAP_SIZE = 120;
const POLL_INTERVAL_MS = 10000;

// Status color config
const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string; glow: string }> = {
	pending: {
		fill: "rgba(75, 85, 99, 0.3)",
		stroke: "#4B5563",
		text: "#9CA3AF",
		glow: "none",
	},
	validating: {
		fill: "rgba(59, 130, 246, 0.15)",
		stroke: "#3B82F6",
		text: "#93C5FD",
		glow: "rgba(59, 130, 246, 0.3)",
	},
	running: {
		fill: "rgba(59, 130, 246, 0.2)",
		stroke: "#3B82F6",
		text: "#93C5FD",
		glow: "rgba(59, 130, 246, 0.4)",
	},
	complete: {
		fill: "rgba(16, 185, 129, 0.2)",
		stroke: "#10B981",
		text: "#6EE7B7",
		glow: "rgba(16, 185, 129, 0.3)",
	},
	failed: {
		fill: "rgba(239, 68, 68, 0.2)",
		stroke: "#EF4444",
		text: "#FCA5A5",
		glow: "rgba(239, 68, 68, 0.3)",
	},
	skipped: {
		fill: "rgba(75, 85, 99, 0.15)",
		stroke: "#6B7280",
		text: "#6B7280",
		glow: "none",
	},
	blocked: {
		fill: "rgba(245, 158, 11, 0.15)",
		stroke: "#F59E0B",
		text: "#FCD34D",
		glow: "rgba(245, 158, 11, 0.3)",
	},
};

const DEFAULT_COLOR = {
	fill: "rgba(75, 85, 99, 0.3)",
	stroke: "#4B5563",
	text: "#9CA3AF",
	glow: "none",
};

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface DagViewerNode {
	id: string;
	label: string;
	status: PhaseStatus;
	x: number;
	y: number;
	width: number;
	height: number;
	layerIndex: number;
	nodeIndex: number;
	dependsOn: string[];
	execution: PhasePlan["execution"];
}

export interface DagViewerEdge {
	source: string;
	target: string;
}

interface ViewTransform {
	x: number;
	y: number;
	scale: number;
}

interface MultiDagViewerProps {
	/** The multi-phase task to render as a DAG */
	task: MultiPhaseTask;
	/** Project ID for API calls */
	projectId: string;
	/** Called when user clicks a phase node to view its plan execution detail */
	onPhasePlanClick?: (planExecId: string) => void;
	/** Called when user clicks the "view files" action on a running phase */
	onViewFiles?: (planExecId: string, workspaceId?: string) => void;
	/** Called when user clicks the "view diff" action on a completed phase */
	onViewDiff?: (planExecId: string) => void;
	/** Optional class name */
	className?: string;
}

// ----------------------------------------------------------------
// DAG Layout Algorithm
// ----------------------------------------------------------------

function computeDagLayout(phases: PhasePlan[]): {
	nodes: DagViewerNode[];
	edges: DagViewerEdge[];
} {
	if (phases.length === 0) {
		return { nodes: [], edges: [] };
	}

	// Build adjacency and in-degree maps
	const phaseMap = new Map<string, PhasePlan>();
	for (const p of phases) {
		phaseMap.set(p.id, p);
	}

	// Topological sort (Kahn's algorithm)
	const inDegree = new Map<string, number>();
	const adj = new Map<string, string[]>();

	for (const p of phases) {
		inDegree.set(p.id, 0);
		adj.set(p.id, []);
	}

	for (const p of phases) {
		for (const dep of p.dependsOn) {
			adj.get(dep)?.push(p.id);
			inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		// Process nodes with same layer together (BFS)
		const layerSize = queue.length;
		for (let i = 0; i < layerSize; i++) {
			const node = queue.shift()!;
			sorted.push(node);
			for (const neighbor of adj.get(node) ?? []) {
				const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDeg);
				if (newDeg === 0) {
					queue.push(neighbor);
				}
			}
		}
	}

	// Assign layers (BFS layering)
	const layer = new Map<string, number>();
	const layers = new Map<number, string[]>();

	// Nodes with no dependencies go to layer 0
	for (const p of phases) {
		if (p.dependsOn.length === 0) {
			layer.set(p.id, 0);
			if (!layers.has(0)) layers.set(0, []);
			layers.get(0)!.push(p.id);
		}
	}

	// Assign remaining nodes: layer = 1 + max(layer of dependencies)
	const remaining = sorted.filter((id) => !layer.has(id));
	for (const id of remaining) {
		const plan = phaseMap.get(id)!;
		let maxDepLayer = -1;
		for (const dep of plan.dependsOn) {
			const depLayer = layer.get(dep);
			if (depLayer !== undefined && depLayer > maxDepLayer) {
				maxDepLayer = depLayer;
			}
		}
		const nodeLayer = maxDepLayer + 1;
		layer.set(id, nodeLayer);
		if (!layers.has(nodeLayer)) layers.set(nodeLayer, []);
		layers.get(nodeLayer)!.push(id);
	}

	// Compute positions
	const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
	const layerWidths = new Map<number, number>();
	for (const [layerIdx, nodeIds] of layers) {
		layerWidths.set(layerIdx, nodeIds.length * (NODE_HEIGHT + NODE_GAP_Y) - NODE_GAP_Y);
	}

	const maxLayerHeight = Math.max(...layerWidths.values(), 0);

	const nodes: DagViewerNode[] = [];
	const edges: DagViewerEdge[] = [];

	for (const [layerIdx, nodeIds] of layers) {
		const layerHeight = nodeIds.length * (NODE_HEIGHT + NODE_GAP_Y) - NODE_GAP_Y;
		const startY = (maxLayerHeight - layerHeight) / 2;

		for (let i = 0; i < nodeIds.length; i++) {
			const id = nodeIds[i];
			const plan = phaseMap.get(id)!;
			nodes.push({
				id,
				label: plan.title || id,
				status: plan.status,
				x: layerIdx * (NODE_WIDTH + LAYER_GAP_X),
				y: startY + i * (NODE_HEIGHT + NODE_GAP_Y),
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				layerIndex: layerIdx,
				nodeIndex: i,
				dependsOn: plan.dependsOn,
				execution: plan.execution,
			});

			for (const dep of plan.dependsOn) {
				edges.push({ source: dep, target: id });
			}
		}
	}

	return { nodes, edges };
}

// ----------------------------------------------------------------
// Curve path between two nodes
// ----------------------------------------------------------------

function computeEdgePath(
	source: DagViewerNode,
	target: DagViewerNode,
): string {
	const x1 = source.x + source.width;
	const y1 = source.y + source.height / 2;
	const x2 = target.x;
	const y2 = target.y + target.height / 2;

	const cx = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

// ----------------------------------------------------------------
// Node Component
// ----------------------------------------------------------------

function DagNode({
	node,
	onClick,
	onViewFiles,
	onViewDiff,
	scale,
}: {
	node: DagViewerNode;
	onClick: (planExecId: string) => void;
	onViewFiles: (planExecId: string, workspaceId?: string) => void;
	onViewDiff: (planExecId: string) => void;
	scale: number;
}) {
	const colors = STATUS_COLORS[node.status] ?? DEFAULT_COLOR;
	const isRunning = node.status === "running";
	const isComplete = node.status === "complete";
	const hasExecution = node.execution !== null;
	const planExecId = node.execution?.planExecId;
	const firstWorkspace = node.execution?.workspaces?.[0]?.id;

	const handleClick = useCallback(() => {
		if (planExecId) onClick(planExecId);
	}, [planExecId, onClick]);

	const handleViewFiles = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (planExecId) onViewFiles(planExecId, firstWorkspace);
		},
		[planExecId, firstWorkspace, onViewFiles],
	);

	const handleViewDiff = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (planExecId) onViewDiff(planExecId);
		},
		[planExecId, onViewDiff],
	);

	const iconSize = Math.max(10, 12 / scale);

	return (
		<g
			onClick={handleClick}
			style={{ cursor: hasExecution && planExecId ? "pointer" : "default" }}
			className="dag-node"
		>
			{/* Glow for running state */}
			{isRunning && colors.glow !== "none" && (
				<ellipse
					cx={node.x + node.width / 2}
					cy={node.y + node.height / 2}
					rx={node.width / 2 + 6}
					ry={node.height / 2 + 6}
					fill={colors.glow}
					className="animate-pulse"
				/>
			)}

			{/* Main rect */}
			<rect
				x={node.x}
				y={node.y}
				width={node.width}
				height={node.height}
				rx={8}
				ry={8}
				fill={colors.fill}
				stroke={colors.stroke}
				strokeWidth={1.5}
				className="transition-colors duration-200"
			/>

			{/* Status indicator dot */}
			<circle
				cx={node.x + 14}
				cy={node.y + node.height / 2}
				r={4}
				fill={colors.stroke}
				className={isRunning ? "animate-ping" : ""}
			/>

			{/* Node label */}
			<text
				x={node.x + 24}
				y={node.y + node.height / 2 + 4}
				fill={colors.text}
				fontSize={Math.max(8, 11 / scale)}
				fontFamily="ui-monospace, monospace"
				fontWeight="500"
				textAnchor="start"
				className="select-none"
			>
				{node.label.length > 20 ? `${node.label.slice(0, 18)}..` : node.label}
			</text>

			{/* Status badge text below */}
			<text
				x={node.x + 24}
				y={node.y + node.height / 2 + 16}
				fill="rgba(156, 163, 175, 0.6)"
				fontSize={Math.max(6, 8 / scale)}
				fontFamily="ui-monospace, monospace"
				textAnchor="start"
				className="select-none"
			>
				{node.status}
				{node.execution?.stats && ` (${node.execution.stats.complete}/${node.execution.stats.total})`}
			</text>

			{/* Action buttons for running phases */}
			{isRunning && hasExecution && planExecId && (
				<g onClick={handleViewFiles} style={{ cursor: "pointer" }} className="dag-action-btn">
					<rect
						x={node.x + node.width - 22}
						y={node.y + 4}
						width={18}
						height={18}
						rx={4}
						fill="rgba(59, 130, 246, 0.3)"
						stroke="rgba(59, 130, 246, 0.5)"
						strokeWidth={1}
					/>
					<text
						x={node.x + node.width - 13}
						y={node.y + 16}
						fill="#93C5FD"
						fontSize={iconSize}
						fontFamily="monospace"
						textAnchor="middle"
						className="select-none pointer-events-none"
					>
						F
					</text>
				</g>
			)}

			{/* Action buttons for completed phases */}
			{isComplete && hasExecution && planExecId && (
				<g onClick={handleViewDiff} style={{ cursor: "pointer" }} className="dag-action-btn">
					<rect
						x={node.x + node.width - 22}
						y={node.y + 4}
						width={18}
						height={18}
						rx={4}
						fill="rgba(16, 185, 129, 0.3)"
						stroke="rgba(16, 185, 129, 0.5)"
						strokeWidth={1}
					/>
					<text
						x={node.x + node.width - 13}
						y={node.y + 16}
						fill="#6EE7B7"
						fontSize={iconSize}
						fontFamily="monospace"
						textAnchor="middle"
						className="select-none pointer-events-none"
					>
						D
					</text>
				</g>
			)}
		</g>
	);
}

// ----------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------

export function MultiDagViewer({
	task,
	projectId,
	onPhasePlanClick,
	onViewFiles,
	onViewDiff,
	className,
}: MultiDagViewerProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [viewTransform, setViewTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
	const [isPanning, setIsPanning] = useState(false);
	const [panStart, setPanStart] = useState({ x: 0, y: 0 });
	const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
	const [localTask, setLocalTask] = useState(task);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);

	// Update local task when prop changes
	useEffect(() => {
		setLocalTask(task);
	}, [task]);

	// Compute DAG layout
	const { nodes, edges } = useMemo(() => computeDagLayout(localTask.phases), [localTask.phases]);

	// Compute total DAG dimensions
	const dagDimensions = useMemo(() => {
		if (nodes.length === 0) return { width: 400, height: 200 };
		const maxX = Math.max(...nodes.map((n) => n.x + n.width));
		const maxY = Math.max(...nodes.map((n) => n.y + n.height));
		return { width: maxX + LAYER_GAP_X, height: maxY + NODE_GAP_Y };
	}, [nodes]);

	// Check if any phase is running (for auto-refresh)
	const hasRunningPhases = useMemo(
		() => localTask.phases.some((p) => p.status === "running" || p.status === "validating"),
		[localTask.phases],
	);

	// Auto-refresh task data
	const fetchTask = useCallback(async () => {
		if (!projectId) return;
		setIsRefreshing(true);
		setFetchError(null);
		try {
			const res = await fetch(
				`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(localTask.id)}`,
			);
			if (!res.ok) {
				if (res.status !== 404) {
					throw new Error(`Fetch failed: ${res.status}`);
				}
				return;
			}
			const data = await res.json();
			if (data.task) {
				setLocalTask(data.task);
			}
		} catch (err) {
			setFetchError(err instanceof Error ? err.message : "Failed to refresh");
		} finally {
			setIsRefreshing(false);
		}
	}, [projectId, localTask.id]);

	useEffect(() => {
		if (!hasRunningPhases) return;
		const interval = setInterval(fetchTask, POLL_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [hasRunningPhases, fetchTask]);

	// Fit DAG to viewport
	const fitToView = useCallback(() => {
		if (!containerRef.current || nodes.length === 0) return;

		const containerWidth = containerRef.current.clientWidth - 40;
		const containerHeight = containerRef.current.clientHeight - 40;

		const scaleX = containerWidth / dagDimensions.width;
		const scaleY = containerHeight / dagDimensions.height;
		const newScale = Math.min(scaleX, scaleY, 2);

		const offsetX = (containerWidth - dagDimensions.width * newScale) / 2;
		const offsetY = (containerHeight - dagDimensions.height * newScale) / 2;

		setViewTransform({ x: offsetX, y: offsetY, scale: newScale });
	}, [dagDimensions, nodes.length]);

	// Auto-fit on mount and when DAG changes
	useEffect(() => {
		fitToView();
	}, [fitToView]);

	// Zoom controls
	const zoomIn = useCallback(() => {
		setViewTransform((prev) => ({
			...prev,
			scale: Math.min(prev.scale * 1.3, 4),
		}));
	}, []);

	const zoomOut = useCallback(() => {
		setViewTransform((prev) => ({
			...prev,
			scale: Math.max(prev.scale / 1.3, 0.15),
		}));
	}, []);

	// Mouse wheel zoom
	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		setViewTransform((prev) => ({
			...prev,
			scale: Math.max(0.15, Math.min(4, prev.scale * delta)),
		}));
	}, []);

	// Pan handlers
	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			// Only pan on background click, not on nodes
			if ((e.target as SVGElement).closest(".dag-node")) return;
			setIsPanning(true);
			setPanStart({ x: e.clientX, y: e.clientY });
			setTransformStart({ x: viewTransform.x, y: viewTransform.y });
		},
		[viewTransform],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!isPanning) return;
			const dx = e.clientX - panStart.x;
			const dy = e.clientY - panStart.y;
			setViewTransform((prev) => ({
				...prev,
				x: transformStart.x + dx,
				y: transformStart.y + dy,
			}));
		},
		[isPanning, panStart, transformStart],
	);

	const handleMouseUp = useCallback(() => {
		setIsPanning(false);
	}, []);

	// ── Mini-map computation ──
	const miniMapScale = useMemo(() => {
		if (dagDimensions.width === 0 || dagDimensions.height === 0) return 1;
		return Math.min(
			MINI_MAP_SIZE / dagDimensions.width,
			MINI_MAP_SIZE / dagDimensions.height,
		);
	}, [dagDimensions]);

	const miniMapViewport = useMemo(() => {
		const vpW = (containerRef.current?.clientWidth ?? 400) / viewTransform.scale;
		const vpH = (containerRef.current?.clientHeight ?? 300) / viewTransform.scale;
		const vpX = -viewTransform.x / viewTransform.scale;
		const vpY = -viewTransform.y / viewTransform.scale;
		return { x: vpX, y: vpY, width: vpW, height: vpH };
	}, [viewTransform]);

	// ── Click handler wrapper ──
	const handleNodeClick = useCallback(
		(planExecId: string) => {
			onPhasePlanClick?.(planExecId);
		},
		[onPhasePlanClick],
	);

	const handleNodeViewFiles = useCallback(
		(planExecId: string, workspaceId?: string) => {
			onViewFiles?.(planExecId, workspaceId);
		},
		[onViewFiles],
	);

	const handleNodeViewDiff = useCallback(
		(planExecId: string) => {
			onViewDiff?.(planExecId);
		},
		[onViewDiff],
	);

	// ── Empty state ──
	if (nodes.length === 0) {
		return (
			<div
				className={`flex flex-col items-center justify-center py-12 px-4 rounded-lg border border-gray-700 bg-gray-900/40 ${className ?? ""}`}
			>
				<AlertCircle size={24} className="text-gray-600 mb-2" />
				<p className="text-xs text-gray-400">No phases to display</p>
				<p className="text-[10px] text-gray-600 mt-1">
					This task has no phases. Add plans to create a dependency graph.
				</p>
			</div>
		);
	}

	return (
		<div className={`relative ${className ?? ""}`}>
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg border border-gray-700 bg-gray-900/80">
				<div className="flex items-center gap-2">
					<h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
						Dependency Graph
					</h3>
					<span className="text-[9px] text-gray-600">
						{nodes.length} phases / {edges.length} dependencies
					</span>
					{hasRunningPhases && (
						<span className="flex items-center gap-1 text-[9px] text-blue-400">
							<span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
							Live
						</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					{fetchError && (
						<span className="text-[9px] text-red-400 mr-2">{fetchError}</span>
					)}
					<button
						onClick={fetchTask}
						disabled={isRefreshing}
						className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-gray-800 transition-colors disabled:opacity-50"
						title="Refresh"
					>
						<RefreshCw size={11} className={`text-gray-400 ${isRefreshing ? "animate-spin" : ""}`} />
					</button>
					<button
						onClick={zoomOut}
						className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
						title="Zoom out"
					>
						<Minus size={11} className="text-gray-400" />
					</button>
					<span className="text-[9px] text-gray-500 tabular-nums w-8 text-center">
						{Math.round(viewTransform.scale * 100)}%
					</span>
					<button
						onClick={zoomIn}
						className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
						title="Zoom in"
					>
						<Plus size={11} className="text-gray-400" />
					</button>
					<button
						onClick={fitToView}
						className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
						title="Fit to view"
					>
						<Maximize2 size={11} className="text-gray-400" />
					</button>
				</div>
			</div>

			{/* SVG Container */}
			<div
				ref={containerRef}
				className="relative overflow-hidden rounded-b-lg border border-t-0 border-gray-700 bg-gray-900/20"
				style={{ height: "360px" }}
			>
				<svg
					ref={svgRef}
					width="100%"
					height="100%"
					onWheel={handleWheel}
					onMouseDown={handleMouseDown}
					onMouseMove={handleMouseMove}
					onMouseUp={handleMouseUp}
					onMouseLeave={handleMouseUp}
					style={{ cursor: isPanning ? "grabbing" : "grab" }}
					className="select-none"
				>
					{/* Main DAG group with transform */}
					<g
						transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.scale})`}
					>
						{/* Edge arrows (defs) */}
						<defs>
							<marker
								id="dag-arrow"
								markerWidth="8"
								markerHeight="6"
								refX="8"
								refY="3"
								orient="auto"
							>
								<path d="M0,0 L8,3 L0,6" fill="#4B5563" />
							</marker>
							<marker
								id="dag-arrow-running"
								markerWidth="8"
								markerHeight="6"
								refX="8"
								refY="3"
								orient="auto"
							>
								<path d="M0,0 L8,3 L0,6" fill="#3B82F6" />
							</marker>
							<marker
								id="dag-arrow-complete"
								markerWidth="8"
								markerHeight="6"
								refX="8"
								refY="3"
								orient="auto"
							>
								<path d="M0,0 L8,3 L0,6" fill="#10B981" />
							</marker>
							<marker
								id="dag-arrow-failed"
								markerWidth="8"
								markerHeight="6"
								refX="8"
								refY="3"
								orient="auto"
							>
								<path d="M0,0 L8,3 L0,6" fill="#EF4444" />
							</marker>
						</defs>

						{/* Edges */}
						{edges.map((edge) => {
							const source = nodes.find((n) => n.id === edge.source);
							const target = nodes.find((n) => n.id === edge.target);
							if (!source || !target) return null;

							const path = computeEdgePath(source, target);
							let arrowId = "dag-arrow";
							let strokeColor = "#4B5563";
							if (source.status === "running" || target.status === "running") {
								arrowId = "dag-arrow-running";
								strokeColor = "#3B82F6";
							} else if (source.status === "complete") {
								arrowId = "dag-arrow-complete";
								strokeColor = "#10B981";
							} else if (source.status === "failed") {
								arrowId = "dag-arrow-failed";
								strokeColor = "#EF4444";
							}

							return (
								<path
									key={`${edge.source}-${edge.target}`}
									d={path}
									fill="none"
									stroke={strokeColor}
									strokeWidth={1.5}
									markerEnd={`url(#${arrowId})`}
									opacity={0.6}
									className="transition-colors duration-300"
								/>
							);
						})}

						{/* Nodes */}
						{nodes.map((node) => (
							<DagNode
								key={node.id}
								node={node}
								onClick={handleNodeClick}
								onViewFiles={handleNodeViewFiles}
								onViewDiff={handleNodeViewDiff}
								scale={viewTransform.scale}
							/>
						))}
					</g>
				</svg>

				{/* Mini-map */}
				<div
					className="absolute bottom-3 right-3 rounded border border-gray-700 bg-gray-900/90 overflow-hidden shadow-lg"
					style={{ width: MINI_MAP_SIZE, height: MINI_MAP_SIZE }}
				>
					<svg width={MINI_MAP_SIZE} height={MINI_MAP_SIZE}>
						{nodes.map((node) => {
							const nx = node.x * miniMapScale;
							const ny = node.y * miniMapScale;
							const nw = node.width * miniMapScale;
							const nh = node.height * miniMapScale;
							const colors = STATUS_COLORS[node.status] ?? DEFAULT_COLOR;
							return (
								<rect
									key={node.id}
									x={nx}
									y={ny}
									width={nw}
									height={nh}
									rx={2}
									fill={colors.stroke}
									opacity={0.5}
								/>
							);
						})}
						{/* Viewport indicator */}
						<rect
							x={miniMapViewport.x * miniMapScale}
							y={miniMapViewport.y * miniMapScale}
							width={miniMapViewport.width * miniMapScale}
							height={miniMapViewport.height * miniMapScale}
							fill="none"
							stroke="rgba(255,255,255,0.3)"
							strokeWidth={1}
						/>
					</svg>
				</div>

				{/* Legend */}
				<div className="absolute top-3 left-3 flex flex-wrap gap-2">
					{[
						{ status: "pending", label: "Pending" },
						{ status: "running", label: "Running" },
						{ status: "complete", label: "Complete" },
						{ status: "failed", label: "Failed" },
						{ status: "blocked", label: "Blocked" },
						{ status: "skipped", label: "Skipped" },
					].map(({ status, label }) => {
						const colors = STATUS_COLORS[status] ?? DEFAULT_COLOR;
						return (
							<div key={status} className="flex items-center gap-1">
								<span
									className="w-2 h-2 rounded-full"
									style={{ backgroundColor: colors.stroke }}
								/>
								<span className="text-[9px] text-gray-500">{label}</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
