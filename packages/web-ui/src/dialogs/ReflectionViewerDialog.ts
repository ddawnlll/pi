/**
 * Reflection Viewer Dialog — P17.H
 *
 * UI dialog for browsing and viewing brain reflection reports.
 *
 * Features:
 *   - List all reflections with filtering (by plan title, pagination)
 *   - View aggregate statistics (total, by plan, avg confidence)
 *   - View full reflection detail
 *   - View memory proposals extracted from a reflection
 *   - View future phase suggestions extracted from a reflection
 *
 * Endpoints consumed:
 *   GET  /api/brain/reflections          (list)
 *   GET  /api/brain/reflections/stats    (stats)
 *   GET  /api/brain/reflections/:id      (detail)
 *   GET  /api/brain/reflections/:id/memories
 *   GET  /api/brain/reflections/:id/future
 *
 * @packageDocumentation
 */

import { Badge, type BadgeVariant } from "@mariozechner/mini-lit/dist/Badge.js";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogHeader } from "@mariozechner/mini-lit/dist/Dialog.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { icon } from "@mariozechner/mini-lit/dist/icons.js";
import { Separator } from "@mariozechner/mini-lit/dist/Separator.js";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	ArrowLeft,
	BarChart3,
	Brain,
	ChevronLeft,
	ChevronRight,
	Lightbulb,
	List,
	RefreshCw,
	Search,
	Star,
	TrendingUp,
} from "lucide";
import { i18n } from "../utils/i18n.js";

// ---------------------------------------------------------------------------
// Types (mirrors the backend API response shape)
// ---------------------------------------------------------------------------

interface ReflectionReport {
	id: string;
	planExecId: string;
	planTitle?: string;
	summary: string;
	whatPeopleNeedToKnow: string;
	whatRan: string[];
	whatWorked: string[];
	whatFailed: string[];
	whatSlowedDown: string[];
	workspaceCount: number;
	successCount: number;
	failureCount: number;
	retryCount: number;
	successRate: number;
	avgRetryCount: number;
	totalDuration: number;
	validationFailures: number;
	memoriesToCreate: MemoryProposalSuggestion[];
	proposalsToGenerate: ProposalSuggestion[];
	futurePhaseSuggestions: FuturePhaseSuggestion[];
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;
	createdAt: string;
	confidence: number;
	sources: SourceRef[];
}

interface MemoryProposalSuggestion {
	type: string;
	title: string;
	content: string;
	confidence: number;
	sourceRefs: SourceRef[];
	category: string;
}

interface ProposalSuggestion {
	type: string;
	title: string;
	description: string;
	rationale: string;
	priority: string;
	evidenceIds: string[];
}

interface FuturePhaseSuggestion {
	title: string;
	rationale: string;
	priority: string;
	estimatedWorkstreams: number;
	relatedMemoryIds: string[];
	relatedObservationIds: string[];
}

interface SourceRef {
	type: string;
	id: string;
	description: string;
}

interface ReflectionStats {
	total: number;
	byPlan: Record<string, number>;
	avgConfidence: number;
}

// ---------------------------------------------------------------------------
// Tab identifiers for the detail view
// ---------------------------------------------------------------------------

type DetailTab = "overview" | "memories" | "future" | "proposals";

// ---------------------------------------------------------------------------
// Reflection Viewer Dialog
// ---------------------------------------------------------------------------

@customElement("reflection-viewer-dialog")
export class ReflectionViewerDialog extends DialogBase {
	// ---- View state ----
	@state() private loading = false;
	@state() private error: string | null = null;

	// ---- List state ----
	@state() private reflections: ReflectionReport[] = [];
	@state() private totalCount = 0;
	@state() private offset = 0;
	@state() private filterTitle = "";
	@state() private limit = 20;

	// ---- Stats state ----
	@state() private stats: ReflectionStats | null = null;
	@state() private showStats = false;

	// ---- Detail state ----
	@state() private selectedReflection: ReflectionReport | null = null;
	@state() private selectedDetailTab: DetailTab = "overview";
	@state() private memories: MemoryProposalSuggestion[] | null = null;
	@state() private future: FuturePhaseSuggestion[] | null = null;
	@state() private proposals: ProposalSuggestion[] | null = null;
	@state() private loadingDetail = false;

	protected modalWidth = "min(900px, 95vw)";
	protected modalHeight = "min(750px, 90vh)";

	// -----------------------------------------------------------------------
	// Static opener
	// -----------------------------------------------------------------------

	static async open() {
		const dialog = new ReflectionViewerDialog();
		dialog.open();
		await dialog.loadReflections();
		await dialog.loadStats();
		return dialog;
	}

	// -----------------------------------------------------------------------
	// API helpers
	// -----------------------------------------------------------------------

	private async apiFetch<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
		const url = new URL(path, window.location.origin);
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined && value !== "") {
					url.searchParams.set(key, String(value));
				}
			}
		}
		const res = await fetch(url.toString());
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? `HTTP ${res.status}`);
		}
		const json = await res.json();
		if (!json.success) {
			throw new Error(json.error ?? "API error");
		}
		return json as T;
	}

	// -----------------------------------------------------------------------
	// Data loading
	// -----------------------------------------------------------------------

	private async loadReflections() {
		this.loading = true;
		this.error = null;
		try {
			const result = await this.apiFetch<{
				reflections: ReflectionReport[];
				total: number;
			}>("/api/brain/reflections", {
				limit: this.limit,
				offset: this.offset,
				planTitle: this.filterTitle || undefined,
			});
			this.reflections = result.reflections;
			this.totalCount = result.total;
		} catch (err) {
			this.error = err instanceof Error ? err.message : "Failed to load reflections";
			this.reflections = [];
			this.totalCount = 0;
		} finally {
			this.loading = false;
		}
	}

	private async loadStats() {
		try {
			const result = await this.apiFetch<{ stats: ReflectionStats }>("/api/brain/reflections/stats");
			this.stats = result.stats;
		} catch {
			// Stats are non-critical
			this.stats = null;
		}
	}

	private async loadDetail(planExecId: string) {
		this.loadingDetail = true;
		this.memories = null;
		this.future = null;
		this.proposals = null;
		this.selectedDetailTab = "overview";

		try {
			// Fetch detail, memories, future, proposals in parallel
			const [detailRes, memoriesRes, futureRes] = await Promise.all([
				this.apiFetch<{ reflection: ReflectionReport }>(`/api/brain/reflections/${encodeURIComponent(planExecId)}`),
				this.apiFetch<{ memories: MemoryProposalSuggestion[] }>(
					`/api/brain/reflections/${encodeURIComponent(planExecId)}/memories`,
				).catch(() => null),
				this.apiFetch<{ suggestions: FuturePhaseSuggestion[] }>(
					`/api/brain/reflections/${encodeURIComponent(planExecId)}/future`,
				).catch(() => null),
			]);

			this.selectedReflection = detailRes.reflection;
			this.memories = memoriesRes?.memories ?? null;
			this.future = (futureRes?.suggestions as FuturePhaseSuggestion[]) ?? null;
			this.proposals = detailRes.reflection.proposalsToGenerate ?? null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : "Failed to load reflection detail";
		} finally {
			this.loadingDetail = false;
		}
	}

	// -----------------------------------------------------------------------
	// Navigation
	// -----------------------------------------------------------------------

	private goBack() {
		this.selectedReflection = null;
		this.memories = null;
		this.future = null;
		this.proposals = null;
		this.selectedDetailTab = "overview";
		this.error = null;
	}

	private async search() {
		this.offset = 0;
		await this.loadReflections();
	}

	private async nextPage() {
		if (this.offset + this.limit < this.totalCount) {
			this.offset += this.limit;
			await this.loadReflections();
		}
	}

	private async prevPage() {
		if (this.offset > 0) {
			this.offset = Math.max(0, this.offset - this.limit);
			await this.loadReflections();
		}
	}

	private async refresh() {
		await Promise.all([this.loadReflections(), this.loadStats()]);
	}

	private setDetailTab(tab: DetailTab) {
		this.selectedDetailTab = tab;
	}

	// -----------------------------------------------------------------------
	// Formatting helpers
	// -----------------------------------------------------------------------

	private formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		const s = sec % 60;
		return `${min}m ${s}s`;
	}

	private formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	private formatPercent(value: number): string {
		return `${(value * 100).toFixed(1)}%`;
	}

	private priorityColor(p: string): BadgeVariant {
		switch (p) {
			case "critical":
				return "destructive";
			case "high":
				return "destructive";
			case "normal":
				return "default";
			case "low":
				return "secondary";
			default:
				return "default";
		}
	}

	private badgeVariantForCategory(cat: string): BadgeVariant {
		switch (cat) {
			case "failure":
				return "destructive";
			case "success":
				return "default";
			case "architecture":
				return "outline";
			default:
				return "secondary";
		}
	}

	// -----------------------------------------------------------------------
	// Render: Main dispatcher
	// -----------------------------------------------------------------------

	protected override renderContent(): TemplateResult {
		const headerTitle = this.selectedReflection
			? (this.selectedReflection.planTitle ?? this.selectedReflection.planExecId)
			: i18n("Reflection Viewer");

		return html`
      ${DialogHeader({
			title: headerTitle,
			description: this.selectedReflection
				? `${i18n("Plan Execution")}: ${this.selectedReflection.planExecId}`
				: i18n("Browse and inspect brain reflection reports"),
			className: "flex-shrink-0",
		})}

      <div class="flex-1 overflow-y-auto mt-4">
        ${this.error ? this.renderError() : ""}
        ${this.selectedReflection ? this.renderDetail() : this.renderList()}
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Error
	// -----------------------------------------------------------------------

	private renderError(): TemplateResult {
		return html`
      <div
        class="mx-4 mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm"
      >
        ${this.error}
        <button
          class="ml-2 underline hover:no-underline"
          @click=${() => {
					this.error = null;
				}}
        >
          ${i18n("Dismiss")}
        </button>
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: List view
	// -----------------------------------------------------------------------

	private renderList(): TemplateResult {
		return html`
      <!-- Toolbar -->
      <div class="flex items-center gap-2 px-4 pb-3 flex-wrap">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          ${icon(Search, "sm", "text-muted-foreground shrink-0")}
          ${Input({
					placeholder: i18n("Search by plan title..."),
					value: this.filterTitle,
					onInput: (e: Event) => {
						this.filterTitle = (e.target as HTMLInputElement).value;
					},
					className: "h-8 text-sm flex-1",
				})}
          ${Button({
					children: i18n("Search"),
					variant: "default",
					size: "sm",
					onClick: () => this.search(),
				})}
        </div>

        <div class="flex items-center gap-1">
          ${Button({
					children: html`${icon(BarChart3, "sm")}`,
					variant: this.showStats ? "default" : "outline",
					size: "sm",
					title: i18n("Stats"),
					onClick: () => {
						this.showStats = !this.showStats;
					},
				})}
          ${Button({
					children: html`${icon(RefreshCw, "sm")}`,
					variant: "outline",
					size: "sm",
					title: i18n("Refresh"),
					onClick: () => this.refresh(),
				})}
        </div>
      </div>

      ${Separator()}

      <!-- Stats panel (collapsible) -->
      ${this.showStats && this.stats ? this.renderStatsPanel() : ""}

      <!-- Loading state -->
      ${
			this.loading
				? html`<div class="text-center py-12 text-muted-foreground text-sm">
            ${i18n("Loading...")}
          </div>`
				: this.reflections.length === 0
					? html`<div class="text-center py-12 text-muted-foreground text-sm">
              ${i18n("No reflections found")}
            </div>`
					: this.renderReflectionList()
		}

      <!-- Pagination -->
      ${
			this.totalCount > this.limit
				? html`<div class="flex items-center justify-between px-4 py-3 border-t border-border">
            <span class="text-xs text-muted-foreground">
              ${this.offset + 1}–${Math.min(this.offset + this.limit, this.totalCount)}
              ${i18n("of")} ${this.totalCount}
            </span>
            <div class="flex items-center gap-1">
              ${Button({
						children: html`${icon(ChevronLeft, "sm")}`,
						variant: "outline",
						size: "sm",
						disabled: this.offset <= 0,
						onClick: () => this.prevPage(),
					})}
              ${Button({
						children: html`${icon(ChevronRight, "sm")}`,
						variant: "outline",
						size: "sm",
						disabled: this.offset + this.limit >= this.totalCount,
						onClick: () => this.nextPage(),
					})}
            </div>
          </div>`
				: ""
		}
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Stats panel
	// -----------------------------------------------------------------------

	private renderStatsPanel(): TemplateResult {
		if (!this.stats) return html``;
		const entries = Object.entries(this.stats.byPlan).slice(0, 10);

		return html`
      <div class="mx-4 my-3 p-4 rounded-lg border border-border bg-secondary/30">
        <div class="flex items-center gap-2 mb-3">
          ${icon(BarChart3, "sm")}
          <span class="text-sm font-medium">${i18n("Reflection Statistics")}</span>
        </div>

        <div class="grid grid-cols-3 gap-4 mb-3">
          <div class="text-center">
            <div class="text-2xl font-bold text-foreground">${this.stats.total}</div>
            <div class="text-xs text-muted-foreground">${i18n("Total")}</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-foreground">
              ${Object.keys(this.stats.byPlan).length}
            </div>
            <div class="text-xs text-muted-foreground">${i18n("Plans")}</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-foreground">
              ${this.formatPercent(this.stats.avgConfidence)}
            </div>
            <div class="text-xs text-muted-foreground">${i18n("Avg Confidence")}</div>
          </div>
        </div>

        ${
				entries.length > 0
					? html`<div class="space-y-1">
              <div class="text-xs font-medium text-muted-foreground mb-1">
                ${i18n("By Plan")}:
              </div>
              ${entries.map(
						([planId, count]) => html`
                  <div class="flex items-center justify-between text-xs">
                    <span class="truncate pr-2 font-mono">${planId}</span>
                    ${Badge(String(count), "secondary")}
                  </div>
                `,
					)}
            </div>`
					: ""
			}
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Reflection list rows
	// -----------------------------------------------------------------------

	private renderReflectionList(): TemplateResult {
		return html`
      <div class="space-y-1 px-4 py-2">
        ${this.reflections.map((r) => this.renderReflectionRow(r))}
      </div>
    `;
	}

	private renderReflectionRow(r: ReflectionReport): TemplateResult {
		const rateColor =
			r.successRate >= 0.8 ? "text-green-500" : r.successRate >= 0.5 ? "text-yellow-500" : "text-red-500";

		return html`
      <div
        class="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
        @click=${() => this.loadDetail(r.planExecId)}
      >
        <div class="shrink-0 mt-0.5">${icon(Brain, "sm", "text-muted-foreground")}</div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm text-foreground truncate">${r.planTitle ?? r.planExecId}</span>
            ${Badge(this.formatPercent(r.confidence), "outline")}
          </div>

          <div class="text-xs text-muted-foreground mt-1 line-clamp-2">
            ${r.summary || r.whatPeopleNeedToKnow || "No summary"}
          </div>

          <div class="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>${this.formatDate(r.createdAt)}</span>
            <span>${r.workspaceCount} ${i18n("workspaces")}</span>
            <span class=${rateColor}>${this.formatPercent(r.successRate)}</span>
            <span>${this.formatDuration(r.totalDuration)}</span>
          </div>
        </div>
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Detail view
	// -----------------------------------------------------------------------

	private renderDetail(): TemplateResult {
		if (!this.selectedReflection) return html``;
		const r = this.selectedReflection;

		return html`
      <!-- Back button + tabs -->
      <div class="flex items-center gap-2 px-4 pb-2">
        ${Button({
				children: html`${icon(ArrowLeft, "sm")} ${i18n("Back")}`,
				variant: "ghost",
				size: "sm",
				onClick: () => this.goBack(),
			})}

        <div class="flex items-center gap-1 ml-auto">
          <button
            class="px-3 py-1 text-xs rounded-md transition-colors ${
					this.selectedDetailTab === "overview"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
				}"
            @click=${() => this.setDetailTab("overview")}
          >
            ${i18n("Overview")}
          </button>
          <button
            class="px-3 py-1 text-xs rounded-md transition-colors ${
					this.selectedDetailTab === "memories"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
				}"
            @click=${() => this.setDetailTab("memories")}
          >
            ${i18n("Memories")} ${this.memories ? `(${this.memories.length})` : ""}
          </button>
          <button
            class="px-3 py-1 text-xs rounded-md transition-colors ${
					this.selectedDetailTab === "future"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
				}"
            @click=${() => this.setDetailTab("future")}
          >
            ${i18n("Future")} ${this.future ? `(${this.future.length})` : ""}
          </button>
          <button
            class="px-3 py-1 text-xs rounded-md transition-colors ${
					this.selectedDetailTab === "proposals"
						? "bg-primary text-primary-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
				}"
            @click=${() => this.setDetailTab("proposals")}
          >
            ${i18n("Proposals")} ${this.proposals ? `(${this.proposals.length})` : ""}
          </button>
        </div>
      </div>

      ${Separator()}

      ${
			this.loadingDetail
				? html`<div class="text-center py-12 text-muted-foreground text-sm">
            ${i18n("Loading...")}
          </div>`
				: html`<div class="px-4 py-3">
            ${this.selectedDetailTab === "overview" ? this.renderOverview(r) : ""}
            ${this.selectedDetailTab === "memories" ? this.renderMemories() : ""}
            ${this.selectedDetailTab === "future" ? this.renderFuture() : ""}
            ${this.selectedDetailTab === "proposals" ? this.renderProposals() : ""}
          </div>`
		}
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Overview tab
	// -----------------------------------------------------------------------

	private renderOverview(r: ReflectionReport): TemplateResult {
		return html`
      <!-- Summary section -->
      <div class="mb-5">
        <h3 class="text-sm font-medium text-foreground mb-2">${i18n("Summary")}</h3>
        <p class="text-sm text-muted-foreground">${r.summary || r.whatPeopleNeedToKnow || "—"}</p>
      </div>

      <!-- Key Metrics -->
      <div class="mb-5">
        <h3 class="text-sm font-medium text-foreground mb-2">${i18n("Key Metrics")}</h3>
        <div class="grid grid-cols-4 gap-3">
          ${this.renderMetric(i18n("Success Rate"), this.formatPercent(r.successRate), "text-green-500")}
          ${this.renderMetric(i18n("Workspaces"), String(r.workspaceCount))}
          ${this.renderMetric(i18n("Succeeded"), String(r.successCount), "text-green-500")}
          ${this.renderMetric(i18n("Failed"), String(r.failureCount), r.failureCount > 0 ? "text-red-500" : "")}
          ${this.renderMetric(i18n("Retries"), String(r.retryCount))}
          ${this.renderMetric(i18n("Avg Retries"), r.avgRetryCount.toFixed(1))}
          ${this.renderMetric(i18n("Duration"), this.formatDuration(r.totalDuration))}
          ${this.renderMetric(i18n("Confidence"), this.formatPercent(r.confidence))}
          ${this.renderMetric(i18n("Validation Failures"), String(r.validationFailures), r.validationFailures > 0 ? "text-red-500" : "")}
          ${this.renderMetric(i18n("Policy Stops"), String(r.policyStops))}
          ${this.renderMetric(i18n("Approvals"), String(r.approvalRequests))}
          ${this.renderMetric(i18n("Safety Interventions"), String(r.safetyInterventions))}
        </div>
      </div>

      ${Separator()}

      <!-- What happened sections -->
      <div class="grid grid-cols-2 gap-4 mt-4">
        <!-- What Worked -->
        <div>
          <h4 class="text-xs font-medium text-green-600 mb-2 flex items-center gap-1">
            ${icon(TrendingUp, "xs")} ${i18n("What Worked")}
          </h4>
          ${
					r.whatWorked.length > 0
						? html`<ul class="space-y-1">
                ${r.whatWorked.map(
							(w) =>
								html`<li class="text-xs text-muted-foreground pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-green-500">${w}</li>`,
						)}
              </ul>`
						: html`<p class="text-xs text-muted-foreground italic">${i18n("None")}</p>`
				}
        </div>

        <!-- What Failed -->
        <div>
          <h4 class="text-xs font-medium text-red-600 mb-2 flex items-center gap-1">
            ${icon(ChevronRight, "xs")} ${i18n("What Failed")}
          </h4>
          ${
					r.whatFailed.length > 0
						? html`<ul class="space-y-1">
                ${r.whatFailed.map(
							(f) =>
								html`<li class="text-xs text-muted-foreground pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-red-500">${f}</li>`,
						)}
              </ul>`
						: html`<p class="text-xs text-muted-foreground italic">${i18n("None")}</p>`
				}
        </div>
      </div>

      <!-- What Slowed Down -->
      <div class="mt-4">
        <h4 class="text-xs font-medium text-yellow-600 mb-2">${i18n("What Slowed Down")}</h4>
        ${
				r.whatSlowedDown.length > 0
					? html`<ul class="space-y-1">
              ${r.whatSlowedDown.map(
						(s) =>
							html`<li class="text-xs text-muted-foreground pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-yellow-500">${s}</li>`,
					)}
            </ul>`
					: html`<p class="text-xs text-muted-foreground italic">${i18n("None")}</p>`
			}
      </div>

      <!-- Sources -->
      ${
			r.sources && r.sources.length > 0
				? html`<div class="mt-4">
            <h4 class="text-xs font-medium text-muted-foreground mb-2">${i18n("Sources")}</h4>
            <div class="flex flex-wrap gap-1">
              ${r.sources.map((s) => html`${Badge(`${s.type}:${s.id}`, "outline", "text-xs")}`)}
            </div>
          </div>`
				: ""
		}

      ${Separator()}

      <!-- People Need To Know -->
      ${
			r.whatPeopleNeedToKnow
				? html`<div class="mt-4">
            <h4 class="text-xs font-medium text-foreground mb-2">
              ${i18n("What People Need to Know")}
            </h4>
            <p class="text-xs text-muted-foreground">${r.whatPeopleNeedToKnow}</p>
          </div>`
				: ""
		}
    `;
	}

	private renderMetric(label: string, value: string, valueClass = ""): TemplateResult {
		return html`
      <div class="p-2 rounded border border-border bg-secondary/20 text-center">
        <div class="text-lg font-bold text-foreground ${valueClass}">${value}</div>
        <div class="text-[10px] text-muted-foreground mt-0.5">${label}</div>
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Memories tab
	// -----------------------------------------------------------------------

	private renderMemories(): TemplateResult {
		if (!this.memories || this.memories.length === 0) {
			return html`<div class="text-center py-12 text-muted-foreground text-sm">
        ${i18n("No memory proposals in this reflection.")}
      </div>`;
		}

		return html`
      <div class="space-y-3">
        ${this.memories.map(
				(m) => html`
            <div class="p-3 rounded-lg border border-border">
              <div class="flex items-start gap-2 mb-2">
                ${icon(Star, "sm", "text-yellow-500 shrink-0 mt-0.5")}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-foreground">${m.title}</span>
                    ${Badge(m.category, this.badgeVariantForCategory(m.category))}
                    ${Badge(this.formatPercent(m.confidence), "outline")}
                  </div>
                </div>
              </div>
              <p class="text-xs text-muted-foreground mt-1">${m.content}</p>
              ${
						m.sourceRefs && m.sourceRefs.length > 0
							? html`<div class="flex flex-wrap gap-1 mt-2">
                    ${m.sourceRefs.map((s) => html`${Badge(`${s.type}:${s.id}`, "outline", "text-[10px]")}`)}
                  </div>`
							: ""
					}
            </div>
          `,
			)}
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Future tab
	// -----------------------------------------------------------------------

	private renderFuture(): TemplateResult {
		if (!this.future || this.future.length === 0) {
			return html`<div class="text-center py-12 text-muted-foreground text-sm">
        ${i18n("No future phase suggestions in this reflection.")}
      </div>`;
		}

		return html`
      <div class="space-y-3">
        ${this.future.map(
				(f) => html`
            <div class="p-3 rounded-lg border border-border">
              <div class="flex items-start gap-2 mb-2">
                ${icon(Lightbulb, "sm", "text-amber-500 shrink-0 mt-0.5")}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-foreground">${f.title}</span>
                    ${Badge(f.priority, this.priorityColor(f.priority))}
                    ${Badge(`${f.estimatedWorkstreams} ws`, "secondary")}
                  </div>
                </div>
              </div>
              <p class="text-xs text-muted-foreground">${f.rationale}</p>
              ${
						(f.relatedMemoryIds && f.relatedMemoryIds.length > 0) ||
						(f.relatedObservationIds && f.relatedObservationIds.length > 0)
							? html`<div class="flex flex-wrap gap-1 mt-2">
                    ${(f.relatedMemoryIds ?? []).map((id) => html`${Badge(`mem:${id}`, "outline", "text-[10px]")}`)}
                    ${(f.relatedObservationIds ?? []).map(
								(id) => html`${Badge(`obs:${id}`, "outline", "text-[10px]")}`,
							)}
                  </div>`
							: ""
					}
            </div>
          `,
			)}
      </div>
    `;
	}

	// -----------------------------------------------------------------------
	// Render: Proposals tab
	// -----------------------------------------------------------------------

	private renderProposals(): TemplateResult {
		if (!this.proposals || this.proposals.length === 0) {
			return html`<div class="text-center py-12 text-muted-foreground text-sm">
        ${i18n("No proposals in this reflection.")}
      </div>`;
		}

		return html`
      <div class="space-y-3">
        ${this.proposals.map(
				(p) => html`
            <div class="p-3 rounded-lg border border-border">
              <div class="flex items-start gap-2 mb-2">
                ${icon(List, "sm", "text-blue-500 shrink-0 mt-0.5")}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-foreground">${p.title}</span>
                    ${Badge(p.type, "secondary")}
                    ${Badge(p.priority, this.priorityColor(p.priority))}
                  </div>
                </div>
              </div>
              <p class="text-xs text-muted-foreground">${p.description}</p>
              ${
						p.rationale
							? html`<p class="text-xs text-muted-foreground mt-1 italic">
                    ${i18n("Rationale")}: ${p.rationale}
                  </p>`
							: ""
					}
              ${
						p.evidenceIds && p.evidenceIds.length > 0
							? html`<div class="flex flex-wrap gap-1 mt-2">
                    ${p.evidenceIds.map((id) => html`${Badge(id, "outline", "text-[10px]")}`)}
                  </div>`
							: ""
					}
            </div>
          `,
			)}
      </div>
    `;
	}
}
