/**
 * Plan Validator — validates parsed plan drafts against rules.
 *
 * Checks:
 * - title presence
 * - plan ID presence/format
 * - generated name uniqueness
 * - dependency existence
 * - cycle detection
 * - validation commands presence
 * - allowed/forbidden files
 * - file conflicts between plans
 * - unsafe parallelism
 * - payload validity
 */

import type { ParsedPlanDraft, PlanValidationMessage, ValidationSeverity, ExecutionBatch, RenamePreview } from "../types";

let _msgCounter = 0;

function vmsg(
	severity: ValidationSeverity,
	area: PlanValidationMessage["area"],
	message: string,
	planLocalId?: string,
	evidence?: string,
): PlanValidationMessage {
	return {
		id: `V${++_msgCounter}`,
		severity,
		area,
		planLocalId,
		message,
		evidence,
	};
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS)
// ---------------------------------------------------------------------------

function detectCycles(
	plans: ParsedPlanDraft[],
): Array<{ planLocalId: string; cycle: string[] }> {
	const adj = new Map<string, string[]>();
	const idByLocal = new Map<string, string>();
	for (const p of plans) {
		adj.set(p.localId, p.detectedDependencies ?? []);
		idByLocal.set(p.localId, p.detectedPlanId ?? p.localId);
	}

	const WHITE = 0,
		GRAY = 1,
		BLACK = 2;
	const color = new Map<string, number>();
	const parent = new Map<string, string | null>();
	const cycles: Array<{ planLocalId: string; cycle: string[] }> = [];

	function dfs(u: string) {
		color.set(u, GRAY);
		for (const v of adj.get(u) ?? []) {
			// Resolve dependency to localId
			const vLocal = plans.find((p) => p.detectedPlanId === v || p.localId === v)?.localId ?? v;
			if (!adj.has(vLocal)) continue; // unknown dependency

			const vColor = color.get(vLocal);
			if (vColor === GRAY) {
				// Back edge found — cycle detected
				const cycle: string[] = [u, vLocal];
				let cur = u;
				while (cur !== vLocal && parent.get(cur) != null) {
					cur = parent.get(cur)!;
					if (cur !== vLocal) cycle.unshift(cur);
				}
				cycles.push({ planLocalId: u, cycle: [...new Set(cycle)] });
				continue;
			}
			if (vColor === BLACK) continue; // already fully explored
			// Not visited yet (undefined or WHITE) — explore
			parent.set(vLocal, u);
			dfs(vLocal);
		}
		color.set(u, BLACK);
	}

	for (const [localId] of adj) {
		if (!color.has(localId)) {
			parent.set(localId, null);
			dfs(localId);
		}
	}

	return cycles;
}

// ---------------------------------------------------------------------------
// Topological sort for batch computation
// ---------------------------------------------------------------------------

function topologicalBatches(
	plans: ParsedPlanDraft[],
): { batches: ExecutionBatch[]; unresolved: string[] } {
	// Build adjacency
	const children = new Map<string, Set<string>>();
	const inDegree = new Map<string, number>();
	const planMap = new Map<string, ParsedPlanDraft>();

	for (const p of plans) {
		children.set(p.localId, new Set());
		inDegree.set(p.localId, 0);
		planMap.set(p.localId, p);
		planMap.set(p.detectedPlanId ?? "", p);
	}

	for (const p of plans) {
		for (const dep of p.detectedDependencies ?? []) {
			// Resolve dep to localId
			const depLocal = plans.find(
				(p2) => p2.detectedPlanId === dep || p2.localId === dep || p2.detectedTitle === dep,
			)?.localId;
			if (depLocal && depLocal !== p.localId) {
				children.get(depLocal)?.add(p.localId);
				inDegree.set(p.localId, (inDegree.get(p.localId) ?? 0) + 1);
			}
		}
	}

	// Kahn's algorithm
	const queue: string[] = [];
	const batches: ExecutionBatch[] = [];
	const unresolved: string[] = [];
	let batchIndex = 0;

	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	while (queue.length > 0 || [...inDegree.values()].some((d) => d > 0)) {
		if (queue.length === 0) {
			// Remaining have cycles or missing deps
			for (const [id, deg] of inDegree) {
				if (deg > 0) unresolved.push(id);
			}
			break;
		}

		batchIndex++;
		const currentBatch = [...queue];
		const batchPlanLocalIds: string[] = [];
		const batchReasons: string[] = [];

		for (const id of currentBatch) {
			inDegree.set(id, -1); // processed
			const p = planMap.get(id);
			if (p) {
				batchPlanLocalIds.push(p.localId);
				const title = p.detectedTitle ?? p.sourceFileName;
				const planId = p.detectedPlanId ?? p.localId;
				batchReasons.push(`${title} (${planId}) ready, deps satisfied`);
			}
		}

		batches.push({
			id: `batch-${batchIndex}`,
			title: `Batch ${batchIndex}`,
			planLocalIds: batchPlanLocalIds,
			canRunInParallel: batchPlanLocalIds.length > 1,
			reasons: batchReasons,
		});

		queue.length = 0;

		// Add newly freed nodes
		for (const id of currentBatch) {
			for (const child of children.get(id) ?? []) {
				const currentDeg = inDegree.get(child) ?? 1;
				inDegree.set(child, currentDeg - 1);
				if (currentDeg - 1 === 0) {
					queue.push(child);
				}
			}
		}
	}

	return { batches, unresolved };
}

// ---------------------------------------------------------------------------
// File conflict detection
// ---------------------------------------------------------------------------

function detectFileConflicts(
	plans: ParsedPlanDraft[],
): Array<{ planA: string; planB: string; files: string[] }> {
	const conflicts: Array<{ planA: string; planB: string; files: string[] }> = [];
	const fileMap = new Map<string, string[]>();

	for (const p of plans) {
		for (const f of p.detectedAllowedFiles ?? []) {
			const list = fileMap.get(f) ?? [];
			list.push(p.localId);
			fileMap.set(f, list);
		}
	}

	for (const [file, owners] of fileMap) {
		if (owners.length > 1) {
			// Each pair
			for (let i = 0; i < owners.length; i++) {
				for (let j = i + 1; j < owners.length; j++) {
					const existing = conflicts.find(
						(c) =>
							(c.planA === owners[i] && c.planB === owners[j]) ||
							(c.planA === owners[j] && c.planB === owners[i]),
					);
					if (existing) {
						existing.files.push(file);
					} else {
						conflicts.push({ planA: owners[i], planB: owners[j], files: [file] });
					}
				}
			}
		}
	}

	return conflicts;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

export interface ValidationResult {
	messages: PlanValidationMessage[];
	cycles: Array<{ planLocalId: string; cycle: string[] }>;
	fileConflicts: Array<{ planA: string; planB: string; files: string[] }>;
	batches: ExecutionBatch[];
	unresolvedDeps: string[];
	hasBlocker: boolean;
}

export function validatePlans(
	plans: ParsedPlanDraft[],
): ValidationResult {
	const messages: PlanValidationMessage[] = [];
	const renamePreviews = generateRenamePreviews(plans);

	// 1. Title presence
	for (const p of plans) {
		if (!p.detectedTitle || p.detectedTitle.trim().length === 0) {
			messages.push(
				vmsg("blocker", "schema", `Plan ${p.sourceFileName} has no title`, p.localId, p.sourceFileName),
			);
		}
	}

	// 2. Plan ID presence
	for (const p of plans) {
		if (!p.detectedPlanId || p.detectedPlanId.trim().length === 0) {
			messages.push(
				vmsg("blocker", "schema", `Plan "${p.detectedTitle ?? p.sourceFileName}" has no plan ID`, p.localId),
			);
		}
	}

	// 3. Duplicate plan IDs
	const planIds = new Map<string, string[]>();
	for (const p of plans) {
		const pid = p.detectedPlanId ?? p.localId;
		const list = planIds.get(pid) ?? [];
		list.push(p.localId);
		planIds.set(pid, list);
	}
	for (const [pid, locals] of planIds) {
		if (locals.length > 1) {
			for (const local of locals) {
				messages.push(
					vmsg("error", "rename", `Duplicate plan ID "${pid}"`, local, `shared by: ${locals.join(", ")}`),
				);
			}
		}
	}

	// 4. Generated name uniqueness
	const nameCount = new Map<string, string[]>();
	for (const r of renamePreviews) {
		const list = nameCount.get(r.newTitle) ?? [];
		list.push(r.originalName);
		nameCount.set(r.newTitle, list);
	}
	for (const [name, originals] of nameCount) {
		if (originals.length > 1) {
			for (const orig of originals) {
				const p = plans.find((pl) => pl.sourceFileName === orig || pl.detectedTitle === orig);
				if (p) {
					messages.push(
						vmsg("error", "rename", `Duplicate generated task name "${name}"`, p.localId, `from: ${originals.join(", ")}`),
					);
				}
			}
		}
	}

	// 5. Empty generated names
	for (const r of renamePreviews) {
		if (!r.newTitle || r.newTitle.trim().length === 0) {
			const p = plans.find((pl) => pl.sourceFileName === r.originalName);
			if (p) {
				messages.push(
					vmsg("blocker", "rename", `Empty generated name for "${r.originalName}"`, p.localId),
				);
			}
		}
	}

	// 6. Dependency existence
	const allLocalIds = new Set(plans.map((p) => p.localId));
	const allPlanIds = new Set(plans.map((p) => p.detectedPlanId).filter(Boolean));
	const allTitles = new Set(plans.map((p) => p.detectedTitle).filter(Boolean));

	for (const p of plans) {
		for (const dep of p.detectedDependencies ?? []) {
			const resolved = plans.find(
				(p2) =>
					p2.detectedPlanId === dep ||
					p2.localId === dep ||
					p2.detectedTitle === dep,
			);
			if (!resolved) {
				messages.push(
					vmsg("error", "dag", `Dependency "${dep}" not found among imported plans`, p.localId, dep),
				);
			}
		}
	}

	// 7. Cycle detection
	const cycles = detectCycles(plans);
	for (const c of cycles) {
		messages.push(
			vmsg("blocker", "dag", `Cycle detected involving "${c.cycle.join(" -> ")}"`, c.planLocalId, c.cycle.join(" -> ")),
		);
	}

	// 8. Validation commands
	for (const p of plans) {
		if (!p.detectedValidationCommands || p.detectedValidationCommands.length === 0) {
			messages.push(
				vmsg("warning", "validation", `No validation commands for "${p.detectedTitle ?? p.sourceFileName}"`, p.localId),
			);
		}
	}

	// 9. Allowed files
	for (const p of plans) {
		if (!p.detectedAllowedFiles || p.detectedAllowedFiles.length === 0) {
			messages.push(
				vmsg("warning", "files", `No allowed files specified for "${p.detectedTitle ?? p.sourceFileName}"`, p.localId),
			);
		}
	}

	// 10. File conflicts
	const fileConflicts = detectFileConflicts(plans);
	for (const cf of fileConflicts) {
		const planA = plans.find((p) => p.localId === cf.planA);
		const planB = plans.find((p) => p.localId === cf.planB);
		messages.push(
			vmsg("warning", "files", `File conflict between "${planA?.detectedTitle ?? cf.planA}" and "${planB?.detectedTitle ?? cf.planB}": ${cf.files.join(", ")}`,
				cf.planA, cf.files.join(", ")),
		);
		messages.push(
			vmsg("warning", "files", `File conflict between "${planB?.detectedTitle ?? cf.planB}" and "${planA?.detectedTitle ?? cf.planA}": ${cf.files.join(", ")}`,
				cf.planB, cf.files.join(", ")),
		);
	}

	// 11. Topological batches
	const { batches, unresolved } = topologicalBatches(plans);
	for (const u of unresolved) {
		const p = plans.find((pl) => pl.localId === u);
		messages.push(
			vmsg("error", "dag", `Plan "${p?.detectedTitle ?? u}" could not be assigned to a batch (unresolved dependencies or cycle)`, u),
		);
	}

	// 12. Unsafe parallelism detection
	if (batches.length > 0) {
		for (const batch of batches) {
			// Check if batch has file conflicts within it — if so, they can't truly run in parallel
			const batchPlanIds = new Set(batch.planLocalIds);
			const batchConflicts = fileConflicts.filter(
				(cf) => batchPlanIds.has(cf.planA) && batchPlanIds.has(cf.planB),
			);
			if (batchConflicts.length > 0 && batch.canRunInParallel) {
				messages.push(
					vmsg("warning", "dag", `Batch "${batch.title}" has file conflicts but is marked parallel-safe. Reduce parallelism.`,
						undefined, batchConflicts.map((c) => `${c.planA} <-> ${c.planB}`).join("; ")),
				);
			}
		}
	}

	const hasBlocker = messages.some((m) => m.severity === "blocker");

	return { messages, cycles, fileConflicts, batches, unresolvedDeps: unresolved, hasBlocker };
}

// ---------------------------------------------------------------------------
// Rename preview generator
// ---------------------------------------------------------------------------

export type RenameTemplate =
	| "{index}-{planId}-{slug}"
	| "{projectSlug}-{planId}-{title}"
	| "{planId}-{shortTitle}"
	| "{index}-{shortTitle}";

export function generateRenamePreviews(
	plans: ParsedPlanDraft[],
	template?: RenameTemplate,
): RenamePreview[] {
	const tmpl = template ?? "{planId}-{shortTitle}";
	const previews: RenamePreview[] = [];

	for (let i = 0; i < plans.length; i++) {
		const p = plans[i];
		const planId = p.detectedPlanId ?? `plan-${i + 1}`;
		const title = p.detectedTitle ?? p.sourceFileName.replace(/\.[^.]+$/, "");
		const shortTitle = title.length > 30 ? title.slice(0, 30) : title;
		const slug = shortTitle
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40)
			|| `plan-${i + 1}`;

		const newTitle = tmpl
			.replace(/\{index\}/g, String(i + 1).padStart(2, "0"))
			.replace(/\{planId\}/g, planId)
			.replace(/\{title\}/g, title)
			.replace(/\{shortTitle\}/g, shortTitle.length > 40 ? shortTitle.slice(0, 40) : shortTitle)
			.replace(/\{slug\}/g, slug)
			.replace(/\{projectSlug\}/g, "project");

		const generatedSlug = newTitle
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");

		// Check for conflicts with other previews
		const conflicts: string[] = [];
		for (let j = 0; j < i; j++) {
			if (previews[j].newTitle === newTitle) {
				conflicts.push(`Duplicate title with "${previews[j].originalName}"`);
			}
			if (previews[j].slug === generatedSlug) {
				conflicts.push(`Duplicate slug with "${previews[j].originalName}"`);
			}
		}

		previews.push({
			originalName: p.sourceFileName,
			newTitle,
			slug: generatedSlug,
			conflicts,
		});
	}

	return previews;
}

// ---------------------------------------------------------------------------
// Execution preview
// ---------------------------------------------------------------------------

export function computeExecutionPreview(
	plans: ParsedPlanDraft[],
	validationResult: ValidationResult,
	safeParallelism: number = 3,
	hardMaxParallelism: number = 5,
): {
	safeParallelism: number;
	hardMaxParallelism: number;
	batches: ExecutionBatch[];
} {
	let actualSafe = safeParallelism;
	const actualHard = hardMaxParallelism;

	// Reduce parallelism if there are file conflicts
	if (validationResult.fileConflicts.length > 0) {
		actualSafe = Math.max(1, actualSafe - 1);
	}

	// Reduce if cycles exist
	if (validationResult.cycles.length > 0) {
		actualSafe = 1;
	}

	return {
		safeParallelism: actualSafe,
		hardMaxParallelism: actualHard,
		batches: validationResult.batches,
	};
}

// ---------------------------------------------------------------------------
// Rename template validation
// ---------------------------------------------------------------------------

export function validateRenameTemplate(template: string): string | null {
	const validVars = ["{index}", "{planId}", "{title}", "{shortTitle}", "{slug}", "{projectSlug}"];
	const usedVars = template.match(/\{[^}]+\}/g) ?? [];
	for (const v of usedVars) {
		if (!validVars.includes(v)) {
			return `Unknown template variable "${v}". Valid: ${validVars.join(", ")}`;
		}
	}
	if (template.trim().length === 0) {
		return "Template cannot be empty";
	}
	return null;
}
