import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Send, Loader2, Bot, User, X, AlertCircle, Terminal, Code,
  CheckCircle2, XCircle, FileText, ClipboardList, AlertTriangle,
  Lightbulb, Wrench, FolderOpen, GitBranch, Archive,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEvent[];
  /** Context references attached when the message was sent */
  contextRefs?: ContextRef[];
}

interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  status?: "running" | "success" | "error";
  result?: string;
}

/** A reference to a project-scoped entity that the chat can mention. */
export interface ContextRef {
  kind: "plan" | "run" | "workspace" | "artifact";
  id: string;
  label: string;
}

/** Quick action preset that pre-fills a context-aware prompt. */
export interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  prompt: string;
  /** Which context kind(s) this action requires. If empty, always available. */
  requires?: ContextRef["kind"][];
}

interface ChatPanelProps {
  isOpen: boolean;
  projectId: string | null;
  onClose: () => void;
  /** Currently selected context references from the dashboard. */
  contextRefs?: ContextRef[];
  /** Callback when a context ref is clicked (e.g. to navigate to it). */
  onContextRefClick?: (ref: ContextRef) => void;
}

// ---------------------------------------------------------------------------
// Quick action definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "summarize-run",
    label: "Summarize run",
    icon: ClipboardList,
    prompt: "Summarize the current plan execution: what workspaces ran, what succeeded, what failed, and overall status.",
    requires: ["run"],
  },
  {
    id: "explain-failure",
    label: "Explain failure",
    icon: AlertTriangle,
    prompt: "Explain why the execution failed. Identify the root cause workspace(s), error messages, and suggest remediation steps.",
    requires: ["run"],
  },
  {
    id: "followup-plan",
    label: "Generate follow-up plan",
    icon: Lightbulb,
    prompt: "Based on the current execution results, generate a follow-up plan that addresses any failures and remaining work.",
    requires: ["run"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

/** Icon for a context ref kind. */
function refKindIcon(kind: ContextRef["kind"]): React.ElementType {
  switch (kind) {
    case "plan":      return FileText;
    case "run":       return ClipboardList;
    case "workspace": return Wrench;
    case "artifact":  return Archive;
  }
}

/** Render a short pill label for a context ref. */
function ContextRefPill({
  ctx,
  removable,
  onRemove,
  onClick,
}: {
  ctx: ContextRef;
  removable?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  const Icon = refKindIcon(ctx.kind);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${ACC_BG} ${ACC_TXT} cursor-pointer hover:opacity-80 transition-opacity`}
      onClick={onClick}
      title={`Go to ${ctx.kind}: ${ctx.label}`}
    >
      <Icon size={10} className="shrink-0" />
      <span className="truncate max-w-[100px]">{ctx.label}</span>
      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-0.5 hover:text-red-500 dark:hover:text-red-400 shrink-0"
          aria-label={`Remove context: ${ctx.label}`}
        >
          <X size={9} />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Markdown components
// ---------------------------------------------------------------------------

/** Custom component map for react-markdown with dashboard styling. */
const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-xs font-semibold mb-1 mt-2 first:mt-0">{children}</h3>
  ),
  code: ({ className, children, ...props }: React.ComponentPropsWithoutRef<"code">) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1 py-0.5 rounded bg-stone-200/70 dark:bg-[#333] text-[10px] font-mono">
          {children}
        </code>
      );
    }
    return (
      <div className="relative group mb-3 last:mb-0">
        <pre className="overflow-x-auto rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-stone-50 dark:bg-[#1a1a1a] p-3 text-xs leading-relaxed">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-3 italic mb-2 text-stone-600 dark:text-stone-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#E8E6E1] dark:border-[#333]" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-3">
      <table className="w-full text-xs border-collapse border border-[#E8E6E1] dark:border-[#333]">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1 bg-stone-100 dark:bg-[#252525] font-semibold text-left">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1">{children}</td>
  ),
};

/** Render markdown content with syntax highlighting. */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Main ChatPanel
// ---------------------------------------------------------------------------

/**
 * Project Chat dialog — a conversational interface that can reference
 * selected plans, runs, workspaces, and artifacts.
 *
 * **Invariant:** This component is strictly read-only with respect to
 * execution state. It never directly calls control endpoints
 * (pause/stop/resume) or mutates plan execution data. It only sends
 * chat messages and displays responses.
 */
export function ChatPanel({
  isOpen,
  projectId,
  onClose,
  contextRefs: externalContextRefs = [],
  onContextRefClick,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachedRefs, setAttachedRefs] = useState<ContextRef[]>(externalContextRefs);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Reset state when dialog opens with a new project
  useEffect(() => {
    if (!isOpen) return;
    sessionIdRef.current = crypto.randomUUID();
    setAttachedRefs(externalContextRefs);
    setError(null);

    if (!projectId) return;

    fetch(`${API_BASE}/api/projects/${projectId}/chat/history`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data) => {
        if (data.messages?.length) {
          setMessages(data.messages);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [isOpen, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the animation start
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ── Send message ──────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || !projectId || streaming) return;

      setInput("");
      setError(null);
      const snapshotRefs = [...attachedRefs];
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, contextRefs: snapshotRefs },
      ]);
      setStreaming(true);
      setStreamBuffer("");
      setActiveToolCalls([]);

      const toolCallMap = new Map<string, ToolCallEvent>();

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const sessionId = sessionIdRef.current;
        const response = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            message: text,
            sessionId,
            contextRefs: snapshotRefs.map((r) => ({
              kind: r.kind,
              id: r.id,
              label: r.label,
            })),
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          setError(`HTTP ${response.status}: ${response.statusText}`);
          setStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("No response body");
          setStreaming(false);
          return;
        }

        let fullText = "";
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data);

              if (event.type === "text") {
                fullText += event.text;
                setStreamBuffer(fullText);
              } else if (event.type === "error") {
                setError(event.message);
              } else if (event.type === "done") {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: fullText,
                    toolCalls: Array.from(toolCallMap.values()),
                  },
                ]);
                setStreamBuffer("");
                setActiveToolCalls([]);
                setStreaming(false);
              } else if (event.type === "tool_call") {
                const toolId = event.tool.toolCallId || event.tool.name;
                const existing = toolCallMap.get(toolId);
                if (existing) {
                  existing.status = "success";
                } else {
                  toolCallMap.set(toolId, {
                    name: event.tool.name,
                    args: event.tool.args,
                    toolCallId: event.tool.toolCallId,
                    status: "running",
                  });
                }
                setActiveToolCalls(Array.from(toolCallMap.values()));
                fullText += `\n[Executing: ${event.tool.name}]\n`;
                setStreamBuffer(fullText);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(String(err));
        }
      } finally {
        setStreamBuffer("");
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [input, projectId, streaming, attachedRefs]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Quick action handlers ──────────────────────────────────────────────
  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      // Check if required context is present
      if (action.requires?.length) {
        const hasRequired = action.requires.some((req) =>
          attachedRefs.some((r) => r.kind === req)
        );
        if (!hasRequired) return;
      }
      sendMessage(action.prompt);
    },
    [sendMessage, attachedRefs]
  );

  const removeAttachedRef = useCallback((refId: string) => {
    setAttachedRefs((prev) => prev.filter((r) => `${r.kind}:${r.id}` !== refId));
  }, []);

  // ── Determine which quick actions are available ───────────────────────
  const availableQuickActions = QUICK_ACTIONS.filter((action) => {
    if (!action.requires?.length) return true;
    return action.requires.some((req) =>
      attachedRefs.some((r) => r.kind === req)
    );
  });

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className={`${SURF} border ${BORD} rounded-lg shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[80vh] min-h-[400px]`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`shrink-0 flex items-center justify-between px-5 h-11 border-b ${BORD}`}>
              <div className="flex items-center gap-2">
                <Bot size={15} className="text-blue-600 dark:text-blue-400" />
                <span className={`text-xs font-semibold ${TXT}`}>
                  Project Chat
                </span>
              </div>
              <button
                onClick={onClose}
                className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}
              >
                <X size={16} />
              </button>
            </div>

            {/* Context refs bar */}
            {attachedRefs.length > 0 && (
              <div className={`shrink-0 flex items-center gap-1.5 px-4 py-1.5 border-b ${BORD} flex-wrap`}>
                <span className={`text-[9px] uppercase tracking-widest ${MUT} font-semibold mr-1`}>
                  Context
                </span>
                {attachedRefs.map((r) => (
                  <ContextRefPill
                    key={`${r.kind}:${r.id}`}
                    ctx={r}
                    removable
                    onRemove={() => removeAttachedRef(`${r.kind}:${r.id}`)}
                    onClick={() => onContextRefClick?.(r)}
                  />
                ))}
                <button
                  onClick={() => setAttachedRefs([])}
                  className={`ml-auto text-[10px] ${MUT} hover:text-red-500 dark:hover:text-red-400 transition-colors`}
                  title="Clear all context references"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Quick actions */}
            {!streaming && availableQuickActions.length > 0 && (
              <div className={`shrink-0 flex items-center gap-1.5 px-4 py-2 border-b ${BORD} overflow-x-auto`}>
                {availableQuickActions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap
                        transition-colors border ${BORD}
                        text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]
                        hover:border-stone-300 dark:hover:border-[#555]`}
                      title={action.prompt}
                    >
                      <ActionIcon size={11} className="shrink-0" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
              {messages.length === 0 && !streaming && (
                <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-400 dark:text-stone-500">
                  <Bot size={24} strokeWidth={1.2} />
                  <p className="text-xs text-center">
                    Ask about the project, execution results,
                    <br />
                    or request changes.
                  </p>
                  {attachedRefs.length > 0 && (
                    <p className={`text-[10px] text-center mt-1 ${MUT}`}>
                      {attachedRefs.length} context reference
                      {attachedRefs.length !== 1 ? "s" : ""} attached
                    </p>
                  )}
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <Bot
                      size={14}
                      className="shrink-0 mt-1 text-blue-600 dark:text-blue-400"
                    />
                  )}
                  <div className="max-w-[85%] space-y-1.5">
                    {/* Context refs shown for user messages */}
                    {msg.role === "user" && msg.contextRefs && msg.contextRefs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-0.5">
                        {msg.contextRefs.map((r) => (
                          <ContextRefPill
                            key={`${r.kind}:${r.id}-${i}`}
                            ctx={r}
                            onClick={() => onContextRefClick?.(r)}
                          />
                        ))}
                      </div>
                    )}
                    {/* Message content - markdown rendered */}
                    <div
                      className={`rounded-lg px-3 py-2 leading-relaxed ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <MarkdownContent content={msg.content} />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                    </div>
                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-1">
                        {msg.toolCalls.map((tc, j) => (
                          <div
                            key={j}
                            className={`flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-[#252525] rounded px-2 py-1`}
                          >
                            {tc.name === "bash" ? (
                              <Terminal size={10} className="shrink-0" />
                            ) : tc.name === "edit" || tc.name === "write" ? (
                              <Code size={10} className="shrink-0" />
                            ) : (
                              <Bot size={10} className="shrink-0" />
                            )}
                            <span className="font-medium">{tc.name}</span>
                            <span className="text-stone-400 dark:text-stone-500 truncate">
                              {typeof tc.args === "object" && tc.args !== null
                                ? JSON.stringify(tc.args).slice(0, 60)
                                : ""}
                            </span>
                            {tc.status === "success" && (
                              <CheckCircle2
                                size={10}
                                className="ml-auto shrink-0 text-green-500"
                              />
                            )}
                            {tc.status === "error" && (
                              <XCircle size={10} className="ml-auto shrink-0 text-red-500" />
                            )}
                            {tc.status === "running" && (
                              <Loader2
                                size={10}
                                className="ml-auto shrink-0 text-blue-500 animate-spin"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <User size={14} className="shrink-0 mt-1 text-stone-400" />
                  )}
                </div>
              ))}

              {activeToolCalls.length > 0 && (
                <div className="flex gap-2 justify-start">
                  <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />
                  <div className="space-y-1">
                    {activeToolCalls.map((tc, j) => (
                      <div
                        key={j}
                        className={`flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-[#252525] rounded px-2 py-1`}
                      >
                        {tc.name === "bash" ? (
                          <Terminal size={10} className="shrink-0" />
                        ) : tc.name === "edit" || tc.name === "write" ? (
                          <Code size={10} className="shrink-0" />
                        ) : (
                          <Bot size={10} className="shrink-0" />
                        )}
                        <span className="font-medium">{tc.name}</span>
                        <span className="text-stone-400 dark:text-stone-500 truncate">
                          {typeof tc.args === "object" && tc.args !== null
                            ? JSON.stringify(tc.args).slice(0, 60)
                            : ""}
                        </span>
                        {tc.status === "running" && (
                          <Loader2
                            size={10}
                            className="ml-auto shrink-0 text-blue-500 animate-spin"
                          />
                        )}
                        {tc.status === "success" && (
                          <CheckCircle2
                            size={10}
                            className="ml-auto shrink-0 text-green-500"
                          />
                        )}
                        {tc.status === "error" && (
                          <XCircle size={10} className="ml-auto shrink-0 text-red-500" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {streamBuffer && (
                <div className="flex gap-2 justify-start">
                  <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`}>
                    <MarkdownContent content={streamBuffer} />
                    <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 justify-center">
                  <AlertCircle size={11} />
                  {error}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className={`shrink-0 border-t ${BORD} p-4`}>
              {/* Attached context bar in input area */}
              {attachedRefs.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {attachedRefs.map((r) => (
                    <ContextRefPill
                      key={`input-${r.kind}:${r.id}`}
                      ctx={r}
                      removable
                      onRemove={() => removeAttachedRef(`${r.kind}:${r.id}`)}
                      onClick={() => onContextRefClick?.(r)}
                    />
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    attachedRefs.length > 0
                      ? `Ask about ${attachedRefs.map((r) => r.kind).join(", ")}...`
                      : "Ask about the project or suggest fixes..."
                  }
                  rows={3}
                  disabled={!projectId || streaming}
                  className={`flex-1 resize-none rounded-lg border ${BORD} ${SURF} px-3 py-2 text-xs ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500 disabled:opacity-50`}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || streaming || !projectId}
                  className="h-10 w-10 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {streaming ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
              {!projectId && (
                <p className={`text-[10px] ${MUT} mt-1`}>
                  Select a project to enable chat
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
