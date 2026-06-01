/**
 * Try to parse a JSON string as an execution contract.
 *
 * An execution contract is a JSON object with a non-empty `workspaces`
 * array where each entry has at least an `id` field.
 */
function looksLikeExecutionContract(json: string): boolean {
	try {
		const parsed = JSON.parse(json);
		if (!parsed || typeof parsed !== "object") return false;
		const workspaces = parsed.workspaces;
		if (!Array.isArray(workspaces) || workspaces.length === 0) return false;
		return workspaces.every((w: unknown) =>
			typeof w === "object" && w !== null && typeof (w as Record<string, unknown>).id === "string",
		);
	} catch {
		return false;
	}
}

/**
 * Extract execution contract JSON from plan content.
 *
 * Tries (in order):
 *  1. JSON code block under a # Part 3 heading (v2/v3 template format)
 *  2. JSON code block under any heading containing "Execution Contract" or "JSON Contract"
 *  3. Any ```json code block in the document that looks like an execution contract
 *
 * @param planContent - Plan content
 * @returns JSON string or null if not found
 */
function extractJsonQueue(planContent: string): string | null {
	// 1. Try # Part 3 section first (v2/v3 template format, backward compat)
	const part3Match = planContent.match(/# Part 3[^\n]*\n([\s\S]*?)(?=\n# Part [4-9]|\n# Part 1[0-9]|$)/i);
	if (part3Match) {
		const part3Content = part3Match[1];
		const jsonMatch = part3Content.match(/```json\s*\n([\s\S]*?)\n```/);
		if (jsonMatch) {
			const json = jsonMatch[1].trim();
			if (looksLikeExecutionContract(json)) return json;
		}
	}

	// 2. Try any heading containing "Execution Contract" or "JSON Contract" (v4 template format)
	const contractSectionMatch = planContent.match(/(?:#+|^)[^\n]*Execution\s*(?:JSON\s*)?Contract[^\n]*\n([\s\S]*?)(?=\n#|\n---|$)/i);
	if (contractSectionMatch) {
		const sectionContent = contractSectionMatch[1];
		const jsonMatch = sectionContent.match(/```json\s*\n([\s\S]*?)\n```/);
		if (jsonMatch) {
			const json = jsonMatch[1].trim();
			if (looksLikeExecutionContract(json)) return json;
		}
	}

	// 3. Scan ALL ```json blocks in the document and try each one
	const allJsonBlocks = planContent.matchAll(/```json\s*\n([\s\S]*?)\n```/g);
	for (const match of allJsonBlocks) {
		const json = match[1].trim();
		if (looksLikeExecutionContract(json)) {
			return json;
		}
	}

	return null;
}
