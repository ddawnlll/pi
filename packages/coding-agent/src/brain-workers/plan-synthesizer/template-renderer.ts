/**
 * Template Renderer — 25.N
 *
 * Renders plan descriptions from templates with {{variable}} substitution.
 * Supports simple variable interpolation and warning on unresolved variables.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanTemplate {
	id: string;
	name: string;
	body: string;
	requiredVariables: string[];
	description: string;
}

export interface TemplateError {
	code: string;
	message: string;
}

export interface TemplateContext {
	[key: string]: unknown;
}

export interface TemplateRenderResult {
	success: boolean;
	output: string;
	errors: TemplateError[];
	warnings: string[];
}

// ---------------------------------------------------------------------------
// Built-in Templates
// ---------------------------------------------------------------------------

const STANDARD_EXECUTION: PlanTemplate = {
	id: "standard-execution",
	name: "Standard Execution Plan",
	body: `# Execution Plan: {{planName}}

## Overview
{{description}}

## Tasks
{{#each tasks}}### [{{priority}}] {{title}}
- **Description**: {{description}}
- **Effort**: {{effort}} units
- **Dependencies**: {{dependencies}}
- **Status**: {{status}}

{{/each}}
## Milestones
{{#each milestones}}### {{name}}
- **Description**: {{description}}
- **Target**: {{target}}

{{/each}}
## Resource Summary
- **Total Effort**: {{totalEffort}} units
- **Estimated Duration**: {{estimatedDuration}}
- **Required Capabilities**: {{capabilities}}`,
	requiredVariables: ["planName", "description"],
	description: "Standard detailed execution plan with tasks, milestones, and resource summary",
};

const SUMMARY: PlanTemplate = {
	id: "summary",
	name: "Summary",
	body: `Plan: {{planName}}
Tasks: {{taskCount}}
Milestones: {{milestoneCount}}
Total Effort: {{totalEffort}} units
Duration: {{estimatedDuration}}`,
	requiredVariables: ["planName"],
	description: "Compact summary of the plan",
};

const TASK_LIST: PlanTemplate = {
	id: "task-list",
	name: "Task List",
	body: `# Task List

{{#each tasks}}### [{{priority}}] {{title}}
Status: {{status}} | Effort: {{effort}} | Dependencies: {{dependencies}}
{{description}}

{{/each}}`,
	requiredVariables: [],
	description: "Flat list of all tasks",
};

const MILESTONE_PLAN: PlanTemplate = {
	id: "milestone-plan",
	name: "Milestone Plan",
	body: `# Milestone Plan: {{planName}}

{{#each milestones}}## {{name}}
Target: {{target}}
{{description}}

{{/each}}
## Summary
- Total Milestones: {{milestoneCount}}
- Total Effort: {{totalEffort}} units`,
	requiredVariables: ["planName"],
	description: "Milestone-focused plan overview",
};

export const BUILT_IN_TEMPLATES: PlanTemplate[] = [STANDARD_EXECUTION, SUMMARY, TASK_LIST, MILESTONE_PLAN];

// ---------------------------------------------------------------------------
// TemplateRenderer
// ---------------------------------------------------------------------------

export class TemplateRenderer {
	private templates: Map<string, PlanTemplate>;

	constructor(customTemplates?: PlanTemplate[]) {
		this.templates = new Map();

		if (customTemplates && customTemplates.length > 0) {
			// When custom templates are provided, they replace built-ins entirely
			for (const tmpl of customTemplates) {
				this.templates.set(tmpl.id, tmpl);
			}
		} else {
			for (const tmpl of BUILT_IN_TEMPLATES) {
				this.templates.set(tmpl.id, tmpl);
			}
		}
	}

	render(templateId: string, context: TemplateContext): TemplateRenderResult {
		const errors: TemplateError[] = [];
		const warnings: string[] = [];

		const template = this.templates.get(templateId);
		if (!template) {
			return {
				success: false,
				output: "",
				errors: [{ code: "TEMPLATE_NOT_FOUND", message: `Template '${templateId}' not found` }],
				warnings: [],
			};
		}

		// Check required variables
		for (const varName of template.requiredVariables) {
			const value = this.resolvePath(context, varName);
			if (value === undefined || value === null) {
				errors.push({
					code: "MISSING_REQUIRED_VARIABLE",
					message: `Required variable '${varName}' is missing`,
				});
			}
		}

		if (errors.length > 0) {
			return {
				success: false,
				output: "",
				errors,
				warnings,
			};
		}

		const output = this.interpolate(template.body, context, warnings);

		return {
			success: true,
			output,
			errors,
			warnings,
		};
	}

	getAllTemplates(): PlanTemplate[] {
		return Array.from(this.templates.values());
	}

	getTemplate(id: string): PlanTemplate | undefined {
		return this.templates.get(id);
	}

	registerTemplate(template: PlanTemplate): void {
		if (this.templates.has(template.id)) {
			throw new Error(`Template '${template.id}' already registered`);
		}
		this.templates.set(template.id, template);
	}

	/**
	 * Remove a template by ID.
	 * @returns true if removed, false if not found.
	 */
	removeTemplate(id: string): boolean {
		return this.templates.delete(id);
	}

	/**
	 * Clear all templates.
	 */
	clear(): void {
		this.templates.clear();
	}

	/**
	 * Reset to built-in templates, discarding all custom templates.
	 */
	resetToBuiltIns(): void {
		this.templates.clear();
		for (const tmpl of BUILT_IN_TEMPLATES) {
			this.templates.set(tmpl.id, tmpl);
		}
	}

	// -------------------------------------------------------------------
	// Interpolation
	// -------------------------------------------------------------------

	private interpolate(body: string, context: TemplateContext, warnings: string[]): string {
		let result = body;

		// Handle each blocks: {{#each name}}...{{/each}}
		result = this.renderEachBlocks(result, context, warnings);

		// Handle if blocks: {{#if name}}...{{/if}}
		result = this.renderIfBlocks(result, context, warnings);

		// Handle simple variables: {{name}}
		result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, varPath: string) => {
			const value = this.resolvePath(context, varPath);
			if (value === undefined || value === null) {
				warnings.push(`Variable '${varPath}' not found in context`);
				return `{{${varPath}}}`;
			}
			if (typeof value === "object") return JSON.stringify(value);
			return String(value);
		});

		return result;
	}

	private renderEachBlocks(template: string, context: TemplateContext, warnings: string[]): string {
		const pattern = /\{\{#each (\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g;
		return template.replace(pattern, (_match, listName: string, blockContent: string) => {
			const items = this.resolvePath(context, listName);
			if (!Array.isArray(items) || items.length === 0) return "";

			return items
				.map((item) => {
					const itemContext = { ...context, this: item };
					if (typeof item === "object" && item !== null) {
						Object.assign(itemContext, item as Record<string, unknown>);
					}
					return this.interpolateSimple(blockContent, itemContext, warnings);
				})
				.join("");
		});
	}

	private renderIfBlocks(template: string, context: TemplateContext, warnings: string[]): string {
		const pattern = /\{\{#if (\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g;
		return template.replace(pattern, (_match, condName: string, blockContent: string) => {
			const value = this.resolvePath(context, condName);
			if (value && value !== false && value !== null && value !== undefined) {
				return this.interpolateSimple(blockContent, context, warnings);
			}
			return "";
		});
	}

	private interpolateSimple(template: string, context: TemplateContext, warnings: string[]): string {
		return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, varPath: string) => {
			const value = this.resolvePath(context, varPath);
			if (value === undefined || value === null) {
				warnings.push(`Variable '${varPath}' not found in context`);
				return `{{${varPath}}}`;
			}
			if (typeof value === "object") return JSON.stringify(value);
			return String(value);
		});
	}

	private resolvePath(context: TemplateContext, path: string): unknown {
		const parts = path.split(".");
		let current: unknown = context;
		for (const part of parts) {
			if (current === null || current === undefined || typeof current !== "object") {
				return undefined;
			}
			current = (current as Record<string, unknown>)[part];
		}
		return current;
	}
}

export function createTemplateRenderer(customTemplates?: PlanTemplate[]): TemplateRenderer {
	return new TemplateRenderer(customTemplates);
}
