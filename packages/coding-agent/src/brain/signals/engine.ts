/**
 * Signal & Anomaly Engine — Engine (V5.06)
 *
 * Core signal detection, deduplication, and feeding logic.
 *
 * Acceptance criteria:
 * 1. Repeated validation signature after threshold creates validation_repeat signal.
 * 2. A memory conflict that affects a proposal creates a decision-impact warning signal.
 * 3. Signals dedupe through cooldown keys and do not spam.
 * 4. Signals can feed proposals, push, overview, and Ask Pi answers.
 *
 * @packageDocumentation
 */

import type { BrainTimelineStore } from "../timeline-store.js";
import type { BrainSignal, BrainTimelineEvent, SignalType } from "../types.js";
import { createBrainSignal, createBrainTimelineEvent } from "../types.js";
import type { V5EventSink } from "../v5/types.js";
import type {
	CooldownConfig,
	DecisionImpactContext,
	SignalDedupKey,
	SignalEngineConfig,
	SignalEngineState,
	SignalFeedTarget,
	ValidationSignature,
} from "./types.js";
import { DEFAULT_SIGNAL_ENGINE_CONFIG, formatDedupKey } from "./types.js";

// =========================================================================
// CooldownTracker
// =========================================================================

class CooldownTracker {
	private readonly _cooldowns: Map<string, number> = new Map();
	private readonly _config: CooldownConfig;

	constructor(config: CooldownConfig) {
		this._config = config;
	}

	isInCooldown(key: SignalDedupKey): boolean {
		const raw = formatDedupKey(key);
		const expiry = this._cooldowns.get(raw);
		if (expiry === undefined) return false;
		if (Date.now() >= expiry) {
			this._cooldowns.delete(raw);
			return false;
		}
		return true;
	}

	startCooldown(key: SignalDedupKey): void {
		const raw = formatDedupKey(key);
		const durationMs = this._config.perTypeCooldownMs[key.signalType] ?? this._config.defaultCooldownMs;
		this._cooldowns.set(raw, Date.now() + durationMs);
	}

	getExpiry(key: SignalDedupKey): number | null {
		const raw = formatDedupKey(key);
		return this._cooldowns.get(raw) ?? null;
	}

	clear(): void {
		this._cooldowns.clear();
	}

	get size(): number {
		return this._cooldowns.size;
	}

	getEntries(): Array<{ key: string; expiresAt: string }> {
		const now = Date.now();
		const entries: Array<{ key: string; expiresAt: string }> = [];
		for (const [key, expiry] of this._cooldowns) {
			if (now < expiry) {
				entries.push({ key, expiresAt: new Date(expiry).toISOString() });
			}
		}
		return entries;
	}

	prune(): void {
		const now = Date.now();
		for (const [key, expiry] of this._cooldowns) {
			if (now >= expiry) {
				this._cooldowns.delete(key);
			}
		}
	}
}

// =========================================================================
// ValidationRepeatTracker
// =========================================================================

class ValidationRepeatTracker {
	private readonly _signatures: Map<string, ValidationSignature> = new Map();
	private readonly _threshold: number;
	private readonly _windowMs: number;

	constructor(threshold: number, windowMs: number) {
		this._threshold = threshold;
		this._windowMs = windowMs;
	}

	record(signature: string, label: string): ValidationSignature {
		const now = new Date().toISOString();
		const nowMs = Date.now();
		const existing = this._signatures.get(signature);

		if (!existing) {
			const sig: ValidationSignature = { signature, label, count: 1, firstSeen: now, lastSeen: now };
			this._signatures.set(signature, sig);
			return sig;
		}

		const firstMs = new Date(existing.firstSeen).getTime();
		if (nowMs - firstMs > this._windowMs) {
			const sig: ValidationSignature = { signature, label, count: 1, firstSeen: now, lastSeen: now };
			this._signatures.set(signature, sig);
			return sig;
		}

		existing.count += 1;
		existing.lastSeen = now;
		return existing;
	}

	hasExceededThreshold(signature: string): boolean {
		const sig = this._signatures.get(signature);
		if (!sig) return false;
		return sig.count >= this._threshold;
	}

	reset(signature: string): void {
		this._signatures.delete(signature);
	}

	getSignatures(): Map<string, ValidationSignature> {
		return new Map(this._signatures);
	}

	prune(): void {
		const nowMs = Date.now();
		for (const [sig, info] of this._signatures) {
			const firstMs = new Date(info.firstSeen).getTime();
			if (nowMs - firstMs > this._windowMs) {
				this._signatures.delete(sig);
			}
		}
	}
}

// =========================================================================
// SignalEngine
// =========================================================================

export class SignalEngine {
	private readonly _config: SignalEngineConfig;
	private readonly _timelineStore: BrainTimelineStore;
	private readonly _eventSink: V5EventSink;
	private readonly _cooldownTracker: CooldownTracker;
	private _validationRepeatTracker: ValidationRepeatTracker;
	private _totalEmitted = 0;
	private _suppressedByCooldown = 0;

	constructor(config: Partial<SignalEngineConfig>, timelineStore: BrainTimelineStore, eventSink: V5EventSink) {
		this._config = { ...DEFAULT_SIGNAL_ENGINE_CONFIG, ...config };
		this._timelineStore = timelineStore;
		this._eventSink = eventSink;
		this._cooldownTracker = new CooldownTracker(this._config.cooldown);
		this._validationRepeatTracker = new ValidationRepeatTracker(
			this._config.validationRepeat.threshold,
			this._config.validationRepeat.windowMs,
		);
	}

	get config(): SignalEngineConfig {
		return this._config;
	}

	updateConfig(config: Partial<SignalEngineConfig>): void {
		Object.assign(this._config, config);
		this._validationRepeatTracker = new ValidationRepeatTracker(
			this._config.validationRepeat.threshold,
			this._config.validationRepeat.windowMs,
		);
	}

	// =====================================================================
	// AC1: Validation Repeat
	// =====================================================================

	async recordValidation(
		signature: string,
		label: string,
		metadata?: Record<string, unknown>,
	): Promise<BrainSignal | null> {
		if (!this._config.enabled) return null;

		const sig = this._validationRepeatTracker.record(signature, label);
		if (!this._validationRepeatTracker.hasExceededThreshold(signature)) return null;

		const dedupKey: SignalDedupKey = { signalType: "validation_repeat", scope: signature };
		if (this._cooldownTracker.isInCooldown(dedupKey)) {
			this._suppressedByCooldown++;
			return null;
		}

		const signal = createBrainSignal({
			observationIds: [],
			pattern: `validation_repeat:${signature}`,
			summary: `Validation "${label}" repeated ${sig.count} times within the detection window`,
			confidence: Math.min(0.5 + (sig.count - this._config.validationRepeat.threshold) * 0.1, 0.95),
			severity: sig.count >= this._config.validationRepeat.threshold + 3 ? "warning" : "info",
			metadata: { signature, label, count: sig.count, firstSeen: sig.firstSeen, lastSeen: sig.lastSeen },
		});

		await this._emitSignal(signal, dedupKey, metadata);
		this._validationRepeatTracker.reset(signature);
		return signal;
	}

	// =====================================================================
	// AC2: Decision Impact
	// =====================================================================

	async recordMemoryConflictDecisionImpact(context: DecisionImpactContext): Promise<BrainSignal | null> {
		if (!this._config.enabled) return null;

		const scope = context.affectedProposalId ?? context.conflictingMemoryIds.join("+");
		const dedupKey: SignalDedupKey = { signalType: "decision_impact", scope };

		if (this._cooldownTracker.isInCooldown(dedupKey)) {
			this._suppressedByCooldown++;
			return null;
		}

		const signal = createBrainSignal({
			observationIds: [],
			pattern: `decision_impact:${context.conflictType}:${scope}`,
			summary: context.impactSummary,
			confidence: 0.85,
			severity: "warning",
			metadata: {
				conflictingMemoryIds: context.conflictingMemoryIds,
				conflictType: context.conflictType,
				memoryTitles: context.memoryTitles,
				affectedProposalId: context.affectedProposalId,
				affectedProposalTitle: context.affectedProposalTitle,
				impactSummary: context.impactSummary,
			},
		});

		await this._emitSignal(signal, dedupKey);
		return signal;
	}

	// =====================================================================
	// AC4: Signal Feeding
	// =====================================================================

	async feedSignal(signal: BrainSignal, customTargets?: SignalFeedTarget[]): Promise<void> {
		const signalType = signal.pattern.split(":")[0] as SignalType;
		const targets = customTargets ?? this._config.feedRouting[signalType] ?? ["overview", "ask_pi"];

		for (const target of targets) {
			switch (target) {
				case "overview":
				case "ask_pi":
					// Already in timeline store; surfaced via getSignals() / digest
					break;
				case "proposal":
					await this._markForProposal(signal);
					break;
				case "push":
					await this._pushToKernel(signal);
					break;
			}
		}
	}

	async feedAllActiveSignals(): Promise<void> {
		const events = await this._timelineStore.list({ eventTypes: ["signal"], limit: 1000 });
		for (const event of events) {
			const signal = this._timelineEventToSignal(event);
			if (signal) await this.feedSignal(signal);
		}
	}

	// =====================================================================
	// State
	// =====================================================================

	async getState(): Promise<SignalEngineState> {
		const events = await this._timelineStore.list({ eventTypes: ["signal"], limit: 10000 });
		const activeCount = events.filter((e) => {
			const data = e.data as Record<string, unknown> | undefined;
			return !data?.resolvedAt;
		}).length;

		return {
			activeCount,
			totalEmitted: this._totalEmitted,
			suppressedByCooldown: this._suppressedByCooldown,
			activeCooldowns: this._cooldownTracker.getEntries(),
			enabled: this._config.enabled,
		};
	}

	getValidationSignatures(): Map<string, ValidationSignature> {
		return this._validationRepeatTracker.getSignatures();
	}

	// =====================================================================
	// Maintenance
	// =====================================================================

	prune(): void {
		this._cooldownTracker.prune();
		this._validationRepeatTracker.prune();
	}

	async resolveSignal(signalId: string): Promise<boolean> {
		const events = await this._timelineStore.list({ limit: 10000 });
		const target = events.find((e) => {
			if (e.eventType !== "signal") return false;
			const d = e.data as Record<string, unknown> | undefined;
			return d?.id === signalId;
		});
		if (!target) return false;

		const data = (target.data as Record<string, unknown>) ?? {};
		data.resolvedAt = new Date().toISOString();

		const resolvedEvent = createBrainTimelineEvent({
			eventType: "signal",
			severity: target.severity,
			data: { ...data, resolvedSignalId: signalId, resolved: true },
			workspaceId: target.workspaceId,
			planExecId: target.planExecId,
		});

		await this._timelineStore.append(resolvedEvent);
		return true;
	}

	// =====================================================================
	// Internal Helpers
	// =====================================================================

	private async _emitSignal(
		signal: BrainSignal,
		dedupKey: SignalDedupKey,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		this._cooldownTracker.startCooldown(dedupKey);
		const timelineEvent = createBrainTimelineEvent({
			eventType: "signal",
			severity: signal.severity,
			data: { ...signal, metadata: { ...signal.metadata, ...metadata }, dedupKey: formatDedupKey(dedupKey) },
		});

		const result = await this._eventSink.emit({ kind: "timeline", event: timelineEvent });
		if (result.ok) {
			this._totalEmitted++;
			await this.feedSignal(signal);
		}
	}

	private async _markForProposal(signal: BrainSignal): Promise<void> {
		const markerEvent = createBrainTimelineEvent({
			eventType: "observation",
			severity: "info",
			data: {
				markerType: "signal_feed_proposal",
				signalId: signal.id,
				signalPattern: signal.pattern,
				signalSummary: signal.summary,
				signalConfidence: signal.confidence,
				signalSeverity: signal.severity,
				timestamp: new Date().toISOString(),
			},
		});
		await this._eventSink.emit({ kind: "timeline", event: markerEvent });
	}

	private async _pushToKernel(signal: BrainSignal): Promise<void> {
		const signalTypeLabel = signal.pattern.split(":")[0] ?? "unknown";
		await this._eventSink.emit({
			kind: "actor",
			event: {
				type: "proposal_submitted",
				timestamp: Date.now(),
				payload: {
					signalId: signal.id,
					signalType: signalTypeLabel,
					signalSummary: signal.summary,
					confidence: signal.confidence,
					severity: signal.severity,
					title: `Signal: ${signal.summary}`,
					description: signal.summary,
					evidence: signal.observationIds,
					pattern: signal.pattern,
				},
			},
		});
	}

	private _timelineEventToSignal(event: BrainTimelineEvent): BrainSignal | null {
		const data = event.data as Record<string, unknown> | undefined;
		if (!data) return null;
		return {
			id: event.id,
			observationIds: (data.observationIds as string[]) ?? [],
			pattern: (data.pattern as string) ?? "",
			summary: (data.summary as string) ?? "",
			confidence: (data.confidence as number) ?? 0,
			severity: event.severity,
			createdAt: event.timestamp,
			resolvedAt: (data.resolvedAt as string) ?? undefined,
			metadata: (data.metadata as Record<string, unknown>) ?? {},
		};
	}
}

export function createSignalEngine(
	timelineStore: BrainTimelineStore,
	eventSink: V5EventSink,
	config?: Partial<SignalEngineConfig>,
): SignalEngine {
	return new SignalEngine(config ?? {}, timelineStore, eventSink);
}
