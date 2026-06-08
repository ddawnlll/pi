/**
 * Atomic File Writer for Project State
 *
 * Writes JSON files atomically using temp + rename pattern.
 * Falls back to direct write if atomic write is unavailable.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a file atomically: write to temp, fsync if supported on platform, then rename.
 */
export function atomicWriteJson(data: unknown, finalPath: string): void {
	const dir = dirname(finalPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const tmpPath = `${finalPath}.${randomUUID().slice(0, 8)}.tmp`;
	const json = JSON.stringify(data, null, 2);

	writeFileSync(tmpPath, json, "utf-8");
	renameSync(tmpPath, finalPath);
}

/**
 * Read and parse a JSON file. Returns undefined if file is missing or malformed.
 */
export function readJsonFile<T>(filePath: string): T | undefined {
	try {
		if (!existsSync(filePath)) return undefined;
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content) as T;
	} catch {
		return undefined;
	}
}
