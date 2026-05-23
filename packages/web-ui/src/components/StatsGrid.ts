import { icon } from "@mariozechner/mini-lit";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * A single stat item shown in the grid.
 */
export interface GridStat {
	/** Icon component reference (e.g. from lucide). */
	icon?: unknown;
	/** Label displayed above the value. */
	label: string;
	/** Primary value to display. */
	value: string;
	/** Optional sublabel below the value (explanation / formula). */
	sublabel?: string;
	/** If true, label/icon use an accent colour (e.g. blue). */
	accent?: boolean;
}

/**
 * Responsive stats grid that renders stat cards in a 2-column layout on
 * small screens and a 4-column layout on larger screens (lg breakpoint).
 *
 * Usage:
 * ```html
 * <stats-grid .stats=${[
 *   { icon: DollarSign, label: "Revenue", value: "$12,345", accent: true },
 *   { icon: Activity,   label: "Users",   value: "1,234" },
 * ]}></stats-grid>
 * ```
 */
@customElement("stats-grid")
export class StatsGrid extends LitElement {
	/** Array of stat items to display in the grid. */
	@property({ type: Array }) stats: GridStat[] = [];

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render(): TemplateResult {
		if (!this.stats || this.stats.length === 0) {
			return html``;
		}

		return html`
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-3" role="list">
				${this.stats.map((stat) => this.renderStat(stat))}
			</div>
		`;
	}

	private renderStat(stat: GridStat): TemplateResult {
		const { icon: Icon, label, value, sublabel, accent = false } = stat;

		return html`
			<div
				class="flex flex-col gap-2 p-4 rounded-xl border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E]"
				role="listitem"
			>
				<div
					class="flex items-center gap-1.5 ${accent
						? "text-blue-600 dark:text-blue-400"
						: "text-stone-400 dark:text-stone-500"}"
				>
					${Icon ? icon(Icon as any, "sm") : ""}
					<span class="text-[10px] font-semibold tracking-widest uppercase">${label}</span>
				</div>
				<p class="text-xl font-semibold text-stone-800 dark:text-stone-200 tracking-tight leading-none">
					${value}
				</p>
				${sublabel
					? html`
							<p class="text-[9px] text-stone-400 dark:text-stone-500 leading-none">${sublabel}</p>
						`
					: ""}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"stats-grid": StatsGrid;
	}
}
