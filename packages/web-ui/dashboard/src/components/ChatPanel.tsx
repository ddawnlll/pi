import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Send, Loader2, Bot, User, X, AlertCircle, Terminal, Code,
  CheckCircle2, XCircle, FileText, ClipboardList, AlertTriangle,
  Lightbulb, Wrench, FolderOpen, GitBranch, Archive, Search,
  FileEdit, Eye, Minimize2, ChevronDown, ChevronUp, Brain, Plus, MessageSquare,
  Copy, ArrowDown, Maximize2,
  Pencil, RefreshCw, Download, Filter,
  CheckSquare, Square, ChevronRight,
  Star, ThumbsUp, ThumbsDown, Mic, MicOff, BarChart2,
  Ellipsis, Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const API_BASE = "";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEvent[];
  contextRefs?: ContextRef[];
  createdAt?: Date;
  branchCount?: number;
  branchIds?: string[];
  parentSessionId?: string;
  parentMessageIndex?: number;
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  status?: "pending" | "running" | "success" | "error";
  result?: string;
  durationMs?: number;
  startedAt?: number;
}

export interface ContextRef {
  kind: "plan" | "run" | "workspace" | "artifact";
  id: string;
  label: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: React.ElementType;
  prompt: string;
  requires?: ContextRef["kind"][];
}

export interface SavedPrompt {
  id: string;
  name: string;
  description: string;
  template: string;
  tags: string[];
}

interface AiModelInfo {
  provider: string;
  models: Array<{ id: string; name: string }>;
}

interface ChatSession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: Date;
}

interface ChatPanelProps {
  isOpen: boolean;
  projectId: string | null;
  onClose: () => void;
  contextRefs?: ContextRef[];
  onContextRefClick?: (ref: ContextRef) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  { id: "summarize-run", label: "Summarize run", icon: ClipboardList, prompt: "Summarize the current plan execution: what workspaces ran, what succeeded, what failed, and overall status.", requires: ["run"] },
  { id: "explain-failure", label: "Explain failure", icon: AlertTriangle, prompt: "Explain why the execution failed. Identify the root cause workspace(s), error messages, and suggest remediation steps.", requires: ["run"] },
  { id: "followup-plan", label: "Generate follow-up plan", icon: Lightbulb, prompt: "Based on the current execution results, generate a follow-up plan that addresses any failures and remaining work.", requires: ["run"] },
];

const DEFAULT_SAVED_PROMPTS: SavedPrompt[] = [
  { id: "explain-error", name: "Explain error", description: "Diagnose a failure", template: "Explain why this error occurred and how to fix it:\n\n```\n{{error}}\n```", tags: ["debug"] },
  { id: "write-tests", name: "Write tests", description: "Generate unit tests", template: "Write comprehensive unit tests for the following code. Cover edge cases:\n\n{{code}}", tags: ["testing"] },
  { id: "refactor", name: "Refactor", description: "Clean up code", template: "Refactor the following code to improve readability, performance, and maintainability. Explain each change:\n\n{{code}}", tags: ["code"] },
  { id: "pr-description", name: "PR description", description: "Draft a pull request", template: "Write a clear pull request description for these changes:\n\n{{changes}}", tags: ["git"] },
  { id: "summarize", name: "Summarize", description: "Summarize content", template: "Summarize the following in 3-5 bullet points:\n\n{{content}}", tags: ["writing"] },
];

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function extractErrorMessage(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return String(r.message ?? r.detail ?? r.code ?? JSON.stringify(raw));
  }
  return "Unknown error";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function refKindIcon(kind: ContextRef["kind"]): React.ElementType {
  switch (kind) {
    case "plan":      return FileText;
    case "run":       return ClipboardList;
    case "workspace": return Wrench;
    case "artifact":  return Archive;
  }
}

interface ToolBadgeConfig { icon: React.ElementType; bg: string; dot: string }
const TOOL_BADGES: Record<string, ToolBadgeConfig> = {
  read:    { icon: Eye,      bg: "bg-blue-100 dark:bg-blue-900/40",      dot: "bg-blue-500" },
  write:   { icon: FileEdit, bg: "bg-amber-100 dark:bg-amber-900/40",    dot: "bg-amber-500" },
  edit:    { icon: Code,     bg: "bg-violet-100 dark:bg-violet-900/40",  dot: "bg-violet-500" },
  bash:    { icon: Terminal, bg: "bg-emerald-100 dark:bg-emerald-900/40",dot: "bg-emerald-500" },
  search:  { icon: Search,   bg: "bg-cyan-100 dark:bg-cyan-900/40",      dot: "bg-cyan-500" },
  default: { icon: Bot,      bg: "bg-stone-100 dark:bg-[#252525]",       dot: "bg-stone-400" },
};

function getToolBadge(name: string): ToolBadgeConfig {
  return TOOL_BADGES[name] ?? TOOL_BADGES.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────────────────

function ContextRefPill({ ctx, removable, onRemove, onClick }: { ctx: ContextRef; removable?: boolean; onRemove?: () => void; onClick?: () => void }) {
  const Icon = refKindIcon(ctx.kind);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${ACC_BG} ${ACC_TXT} cursor-pointer hover:opacity-80 transition-opacity`}
      onClick={onClick} title={`Go to ${ctx.kind}: ${ctx.label}`}>
      <Icon size={10} className="shrink-0" />
      <span className="truncate max-w-[100px]">{ctx.label}</span>
      {removable && (
        <button onClick={(e) => { e.stopPropagation(); onRemove?.(); }} className="ml-0.5 hover:text-red-500 dark:hover:text-red-400 shrink-0" aria-label={`Remove context: ${ctx.label}`}>
          <X size={9} />
        </button>
      )}
    </span>
  );
}

function DiffViewer({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="font-mono text-[10px] leading-5 overflow-x-auto">
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        return (
          <div key={i} className={
            isAdd ? "bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300" :
            isDel ? "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" :
            "text-stone-600 dark:text-stone-400"
          }>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function ToolResultPanel({ tc, compact = false }: { tc: ToolCallEvent; compact?: boolean }) {
  // Auto-expand when tool completes (success/error) with a result
  const [expanded, setExpanded] = useState(
    !compact || (tc.status !== "running" && tc.status !== "pending" && !!tc.result)
  );
  
  // Auto-expand when status transitions to success/error with result
  useEffect(() => {
    if (tc.status !== "running" && tc.status !== "pending" && !!tc.result) {
      setExpanded(true);
    }
  }, [tc.status, tc.result]);
  const cfg = getToolBadge(tc.name);
  const Icon = cfg.icon;
  const isError = tc.status === "error";
  
  const durationDisplay = useMemo(() => {
    if (!tc.durationMs) return null;
    if (tc.durationMs < 1000) return `${tc.durationMs}ms`;
    return `${(tc.durationMs / 1000).toFixed(1)}s`;
  }, [tc.durationMs]);
  
  const hasDiff = useMemo(() => {
    if (!tc.result) return false;
    return tc.result.includes("+++") || tc.result.includes("---") || tc.result.split("\n").some(l => l.startsWith("+") || l.startsWith("-"));
  }, [tc.result]);
  
  const displayResult = useMemo(() => {
    if (!tc.result) return null;
    const lines = tc.result.split("\n");
    if (lines.length > 300) {
      return { truncated: true, content: lines.slice(0, 300).join("\n"), remaining: lines.length - 300 };
    }
    return { truncated: false, content: tc.result, remaining: 0 };
  }, [tc.result]);
  
  const [showAll, setShowAll] = useState(false);
  
  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono ${cfg.bg} ${MUT} hover:opacity-80 transition-opacity`}
        aria-label={`Expand ${tc.name} result`}
      >
        <Icon size={9} /><span>{tc.name}</span>
        {tc.status === "running" && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse ml-0.5`} />}
        {tc.status === "success" && <CheckCircle2 size={9} className="text-green-500 ml-0.5" />}
        {tc.status === "error" && <XCircle size={9} className="text-red-500 ml-0.5" />}
        <ChevronDown size={9} className="ml-0.5" />
      </button>
    );
  }
  
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      className={`rounded border ${BORD} overflow-hidden mb-2 ${isError ? "bg-red-50 dark:bg-red-950/20" : ""}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] ${cfg.bg} ${MUT} hover:opacity-80 transition-opacity ${isError ? "bg-red-100 dark:bg-red-900/40" : ""}`}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${tc.name} result`}
      >
        <Icon size={10} className="shrink-0" />
        <span className="font-medium">{tc.name}</span>
        {tc.status === "running" && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse ml-auto shrink-0`} />}
        {tc.status === "success" && <CheckCircle2 size={10} className="text-green-500 ml-auto shrink-0" />}
        {tc.status === "error" && <XCircle size={10} className="text-red-500 ml-auto shrink-0" />}
        {durationDisplay && <span className="ml-2 opacity-60 text-[9px]">{durationDisplay}</span>}
        <ChevronDown size={10} className={`ml-auto shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="max-h-80 overflow-y-auto bg-white dark:bg-[#1a1a1a] p-2">
              {isError && tc.result && (
                <div className="text-red-600 dark:text-red-400 text-[10px] mb-2 font-medium">
                  <AlertCircle size={10} className="inline mr-1" />
                  {tc.result}
                </div>
              )}
              {!isError && displayResult && (
                <>
                  {hasDiff ? (
                    <DiffViewer content={displayResult.content} />
                  ) : (
                    <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-all font-mono text-stone-700 dark:text-stone-300">
                      {displayResult.content}
                    </pre>
                  )}
                  {displayResult.truncated && !showAll && (
                    <button
                      onClick={() => setShowAll(true)}
                      className="text-[9px] text-blue-600 dark:text-blue-400 hover:underline mt-1"
                    >
                      Show {displayResult.remaining} more lines
                    </button>
                  )}
                </>
              )}
              {!tc.result && tc.status === "running" && (
                <span className="text-[10px] text-stone-400">Running...</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ToolTimeline({ toolCalls }: { toolCalls: ToolCallEvent[] }) {
  const total = useMemo(() => toolCalls.reduce((s, t) => s + (t.durationMs ?? 200), 0), [toolCalls]);
  
  const formatTotalDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  if (toolCalls.length === 0) return null;
  
  return (
    <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] overflow-x-auto">
      <span className="text-[9px] text-stone-400 shrink-0 mr-1">Timeline:</span>
      {toolCalls.map((tc, idx) => {
        const cfg = getToolBadge(tc.name);
        const widthPct = total > 0 ? ((tc.durationMs ?? 200) / total) * 100 : 100 / toolCalls.length;
        const isFailed = tc.status === "error";
        return (
          <motion.button
            key={tc.toolCallId ?? idx}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(widthPct, 10)}%` }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            className={`h-5 min-w-[40px] rounded text-[8px] font-medium truncate px-1 relative ${cfg.bg} ${MUT} hover:opacity-80 text-center overflow-hidden`}
            title={`${tc.name}${tc.durationMs ? ` (${formatTotalDuration(tc.durationMs)})` : ""}`}
          >
            {tc.name.slice(0, 6)}
            {isFailed && <span className="absolute inset-0 flex items-center justify-center bg-red-500/20">x</span>}
          </motion.button>
        );
      })}
      <span className="text-[9px] text-stone-400 shrink-0 ml-2">
        {toolCalls.length} tool{toolCalls.length !== 1 ? "s" : ""} · {formatTotalDuration(total)}
      </span>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      <motion.span className="w-1.5 h-1.5 rounded-full bg-blue-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
      <motion.span className="w-1.5 h-1.5 rounded-full bg-blue-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
      <motion.span className="w-1.5 h-1.5 rounded-full bg-blue-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
    </span>
  );
}

function StreamContent({ content, hasToolCalls }: { content: string; hasToolCalls: boolean }) {
  if (content.length > 0) {
    return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}><MarkdownContent content={content} /></motion.div>;
  }
  if (hasToolCalls) return <span className="inline-flex items-center gap-1 text-[10px] italic text-stone-400">Processing<ThinkingDots /></span>;
  return <span className="inline-flex items-center gap-1 text-[10px] italic text-stone-400">Thinking<ThinkingDots /></span>;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") ?? "";
  const code = useMemo(() => {
    const arr = Array.isArray(children) ? children : [children];
    return arr.map((c) => (typeof c === "string" ? c : "")).join("");
  }, [children]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [code]);

  return (
    <div className="relative group mb-3 last:mb-0">
      <div className="flex items-center justify-between px-3 py-1 rounded-t-lg border border-b-0 border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#222]">
        <span className="text-[9px] uppercase tracking-wider font-mono text-stone-400 dark:text-stone-500">{lang || "code"}</span>
        <button onClick={handleCopy}
          className={`inline-flex items-center gap-1 text-[9px] transition-colors ${copied ? "text-green-500" : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"}`}>
          {copied ? <><CheckCircle2 size={9} />Copied</> : <><Copy size={9} />Copy</>}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-lg border border-[#E8E6E1] dark:border-[#333] bg-stone-50 dark:bg-[#1a1a1a] p-3 text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const CHECKBOX_RE = /^\[([ xX])\]\s*/;

function CheckboxItem({ checked, children }: { checked: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 leading-relaxed">
      <span className={`shrink-0 mt-0.5 ${checked ? "text-green-600 dark:text-green-400" : "text-stone-400 dark:text-stone-500"}`}>
        {checked ? <CheckSquare size={11} /> : <Square size={11} />}
      </span>
      <span className="flex-1">{children}</span>
    </li>
  );
}

function isCheckboxText(text: string): { checked: boolean; rest: string } | null {
  const m = CHECKBOX_RE.exec(text);
  if (m) return { checked: m[1].toLowerCase() === "x", rest: text.slice(m[0].length) };
  return null;
}

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => {
    const childArr = React.Children.toArray(children);
    if (childArr.length === 1 && typeof childArr[0] === "string") {
      const cb = isCheckboxText(childArr[0] as string);
      if (cb) return <CheckboxItem checked={cb.checked}>{cb.rest}</CheckboxItem>;
    }
    return <li className="leading-relaxed">{children}</li>;
  },
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-2 mt-5 first:mt-0 pb-1 border-b border-[#E8E6E1] dark:border-[#333]">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-1.5 mt-4 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-xs font-semibold mb-1 mt-3 first:mt-0">{children}</h3>,
  code: ({ className, children }: React.ComponentPropsWithoutRef<"code">) => {
    const isInline = !className;
    if (isInline) return <code className="px-1 py-0.5 rounded bg-stone-200/70 dark:bg-[#333] text-[10px] font-mono">{children}</code>;
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }: React.ComponentPropsWithoutRef<"a">) => <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-3 my-2 text-stone-600 dark:text-stone-400 italic">{children}</blockquote>,
  table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse">{children}</table></div>,
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-stone-100 dark:bg-[#222]">{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b border-[#E8E6E1] dark:border-[#333]">{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="text-left px-2 py-1 font-medium text-stone-600 dark:text-stone-400">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="px-2 py-1 text-stone-700 dark:text-stone-300">{children}</td>,
  hr: () => <hr className="my-3 border-[#E8E6E1] dark:border-[#333]" />,
};

const MarkdownContent = React.memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
});

function MessageBubble({
  msg,
  index,
  onContextRefClick,
  onEdit,
  onRegenerate,
  isLastAssistant,
  isPinned,
  onTogglePin,
  messageFeedback,
  onFeedback,
  onSubmitFeedback,
}: {
  msg: ChatMessage;
  index: number;
  onContextRefClick?: (ref: ContextRef) => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  messageFeedback?: { rating: 1 | -1 | null; comment?: string };
  onFeedback?: (rating: 1 | -1) => void;
  onSubmitFeedback?: (comment: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showFeedbackComment, setShowFeedbackComment] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [msg.content]);

  const handleSubmitFeedback = useCallback(() => {
    onSubmitFeedback?.(feedbackComment);
    setShowFeedbackComment(false);
    setFeedbackComment("");
  }, [feedbackComment, onSubmitFeedback]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`flex gap-2 group ${msg.role === "user" ? "justify-end" : "justify-start"} ${isPinned ? "border-l-2 border-amber-400 pl-1" : ""}`}
    >
      {msg.role === "assistant" && <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />}
      <div className="max-w-[85%] space-y-1.5">
        {msg.role === "user" && msg.contextRefs?.length ? (
          <div className="flex flex-wrap gap-1 mb-0.5">{msg.contextRefs.map((r) => <ContextRefPill key={`${r.kind}:${r.id}-${index}`} ctx={r} onClick={() => onContextRefClick?.(r)} />)}</div>
        ) : null}

        <div className={`rounded-lg px-3 py-2 leading-relaxed relative ${msg.role === "user" ? "bg-blue-600 text-white" : `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`}`}>
          {isPinned && (
            <div className="absolute -top-2 -right-2">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500 }}>
                <Star size={12} className="text-amber-500 fill-amber-500" />
              </motion.div>
            </div>
          )}
          {msg.role === "assistant" ? <MarkdownContent content={msg.content} /> : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}

          {msg.createdAt && (
            <div className={`text-[8px] mt-1.5 ${msg.role === "user" ? "text-blue-200" : MUT}`}>
              {formatRelativeTime(msg.createdAt)}
            </div>
          )}

          <div className={`absolute -bottom-4 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}>
            <button onClick={handleCopy}
              className={`p-0.5 rounded ${copied ? "text-green-500" : MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`}
              title="Copy message" aria-label="Copy message">
              {copied ? <CheckCircle2 size={9} /> : <Copy size={9} />}
            </button>

            {msg.role === "assistant" && onTogglePin && (
              <button onClick={onTogglePin}
                className={`p-0.5 rounded ${isPinned ? "text-amber-500" : MUT} hover:text-amber-500 transition-colors`}
                title={isPinned ? "Unpin message" : "Pin message"} aria-label={isPinned ? "Unpin message" : "Pin message"}>
                <Star size={9} className={isPinned ? "fill-amber-500" : ""} />
              </button>
            )}

            {msg.role === "assistant" && (
              <>
                <button onClick={() => onFeedback?.(1)}
                  className={`p-0.5 rounded ${messageFeedback?.rating === 1 ? "text-green-500" : MUT} hover:text-green-500 transition-colors`}
                  title="Good response" aria-label="Thumbs up">
                  <ThumbsUp size={9} />
                </button>
                <button onClick={() => onFeedback?.(-1)}
                  className={`p-0.5 rounded ${messageFeedback?.rating === -1 ? "text-red-500" : MUT} hover:text-red-500 transition-colors`}
                  title="Poor response" aria-label="Thumbs down">
                  <ThumbsDown size={9} />
                </button>
              </>
            )}

            {msg.role === "user" && onEdit && (
              <button onClick={onEdit} className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`} title="Edit message" aria-label="Edit message">
                <Pencil size={9} />
              </button>
            )}

            {msg.role === "assistant" && isLastAssistant && onRegenerate && (
              <button onClick={onRegenerate} className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`} title="Regenerate" aria-label="Regenerate response">
                <RefreshCw size={9} />
              </button>
            )}
          </div>
        </div>

        {msg.role === "assistant" && messageFeedback?.rating === -1 && !showFeedbackComment && (
          <div className="mt-1">
            <button onClick={() => setShowFeedbackComment(true)} className={`text-[9px] ${MUT} hover:text-stone-600 underline`}>
              Add feedback
            </button>
          </div>
        )}

        {msg.role === "assistant" && showFeedbackComment && (
          <div className="flex gap-1 mt-1">
            <textarea
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="What was wrong?"
              className={`flex-1 text-[9px] px-2 py-1 rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} resize-none`}
              rows={2}
              aria-label="Feedback comment"
            />
            <button onClick={handleSubmitFeedback} className={`text-[9px] px-2 py-1 rounded ${ACC_BG} ${ACC_TXT}`}>
              Submit
            </button>
          </div>
        )}

        {msg.toolCalls?.length ? (
          <div className="space-y-1">
            <ToolTimeline toolCalls={msg.toolCalls} />
            {msg.toolCalls.map((tc, j) => <ToolResultPanel key={j} tc={tc} compact />)}
          </div>
        ) : null}
      </div>
      {msg.role === "user" && <User size={14} className="shrink-0 mt-1 text-stone-400" />}
    </motion.div>
  );
}

// Remaining message count (for status bar)
function ChatStatusBar({ provider, model, contextUsed, contextLimit, aiModels, onSelectModel, onCompact, compacting }: {
  provider: string; model: string; contextUsed: number; contextLimit: number;
  aiModels: AiModelInfo[]; onSelectModel: (p: string, m: string) => void;
  onCompact: () => void; compacting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const pct = contextLimit > 0 ? Math.min(100, Math.round((contextUsed / contextLimit) * 100)) : 0;
  const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className={`shrink-0 flex items-center gap-2 px-4 py-1.5 border-b ${BORD} bg-stone-50 dark:bg-[#161616] text-[9px] relative`}>
      <button onClick={() => setMenuOpen(!menuOpen)} className={`inline-flex items-center gap-1 ${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors shrink-0`} title="Change model">
        <Brain size={10} /><span className="font-medium">{provider}</span><span className="opacity-60">/</span><span className="opacity-80">{model}</span><ChevronDown size={8} className="opacity-50" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(false); setSearchQuery(""); }} />
          <div className="absolute left-2 top-full mt-1 z-20 w-72 max-h-64 overflow-hidden rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E] shadow-lg p-1 flex flex-col"
            onKeyDown={(e) => { if (e.key === "Escape") { setMenuOpen(false); setSearchQuery(""); } }}>
            <div className="relative mb-1 shrink-0">
              <Search size={10} className={`absolute left-2 top-1/2 -translate-y-1/2 ${MUT}`} />
              <input ref={searchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..." autoFocus
                className={`w-full pl-7 pr-2 py-1.5 text-[10px] bg-transparent ${TXT} placeholder-stone-400 focus:outline-none`} />
            </div>
            <div className="flex-1 overflow-y-auto">
              {aiModels.map((p) => (
                <div key={p.provider}>
                  <div className={`px-2 py-1 text-[9px] font-semibold ${MUT} uppercase tracking-wider sticky top-0 bg-white dark:bg-[#1E1E1E]`}>{p.provider}</div>
                  {p.models.filter((m) => searchQuery === "" || m.name.toLowerCase().includes(searchQuery.toLowerCase())).map((m) => (
                    <button key={m.id} onClick={() => { onSelectModel(p.provider, m.id); setMenuOpen(false); setSearchQuery(""); }}
                      className={`w-full text-left px-2 py-1.5 text-[10px] rounded ${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}>
                      {m.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-[#333] overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className={MUT}>{contextUsed.toLocaleString()} / {contextLimit.toLocaleString()} tokens</span>
      <button onClick={onCompact} disabled={compacting}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors ${compacting ? "opacity-50" : MUT} hover:text-stone-700 dark:hover:text-stone-300`}
        title="Compact context">
        {compacting ? <Loader2 size={9} className="animate-spin" /> : <Archive size={9} />}
        <span>Compact</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PinnedMessagesPanel
// ─────────────────────────────────────────────────────────────────────────────

function PinnedMessagesPanel({ pinnedIndices, messages, onClose, onJump }: {
  pinnedIndices: Set<number>;
  messages: ChatMessage[];
  onClose: () => void;
  onJump: (index: number) => void;
}) {
  const pinnedMsgs = useMemo(() =>
    Array.from(pinnedIndices).sort((a, b) => a - b).map(i => ({ index: i, msg: messages[i] })),
    [pinnedIndices, messages]
  );

  return (
    <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 260, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`shrink-0 border-l ${BORD} flex flex-col overflow-hidden bg-white dark:bg-[#1E1E1E]`}
    >
      <div className={`shrink-0 flex items-center justify-between px-3 h-10 border-b ${BORD}`}>
        <span className={`text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>Pinned Messages</span>
        <button onClick={onClose} className={`${MUT} hover:text-stone-600`}><X size={12} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {pinnedMsgs.length === 0 ? (
          <div className={`text-[10px] ${MUT} text-center py-4`}>No pinned messages</div>
        ) : (
          pinnedMsgs.map(({ index, msg }) => (
            <button key={index} onClick={() => onJump(index)}
              className={`w-full text-left p-2 rounded border ${BORD} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
            >
              <div className="flex items-center gap-1 mb-1">
                <Star size={9} className="text-amber-500 fill-amber-500" />
                <span className={`text-[9px] ${MUT}`}>Message {index + 1}</span>
              </div>
              <p className={`text-[10px] ${TXT} line-clamp-2`}>{msg.content.slice(0, 100)}{msg.content.length > 100 ? "..." : ""}</p>
            </button>
          ))
        )}
      </div>
      {pinnedMsgs.length > 0 && (
        <div className={`shrink-0 px-3 py-2 border-t ${BORD}`}>
          <button className={`text-[9px] ${MUT} hover:text-red-500 flex items-center gap-1`}>
            <Trash2 size={9} /> Clear all pins
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SessionStatsPanel
// ─────────────────────────────────────────────────────────────────────────────

function SessionStatsPanel({ messages, onClose }: { messages: ChatMessage[]; onClose: () => void }) {
  const stats = useMemo(() => {
    const toolCalls = messages.flatMap(m => m.toolCalls ?? []);
    const byType = toolCalls.reduce<Record<string, number>>((acc, tc) => {
      acc[tc.name] = (acc[tc.name] ?? 0) + 1;
      return acc;
    }, {});
    const filePaths = toolCalls
      .filter(tc => ["read", "write", "edit"].includes(tc.name))
      .map(tc => String(tc.args?.path ?? tc.args?.file_path ?? ""))
      .filter(Boolean);
    const uniqueFiles = [...new Set(filePaths)];
    const firstMsg = messages[0]?.createdAt;
    const lastMsg = messages[messages.length - 1]?.createdAt;
    const durationMs = firstMsg && lastMsg ? lastMsg.getTime() - firstMsg.getTime() : 0;
    const errorCount = toolCalls.filter(t => t.status === "error").length;
    return {
      totalMessages: messages.length,
      toolCalls: toolCalls.length,
      byType,
      uniqueFiles,
      durationMs,
      errorCount
    };
  }, [messages]);

  const formatDuration = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  const maxTypeCount = Math.max(...Object.values(stats.byType), 1);

  return (
    <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={`shrink-0 border-l ${BORD} flex flex-col overflow-hidden bg-white dark:bg-[#1E1E1E]`}
    >
      <div className={`shrink-0 flex items-center justify-between px-3 h-10 border-b ${BORD}`}>
        <span className={`text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>Session Stats</span>
        <button onClick={onClose} className={`${MUT} hover:text-stone-600`}><X size={12} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className={`p-2 rounded border ${BORD} text-center`}>
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">{stats.totalMessages}</div>
            <div className={`text-[9px] ${MUT}`}>Messages</div>
          </div>
          <div className={`p-2 rounded border ${BORD} text-center`}>
            <div className="text-sm font-bold text-green-600 dark:text-green-400">{stats.toolCalls}</div>
            <div className={`text-[9px] ${MUT}`}>Tool Calls</div>
          </div>
          <div className={`p-2 rounded border ${BORD} text-center`}>
            <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{stats.errorCount}</div>
            <div className={`text-[9px] ${MUT}`}>Errors</div>
          </div>
          <div className={`p-2 rounded border ${BORD} text-center`}>
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400">{formatDuration(stats.durationMs)}</div>
            <div className={`text-[9px] ${MUT}`}>Duration</div>
          </div>
        </div>

        {stats.uniqueFiles.length > 0 && (
          <div>
            <div className={`text-[9px] font-semibold ${MUT} mb-1`}>Files Touched ({stats.uniqueFiles.length})</div>
            <div className="max-h-24 overflow-y-auto space-y-0.5">
              {stats.uniqueFiles.slice(0, 10).map((f, i) => (
                <div key={i} className={`text-[9px] ${TXT} truncate`}>{f}</div>
              ))}
              {stats.uniqueFiles.length > 10 && <div className={`text-[9px] ${MUT}`}>+{stats.uniqueFiles.length - 10} more</div>}
            </div>
          </div>
        )}

        {stats.toolCalls > 0 && (
          <div>
            <div className={`text-[9px] font-semibold ${MUT} mb-1`}>Tool Call Breakdown</div>
            <div className="space-y-1">
              {Object.entries(stats.byType).map(([name, count]) => {
                return (
                  <div key={name} className="flex items-center gap-1">
                    <span className={`text-[9px] w-12 truncate ${MUT}`}>{name}</span>
                    <div className="flex-1 h-2 bg-stone-100 dark:bg-[#333] rounded overflow-hidden">
                      <div className="h-full bg-blue-100 dark:bg-blue-900/40" style={{ width: `${(count / maxTypeCount) * 100}%` }} />
                    </div>
                    <span className={`text-[9px] w-4 text-right ${MUT}`}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: export chat
// ─────────────────────────────────────────────────────────────────────────────

function exportChatMessages(messages: ChatMessage[]): string {
  return messages.map(m => {
    const role = m.role === "user" ? "You" : "AI";
    const refs = m.contextRefs?.length ? ` [${m.contextRefs.map(r => r.label).join(", ")}]` : "";
    return `## ${role}${refs}\n\n${m.content}\n`;
  }).join("---\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ChatPanel({ isOpen, projectId, onClose, contextRefs: externalContextRefs = [], onContextRefClick }: ChatPanelProps) {
  // Basic state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachedRefs, setAttachedRefs] = useState<ContextRef[]>(externalContextRefs);

  // Model state
  const [chatProvider, setChatProvider] = useState("opencode-go");
  const [chatModel, setChatModel] = useState("deepseek-v4-flash");
  const [contextLimit, setContextLimit] = useState(128000);
  const [contextUsed, setContextUsed] = useState(0);
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [compacting, setCompacting] = useState(false);

  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Editing + search
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Scroll
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // File search
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string; ext: string; dir: string; isDir: boolean }>>([]);
  const [fileBrowserPath, setFileBrowserPath] = useState("");
  const [fileBrowserEntries, setFileBrowserEntries] = useState<Array<{ name: string; path: string; isDir: boolean; ext: string; size: number; dir: string }>>([]);
  const [fileBrowserParent, setFileBrowserParent] = useState("");
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchActiveIdx, setFileSearchActiveIdx] = useState<number | null>(null);

  // Feature 4: Pins
  const [pinnedIndices, setPinnedIndices] = useState<Set<number>>(new Set());
  const [showPins, setShowPins] = useState(false);

  // Feature 5: Slash command prompts
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(DEFAULT_SAVED_PROMPTS);
  const [promptPickerIdx, setPromptPickerIdx] = useState<number | null>(null);

  // Feature 6: Drag-drop
  const [isDragOver, setIsDragOver] = useState(false);

  // Feature 7: Stats
  const [showStats, setShowStats] = useState(false);

  // Feature 9: Feedback
  const [feedback, setFeedback] = useState<Record<number, { rating: 1 | -1 | null; comment?: string }>>({});

  // Feature 10: Voice input
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Refs
  const fileSearchRef = useRef<HTMLDivElement>(null);
  const fileSearchInputRef = useRef<HTMLInputElement>(null);
  const fileSearchAbortRef = useRef<AbortController | null>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const atSignIndexRef = useRef<number | null>(null);
  const slashIndexRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const totalCharsRef = useRef(0);

  // Computed values
  const filteredMessages = useMemo(() => {
    if (!messageSearch) return messages;
    const q = messageSearch.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, messageSearch]);

  const filteredSavedPrompts = useMemo(() => {
    if (!promptQuery.trim()) return savedPrompts;
    const q = promptQuery.toLowerCase();
    return savedPrompts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [savedPrompts, promptQuery]);

  const availableQuickActions = QUICK_ACTIONS.filter((a) => !a.requires?.length || a.requires.some((req) => attachedRefs.some((r) => r.kind === req)));

  // Load pinned indices
  useEffect(() => {
    const sid = sessionIdRef.current;
    const saved = localStorage.getItem(`pins-${sid}`);
    if (saved) {
      try {
        const arr = JSON.parse(saved) as number[];
        setPinnedIndices(new Set(arr));
      } catch {}
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [isOpen]);

  // Scroll handling
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollBtn(!atBottom);
      setAutoScroll(atBottom);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamBuffer, autoScroll]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
  }, []);

  // ── Send message with all bug fixes ──────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !projectId || streaming) return;
    setInput("");
    setError(null);
    const snapshotRefs = [...attachedRefs];
    const newMsg: ChatMessage = { role: "user", content: text, contextRefs: snapshotRefs, createdAt: new Date() };
    setMessages((prev) => [...prev, newMsg]);
    setStreaming(true);
    setStreamBuffer("");
    setActiveToolCalls([]);
    totalCharsRef.current += text.length;

    const toolCallMap = new Map<string, ToolCallEvent>();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, message: text, sessionId: sessionIdRef.current,
          provider: chatProvider, model: chatModel,
          contextRefs: snapshotRefs.map((r) => ({ kind: r.kind, id: r.id, label: r.label })),
        }),
        signal: abort.signal,
      });

      if (!response.ok) {
        setError(`HTTP ${response.status}: ${response.statusText}`);
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { setError("No response body"); setStreaming(false); return; }

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data);

            // Bug fix 3: Proper error message extraction
            if (event.type === "text") {
              fullText += event.text;
              setStreamBuffer(fullText);
            } else if (event.type === "error") {
              setError(extractErrorMessage(event.message ?? event));
            } else if (event.type === "usage") {
              inputTokens = event.inputTokens ?? 0;
              outputTokens = event.outputTokens ?? 0;
              if (event.totalTokens) setContextUsed(event.totalTokens);
            } else if (event.type === "done") {
              const assistantMsg: ChatMessage = {
                role: "assistant", content: fullText,
                toolCalls: Array.from(toolCallMap.values()),
                createdAt: new Date()
              };
              setMessages((prev) => [...prev, assistantMsg]);
              if (inputTokens || outputTokens) setContextUsed(inputTokens + outputTokens);
              setStreamBuffer("");
              setActiveToolCalls([]);
              setStreaming(false);
              // Refresh session list
              if (projectId) {
                fetch(`${API_BASE}/api/projects/${projectId}/chat/history?sessionId=${sessionIdRef.current}`)
                  .then((r) => r.ok ? r.json() : { sessions: [] })
                  .then((data) => { if (data.sessions?.length) setSessions(data.sessions); })
                  .catch(() => {});
              }
            }
            // Bug fix 1 & 4: Stable client-side ID + new object every time
            else if (event.type === "tool_call") {
              const toolId = event.tool.toolCallId ??
                `${event.tool.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              const existing = toolCallMap.get(toolId);
              if (existing) {
                // Always replace with new object to trigger re-render
                toolCallMap.set(toolId, { ...existing, status: "running", startedAt: Date.now() });
              } else {
                toolCallMap.set(toolId, {
                  name: event.tool.name, args: event.tool.args,
                  toolCallId: toolId, status: "running", startedAt: Date.now()
                });
              }
              setActiveToolCalls([...toolCallMap.values()]);
            }
            // Bug fix 2: tool_result event handler prevents stream pollution
            else if (event.type === "tool_result") {
              const toolId = event.toolCallId;
              if (toolId) {
                const existing = toolCallMap.get(toolId);
                if (existing) {
                  const durationMs = existing.startedAt ? Date.now() - existing.startedAt : undefined;
                  toolCallMap.set(toolId, {
                    ...existing,
                    status: event.isError ? "error" : "success",
                    result: typeof event.content === "string"
                      ? event.content
                      : JSON.stringify(event.content, null, 2),
                    durationMs,
                  });
                  setActiveToolCalls([...toolCallMap.values()]);
                }
              }
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(extractErrorMessage(err));
      }
    } finally {
      setStreamBuffer("");
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, projectId, streaming, attachedRefs, chatProvider, chatModel]);

  // ── File search ──────────────────────────────────────────────────────
  const fetchDirectory = useCallback(async (path: string) => {
    if (!projectId) return;
    setFileSearchLoading(true);
    setFileBrowserPath(path);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/files/browse?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setFileBrowserEntries(data.entries ?? []);
        setFileBrowserParent(data.parentPath ?? "");
        setFileSearchActiveIdx(null);
      }
    } catch {} finally {
      setFileSearchLoading(false);
    }
  }, [projectId]);

  const openFileSearch = useCallback(() => {
    setShowFileSearch(true);
    setFileQuery("");
    setFileSearchResults([]);
    setFileBrowserPath("");
    setFileBrowserEntries([]);
    setFileBrowserParent("");
    setFileSearchActiveIdx(null);
    fetchDirectory("");
    setTimeout(() => fileSearchInputRef.current?.focus(), 50);
  }, [fetchDirectory]);

  const closeFileSearch = useCallback(() => {
    setShowFileSearch(false);
    setFileQuery("");
    setFileSearchResults([]);
    setFileBrowserPath("");
    setFileBrowserEntries([]);
    setFileBrowserParent("");
    setFileSearchActiveIdx(null);
    atSignIndexRef.current = null;
  }, []);

  const selectFile = useCallback((file: { name: string; path: string; isDir: boolean; ext: string; dir: string }) => {
    if (file.isDir) { fetchDirectory(file.path); return; }
    const ref: ContextRef = { kind: "artifact", id: file.path, label: file.path };
    setAttachedRefs((prev) => {
      if (prev.some((r) => r.id === file.path)) return prev;
      return [...prev, ref];
    });
    if (atSignIndexRef.current !== null) {
      const atIdx = atSignIndexRef.current;
      const beforeAt = input.slice(0, atIdx);
      const cursorPos = inputRef.current?.selectionStart ?? input.length;
      const afterAt = input.slice(cursorPos);
      setInput(beforeAt + afterAt);
      atSignIndexRef.current = null;
    }
    closeFileSearch();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, closeFileSearch, fetchDirectory]);

  // Debounced file search
  useEffect(() => {
    if (!showFileSearch || !projectId || !fileQuery.trim()) {
      setFileSearchResults([]);
      return;
    }
    const id = setTimeout(async () => {
      if (fileSearchAbortRef.current) fileSearchAbortRef.current.abort();
      const abort = new AbortController();
      fileSearchAbortRef.current = abort;
      setFileSearchLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/projects/${projectId}/files/search?q=${encodeURIComponent(fileQuery)}&limit=50`,
          { signal: abort.signal },
        );
        if (res.ok) {
          const data = await res.json();
          setFileSearchResults(data.files ?? []);
        }
      } catch {} finally {
        if (!abort.signal.aborted) setFileSearchLoading(false);
      }
    }, 200);
    return () => { clearTimeout(id); };
  }, [fileQuery, showFileSearch, projectId]);

  // ── Prompt selection ──────────────────────────────────────────────
  const selectPrompt = useCallback((prompt: SavedPrompt) => {
    if (slashIndexRef.current !== null) {
      const beforeSlash = input.slice(0, slashIndexRef.current);
      const afterSlash = input.slice(slashIndexRef.current + 1);
      setInput(beforeSlash + prompt.template + afterSlash);
    } else {
      setInput(prompt.template);
    }
    setShowPromptPicker(false);
    slashIndexRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input]);

  // ── Pin toggle ──────────────────────────────────────────────────────
  const togglePin = useCallback((index: number) => {
    setPinnedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      localStorage.setItem(`pins-${sessionIdRef.current}`, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // ── Feedback ─────────────────────────────────────────────────────────
  const setMessageFeedback = useCallback((index: number, rating: 1 | -1 | null, comment?: string) => {
    setFeedback(prev => ({ ...prev, [index]: { rating, comment } }));
  }, []);

  const submitFeedback = useCallback(async (index: number, rating: -1, comment: string) => {
    try {
      await fetch(`${API_BASE}/api/chat/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          messageIndex: index,
          rating,
          comment,
        }),
      });
    } catch {}
  }, []);

  // ── Voice input ──────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = typeof window !== "undefined"
      ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : null;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: { results: Array<Array<{ transcript: string }>> }) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join("");
      setInput(prev => prev + transcript);
    };
    rec.onerror = () => setIsRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setIsRecording(true);
  }, [isRecording]);

  // ── Drag and drop ────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const newRefs: ContextRef[] = files.map(f => ({
      kind: "artifact" as const,
      id: f.name,
      label: f.name,
    }));
    setAttachedRefs(prev => {
      const existing = new Set(prev.map(r => r.id));
      return [...prev, ...newRefs.filter(r => !existing.has(r.id))];
    });
  }, []);

  // ── Message handlers ─────────────────────────────────────────────────
  const handleEditMessage = useCallback((index: number) => {
    const msg = messages[index];
    if (msg.role !== "user") return;
    setInput(msg.content);
    setEditingIndex(index);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [messages]);

  const handleRegenerate = useCallback(() => {
    if (messages.length < 2 || streaming) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    setMessages((prev) => prev.slice(0, lastUserIdx + 1));
    const lastUser = messages[lastUserIdx];
    setAttachedRefs(lastUser.contextRefs ?? []);
    setEditingIndex(null);
    sendMessage(lastUser.content);
  }, [messages, streaming, sendMessage]);

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.requires?.length && !action.requires.some((req) => attachedRefs.some((r) => r.kind === req))) return;
    sendMessage(action.prompt);
  }, [sendMessage, attachedRefs]);

  const removeAttachedRef = useCallback((refId: string) =>
    setAttachedRefs((prev) => prev.filter((r) => `${r.kind}:${r.id}` !== refId)), []);

  const exportChat = useCallback(() => {
    const text = exportChatMessages(messages);
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${sessionIdRef.current.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  // ── Key handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showSearch) {
      if (e.key === "Enter") setShowSearch(false);
      return;
    }

    // Slash command trigger
    if (!showPromptPicker && e.key === "/") {
      const cursorPos = inputRef.current?.selectionStart ?? input.length;
      const prevChar = cursorPos > 0 ? input[cursorPos - 1] : "";
      if (prevChar === "" || prevChar === " " || prevChar === "\n" || prevChar === "\t") {
        e.preventDefault();
        slashIndexRef.current = cursorPos;
        setShowPromptPicker(true);
        setPromptQuery("");
        setTimeout(() => promptInputRef.current?.focus(), 50);
      }
    }

    if (showPromptPicker) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowPromptPicker(false);
        slashIndexRef.current = null;
        return;
      }
      const list = filteredSavedPrompts;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const total = list.length;
        if (total === 0) return;
        setPromptPickerIdx((prev) => {
          if (prev === null) return e.key === "ArrowDown" ? 0 : total - 1;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return Math.max(0, Math.min(total - 1, prev + delta));
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = promptPickerIdx;
        if (idx !== null && idx >= 0 && idx < list.length) {
          selectPrompt(list[idx]);
        }
        return;
      }
    }

    if (showFileSearch) {
      if (e.key === "Escape") { e.preventDefault(); closeFileSearch(); return; }
      const list = fileQuery.trim() ? fileSearchResults : fileBrowserEntries;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const total = list.length;
        if (total === 0) return;
        setFileSearchActiveIdx((prev) => {
          if (prev === null) return e.key === "ArrowDown" ? 0 : total - 1;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          return Math.max(0, Math.min(total - 1, prev + delta));
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = fileSearchActiveIdx;
        if (idx === null || idx < 0 || idx >= list.length) return;
        const entry = list[idx];
        if (entry.isDir) {
          fetchDirectory(entry.path);
          setFileQuery("");
          setFileSearchResults([]);
        } else {
          selectFile(entry);
        }
        return;
      }
    }

    if (e.key === "ArrowUp" && !input && messages.length > 0) {
      const lastUserIdx = messages.length - 1;
      if (messages[lastUserIdx].role === "user") {
        e.preventDefault();
        setInput(messages[lastUserIdx].content);
        setEditingIndex(lastUserIdx);
      }
    }

    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [input, messages, showSearch, showFileSearch, showPromptPicker, filteredSavedPrompts, fileQuery, fileSearchResults, fileBrowserEntries, fileSearchActiveIdx, promptPickerIdx, closeFileSearch, fetchDirectory, selectFile, selectPrompt, sendMessage]);

  // ── Model selection ──────────────────────────────────────────────────
  const handleSelectModel = useCallback((provider: string, model: string) => {
    setChatProvider(provider);
    setChatModel(model);
  }, []);

  const handleCompact = useCallback(() => {
    setCompacting(true);
    // Simulate compact (would call API in production)
    setTimeout(() => setCompacting(false), 1000);
  }, []);

  const isSearching = fileQuery.trim().length > 0;
  const activeList = isSearching ? fileSearchResults : fileBrowserEntries;
  const activeLabel = isSearching ? "Search results" : `/${fileBrowserPath || ""}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.1 }}
            className={`${SURF} border ${BORD} rounded-lg shadow-xl w-full mx-4 flex flex-col ${
              isFullscreen ? "max-w-full max-h-full !m-0 !rounded-none !h-screen" : "max-w-4xl max-h-[85vh] min-h-[400px]"
            }`} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={`shrink-0 flex items-center justify-between px-5 h-11 border-b ${BORD}`}>
              <div className="flex items-center gap-2 min-w-0">
                <Bot size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
                <span className={`text-xs font-semibold ${TXT} whitespace-nowrap`}>Project Chat</span>
                {activeSessionId && sessions.length > 0 && (
                  <span className={`text-[9px] ${MUT} truncate ml-1`}>
                    &middot; {sessions.find((s) => s.id === activeSessionId)?.title?.slice(0, 40) ?? ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {showSearch && (
                  <div className="relative">
                    <input value={messageSearch} onChange={(e) => setMessageSearch(e.target.value)}
                      autoFocus placeholder="Search messages..."
                      className={`w-32 text-[10px] pl-2 pr-6 py-1 rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} focus:outline-none focus:border-blue-500`} />
                    <button onClick={() => { setShowSearch(false); setMessageSearch(""); }}
                      className={`absolute right-1 top-1/2 -translate-y-1/2 ${MUT} hover:text-stone-600`}>
                      <X size={10} />
                    </button>
                  </div>
                )}
                <button onClick={() => setShowSearch(!showSearch)}
                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${showSearch ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-700 dark:hover:text-stone-300`}`}
                  title="Search messages (Cmd+K)"><Filter size={11} /></button>
                <button onClick={exportChat}
                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
                  title="Export chat (Cmd+Shift+E)"><Download size={11} /></button>
                <button onClick={() => setShowThreads(!showThreads)}
                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${showThreads ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-700 dark:hover:text-stone-300`}`}
                  title="Threads">
                  <MessageSquare size={11} />
                  <span className="font-medium">{sessions.length}</span>
                </button>
                {/* Feature 4: Pins button */}
                <button onClick={() => setShowPins(!showPins)}
                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${showPins ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-700 dark:hover:text-stone-300`}`}
                  title="Pinned messages">
                  <Star size={11} />
                  <span className="font-medium">{pinnedIndices.size}</span>
                </button>
                {/* Feature 7: Stats button */}
                <button onClick={() => setShowStats(!showStats)}
                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[9px] transition-colors ${showStats ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-700 dark:hover:text-stone-300`}`}
                  title="Session stats">
                  <BarChart2 size={11} />
                </button>
                <button onClick={() => setIsFullscreen(!isFullscreen)}
                  className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}><X size={16} /></button>
              </div>
            </div>
            {/* Body: panels + chat */}
            <div className="flex flex-1 min-h-0">
              {/* Thread sidebar */}
              <AnimatePresence>
                {showThreads && (
                  <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 220, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className={`shrink-0 border-r ${BORD} flex flex-col overflow-hidden`}>
                    <div className={`shrink-0 flex items-center justify-between px-3 h-10 border-b ${BORD}`}>
                      <span className={`text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>Threads</span>
                      <button className={`inline-flex items-center gap-0.5 text-[9px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`} title="New thread">
                        <Plus size={10} /><span>New</span>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
                      {sessions.length === 0 && (
                        <div className={`px-2 py-4 text-[10px] ${MUT} text-center`}>No threads yet</div>
                      )}
                      {sessions.map((s) => (
                        <div key={s.id} className="group relative">
                          {renamingSession === s.id ? (
                            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => { setRenamingSession(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter") setRenamingSession(null); if (e.key === "Escape") setRenamingSession(null); }}
                              autoFocus
                              className={`w-full text-[10px] px-2.5 py-2 rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} focus:outline-none focus:border-blue-500`} />
                          ) : (
                            <button onClick={() => setActiveSessionId(s.id)}
                              className={`w-full text-left px-2.5 py-2 rounded text-[10px] transition-colors ${
                                activeSessionId === s.id ? `${ACC_BG} ${ACC_TXT}` : `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
                              }`}>
                              <div className="font-medium truncate pr-4">{s.title}</div>
                              <div className={`text-[8px] ${MUT} mt-0.5`}>{s.messageCount} message{s.messageCount !== 1 ? "s" : ""}</div>
                            </button>
                          )}
                          {renamingSession !== s.id && (
                            <button onClick={() => setRenamingSession(s.id)}
                              className={`absolute right-1 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
                              title="Rename thread">
                              <Pencil size={8} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* Chat content */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                <ChatStatusBar provider={chatProvider} model={chatModel} contextUsed={contextUsed} contextLimit={contextLimit} aiModels={aiModels} onSelectModel={handleSelectModel} onCompact={handleCompact} compacting={compacting} />
                {attachedRefs.length > 0 && (
                  <div className={`shrink-0 flex items-center gap-1.5 px-4 py-1.5 border-b ${BORD} flex-wrap`}>
                    <span className={`text-[9px] uppercase tracking-widest ${MUT} font-semibold mr-1`}>Context</span>
                    {attachedRefs.map((r) => <ContextRefPill key={`${r.kind}:${r.id}`} ctx={r} removable onRemove={() => removeAttachedRef(`${r.kind}:${r.id}`)} onClick={() => onContextRefClick?.(r)} />)}
                    <button onClick={() => setAttachedRefs([])} className={`ml-auto text-[10px] ${MUT} hover:text-red-500 dark:hover:text-red-400 transition-colors`}>Clear all</button>
                  </div>
                )}
                {!streaming && availableQuickActions.length > 0 && (
                  <div className={`shrink-0 flex items-center gap-1.5 px-4 py-2 border-b ${BORD} overflow-x-auto`}>
                    {availableQuickActions.map((action) => {
                      const ActionIcon = action.icon;
                      return <button key={action.id} onClick={() => handleQuickAction(action)} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors border ${BORD} text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] hover:border-stone-300 dark:hover:border-[#555]`} title={action.prompt}><ActionIcon size={11} className="shrink-0" />{action.label}</button>;
                    })}
                  </div>
                )}
                {/* Messages area */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs relative">
                  <AnimatePresence>
                    {showScrollBtn && (
                      <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                        onClick={scrollToBottom}
                        className="sticky bottom-2 z-10 float-right -mr-2 w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333] shadow-md hover:shadow-lg transition-shadow"
                        title="Scroll to bottom">
                        <ArrowDown size={12} className={MUT} />
                      </motion.button>
                    )}
                  </AnimatePresence>
                  {filteredMessages.length === 0 && !streaming && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-400 dark:text-stone-500">
                      {messageSearch ? (
                        <><Search size={20} strokeWidth={1.2} /><p className="text-xs text-center">No messages match "{messageSearch}"</p></>
                      ) : (
                        <><Bot size={24} strokeWidth={1.2} /><p className="text-xs text-center">Ask about the project, execution results,<br />or request changes.</p></>
                      )}
                      {attachedRefs.length > 0 && <p className={`text-[10px] text-center mt-1 ${MUT}`}>{attachedRefs.length} context reference{attachedRefs.length !== 1 ? "s" : ""} attached</p>}
                    </motion.div>
                  )}
                  {filteredMessages.map((msg, i) => (
                    <MessageBubble key={i} msg={msg} index={i} onContextRefClick={onContextRefClick}
                      onEdit={msg.role === "user" ? () => handleEditMessage(i) : undefined}
                      onRegenerate={msg.role === "assistant" ? handleRegenerate : undefined}
                      isLastAssistant={msg.role === "assistant" && i === messages.length - 1 && !streaming}
                      isPinned={pinnedIndices.has(i)}
                      onTogglePin={msg.role === "assistant" ? () => togglePin(i) : undefined}
                      messageFeedback={feedback[i]}
                      onFeedback={(rating) => setMessageFeedback(i, rating)}
                      onSubmitFeedback={(comment) => submitFeedback(i, -1, comment)}
                    />
                  ))}
                  {(streamBuffer || streaming) && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="flex gap-2 justify-start">
                      <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`}>
                        <StreamContent content={streamBuffer} hasToolCalls={activeToolCalls.length > 0} />
                        {streamBuffer.length > 0 && <motion.span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 align-text-bottom" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />}
                      </div>
                    </motion.div>
                  )}
                  {streaming && activeToolCalls.length > 0 && !streamBuffer && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-1 pl-7">
                      {activeToolCalls.map((tc, j) => (
                        <span key={j} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-100 dark:bg-blue-900/40 ${MUT}`}>
                          {tc.name}
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse ml-0.5" />
                        </span>
                      ))}
                    </motion.div>
                  )}
                  {error && <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 justify-center"><AlertCircle size={11} />{error}</div>}
                  <div ref={bottomRef} />
                </div>
                {/* Input area */}
                <div
                  className={`shrink-0 border-t ${BORD} p-4 relative`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {/* Drag-and-drop overlay */}
                  <AnimatePresence>
                    {isDragOver && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-20 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg m-1 pointer-events-none"
                      >
                        <span className="text-blue-600 dark:text-blue-400 text-sm font-medium">Drop files to attach as context</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {editingIndex !== null && (
                    <div className={`text-[10px] ${MUT} flex items-center gap-1 mb-2`}>
                      <Pencil size={9} />
                      <span>Editing message {editingIndex + 1}. Press Enter to send or <button onClick={() => { setEditingIndex(null); setInput(""); }} className={`underline ${MUT} hover:text-stone-600`}>cancel</button></span>
                    </div>
                  )}

                  {attachedRefs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {attachedRefs.map((r) => <ContextRefPill key={`input-${r.kind}:${r.id}`} ctx={r} removable onRemove={() => removeAttachedRef(`${r.kind}:${r.id}`)} onClick={() => onContextRefClick?.(r)} />)}
                    </div>
                  )}

                  {/* File search popover */}
                  <AnimatePresence>
                    {showFileSearch && (
                      <motion.div ref={fileSearchRef} initial={{ opacity: 0, y: 4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.96 }}
                        transition={{ duration: 0.1, ease: "easeOut" }}
                        className="relative mb-2 z-10">
                        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-hidden rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E] shadow-lg flex flex-col">
                          <div className="relative shrink-0">
                            <Search size={11} className={`absolute left-3 top-1/2 -translate-y-1/2 ${MUT}`} />
                            <input ref={fileSearchInputRef} type="text" value={fileQuery}
                              onChange={(e) => setFileQuery(e.target.value)}
                              placeholder="Search files..."
                              autoFocus
                              className={`w-full pl-8 pr-3 py-2 text-[11px] bg-white dark:bg-[#1E1E1E] ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none border-b border-[#E8E6E1] dark:border-[#333]`}
                            />
                          </div>
                          <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-[#E8E6E1] dark:border-[#333] text-[9px] ${MUT}`}>
                            {isSearching ? (
                              <><Search size={9} className="shrink-0" /><span className="font-medium truncate">Search results for &ldquo;{fileQuery}&rdquo;</span></>
                            ) : (
                              <><FolderOpen size={9} className="shrink-0" /><span className="font-medium truncate">/{fileBrowserPath || ""}</span></>
                            )}
                            {fileSearchLoading && <Loader2 size={8} className="animate-spin ml-auto" />}
                          </div>
                          <div className="flex-1 overflow-y-auto min-h-0">
                            {!isSearching && fileBrowserParent !== undefined && fileBrowserPath && (
                              <button onClick={() => { fetchDirectory(fileBrowserParent); setFileSearchActiveIdx(-1); }}
                                onMouseEnter={() => setFileSearchActiveIdx(-1)}
                                className={`w-full text-left px-3 py-1.5 text-[10px] transition-colors flex items-center gap-2 ${
                                  fileSearchActiveIdx === -1
                                    ? `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`
                                    : `${MUT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
                                }`}>
                                <FolderOpen size={10} className="shrink-0" />
                                <span className="font-medium">..</span>
                                <span className={`ml-auto text-[9px] ${MUT}`}>parent</span>
                              </button>
                            )}
                            {fileSearchLoading && activeList.length === 0 && (
                              <div className={`px-3 py-8 flex items-center justify-center text-[10px] ${MUT}`}>
                                <Loader2 size={10} className="animate-spin mr-1.5" />Searching...
                              </div>
                            )}
                            {!fileSearchLoading && activeList.length === 0 && (
                              <div className={`px-3 py-8 text-[10px] ${MUT} text-center`}>
                                {isSearching ? `No files matching "${fileQuery}"` : "Empty directory"}
                              </div>
                            )}
                            {activeList.map((entry, i) => (
                              <button key={entry.path} onClick={() => selectFile(entry)}
                                onMouseEnter={() => setFileSearchActiveIdx(i)}
                                className={`w-full text-left px-3 py-1.5 text-[10px] transition-colors flex items-center gap-2 ${
                                  i === fileSearchActiveIdx
                                    ? `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`
                                    : `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
                                }`}>
                                {entry.isDir ? (
                                  <FolderOpen size={10} className={`shrink-0 text-amber-500 dark:text-amber-400`} />
                                ) : (
                                  <FileText size={10} className={`shrink-0 ${MUT}`} />
                                )}
                                <span className="font-medium truncate">{entry.name}</span>
                                {'dir' in entry && entry.dir && isSearching && (
                                  <span className={`${MUT} truncate ml-auto text-[9px]`}>{entry.dir}</span>
                                )}
                                {entry.isDir && <ChevronRight size={8} className={`ml-auto shrink-0 ${MUT}`} />}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Prompt picker popover */}
                  <AnimatePresence>
                    {showPromptPicker && (
                      <motion.div initial={{ opacity: 0, y: 4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.96 }}
                        transition={{ duration: 0.1, ease: "easeOut" }}
                        className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-hidden rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E] shadow-lg z-30"
                      >
                        <div className="relative shrink-0">
                          <Search size={11} className={`absolute left-3 top-1/2 -translate-y-1/2 ${MUT}`} />
                          <input ref={promptInputRef} type="text" value={promptQuery}
                            onChange={(e) => setPromptQuery(e.target.value)}
                            placeholder="Search prompts..."
                            className={`w-full pl-8 pr-3 py-2 text-[11px] bg-white dark:bg-[#1E1E1E] ${TXT} placeholder-stone-400 focus:outline-none border-b border-[#E8E6E1] dark:border-[#333]`}
                          />
                        </div>
                        <div className="overflow-y-auto max-h-32">
                          {filteredSavedPrompts.length === 0 ? (
                            <div className={`px-3 py-4 text-[10px] ${MUT} text-center`}>No prompts found</div>
                          ) : (
                            filteredSavedPrompts.map((prompt, i) => (
                              <button key={prompt.id} onClick={() => selectPrompt(prompt)}
                                className={`w-full text-left px-3 py-2 text-[10px] transition-colors ${
                                  promptPickerIdx === i ? `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}` : `${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`
                                }`}>
                                <div className="font-medium">{prompt.name}</div>
                                <div className={`${MUT} text-[9px]`}>{prompt.description}</div>
                              </button>
                            ))
                          )}
                        </div>
                        <div className={`shrink-0 px-3 py-1.5 border-t border-[#E8E6E1] dark:border-[#333] text-[9px] ${MUT}`}>
                          <button className="hover:text-blue-500 underline">Manage prompts</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Input row */}
                  <div className="flex gap-2 items-end">
                    {/* Voice input button */}
                    <button
                      onClick={toggleRecording}
                      className={`h-10 w-10 flex items-center justify-center rounded-lg border ${BORD} ${SURF} transition-colors shrink-0 ${
                        isRecording ? "bg-red-500 text-white animate-pulse" : MUT
                      }`}
                      title={isRecording ? "Stop recording" : "Voice input"}
                      aria-label={isRecording ? "Stop recording" : "Start voice input"}
                    >
                      {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
                    </button>

                    <div className="flex-1 relative">
                      <textarea ref={inputRef} value={input} onChange={(e) => {
                        const val = e.target.value;
                        const cursorPos = e.target.selectionStart;
                        setInput(val);
                        if (!showFileSearch && cursorPos > 0 && val[cursorPos - 1] === "@") {
                          const prevChar = cursorPos > 1 ? val[cursorPos - 2] : "";
                          if (prevChar === "" || prevChar === " " || prevChar === "\n" || prevChar === "\t") {
                            atSignIndexRef.current = cursorPos - 1;
                            openFileSearch();
                          }
                        }
                        if (showFileSearch && atSignIndexRef.current !== null) {
                          const atIdx = atSignIndexRef.current;
                          if (cursorPos <= atIdx || val.length <= atIdx || val[atIdx] !== "@") {
                            closeFileSearch();
                          }
                        }
                      }} onKeyDown={handleKeyDown}
                        placeholder={attachedRefs.length > 0 ? `Ask about ${attachedRefs.map((r) => r.kind).join(", ")}...` : "Ask about the project or suggest fixes..."}
                        rows={3} disabled={!projectId || streaming}
                        className={`w-full resize-none rounded-lg border ${BORD} ${SURF} px-3 py-2 text-xs ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500 disabled:opacity-50`}
                        aria-label="Chat input"
                      />
                      {/* Feature 8: Live token counter */}
                      {input.trim() && (
                        <span className={`absolute bottom-1 right-2 text-[9px] shrink-0 transition-colors ${
                          estimateTokens(input) > 2000 ? "text-red-500" :
                          estimateTokens(input) > 500 ? "text-amber-500" :
                          MUT
                        }`}>
                          ~{formatTokens(estimateTokens(input))} tokens
                        </span>
                      )}
                    </div>

                    <button onClick={() => {
                      if (editingIndex !== null) {
                        setMessages((prev) => prev.map((m, i) => i === editingIndex ? { ...m, content: input } : m));
                        setEditingIndex(null);
                        setInput("");
                      } else {
                        sendMessage();
                      }
                    }} disabled={!input.trim() || streaming || !projectId}
                      className="h-10 w-10 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                      {streaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    </button>
                  </div>
                  {!projectId && <p className={`text-[10px] ${MUT} mt-1`}>Select a project to enable chat</p>}
                </div>
              </div>
              {/* Pin panel (right side) */}
              <AnimatePresence>
                {showPins && (
                  <PinnedMessagesPanel
                    pinnedIndices={pinnedIndices}
                    messages={messages}
                    onClose={() => setShowPins(false)}
                    onJump={(index) => {
                      // Scroll to message at index
                      const el = scrollRef.current;
                      if (el) {
                        const children = el.children;
                        for (let i = 0; i < children.length; i++) {
                          if (children[i].textContent?.includes(messages[index]?.content.slice(0, 20))) {
                            children[i].scrollIntoView({ behavior: "smooth" });
                            break;
                          }
                        }
                      }
                      setShowPins(false);
                    }}
                  />
                )}
              </AnimatePresence>
              {/* Stats panel (right side) */}
              <AnimatePresence>
                {showStats && (
                  <SessionStatsPanel messages={messages} onClose={() => setShowStats(false)} />
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
