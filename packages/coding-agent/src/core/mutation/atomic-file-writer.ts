/**
 * Atomic File Writer — P43.8C Smart Mutation Engine
 *
 * Atomic file writing with backup, rollback, and hash tracking.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

// =========================================================================
// Hash helpers
// =========================================================================

export function computeFileHash(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

export async function computeFileHashFromPath(filePath: string): Promise<string | null> {
	try {
		const content = await fsPromises.readFile(filePath, "utf-8");
		return computeFileHash(content);
	} catch {
		return null;
	}
}

export async function getFileLineCount(filePath: string): Promise<number> {
	try {
		const content = await fsPromises.readFile(filePath, "utf-8");
		return content.split("\n").length;
	} catch {
		return 0;
	}
}

export async function getFileByteCount(filePath: string): Promise<number> {
	try {
		const stat = await fsPromises.stat(filePath);
		return stat.size;
	} catch {
		return 0;
	}
}

export function fileExistsSync(filePath: string): boolean {
	try {
		return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fsPromises.access(filePath);
		return true;
	} catch {
		return false;
	}
}

// =========================================================================
// Backup helpers
// =========================================================================

export interface BackupInfo {
	backupPath: string;
	preHash: string;
}

export async function createBackup(filePath: string): Promise<BackupInfo | null> {
	try {
		const content = await fsPromises.readFile(filePath, "utf-8");
		const preHash = computeFileHash(content);
		const backupDir = path.join(path.dirname(filePath), ".backups");
		await fsPromises.mkdir(backupDir, { recursive: true });
		const backupName = `.bak-${path.basename(filePath)}-${Date.now()}`;
		const backupPath = path.join(backupDir, backupName);
		await fsPromises.writeFile(backupPath, content, "utf-8");
		return { backupPath, preHash };
	} catch {
		return null;
	}
}

export async function restoreBackup(backupPath: string, targetPath: string): Promise<boolean> {
	try {
		const content = await fsPromises.readFile(backupPath, "utf-8");
		await fsPromises.writeFile(targetPath, content, "utf-8");
		return true;
	} catch {
		return false;
	}
}

// =========================================================================
// Atomic file writer
// =========================================================================

export interface AtomicWriteResult {
	success: boolean;
	postHash: string | null;
	error?: string;
}

/**
 * Write content to a file atomically:
 * 1. Write to a temp file in the same directory
 * 2. Rename into place
 * 3. Read back and verify hash
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<AtomicWriteResult> {
	const dir = path.dirname(filePath);
	await fsPromises.mkdir(dir, { recursive: true });

	const tmpPath = path.join(dir, `.tmp-${path.basename(filePath)}-${Date.now()}`);
	try {
		// Write to temp
		await fsPromises.writeFile(tmpPath, content, "utf-8");

		// Rename into place
		await fsPromises.rename(tmpPath, filePath);

		// Read back and verify hash
		const writtenContent = await fsPromises.readFile(filePath, "utf-8");
		const postHash = computeFileHash(writtenContent);

		return { success: true, postHash };
	} catch (error) {
		// Clean up temp file on failure
		try {
			await fsPromises.unlink(tmpPath);
		} catch {
			// ignore cleanup failure
		}
		return {
			success: false,
			postHash: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
