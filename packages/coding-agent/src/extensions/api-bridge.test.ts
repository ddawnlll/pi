/**
 * Tests for ApiBridge - Extension API Bridge
 *
 * Acceptance criteria:
 * 1. pi.readFile() works on permitted path
 * 2. pi.readFile('../.env') returns permission denied
 * 3. All API calls are written to audit log
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiBridge, ApiBridgePermissionError } from "./bridge/ApiBridge.js";

describe("ApiBridge", () => {
	let bridge: ApiBridge;
	let tempDir: string;
	const mockFs = new Map<string, Buffer>();

	// Custom readFile for testing (no real filesystem access needed)
	function testReadFile(filePath: string): Promise<Buffer> {
		const content = mockFs.get(filePath);
		if (content === undefined) {
			return Promise.reject(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
		}
		return Promise.resolve(content);
	}

	beforeEach(() => {
		mockFs.clear();

		// Create a fake workspace root
		tempDir = "/test/workspace";

		// Seed some mock files
		mockFs.set("/test/workspace/hello.txt", Buffer.from("Hello, world!"));
		mockFs.set("/test/workspace/src/index.ts", Buffer.from("console.log('hello');"));
		mockFs.set("/test/workspace/.env", Buffer.from("SECRET=value"));
		mockFs.set("/test/.env", Buffer.from("OUTSIDE_SECRET=outside"));

		bridge = new ApiBridge({
			basePath: tempDir,
			readFile: testReadFile,
		});
	});

	afterEach(() => {
		mockFs.clear();
	});

	// -----------------------------------------------------------------------
	// AC 1: pi.readFile() works on permitted path
	// -----------------------------------------------------------------------

	it("reads a file within the workspace", async () => {
		const content = await bridge.readFile("hello.txt");
		expect(content).toBe("Hello, world!");
	});

	it("reads a file in a subdirectory within the workspace", async () => {
		const content = await bridge.readFile("src/index.ts");
		expect(content).toBe("console.log('hello');");
	});



	// -----------------------------------------------------------------------
	// AC 2: pi.readFile('../.env') returns permission denied
	// -----------------------------------------------------------------------

	it("rejects path traversal with ../", async () => {
		await expect(bridge.readFile("../.env")).rejects.toThrow(ApiBridgePermissionError);
	});

	it("rejects deeply nested path traversal", async () => {
		await expect(bridge.readFile("src/../../../.env")).rejects.toThrow(ApiBridgePermissionError);
	});

	it("rejects absolute path", async () => {
		await expect(bridge.readFile("/etc/passwd")).rejects.toThrow(ApiBridgePermissionError);
	});

	it("rejects path that escapes via symlink-like traversal", async () => {
		await expect(bridge.readFile("subdir/../../.env")).rejects.toThrow(ApiBridgePermissionError);
	});

	it("rejects path traversal to sibling directory", async () => {
		await expect(bridge.readFile("../other/file.txt")).rejects.toThrow(ApiBridgePermissionError);
	});

	it("throws ApiBridgePermissionError with permission identifier", async () => {
		try {
			await bridge.readFile("../.env");
			expect.fail("Expected error to be thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiBridgePermissionError);
			if (error instanceof ApiBridgePermissionError) {
				expect(error.permission).toBe("filesystem");
				expect(error.message).toContain("../.env");
			}
		}
	});

	// -----------------------------------------------------------------------
	// AC 3: All API calls are written to audit log
	// -----------------------------------------------------------------------

	it("records successful readFile calls in the audit log", async () => {
		await bridge.readFile("hello.txt");

		expect(bridge.auditLog).toHaveLength(1);
		const entry = bridge.auditLog[0];
		expect(entry.method).toBe("readFile");
		expect(entry.args).toEqual(["hello.txt"]);
		expect(entry.result).toEqual({ success: true });
		expect(entry.timestamp).toBeDefined();
		expect(typeof entry.durationMs).toBe("number");
	});

	it("records failed readFile calls (permission denied) in the audit log", async () => {
		try {
			await bridge.readFile("../.env");
		} catch {
			// expected
		}

		expect(bridge.auditLog).toHaveLength(1);
		const entry = bridge.auditLog[0];
		expect(entry.method).toBe("readFile");
		expect(entry.args).toEqual(["../.env"]);
		expect(entry.result).toEqual({ success: false, error: expect.any(String) });
		expect(entry.timestamp).toBeDefined();
		expect(typeof entry.durationMs).toBe("number");
	});

	it("records multiple API calls in order in the audit log", async () => {
		await bridge.readFile("hello.txt");
		await bridge.readFile("src/index.ts");
		try {
			await bridge.readFile("../.env");
		} catch {
			// expected
		}

		expect(bridge.auditLog).toHaveLength(3);

		// First call
		expect(bridge.auditLog[0].method).toBe("readFile");
		expect(bridge.auditLog[0].args).toEqual(["hello.txt"]);
		expect(bridge.auditLog[0].result).toEqual({ success: true });

		// Second call
		expect(bridge.auditLog[1].method).toBe("readFile");
		expect(bridge.auditLog[1].args).toEqual(["src/index.ts"]);
		expect(bridge.auditLog[1].result).toEqual({ success: true });

		// Third call (denied)
		expect(bridge.auditLog[2].method).toBe("readFile");
		expect(bridge.auditLog[2].args).toEqual(["../.env"]);
		expect(bridge.auditLog[2].result).toEqual({ success: false, error: expect.any(String) });
	});

	it("records file not found error in audit log", async () => {
		try {
			await bridge.readFile("nonexistent.ts");
		} catch {
			// expected
		}

		expect(bridge.auditLog).toHaveLength(1);
		const entry = bridge.auditLog[0];
		expect(entry.method).toBe("readFile");
		expect(entry.result).toEqual({ success: false, error: expect.any(String) });
	});

	it("rejects empty path in bridge", async () => {
		await expect(bridge.readFile("")).rejects.toThrow();
	});
});
