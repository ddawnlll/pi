# Prompt Cache Architecture

## Overview

The prompt cache architecture separates the LLM prompt into a **cacheable prefix** (static content that remains stable across turns) and a **dynamic suffix** (content that changes per request). This enables server-side prompt caching on supported LLM providers (Anthropic, OpenAI, etc.), reducing token costs and latency.

## Architecture

```
┌─────────────────────────────────────────────┐
│               Full Context                   │
├──────────────────────┬──────────────────────┤
│  Cacheable Prefix    │  Dynamic Suffix      │
│  ────────────────    │  ───────────────     │
│  • System prompt     │  • Current date      │
│  • Tool definitions  │  • Working dir       │
│  • Pinned messages   │  • Recent messages   │
│  • Safety policy     │  • Extension appends │
│  • Edit strategy     │  • Skills content    │
│  • Completion gate   │  • Project context   │
│                      │                      │
│  hash: stable        │  hash: changes       │
│  version: 1          │  every turn          │
└──────────────────────┴──────────────────────┘
```

## Layers

### 1. `@earendil-works/pi-ai` — Core primitives (`packages/ai/src/prompt-cache.ts`)

Provides the foundational split logic:

- `assemblePrompt(context, options)` — splits a `Context` into `{ version, prefix, suffix }`
- `computePrefixHash(prefix)` — deterministic hash of the cacheable prefix
- `computeContextPrefixHash(context, options)` — convenience for direct context-to-hash
- `prefixHashStableAcrossSuffixChange(a, b, options)` — validation helper
- `CACHE_PREFIX_VERSION` — global version number (bump to invalidate all cached entries)

**Types:**

- `PromptAssembly` — `{ version, prefix: PromptPrefix, suffix: Message[] }`
- `PromptPrefix` — `{ systemPrompt, tools, pinnedMessages }`
- `PromptAssemblyOptions` — `{ pinnedMessageCount }`

### 2. `@earendil-works/pi-coding-agent` — Coding agent policy (`src/context/prompt-cache-policy.ts`)

Extends the ai primitives with coding-agent-specific classification:

- `PromptCachePolicy` class with:
  - `classifySection(kind)` — returns `Cacheability`: `static_cacheable`, `semi_static_cacheable`, or `dynamic_non_cacheable`
  - `classifySystemPrompt(prompt)` — splits the system prompt text into static and dynamic (date/cwd) sections
  - `classifyTools(tools)` — classifies tool definitions as cacheable
  - `classifyMessages(messages, pinnedMessageCount)` — splits messages into pinned (semi-cacheable) and recent (dynamic)
  - `buildContextReport(context, options)` — builds a full classified section report
  - `extractCacheablePrefix(context, options)` — extracts the cacheable prefix from a context
  - `computeContextPrefixHash(context, options)` — hash of cacheable prefix

- `ContextSection` — `{ kind, content, cacheability, priority, tokenEstimate, source, hash }`
- `Cacheability` — `"static_cacheable" | "semi_static_cacheable" | "dynamic_non_cacheable"`

### 3. `@earendil-works/pi-coding-agent` — Prompt assembler (`src/context/prompt-assembler.ts`)

Bridges the ai primitives with coding-agent data structures:

- `PromptAssembler` class with:
  - `assemble(context, options)` — returns `PromptAssemblyResult` with hash, estimates, and classified sections
  - `assembleRaw(context, options)` — delegates to ai `assemblePrompt` directly
  - `computePrefixHash(context, options)` — convenience hash computation
  - `isPrefixStable(a, b, options)` — compares prefix hashes between two contexts
  - `getPolicy()` — returns the underlying policy instance

- `PromptAssemblyResult` — `{ context, options, prefixHash, pinnedMessageCount, suffixMessageCount, totalTokenEstimate, cacheableTokenEstimate, dynamicTokenEstimate, sections, version }`

## Cacheable vs Dynamic Classification

| Kind | Cacheability | Reason |
|------|-------------|--------|
| `system_prompt` | static_cacheable | Core instructions, stable across session |
| `tool_definitions` | static_cacheable | Tools change rarely, stable per session |
| `safety_policy` | static_cacheable | Safety rules are fixed per policy version |
| `edit_strategy_policy` | static_cacheable | Strategy is fixed per session config |
| `completion_gate_rules` | static_cacheable | Gate rules are fixed per session |
| `execution_contract` | static_cacheable | Contract is stable per workspace |
| `stable_project_conventions` | static_cacheable | Project conventions are stable |
| `pinned_messages` | semi_static_cacheable | Fixed within a session, changes across sessions |
| `current_date` | dynamic_non_cacheable | Changes daily |
| `current_directory` | dynamic_non_cacheable | Changes across projects |
| `project_context_files` | dynamic_non_cacheable | File content may change |
| `skills_content` | dynamic_non_cacheable | Skills are per-project |
| `extension_append` | dynamic_non_cacheable | Per-turn extension modifications |
| `recent_messages` | dynamic_non_cacheable | Changes every turn |
| `latest_tool_result` | dynamic_non_cacheable | Changes every execution |
| `retry_state` | dynamic_non_cacheable | Changes per attempt |
| `current_diff` | dynamic_non_cacheable | Changes per edit |

## Prefix Version Invalidation

The `CACHE_PREFIX_VERSION` constant controls cache invalidation:

- Every `PromptPrefix` hash includes the version number
- When safety or policy rules change, bump the version
- All cached entries with the old version are automatically invalidated
- Consumers should compare version numbers before reusing cache entries

## Token Estimation

Token estimates use a rough heuristic of **1 token per 4 characters** (a common approximation). The `PromptAssemblyResult` includes:

- `totalTokenEstimate` — total estimated tokens for the full context
- `cacheableTokenEstimate` — estimated tokens in the cacheable prefix
- `dynamicTokenEstimate` — estimated tokens in the dynamic suffix

## Usage Example

```typescript
import { PromptAssembler } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";

const assembler = new PromptAssembler();

// Build your prompt context
const context: Context = {
  systemPrompt: "You are an expert coding assistant...\nCurrent date: 2026-05-14\nCurrent working directory: /project",
  tools: [{ name: "read", description: "Read files", parameters: { type: "object" } }],
  messages: [
    { role: "user", content: "Hello", timestamp: 1000 },
    { role: "user", content: "Follow up", timestamp: 2000 },
  ],
};

// Assemble with 1 pinned message
const result = assembler.assemble(context, { pinnedMessageCount: 1 });

console.log(result.prefixHash);          // stable hash string
console.log(result.suffixMessageCount);  // 1 (follow-up is dynamic)
console.log(result.sections);            // classified sections array

// Check if prefix is stable across two contexts
const stable = assembler.isPrefixStable(contextA, contextB);
```

## Testing

Tests are in `packages/coding-agent/test/prompt-cache-policy.test.ts` and cover:

1. **AC1** — Assembly separates cacheable prefix from dynamic suffix
2. **AC2** — Static prefix hash remains stable across equivalent calls
3. **AC3** — Dynamic suffix changes do not change prefix hash
4. **AC4** — Cache prefix version invalidates on safety/policy changes
5. **AC5** — Integration scenarios with stable prefix and changing suffix
6. Edge cases (empty context, undefined fields, large pinned count)

Run with:

```bash
npm test -- prompt-cache-policy
```
