import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Send, Loader2, Bot, User, X, AlertCircle, Terminal, Code,
  CheckCircle2, XCircle, FileText, ClipboardList, AlertTriangle,
  Lightbulb, Wrench, FolderOpen, GitBranch, Archive, Search,
  FileEdit, Eye, Minimize2, ChevronDown, Brain, Plus, MessageSquare,
  Copy, ArrowDown, Maximize2,
  Pencil, RefreshCw, Download, Filter,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const API_BASE = "";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEvent[];
  contextRefs?: ContextRef[];
  createdAt?: Date;
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  status?: "running" | "success" | "error";
  result?: string;
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

const QUICK_ACTIONS: QuickAction[] = [
  { id: "summarize-run", label: "Summarize run", icon: ClipboardList, prompt: "Summarize the current plan execution: what workspaces ran, what succeeded, what failed, and overall status.", requires: ["run"] },
  { id: "explain-failure", label: "Explain failure", icon: AlertTriangle, prompt: "Explain why the execution failed. Identify the root cause workspace(s), error messages, and suggest remediation steps.", requires: ["run"] },
  { id: "followup-plan", label: "Generate follow-up plan", icon: Lightbulb, prompt: "Based on the current execution results, generate a follow-up plan that addresses any failures and remaining work.", requires: ["run"] },
];

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

function refKindIcon(kind: ContextRef["kind"]): React.ElementType {
  switch (kind) {
    case "plan":      return FileText;
    case "run":       return ClipboardList;
    case "workspace": return Wrench;
    case "artifact":  return Archive;
  }
}

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

interface ToolBadgeConfig { icon: React.ElementType; bg: string; dot: string }
const TOOL_BADGES: Record<string, ToolBadgeConfig> = {
  read:    { icon: Eye,      bg: "bg-blue-100 dark:bg-blue-900/40",      dot: "bg-blue-500" },
  write:   { icon: FileEdit, bg: "bg-amber-100 dark:bg-amber-900/40",    dot: "bg-amber-500" },
  edit:    { icon: Code,     bg: "bg-violet-100 dark:bg-violet-900/40",  dot: "bg-violet-500" },
  bash:    { icon: Terminal, bg: "bg-emerald-100 dark:bg-emerald-900/40",dot: "bg-emerald-500" },
  search:  { icon: Search,   bg: "bg-cyan-100 dark:bg-cyan-900/40",      dot: "bg-cyan-500" },
  default: { icon: Bot,      bg: "bg-stone-100 dark:bg-[#252525]",       dot: "bg-stone-400" },
};

function getToolBadge(name: string): ToolBadgeConfig { return TOOL_BADGES[name] ?? TOOL_BADGES.default; }

function ToolBadge({ tc, compact }: { tc: ToolCallEvent; compact?: boolean }) {
  const cfg = getToolBadge(tc.name);
  const Icon = cfg.icon;
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono ${cfg.bg} ${MUT}`}>
        <Icon size={9} /><span>{tc.name}</span>
        {tc.status === "running" && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse ml-0.5`} />}
        {tc.status === "success" && <CheckCircle2 size={9} className="text-green-500 ml-0.5" />}
        {tc.status === "error" && <XCircle size={9} className="text-red-500 ml-0.5" />}
      </span>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 text-[10px] ${MUT} ${cfg.bg} rounded px-2 py-1`}>
      <Icon size={10} /><span className="font-medium">{tc.name}</span>
      <span className="opacity-60 truncate max-w-[100px]">{typeof tc.args === "object" && tc.args !== null ? JSON.stringify(tc.args).slice(0, 60) : ""}</span>
      {tc.status === "running" && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse ml-auto shrink-0`} />}
      {tc.status === "success" && <CheckCircle2 size={10} className="text-green-500 ml-auto shrink-0" />}
      {tc.status === "error" && <XCircle size={10} className="text-red-500 ml-auto shrink-0" />}
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

// ── Code block component with copy and language label ────────────────
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
      {/* Language label + copy button */}
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

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-xs font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
  code: ({ className, children, ...props }: React.ComponentPropsWithoutRef<"code">) => {
    const isInline = !className;
    if (isInline) return <code className="px-1 py-0.5 rounded bg-stone-200/70 dark:bg-[#333] text-[10px] font-mono">{children}</code>;
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">{children}</a>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-3 italic mb-2">{children}</blockquote>,
  hr: () => <hr className="my-3 border-[#E8E6E1] dark:border-[#333]" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-3 rounded-lg border border-[#E8E6E1] dark:border-[#333]">
      <div className="text-[8px] uppercase tracking-wider text-stone-400 px-2 py-0.5 bg-stone-50 dark:bg-[#1a1a1a] border-b border-[#E8E6E1] dark:border-[#333]">Table (scroll sideways)</div>
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => <th className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1 bg-stone-100 dark:bg-[#252525] font-semibold text-left">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1">{children}</td>,
};

function MarkdownContent({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>;
}

function MessageBubble({ msg, index, onContextRefClick, onEdit, onRegenerate, isLastAssistant }: {
  msg: ChatMessage; index: number; onContextRefClick?: (ref: ContextRef) => void;
  onEdit?: () => void; onRegenerate?: () => void; isLastAssistant?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [msg.content]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
      className={`flex gap-2 group ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "assistant" && <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />}
      <div className="max-w-[85%] space-y-1.5">
        {msg.role === "user" && msg.contextRefs?.length ? (
          <div className="flex flex-wrap gap-1 mb-0.5">{msg.contextRefs.map((r) => <ContextRefPill key={`${r.kind}:${r.id}-${index}`} ctx={r} onClick={() => onContextRefClick?.(r)} />)}</div>
        ) : null}
        <div className={`rounded-lg px-3 py-2 leading-relaxed relative ${msg.role === "user" ? "bg-blue-600 text-white" : `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`}`}>
          {msg.role === "assistant" ? <MarkdownContent content={msg.content} /> : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
          {/* Timestamp */}
          {msg.createdAt && (
            <div className={`text-[8px] mt-1.5 ${msg.role === "user" ? "text-blue-200" : MUT}`}>
              {formatRelativeTime(msg.createdAt)}
            </div>
          )}
          {/* Copy + action buttons */}
          <div className={`absolute -bottom-4 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === "user" ? "" : ""}`}>
            <button onClick={handleCopy}
              className={`p-0.5 rounded ${copied ? "text-green-500" : MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`} title="Copy message">
              {copied ? <CheckCircle2 size={9} /> : <Copy size={9} />}
            </button>
            {msg.role === "user" && onEdit && (
              <button onClick={onEdit} className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`} title="Edit message">
                <Pencil size={9} />
              </button>
            )}
            {msg.role === "assistant" && isLastAssistant && onRegenerate && (
              <button onClick={onRegenerate} className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`} title="Regenerate">
                <RefreshCw size={9} />
              </button>
            )}
          </div>
        </div>
        {msg.toolCalls?.length ? <div className="flex flex-wrap gap-1">{msg.toolCalls.map((tc, j) => <ToolBadge key={j} tc={tc} compact />)}</div> : null}
      </div>
      {msg.role === "user" && <User size={14} className="shrink-0 mt-1 text-stone-400" />}
    </motion.div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

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
              <input ref={searchRef} type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                autoFocus
                className={`w-full pl-6 pr-2 py-1.5 text-[10px] rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500`}
              />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {(() => {
                const q = searchQuery.toLowerCase();
                const filtered = q
                  ? aiModels.filter((p) =>
                      p.provider.toLowerCase().includes(q) ||
                      p.models.some((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
                    ).map((p) => ({
                      ...p,
                      models: p.models.filter((m) =>
                        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
                      ),
                    }))
                  : aiModels;
                if (filtered.length === 0) {
                  return <div className={`px-2 py-3 text-[10px] ${MUT} text-center`}>No models found</div>;
                }
                return filtered.map((p) => (
                  <div key={p.provider}>
                    <div className={`px-2 py-1 text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>{p.provider}</div>
                    {p.models.map((m) => (
                      <button key={m.id} onClick={() => { onSelectModel(p.provider, m.id); setMenuOpen(false); setSearchQuery(""); }}
                        className={`w-full text-left px-2 py-1 text-[10px] rounded transition-colors ${provider === p.provider && model === m.id ? `${ACC_BG} ${ACC_TXT}` : `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}`}>{m.name}</button>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>
        </>
      )}
      <span className={`w-px h-3 border-l ${BORD}`} />
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className={`${MUT} whitespace-nowrap`}>{formatTokens(contextUsed)} / {formatTokens(contextLimit)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-[#333] overflow-hidden min-w-[40px]">
          <motion.div className={`h-full rounded-full ${barColor}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
        </div>
      </div>
      <button onClick={onCompact} disabled={compacting}
        className={`inline-flex items-center gap-1 ${MUT} hover:text-stone-700 dark:hover:text-stone-300 disabled:opacity-40 transition-colors shrink-0`} title="Compact context">
        <Minimize2 size={10} /><span>{compacting ? "Compacting..." : "Compact"}</span>
      </button>
    </div>
  );
}

export function ChatPanel({ isOpen, projectId, onClose, contextRefs: externalContextRefs = [], onContextRefClick }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachedRefs, setAttachedRefs] = useState<ContextRef[]>(externalContextRefs);
  const [chatProvider, setChatProvider] = useState("opencode-go");
  const [chatModel, setChatModel] = useState("deepseek-v4-flash");
  const [contextLimit, setContextLimit] = useState(128000);
  const [contextUsed, setContextUsed] = useState(0);
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const totalCharsRef = useRef(0);
  const estimateTokens = (text: string) => Math.round(text.length * 0.3);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // Cmd+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
      // Escape to close search
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setMessageSearch("");
      }
      // Cmd+Shift+E to export
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
        e.preventDefault();
        exportChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, showSearch, messages]);

  // ── Export chat ─────────────────────────────────────────────────────
  const exportChat = useCallback(() => {
    if (messages.length === 0) return;
    const text = messages.map((m) => {
      const prefix = m.role === "user" ? "**User:**" : "**Assistant:**";
      return `${prefix}\n${m.content}`;
    }).join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${sessionIdRef.current.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  // ── Scroll management ───────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setAutoScroll(nearBottom);
      setShowScrollBtn(!nearBottom);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer, autoScroll]);

  useEffect(() => {
    if (isOpen) { const t = setTimeout(() => inputRef.current?.focus(), 100); return () => clearTimeout(t); }
  }, [isOpen]);

  const scrollToBottom = () => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setAutoScroll(true); };

  // ── Load data on open ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/api/settings`).then((r) => r.ok ? r.json() : {}).then((s: Record<string, unknown>) => {
      setChatProvider((s.defaultProvider as string) ?? "opencode-go");
      setChatModel((s.defaultModel as string) ?? "deepseek-v4-flash");
      setContextLimit(((s.contextBudgets as Record<string, number>)?.flash ?? 128000));
    }).catch(() => {});
    fetch(`${API_BASE}/api/ai-models`).then((r) => r.ok ? r.json() : { providers: [] }).then((d) => setAiModels(d.providers ?? [])).catch(() => {});
    sessionIdRef.current = crypto.randomUUID();
    setActiveSessionId(null);
    setSessions([]);
    setMessages([]);
    setAttachedRefs(externalContextRefs);
    setError(null);
    setStreamBuffer("");
    setActiveToolCalls([]);
    setContextUsed(0);
    totalCharsRef.current = 0;
    setIsFullscreen(false);
    setEditingIndex(null);
    setMessageSearch("");
    setShowSearch(false);
    if (!projectId) return;
    fetch(`${API_BASE}/api/projects/${projectId}/chat/history`).then((r) => r.ok ? r.json() : { sessions: [], messages: [] }).then((data) => {
      setSessions(data.sessions ?? []);
      if (data.sessions?.length > 0) {
        const latest = data.sessions[0];
        setActiveSessionId(latest.id);
        sessionIdRef.current = latest.id;
        if (data.messages?.length) {
          setMessages(data.messages);
          const chars = data.messages.reduce((s: number, m: { content: string }) => s + (m.content?.length ?? 0), 0);
          totalCharsRef.current = chars;
          setContextUsed(estimateTokens(String(chars)));
        }
      }
    }).catch(() => {});
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!streamBuffer) return;
    setContextUsed(estimateTokens(String(totalCharsRef.current + streamBuffer.length)));
  }, [streamBuffer]);

  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === "assistant") {
      totalCharsRef.current += last.content.length;
      setContextUsed(estimateTokens(String(totalCharsRef.current)));
    }
  }, [messages]);

  // ── Thread management ───────────────────────────────────────────────
  const switchSession = useCallback((sessionId: string) => {
    if (streaming) return;
    setActiveSessionId(sessionId);
    sessionIdRef.current = sessionId;
    setError(null);
    setEditingIndex(null);
    setMessageSearch("");
    setShowSearch(false);
    fetch(`${API_BASE}/api/projects/${projectId}/chat/history?sessionId=${sessionId}`)
      .then((r) => r.ok ? r.json() : { messages: [] })
      .then((data) => {
        setMessages(data.messages ?? []);
        const chars = (data.messages ?? []).reduce((s: number, m: { content: string }) => s + (m.content?.length ?? 0), 0);
        totalCharsRef.current = chars;
        setContextUsed(estimateTokens(String(chars)));
        setShowThreads(false);
      }).catch(() => {});
  }, [projectId, streaming]);

  const newSession = useCallback(() => {
    if (streaming) return;
    setActiveSessionId(null);
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setStreamBuffer("");
    setActiveToolCalls([]);
    setError(null);
    setEditingIndex(null);
    setContextUsed(0);
    totalCharsRef.current = 0;
    setShowThreads(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [streaming]);

  // ── Rename thread ───────────────────────────────────────────────────
  const handleRename = useCallback((sessionId: string) => {
    setRenamingSession(sessionId);
    const s = sessions.find((s) => s.id === sessionId);
    setRenameValue(s?.title ?? "");
  }, [sessions]);

  const submitRename = useCallback((sessionId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title: trimmed } : s));
    setRenamingSession(null);
  }, [renameValue]);

  const handleSelectModel = useCallback((provider: string, model: string) => {
    setChatProvider(provider);
    setChatModel(model);
    fetch(`${API_BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultProvider: provider, defaultModel: model }) }).catch(() => {});
  }, []);

  const handleCompact = useCallback(async () => {
    if (compacting || messages.length === 0) return;
    setCompacting(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat/compact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, sessionId: sessionIdRef.current }) });
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
          setSessions((prev) => prev.map((s) => s.id === sessionIdRef.current ? { ...s, messageCount: data.messages.length } : s));
          const chars = data.messages.reduce((s: number, m: { content: string }) => s + (m.content?.length ?? 0), 0);
          totalCharsRef.current = chars;
          setContextUsed(estimateTokens(String(chars)));
        }
      }
    } catch {} finally { setCompacting(false); }
  }, [compacting, messages, projectId]);

  // ── Filtered messages for search ─────────────────────────────────────
  const filteredMessages = useMemo(() => {
    if (!messageSearch.trim()) return messages;
    const q = messageSearch.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, messageSearch]);

  // ── Send message ─────────────────────────────────────────────────────
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
        body: JSON.stringify({ projectId, message: text, sessionId: sessionIdRef.current, provider: chatProvider, model: chatModel, contextRefs: snapshotRefs.map((r) => ({ kind: r.kind, id: r.id, label: r.label })) }),
        signal: abort.signal,
      });
      if (!response.ok) { setError(`HTTP ${response.status}: ${response.statusText}`); setStreaming(false); return; }
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
            if (event.type === "text") { fullText += event.text; setStreamBuffer(fullText); }
            else if (event.type === "error") { setError(event.message); }
            else if (event.type === "usage") {
              inputTokens = event.inputTokens ?? 0;
              outputTokens = event.outputTokens ?? 0;
              if (event.totalTokens) setContextUsed(event.totalTokens);
            }
            else if (event.type === "done") {
              const assistantMsg: ChatMessage = { role: "assistant", content: fullText, toolCalls: Array.from(toolCallMap.values()), createdAt: new Date() };
              setMessages((prev) => [...prev, assistantMsg]);
              if (inputTokens || outputTokens) setContextUsed(inputTokens + outputTokens);
              setStreamBuffer(""); setActiveToolCalls([]); setStreaming(false);
              // Refresh session list to get updated message count
              if (projectId) {
                fetch(`${API_BASE}/api/projects/${projectId}/chat/history?sessionId=${sessionIdRef.current}`)
                  .then((r) => r.ok ? r.json() : { sessions: [] })
                  .then((data) => { if (data.sessions?.length) setSessions(data.sessions); })
                  .catch(() => {});
              }
            } else if (event.type === "tool_call") {
              const toolId = event.tool.toolCallId || event.tool.name;
              const existing = toolCallMap.get(toolId);
              if (existing) { existing.status = "success"; } else { toolCallMap.set(toolId, { name: event.tool.name, args: event.tool.args, toolCallId: event.tool.toolCallId, status: "running" }); }
              setActiveToolCalls(Array.from(toolCallMap.values()));
            }
          } catch {}
        }
      }
    } catch (err: unknown) { if (err instanceof Error && err.name !== "AbortError") setError(String(err)); }
    finally { setStreamBuffer(""); setStreaming(false); abortRef.current = null; }
  }, [input, projectId, streaming, attachedRefs, chatProvider, chatModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSearch) {
      if (e.key === "Enter") { setShowSearch(false); }
      return;
    }
    // Arrow up to edit last user message (when input is empty)
    if (e.key === "ArrowUp" && !input && messages.length > 0) {
      const lastUserIdx = messages.length - 1;
      if (messages[lastUserIdx].role === "user") {
        e.preventDefault();
        setInput(messages[lastUserIdx].content);
        setEditingIndex(lastUserIdx);
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Edit message ─────────────────────────────────────────────────────
  const handleEditMessage = useCallback((index: number) => {
    const msg = messages[index];
    if (msg.role !== "user") return;
    setInput(msg.content);
    setEditingIndex(index);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [messages]);

  // ── Regenerate last assistant response ────────────────────────────────
  const handleRegenerate = useCallback(() => {
    if (messages.length < 2 || streaming) return;
    // Find last user message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    // Remove the last assistant response (or the messages after last user message)
    setMessages((prev) => prev.slice(0, lastUserIdx + 1));
    // Resend the last user message
    const lastUser = messages[lastUserIdx];
    setAttachedRefs(lastUser.contextRefs ?? []);
    setEditingIndex(null);
    sendMessage(lastUser.content);
  }, [messages, streaming, sendMessage]);

  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.requires?.length && !action.requires.some((req) => attachedRefs.some((r) => r.kind === req))) return;
    if (editingIndex !== null) {
      // Replace the message at editingIndex
      setMessages((prev) => prev.map((m, i) => i === editingIndex ? { ...m, content: action.prompt } : m));
      setEditingIndex(null);
    }
    sendMessage(action.prompt);
  }, [sendMessage, attachedRefs, editingIndex]);

  const removeAttachedRef = useCallback((refId: string) => setAttachedRefs((prev) => prev.filter((r) => `${r.kind}:${r.id}` !== refId)), []);
  const availableQuickActions = QUICK_ACTIONS.filter((a) => !a.requires?.length || a.requires.some((req) => attachedRefs.some((r) => r.kind === req)));

  // ── Flatten duplicate Minimize2 import ───────────────────────────────

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
                <button onClick={() => setIsFullscreen(!isFullscreen)}
                  className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}><X size={16} /></button>
              </div>
            </div>
            {/* Body: thread sidebar + chat */}
            <div className="flex flex-1 min-h-0">
              {/* Thread sidebar */}
              <AnimatePresence>
                {showThreads && (
                  <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 220, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className={`shrink-0 border-r ${BORD} flex flex-col overflow-hidden`}>
                    <div className={`shrink-0 flex items-center justify-between px-3 h-10 border-b ${BORD}`}>
                      <span className={`text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>Threads</span>
                      <button onClick={newSession}
                        className={`inline-flex items-center gap-0.5 text-[9px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}
                        title="New thread">
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
                              onBlur={() => submitRename(s.id)}
                              onKeyDown={(e) => { if (e.key === "Enter") submitRename(s.id); if (e.key === "Escape") setRenamingSession(null); }}
                              autoFocus
                              className={`w-full text-[10px] px-2.5 py-2 rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} focus:outline-none focus:border-blue-500`} />
                          ) : (
                            <button onClick={() => switchSession(s.id)}
                              className={`w-full text-left px-2.5 py-2 rounded text-[10px] transition-colors ${
                                activeSessionId === s.id ? `${ACC_BG} ${ACC_TXT}` : `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
                              }`}>
                              <div className="font-medium truncate pr-4">{s.title}</div>
                              <div className={`text-[8px] ${MUT} mt-0.5`}>{s.messageCount} message{s.messageCount !== 1 ? "s" : ""}</div>
                            </button>
                          )}
                          {renamingSession !== s.id && (
                            <button onClick={() => handleRename(s.id)}
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
                  {/* Scroll to bottom button */}
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
                      isLastAssistant={msg.role === "assistant" && i === messages.length - 1 && !streaming} />
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
                      {activeToolCalls.map((tc, j) => <ToolBadge key={j} tc={tc} compact />)}
                    </motion.div>
                  )}
                  {error && <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 justify-center"><AlertCircle size={11} />{error}</div>}
                  <div ref={bottomRef} />
                </div>
                {/* Input area */}
                <div className={`shrink-0 border-t ${BORD} p-4`}>
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
                  <div className="flex gap-2 items-end">
                    <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                      placeholder={attachedRefs.length > 0 ? `Ask about ${attachedRefs.map((r) => r.kind).join(", ")}...` : "Ask about the project or suggest fixes..."}
                      rows={3} disabled={!projectId || streaming}
                      className={`flex-1 resize-none rounded-lg border ${BORD} ${SURF} px-3 py-2 text-xs ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500 disabled:opacity-50`} />
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}