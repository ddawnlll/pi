import { Button, type ButtonVariant } from "@mariozechner/mini-lit/dist/Button.js";
import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Empty state component for showing placeholder content when no data exists.
 *
 * Usage:
 * ```ts
 * html`<empty-state
 *   .title=${"No items found"}
 *   .description=${"Try adjusting your filters or create a new item."}
 *   .action=${{ label: "Create", onClick: () => createItem() }}
 * ></empty-state>`
 * ```
 */
@customElement("empty-state")
export class EmptyState extends LitElement {
	/** Optional Lucide icon to display above the title. Pass the rendered icon via icon(). */
	@property({ attribute: false }) icon?: TemplateResult;

	/** Title text (i18n key or raw string). */
	@property() title = "";

	/** Optional description text. */
	@property() description = "";

	/** Optional action button configuration. */
	@property({ attribute: false }) action?: { label: string; onClick: () => void; variant?: ButtonVariant };

	protected createRenderRoot() {
		return this;
	}

	override connectedCallback() {
		super.connectedCallback();
		this.style.display = "block";
	}

	override render() {
		return html`
			<div class="flex flex-col items-center justify-center py-12 px-6 text-center" role="status">
				${this.icon ? html`<div class="mb-4 text-muted-foreground">${this.icon}</div>` : ""}
				<h3 class="text-sm font-medium text-foreground mb-1">${this.title}</h3>
				${
					this.description
						? html`<p class="text-xs text-muted-foreground max-w-xs mb-4">${this.description}</p>`
						: ""
				}
				${
					this.action
						? Button({
								onClick: this.action.onClick,
								variant: this.action.variant ?? "default",
								size: "sm",
								children: this.action.label,
							})
						: ""
				}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"empty-state": EmptyState;
	}
}
