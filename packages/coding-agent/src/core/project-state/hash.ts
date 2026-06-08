/**
 * Content hashing helpers for project state.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Compute SHA-256 hash of a string.
 */
export function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Compute SHA-256 hash of a file's contents.
 * Returns null if file cannot be read.
 */
export function hashFile(filePath: string): string | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		return hashContent(content);
	} catch {
		return null;
	}
}

/**
 * Compute a simple hash from a sorted array of strings (e.g., directory list).
 */
export function hashSortedStrings(items: string[]): string {
	const h = createHash("sha256");
	for (const item of items) {
		h.update(item, "utf-8");
	}
	return h.digest("hex");
}
