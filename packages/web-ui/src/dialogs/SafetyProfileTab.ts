import { i18n } from "@mariozechner/mini-lit";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getAppStorage } from "../storage/app-storage.js";
import { SettingsTab } from "./SettingsDialog.js";

/**
 * Safety profile option for the dropdown.
 */
interface ProfileOption {
	value: string;
	label: string;
	description: string;
}

const PROFILE_OPTIONS: ProfileOption[] = [
	{
		value: "strict",
		label: i18n("Strict (Default)"),
		description: i18n(
			"Maximum safety. All shell commands require confirmation. git push and rm -rf are blocked. File writes require confirmation. Single workspace only.",
		),
	},
	{
		value: "balanced",
		label: i18n("Balanced"),
		description: i18n(
			"Moderate safety. Common dev commands allowed. git push and rm -rf are blocked. Deployment requires confirmation. Up to 3 parallel workspaces.",
		),
	},
	{
		value: "full_auto",
		label: i18n("Full Auto"),
		description: i18n(
			"Least restrictive. Most commands allowed. git push and rm -rf require EXPLICIT confirmation each time. Up to 5 parallel workspaces.",
		),
	},
];

/**
 * Safety Profile settings tab for the Settings dialog.
 *
 * Displays the current safety profile and its effective permissions.
 * Allows the user to switch between Strict, Balanced, and Full Auto profiles.
 */
@customElement("safety-profile-tab")
export class SafetyProfileTab extends SettingsTab {
	@state() private selectedProfile = "strict";
	@state() private effectivePermissions: Record<string, unknown> | null = null;

	getTabName(): string {
		return i18n("Safety Profile");
	}

	override async connectedCallback(): Promise<void> {
		super.connectedCallback();
		try {
			const storage = getAppStorage();
			const profile = await storage.settings.get<string>("safetyProfile");
			if (profile) this.selectedProfile = profile;
			await this.loadEffectivePermissions();
		} catch (error) {
			console.error("Failed to load safety profile settings:", error);
		}
	}

	private async loadEffectivePermissions(): Promise<void> {
		try {
			const storage = getAppStorage();
			const perms = await storage.settings.get<Record<string, unknown>>("safetyProfilePermissions");
			this.effectivePermissions = perms;
		} catch {
			// Permissions not available from server-side, show defaults
			this.effectivePermissions = null;
		}
	}

	private async saveProfile(profile: string): Promise<void> {
		this.selectedProfile = profile;
		try {
			const storage = getAppStorage();
			await storage.settings.set("safetyProfile", profile);
		} catch (error) {
			console.error("Failed to save safety profile:", error);
		}
		await this.loadEffectivePermissions();
	}

	private renderPermissionLevel(level: string): TemplateResult {
		switch (level) {
			case "blocked":
				return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Blocked</span>`;
			case "confirm":
				return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Confirm</span>`;
			case "allowed":
				return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Allowed</span>`;
			default:
				return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">${level}</span>`;
		}
	}

	private renderProfileOption(option: ProfileOption): TemplateResult {
		const isSelected = this.selectedProfile === option.value;
		return html`
			<button
				class="w-full text-left p-4 rounded-lg border-2 transition-colors ${
					isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
				}"
				@click=${() => this.saveProfile(option.value)}
			>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-foreground">${option.label}</span>
					${
						isSelected
							? html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground">Active</span>`
							: ""
					}
				</div>
				<p class="mt-1 text-xs text-muted-foreground">${option.description}</p>
			</button>
		`;
	}

	private renderEffectivePermissions(): TemplateResult {
		if (!this.effectivePermissions) {
			return html`
				<p class="text-sm text-muted-foreground">
					${i18n("Effective permissions will be displayed after profile selection.")}
				</p>
			`;
		}

		const data = this.effectivePermissions;
		return html`
			<div class="space-y-3">
				<h4 class="text-sm font-medium text-foreground">${i18n("Effective Permissions")}</h4>

				<div class="grid grid-cols-2 gap-3">
					<div class="p-3 rounded-md bg-secondary">
						<p class="text-xs text-muted-foreground">${i18n("Shell Default")}</p>
						<p class="text-sm font-medium">
							${this.renderPermissionLevel(
								(data as Record<string, unknown>).defaultShellConfirmation ? "confirm" : "allowed",
							)}
						</p>
					</div>
					<div class="p-3 rounded-md bg-secondary">
						<p class="text-xs text-muted-foreground">${i18n("File Write Default")}</p>
						<p class="text-sm font-medium">
							${this.renderPermissionLevel(
								(data as Record<string, unknown>).defaultFileWriteConfirmation ? "confirm" : "allowed",
							)}
						</p>
					</div>
					<div class="p-3 rounded-md bg-secondary">
						<p class="text-xs text-muted-foreground">${i18n("Plan Execution")}</p>
						<p class="text-sm font-medium">
							${this.renderPermissionLevel(
								(data as Record<string, unknown>).planExecutionConfirmation ? "confirm" : "allowed",
							)}
						</p>
					</div>
					<div class="p-3 rounded-md bg-secondary">
						<p class="text-xs text-muted-foreground">${i18n("Max Parallel Workspaces")}</p>
						<p class="text-sm font-medium">${(data as Record<string, unknown>).maxParallelWorkspaces ?? "Unlimited"}</p>
					</div>
				</div>

				<div class="mt-4">
					<p class="text-xs text-muted-foreground">
						${i18n("Key Commands:")}
					</p>
					<div class="mt-2 space-y-1">
						<div class="flex items-center justify-between text-sm">
							<span class="font-mono text-xs">git push</span>
							${this.renderPermissionLevel(this.selectedProfile === "full_auto" ? "confirm" : "blocked")}
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="font-mono text-xs">rm -rf</span>
							${this.renderPermissionLevel(this.selectedProfile === "full_auto" ? "confirm" : "blocked")}
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="font-mono text-xs">npm publish</span>
							${this.renderPermissionLevel(this.selectedProfile === "full_auto" ? "confirm" : "blocked")}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				<p class="text-sm text-muted-foreground">
					${i18n("Safety profiles control what commands and operations the agent can execute. Strict is the default and most restrictive profile.")}
				</p>

				<div class="space-y-3">
					<h3 class="text-sm font-medium text-foreground">${i18n("Select Safety Profile")}</h3>
					<div class="space-y-2">
						${PROFILE_OPTIONS.map((option) => this.renderProfileOption(option))}
					</div>
				</div>

				<div class="border-t pt-4">
					${this.renderEffectivePermissions()}
				</div>
			</div>
		`;
	}
}
