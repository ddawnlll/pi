/**
 * Tests for Large File Context Policy - P1 Workstream 7.D
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createFilePolicy, DEFAULT_FILE_POLICY, FilePolicy } from "../src/core/file-policy.js";

describe("Large File Context Policy", () => {
	describe("DEFAULT_FILE_POLICY", () => {
		it("should have correct default values from P1 spec", () => {
			expect(DEFAULT_FILE_POLICY.smallFileFullReadMaxLines).toBe(800);
			expect(DEFAULT_FILE_POLICY.mediumFileOutlineMaxLines).toBe(2500);
			expect(DEFAULT_FILE_POLICY.largeFileChunkOnlyMinLines).toBe(2501);
			expect(DEFAULT_FILE_POLICY.hugeFileManualApprovalMinLines).toBe(8000);
			expect(DEFAULT_FILE_POLICY.defaultChunkLines).toBe(120);
			expect(DEFAULT_FILE_POLICY.maxChunkLines).toBe(300);
			expect(DEFAULT_FILE_POLICY.overlapLines).toBe(30);
			expect(DEFAULT_FILE_POLICY.maxChunksPerPacket).toBe(6);
		});
	});

	describe("FilePolicy", () => {
		let policy: FilePolicy;

		beforeEach(() => {
			policy = new FilePolicy();
		});

		describe("classifyFile", () => {
			it("should classify small files (<=800 lines)", () => {
				expect(policy.classifyFile(100)).toBe("small");
				expect(policy.classifyFile(800)).toBe("small");
			});

			it("should classify medium files (801-2500 lines)", () => {
				expect(policy.classifyFile(801)).toBe("medium");
				expect(policy.classifyFile(1500)).toBe("medium");
				expect(policy.classifyFile(2500)).toBe("medium");
			});

			it("should classify large files (2501-7999 lines)", () => {
				expect(policy.classifyFile(2501)).toBe("large");
				expect(policy.classifyFile(5000)).toBe("large");
				expect(policy.classifyFile(7999)).toBe("large");
			});

			it("should classify huge files (>=8000 lines)", () => {
				expect(policy.classifyFile(8000)).toBe("huge");
				expect(policy.classifyFile(10000)).toBe("huge");
			});
		});

		describe("canReadFull", () => {
			it("should allow full read for small files", () => {
				expect(policy.canReadFull(500)).toBe(true);
				expect(policy.canReadFull(800)).toBe(true);
			});

			it("should not allow full read for medium files", () => {
				expect(policy.canReadFull(1000)).toBe(false);
			});

			it("should not allow full read for large files", () => {
				expect(policy.canReadFull(5000)).toBe(false);
			});

			it("should not allow full read for huge files", () => {
				expect(policy.canReadFull(10000)).toBe(false);
			});

			it("should respect budget when provided", () => {
				// Small file that fits in budget
				expect(policy.canReadFull(100, 5000)).toBe(true);

				// Small file that exceeds budget
				expect(policy.canReadFull(800, 100)).toBe(false);
			});
		});

		describe("checkPolicy", () => {
			it("should recommend full_read for small files", () => {
				const result = policy.checkPolicy(500);
				expect(result.classification).toBe("small");
				expect(result.canReadFull).toBe(true);
				expect(result.requiresChunking).toBe(false);
				expect(result.requiresApproval).toBe(false);
				expect(result.recommendedAction).toBe("full_read");
			});

			it("should recommend outline for medium files", () => {
				const result = policy.checkPolicy(1500);
				expect(result.classification).toBe("medium");
				expect(result.canReadFull).toBe(false);
				expect(result.requiresChunking).toBe(false);
				expect(result.requiresApproval).toBe(false);
				expect(result.recommendedAction).toBe("outline");
			});

			it("should recommend chunks for large files", () => {
				const result = policy.checkPolicy(5000);
				expect(result.classification).toBe("large");
				expect(result.canReadFull).toBe(false);
				expect(result.requiresChunking).toBe(true);
				expect(result.requiresApproval).toBe(false);
				expect(result.recommendedAction).toBe("chunks");
			});

			it("should require manual approval for huge files", () => {
				const result = policy.checkPolicy(10000);
				expect(result.classification).toBe("huge");
				expect(result.canReadFull).toBe(false);
				expect(result.requiresChunking).toBe(true);
				expect(result.requiresApproval).toBe(true);
				expect(result.recommendedAction).toBe("manual_approval");
			});

			it("should recommend chunks when small file exceeds budget", () => {
				const result = policy.checkPolicy(500, 100);
				expect(result.classification).toBe("small");
				expect(result.canReadFull).toBe(false);
				expect(result.recommendedAction).toBe("chunks");
			});
		});

		describe("getChunks", () => {
			it("should split content into chunks", () => {
				const content = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunks = policy.getChunks(content);

				expect(chunks.length).toBeGreaterThan(1);
				expect(chunks[0].startLine).toBe(1);
				expect(chunks[0].endLine).toBeLessThanOrEqual(120);
			});

			it("should include overlap between chunks", () => {
				const content = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunks = policy.getChunks(content);

				if (chunks.length > 1) {
					// Second chunk should start before first chunk ends (overlap)
					expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine);
				}
			});

			it("should respect custom chunk size", () => {
				const content = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunks = policy.getChunks(content, 50);

				expect(chunks[0].endLine).toBeLessThanOrEqual(50);
			});

			it("should limit to max chunks per packet", () => {
				const content = Array.from({ length: 10000 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunks = policy.getChunks(content);

				expect(chunks.length).toBeLessThanOrEqual(6); // maxChunksPerPacket
			});

			it("should estimate tokens for each chunk", () => {
				const content = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunks = policy.getChunks(content);

				for (const chunk of chunks) {
					expect(chunk.estimatedTokens).toBeGreaterThan(0);
				}
			});
		});

		describe("getChunkByRange", () => {
			it("should extract specific line range", () => {
				const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
				const chunk = policy.getChunkByRange(content, 10, 20);

				expect(chunk.startLine).toBe(10);
				expect(chunk.endLine).toBe(20);
				expect(chunk.content).toContain("line 10");
				expect(chunk.content).toContain("line 20");
				expect(chunk.estimatedTokens).toBeGreaterThan(0);
			});
		});

		describe("generateOutline", () => {
			it("should extract function definitions", () => {
				const content = `
import { something } from "module";

export function myFunction() {
  return 42;
}

function helperFunction() {
  return "helper";
}
`;
				const outline = policy.generateOutline(content, "test.ts");

				expect(outline.path).toBe("test.ts");
				expect(outline.outline).toContain("import");
				expect(outline.outline).toContain("function myFunction");
				expect(outline.outline).toContain("function helperFunction");
				expect(outline.estimatedTokens).toBeGreaterThan(0);
			});

			it("should extract class definitions", () => {
				const content = `
export class MyClass {
  constructor() {}
  
  public myMethod() {
    return true;
  }
}
`;
				const outline = policy.generateOutline(content, "test.ts");

				expect(outline.outline).toContain("class MyClass");
				expect(outline.outline).toContain("myMethod");
			});

			it("should extract type definitions", () => {
				const content = `
export interface MyInterface {
  prop: string;
}

export type MyType = string | number;

export enum MyEnum {
  A, B, C
}
`;
				const outline = policy.generateOutline(content, "test.ts");

				expect(outline.outline).toContain("interface MyInterface");
				expect(outline.outline).toContain("type MyType");
				expect(outline.outline).toContain("enum MyEnum");
			});

			it("should include line numbers", () => {
				const content = `line 1
line 2
export function test() {}
line 4`;
				const outline = policy.generateOutline(content, "test.ts");

				expect(outline.outline).toMatch(/3:/); // Line number prefix
			});
		});

		describe("updateSettings", () => {
			it("should update partial settings", () => {
				policy.updateSettings({ defaultChunkLines: 200 });
				expect(policy.getSettings().defaultChunkLines).toBe(200);
				expect(policy.getSettings().smallFileFullReadMaxLines).toBe(800); // unchanged
			});
		});

		describe("getSettings", () => {
			it("should return current settings", () => {
				const settings = policy.getSettings();
				expect(settings.defaultChunkLines).toBe(120);
			});

			it("should return a copy (not mutable)", () => {
				const settings = policy.getSettings();
				(settings as any).defaultChunkLines = 999;
				expect(policy.getSettings().defaultChunkLines).toBe(120);
			});
		});
	});

	describe("createFilePolicy", () => {
		it("should create policy with default settings", () => {
			const policy = createFilePolicy();
			expect(policy.getSettings().defaultChunkLines).toBe(120);
		});

		it("should create policy with custom settings", () => {
			const policy = createFilePolicy({ defaultChunkLines: 200 });
			expect(policy.getSettings().defaultChunkLines).toBe(200);
			expect(policy.getSettings().smallFileFullReadMaxLines).toBe(800); // default
		});
	});

	describe("AC Verification - 7.D Large File Context Policy", () => {
		it("AC: 5000-line file is not fully injected by default", () => {
			const policy = new FilePolicy();
			expect(policy.canReadFull(5000)).toBe(false);
		});

		it("AC: large file can produce targeted chunks", () => {
			const policy = new FilePolicy();
			const content = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join("\n");
			const chunks = policy.getChunks(content);

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.length).toBeLessThanOrEqual(6);
		});

		it("AC: small file can be fully included if under budget", () => {
			const policy = new FilePolicy();
			expect(policy.canReadFull(500, 10000)).toBe(true);
		});

		it("AC: huge file requires explicit deep/approval mode", () => {
			const policy = new FilePolicy();
			const result = policy.checkPolicy(10000);
			expect(result.requiresApproval).toBe(true);
			expect(result.recommendedAction).toBe("manual_approval");
		});
	});
});
