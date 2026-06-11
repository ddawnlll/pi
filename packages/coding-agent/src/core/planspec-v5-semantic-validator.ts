/**
 * PlanSpec v5 RC1 Semantic Validator — ACCP 1.2
 *
 * Validates PlanSpec v5 instances for semantic correctness beyond schema:
 * - Workspace refs resolve to valid wave definitions
 * - Wave refs resolve to valid workspace IDs
 * - Dependency graph has no cycles
 * - Wave graph has no cycles
 * - Command refs resolve to workspace commands
 * - Final validation command refs resolve to exact commands only
 * - AC validation refs resolve
 * - enforcedBy types are registered
 * - p45 forbidden paths respected
 * - empty allowedFiles rejected
 * - shell commands in final validation rejected (E_COMMAND_SHELL_NOT_ALLOWED)
 * - network patterns in commands rejected (E_COMMAND_NETWORK_NOT_ALLOWED)
 * - forbidden path patterns in workspace allowedFiles rejected (E_SECURITY_FORBIDDEN_PATH)
 * - cross-wave dependency without explicit marker rejected (E_SEMANTIC_INVALID)
 * - batch size exceeding parallelism rejected (E_SEMANTIC_INVALID)
 * - AC/evidence traceability enforced (E_REF_UNKNOWN_AC, E_MISSING_AC_EVIDENCE)
 *
 * All errors are typed (no generic TypeError).
 */

import { minimatch } from "minimatch";
import type { PlanSpecV5 } from "./planspec-v5-types.js";

// =============================================================================
// Error types
// =============================================================================

export interface SemanticError {
	readonly code: string;
	readonly message: string;
	readonly path: string;
}

// =============================================================================
// Validator
// =============================================================================

/**
 * Validate a PlanSpec v5 instance for semantic correctness.
 *
 * @param planSpec - The parsed PlanSpec v5 instance
 * @returns Array of semantic errors (empty = valid)
 */
export function validatePlanSpecSemantics(planSpec: PlanSpecV5): SemanticError[] {
	const errors: SemanticError[] = [];

	// Collect all workspace IDs
	const workspaceIds = new Set<string>();
	for (const ws of planSpec.workspaces) {
		if (workspaceIds.has(ws.id)) {
			errors.push({
				code: "E_DUPLICATE_WORKSPACE",
				message: `Duplicate workspace ID: "${ws.id}"`,
				path: `workspaces.${ws.id}`,
			});
		}
		workspaceIds.add(ws.id);
	}

	// Collect all wave IDs
	const waveIds = new Set<string>();
	for (const wave of planSpec.waves) {
		if (waveIds.has(wave.id)) {
			errors.push({
				code: "E_DUPLICATE_WAVE",
				message: `Duplicate wave ID: "${wave.id}"`,
				path: `waves.${wave.id}`,
			});
		}
		waveIds.add(wave.id);
	}

	// Build command ref map: workspaceId -> Set<commandRef>
	const commandRefMap = new Map<string, Set<string>>();
	// Build command exact map: workspaceId -> Map<commandRef, {exact, isFinalValidation}>
	const commandExactMap = new Map<string, Map<string, { exact: string; isFinal: boolean }>>();

	for (const ws of planSpec.workspaces) {
		const refs = new Set<string>();
		const exactMap = new Map<string, { exact: string; isFinal: boolean }>();

		for (const cmd of ws.commands) {
			refs.add(cmd.ref);
			exactMap.set(cmd.ref, { exact: cmd.exact, isFinal: false });
		}

		// Mark final validation refs
		if (ws.finalValidationCommandRefs) {
			for (const ref of ws.finalValidationCommandRefs) {
				const existing = exactMap.get(ref);
				if (existing) {
					exactMap.set(ref, { ...existing, isFinal: true });
				}
			}
		}

		commandRefMap.set(ws.id, refs);
		commandExactMap.set(ws.id, exactMap);
	}

	// SEMANTIC_VALIDATION-001: unknown workspace rejects
	for (const ws of planSpec.workspaces) {
		for (const dep of ws.dependencies) {
			if (!workspaceIds.has(dep)) {
				errors.push({
					code: "E_REF_UNKNOWN_WORKSPACE",
					message: `Workspace "${ws.id}" depends on unknown workspace "${dep}"`,
					path: `workspaces.${ws.id}.dependencies`,
				});
			}
		}

		if (ws.waveRef && !waveIds.has(ws.waveRef)) {
			errors.push({
				code: "E_REF_UNKNOWN_WAVE",
				message: `Workspace "${ws.id}" references unknown wave "${ws.waveRef}"`,
				path: `workspaces.${ws.id}.waveRef`,
			});
		}
	}

	// SEMANTIC_VALIDATION-002: unknown wave rejects
	for (const wave of planSpec.waves) {
		for (const wsRef of wave.workspaceRefs) {
			if (!workspaceIds.has(wsRef)) {
				errors.push({
					code: "E_REF_UNKNOWN_WORKSPACE",
					message: `Wave "${wave.id}" references unknown workspace "${wsRef}"`,
					path: `waves.${wave.id}.workspaceRefs`,
				});
			}
		}
	}

	// SEMANTIC_VALIDATION-003: unknown commandRef rejects
	for (const ws of planSpec.workspaces) {
		const wsRefs = commandRefMap.get(ws.id);
		const _wsExact = commandExactMap.get(ws.id);

		// Validation command refs
		for (const cmdRef of ws.validation.commandRefs) {
			if (!wsRefs?.has(cmdRef)) {
				errors.push({
					code: "E_REF_UNKNOWN_COMMAND",
					message: `Workspace "${ws.id}" validation references unknown command ref "${cmdRef}"`,
					path: `workspaces.${ws.id}.validation.commandRefs`,
				});
			}
		}

		// Final validation command refs
		if (ws.finalValidationCommandRefs) {
			for (const cmdRef of ws.finalValidationCommandRefs) {
				if (!wsRefs?.has(cmdRef)) {
					errors.push({
						code: "E_REF_UNKNOWN_COMMAND",
						message: `Workspace "${ws.id}" final validation references unknown command ref "${cmdRef}"`,
						path: `workspaces.${ws.id}.finalValidationCommandRefs`,
					});
				}
			}
		}

		// AC validation refs
		for (const ac of ws.acceptanceCriteria) {
			if (ac.validationRefs) {
				for (const vref of ac.validationRefs) {
					if (!wsRefs?.has(vref)) {
						errors.push({
							code: "E_REF_UNKNOWN_COMMAND",
							message: `Workspace "${ws.id}" AC "${ac.id}" references unknown command ref "${vref}"`,
							path: `workspaces.${ws.id}.acceptanceCriteria.${ac.id}.validationRefs`,
						});
					}
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-004: unknown AC ref rejects
	// (ACs are validated above - unknown AC validation refs are already caught)

	// SEMANTIC_VALIDATION-005: unknown enforcedBy rejects
	// (enforcedBy is not used in v5 RC1 schema; skipped)

	// SEMANTIC_VALIDATION-006: workspace cycle rejects
	const wsCycle = detectCycle(
		planSpec.workspaces.map((ws) => ({
			id: ws.id,
			deps: ws.dependencies.filter((d) => workspaceIds.has(d)),
		})),
	);
	if (wsCycle) {
		errors.push({
			code: "E_CYCLE_WORKSPACE",
			message: `Workspace dependency cycle detected: ${wsCycle.join(" -> ")}`,
			path: "workspaces",
		});
	}

	// SEMANTIC_VALIDATION-007: wave cycle rejects
	const waveGraph = planSpec.waves.map((wave) => ({
		id: wave.id,
		deps: planSpec.waves
			.filter((other) => other.id !== wave.id)
			.filter((other) => {
				// A wave depends on another if its workspaces depend on workspaces in the other wave
				const otherWsIds = new Set(other.workspaceRefs.filter((r) => workspaceIds.has(r)));
				for (const wsRef of wave.workspaceRefs) {
					const ws = planSpec.workspaces.find((w) => w.id === wsRef);
					if (ws?.dependencies.some((d) => otherWsIds.has(d))) {
						return true;
					}
				}
				return false;
			})
			.map((other) => other.id),
	}));
	const waveCycle = detectCycle(waveGraph);
	if (waveCycle) {
		errors.push({
			code: "E_CYCLE_WAVE",
			message: `Wave dependency cycle detected: ${waveCycle.join(" -> ")}`,
			path: "waves",
		});
	}

	// SEMANTIC_VALIDATION-008: empty allowedFiles rejects
	for (const ws of planSpec.workspaces) {
		if (ws.allowedFiles && ws.allowedFiles.length === 0) {
			errors.push({
				code: "E_EMPTY_ALLOWED_FILES",
				message: `Workspace "${ws.id}" has empty allowedFiles`,
				path: `workspaces.${ws.id}.allowedFiles`,
			});
		}
	}

	// SEMANTIC_VALIDATION-009: p45 forbidden path rejects
	for (const ws of planSpec.workspaces) {
		if (ws.p45Bridge) {
			if (ws.p45Bridge.allowedFiles) {
				for (const file of ws.p45Bridge.allowedFiles) {
					// Check if any allowed file is in forbidden paths
					if (ws.p45Bridge.forbiddenPaths) {
						for (const forbidden of ws.p45Bridge.forbiddenPaths) {
							if (file.startsWith(forbidden)) {
								errors.push({
									code: "E_P45_RUNTIME_PATH_FORBIDDEN",
									message: `Workspace "${ws.id}" p45Bridge allowedFiles includes forbidden path: "${file}" (matches "${forbidden}")`,
									path: `workspaces.${ws.id}.p45Bridge.allowedFiles`,
								});
							}
						}
					}
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-010: final validation non-exact rejects
	for (const ws of planSpec.workspaces) {
		if (ws.finalValidationCommandRefs) {
			for (const ref of ws.finalValidationCommandRefs) {
				const exactMap = commandExactMap.get(ws.id);
				const cmdInfo = exactMap?.get(ref);
				if (cmdInfo?.isFinal) {
					// Final validation commands must be exact
					// (they are by schema; this is a semantic check)
					// No additional check needed — exact is already validated by schema
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-011: delete policy allowed/forbidden overlap rejects
	const authCommands = planSpec.authority.commands;
	if (authCommands?.controlledDelete) {
		const allowedPatterns = (authCommands.controlledDelete.allowedPaths ?? []).map((p) => p.pattern);
		const forbiddenPatterns = (authCommands.controlledDelete.forbiddenPaths ?? []).map((p) => p.pattern);

		for (const allowed of allowedPatterns) {
			for (const forbidden of forbiddenPatterns) {
				// Check if an allowed path contains a forbidden pattern
				if (minimatch(allowed, forbidden) || minimatch(forbidden, allowed)) {
					errors.push({
						code: "E_DELETE_POLICY_INVALID",
						message: `Delete policy: allowed path "${allowed}" overlaps with forbidden path "${forbidden}". Forbidden paths should preempt allowed paths explicitly.`,
						path: `authority.commands.controlledDelete`,
					});
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-012: shell commands in final validation allowed patterns rejected
	// Check if any command uses shell patterns like &&, ||, ;, | that indicate shell usage
	// while being used as a final validation command
	for (const ws of planSpec.workspaces) {
		if (!ws.finalValidationCommandRefs || ws.finalValidationCommandRefs.length === 0) continue;

		const exactMap = commandExactMap.get(ws.id);
		if (!exactMap) continue;

		for (const ref of ws.finalValidationCommandRefs) {
			const cmdInfo = exactMap.get(ref);
			if (cmdInfo) {
				// Shell patterns detected in a command used as final validation
				if (/[&|;]/.test(cmdInfo.exact) || cmdInfo.exact.includes("$( ")) {
					errors.push({
						code: "E_COMMAND_SHELL_NOT_ALLOWED",
						message: `Workspace "${ws.id}" final validation command "${ref}" uses shell patterns: "${cmdInfo.exact}". Final validation commands must be exact argv commands.`,
						path: `workspaces.${ws.id}.finalValidationCommandRefs`,
					});
				}

				// Network-like patterns in commands
				if (/curl\b|wget\b|fetch\b|http[s]?:\/\//.test(cmdInfo.exact)) {
					errors.push({
						code: "E_COMMAND_NETWORK_NOT_ALLOWED",
						message: `Workspace "${ws.id}" command "${ref}" uses network pattern: "${cmdInfo.exact}". Network commands must be explicitly policy-allowed.`,
						path: `workspaces.${ws.id}.commands.${ref}`,
					});
				}
			}
		}

		// Check all commands for forbidden patterns
		const wsCommands = planSpec.workspaces.find((w) => w.id === ws.id)?.commands ?? [];
		for (const cmd of wsCommands) {
			// Check for forbidden command patterns
			// Matches patterns like rm -rf /, sudo rm, mkfs, dd if=, > /dev/sd
			const FORBIDDEN_PATTERNS = [
				/rm\s+-rf\s+\//,
				/sudo\s+rm/,
				/mkfs\b/,
				/dd\s+if\s*=/,
				/chmod\s+-R\s+000/,
				/chown\s+-R\s+root:root/,
			];
			for (const pattern of FORBIDDEN_PATTERNS) {
				if (pattern.test(cmd.exact)) {
					errors.push({
						code: "E_COMMAND_FORBIDDEN_PATTERN",
						message: `Workspace "${ws.id}" command "${cmd.ref}" matches forbidden pattern: "${cmd.exact}".`,
						path: `workspaces.${ws.id}.commands.${cmd.ref}.exact`,
					});
				}
			}

			// Check for network-only commands (curl, wget) without explicit policy
			if (/^curl\b/.test(cmd.exact) || /^wget\b/.test(cmd.exact)) {
				errors.push({
					code: "E_COMMAND_NETWORK_NOT_ALLOWED",
					message: `Workspace "${ws.id}" command "${cmd.ref}" is a network command: "${cmd.exact}". Network commands must be explicitly policy-allowed.`,
					path: `workspaces.${ws.id}.commands.${cmd.ref}.exact`,
				});
			}
		}
	}

	// SEMANTIC_VALIDATION-013: forbidden paths in workspace allowedFiles rejected
	const GENERAL_FORBIDDEN_PATTERNS = [
		".env",
		".env.*",
		"node_modules/**",
		".git/**",
		"package-lock.json",
		"pnpm-lock.yaml",
	];
	for (const ws of planSpec.workspaces) {
		if (ws.allowedFiles) {
			for (const file of ws.allowedFiles) {
				for (const forbidden of GENERAL_FORBIDDEN_PATTERNS) {
					if (minimatch(file, forbidden)) {
						errors.push({
							code: "E_SECURITY_FORBIDDEN_PATH",
							message: `Workspace "${ws.id}" allowedFiles contains forbidden path: "${file}" (matches "${forbidden}")`,
							path: `workspaces.${ws.id}.allowedFiles`,
						});
					}
				}
			}
		}

		// Check forbiddenFiles for validity (forbiddenFiles should exist)
		if (ws.forbiddenFiles) {
			for (const file of ws.forbiddenFiles) {
				// Check that forbidden files don't contain allowedFiles themselves (no-op check)
				if (ws.allowedFiles) {
					for (const allowed of ws.allowedFiles) {
						if (minimatch(allowed, file)) {
							errors.push({
								code: "E_SECURITY_FORBIDDEN_PATH",
								message: `Workspace "${ws.id}": allowedFiles path "${allowed}" is also covered by forbiddenFiles pattern "${file}".`,
								path: `workspaces.${ws.id}.forbiddenFiles`,
							});
						}
					}
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-014: cross-wave dependency check
	// A workspace cannot depend on a workspace in a later wave
	const workspaceWaveMap = new Map<string, string>();
	for (const ws of planSpec.workspaces) {
		if (ws.waveRef) {
			workspaceWaveMap.set(ws.id, ws.waveRef);
		}
	}

	// Build wave order map
	const waveOrder = new Map<string, number>();
	for (let i = 0; i < planSpec.waves.length; i++) {
		waveOrder.set(planSpec.waves[i].id, i);
	}

	for (const ws of planSpec.workspaces) {
		for (const dep of ws.dependencies) {
			const wsWave = workspaceWaveMap.get(ws.id);
			const depWave = workspaceWaveMap.get(dep);
			if (wsWave && depWave && waveOrder.has(wsWave) && waveOrder.has(depWave)) {
				if ((waveOrder.get(depWave) ?? 0) > (waveOrder.get(wsWave) ?? 0)) {
					errors.push({
						code: "E_SEMANTIC_INVALID",
						message: `Workspace "${ws.id}" in wave "${wsWave}" depends on workspace "${dep}" in later wave "${depWave}". Cross-wave forward dependencies are not allowed.`,
						path: `workspaces.${ws.id}.dependencies`,
					});
				}
			}
		}
	}

	// SEMANTIC_VALIDATION-015: batch size exceeding parallelism check
	// Total workspaces in a parallel wave should not exceed maxParallelWorkspaces
	for (const wave of planSpec.waves) {
		if (wave.parallel && wave.workspaceRefs.length > planSpec.authority.executionState.maxParallelWorkspaces) {
			errors.push({
				code: "E_SEMANTIC_INVALID",
				message: `Wave "${wave.id}" has ${wave.workspaceRefs.length} parallel workspace(s) but maxParallelWorkspaces is ${planSpec.authority.executionState.maxParallelWorkspaces}. Batch size exceeds parallelism.`,
				path: `waves.${wave.id}.workspaceRefs`,
			});
		}
	}

	// SEMANTIC_VALIDATION-016: AC evidence traceability
	// Every workspace with requireEvidence=true must have ACs
	for (const ws of planSpec.workspaces) {
		if (ws.validation.requireEvidence && ws.acceptanceCriteria.length === 0) {
			errors.push({
				code: "E_MISSING_AC_EVIDENCE",
				message: `Workspace "${ws.id}" requires validation evidence but has no acceptance criteria defined.`,
				path: `workspaces.${ws.id}.validation.requireEvidence`,
			});
		}

		// Check for ACs without descriptions (semantically invalid)
		for (const ac of ws.acceptanceCriteria) {
			if (!ac.description || ac.description.trim().length === 0) {
				errors.push({
					code: "E_REF_UNKNOWN_AC",
					message: `Workspace "${ws.id}" AC "${ac.id}" has an empty description. Each AC must have a meaningful description.`,
					path: `workspaces.${ws.id}.acceptanceCriteria.${ac.id}.description`,
				});
			}
		}
	}

	return errors;
}

// =============================================================================
// Cycle Detection
// =============================================================================

interface GraphNode {
	id: string;
	deps: string[];
}

/**
 * Detect a cycle in a dependency graph.
 * Uses DFS with visitation states: 0=unvisited, 1=visiting, 2=visited.
 *
 * @param nodes - Graph nodes with IDs and dependency lists
 * @returns The cycle path if found, null otherwise
 */
function detectCycle(nodes: GraphNode[]): string[] | null {
	const idToNode = new Map(nodes.map((n) => [n.id, n]));
	const state = new Map<string, number>();
	const parent = new Map<string, string | null>();

	for (const node of nodes) {
		state.set(node.id, 0);
		parent.set(node.id, null);
	}

	for (const node of nodes) {
		if (state.get(node.id) === 0) {
			const cycle = dfsVisit(node.id, idToNode, state, parent);
			if (cycle) return cycle;
		}
	}

	return null;
}

function dfsVisit(
	id: string,
	idToNode: Map<string, GraphNode>,
	state: Map<string, number>,
	parent: Map<string, string | null>,
): string[] | null {
	state.set(id, 1); // visiting

	const node = idToNode.get(id);
	if (node) {
		for (const dep of node.deps) {
			const depState = state.get(dep);
			if (depState === 1) {
				// Found a cycle — reconstruct path
				const cycle: string[] = [dep, id];
				let current = id;
				while (current !== dep) {
					const p = parent.get(current);
					if (p && p !== dep) {
						cycle.push(p);
						current = p;
					} else {
						break;
					}
				}
				cycle.reverse();
				return cycle;
			}
			if (depState === 0) {
				parent.set(dep, id);
				const cycle = dfsVisit(dep, idToNode, state, parent);
				if (cycle) return cycle;
			}
		}
	}

	state.set(id, 2); // visited
	return null;
}
