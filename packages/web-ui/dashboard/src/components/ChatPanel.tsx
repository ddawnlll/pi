import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Send, Loader2, Bot, User, X, AlertCircle, Terminal, Code,
  CheckCircle2, XCircle, FileText, ClipboardList, AlertTriangle,
  Lightbulb, Wrench, FolderOpen, GitBranch, Archive, Search,
  FileEdit, Eye, Minimize2, ChevronDown, Brain,
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
    return <div className="relative group mb-3 last:mb-0"><pre className="overflow-x-auto rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-stone-50 dark:bg-[#1a1a1a] p-3 text-xs leading-relaxed"><code className={className} {...props}>{children}</code></pre></div>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">{children}</a>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-3 italic mb-2 text-stone-600 dark:text-stone-400">{children}</blockquote>,
  hr: () => <hr className="my-3 border-[#E8E6E1] dark:border-[#333]" />,
  table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-x-auto mb-3"><table className="w-full text-xs border-collapse border border-[#E8E6E1] dark:border-[#333]">{children}</table></div>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1 bg-stone-100 dark:bg-[#252525] font-semibold text-left">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border border-[#E8E6E1] dark:border-[#333] px-2 py-1">{children}</td>,
};

function MarkdownContent({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>;
}

function MessageBubble({ msg, index, onContextRefClick }: { msg: ChatMessage; index: number; onContextRefClick?: (ref: ContextRef) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}
      className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "assistant" && <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />}
      <div className="max-w-[85%] space-y-1.5">
        {msg.role === "user" && msg.contextRefs?.length ? (
          <div className="flex flex-wrap gap-1 mb-0.5">{msg.contextRefs.map((r) => <ContextRefPill key={`${r.kind}:${r.id}-${index}`} ctx={r} onClick={() => onContextRefClick?.(r)} />)}</div>
        ) : null}
        <div className={`rounded-lg px-3 py-2 leading-relaxed ${msg.role === "user" ? "bg-blue-600 text-white" : `bg-stone-100 dark:bg-[#2A2A2A] ${TXT}`}`}>
          {msg.role === "assistant" ? <MarkdownContent content={msg.content} /> : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
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
            {/* Search input */}
            <div className="relative mb-1 shrink-0">
              <Search size={10} className={`absolute left-2 top-1/2 -translate-y-1/2 ${MUT}`} />
              <input ref={searchRef} type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                autoFocus
                className={`w-full pl-6 pr-2 py-1.5 text-[10px] rounded border ${BORD} bg-white dark:bg-[#161616] ${TXT} placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500`}
              />
            </div>
            {/* Filtered model list */}
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const totalCharsRef = useRef(0);
  const estimateTokens = (text: string) => Math.round(text.length * 0.3);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/api/settings`).then((r) => r.ok ? r.json() : {}).then((s: Record<string, unknown>) => {
      setChatProvider((s.defaultProvider as string) ?? "opencode-go");
      setChatModel((s.defaultModel as string) ?? "deepseek-v4-flash");
      setContextLimit(((s.contextBudgets as Record<string, number>)?.flash ?? 128000));
    }).catch(() => {});
    fetch(`${API_BASE}/api/ai-models`).then((r) => r.ok ? r.json() : { providers: [] }).then((d) => setAiModels(d.providers ?? [])).catch(() => {});
    sessionIdRef.current = crypto.randomUUID();
    setAttachedRefs(externalContextRefs);
    setError(null);
    setContextUsed(0);
    totalCharsRef.current = 0;
    if (!projectId) return;
    fetch(`${API_BASE}/api/projects/${projectId}/chat/history`).then((r) => r.ok ? r.json() : { messages: [] }).then((data) => {
      if (data.messages?.length) {
        setMessages(data.messages);
        const chars = data.messages.reduce((s: number, m: { content: string }) => s + (m.content?.length ?? 0), 0);
        totalCharsRef.current = chars;
        setContextUsed(estimateTokens(String(chars)));
      }
    }).catch(() => {});
  }, [isOpen, projectId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamBuffer]);
  useEffect(() => { if (isOpen) { const t = setTimeout(() => inputRef.current?.focus(), 100); return () => clearTimeout(t); } }, [isOpen]);

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
          const chars = data.messages.reduce((s: number, m: { content: string }) => s + (m.content?.length ?? 0), 0);
          totalCharsRef.current = chars;
          setContextUsed(estimateTokens(String(chars)));
        }
      }
    } catch {} finally { setCompacting(false); }
  }, [compacting, messages, projectId]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !projectId || streaming) return;
    setInput("");
    setError(null);
    const snapshotRefs = [...attachedRefs];
    setMessages((prev) => [...prev, { role: "user", content: text, contextRefs: snapshotRefs }]);
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
            else if (event.type === "done") {
              setMessages((prev) => [...prev, { role: "assistant", content: fullText, toolCalls: Array.from(toolCallMap.values()) }]);
              setStreamBuffer(""); setActiveToolCalls([]); setStreaming(false);
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

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const handleQuickAction = useCallback((action: QuickAction) => {
    if (action.requires?.length && !action.requires.some((req) => attachedRefs.some((r) => r.kind === req))) return;
    sendMessage(action.prompt);
  }, [sendMessage, attachedRefs]);
  const removeAttachedRef = useCallback((refId: string) => setAttachedRefs((prev) => prev.filter((r) => `${r.kind}:${r.id}` !== refId)), []);
  const availableQuickActions = QUICK_ACTIONS.filter((a) => !a.requires?.length || a.requires.some((req) => attachedRefs.some((r) => r.kind === req)));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.1 }}
            className={`${SURF} border ${BORD} rounded-lg shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[80vh] min-h-[400px]`} onClick={(e) => e.stopPropagation()}>
            <div className={`shrink-0 flex items-center justify-between px-5 h-11 border-b ${BORD}`}>
              <div className="flex items-center gap-2"><Bot size={15} className="text-blue-600 dark:text-blue-400" /><span className={`text-xs font-semibold ${TXT}`}>Project Chat</span></div>
              <button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}><X size={16} /></button>
            </div>
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
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
              {messages.length === 0 && !streaming && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-400 dark:text-stone-500">
                  <Bot size={24} strokeWidth={1.2} /><p className="text-xs text-center">Ask about the project, execution results,<br />or request changes.</p>
                  {attachedRefs.length > 0 && <p className={`text-[10px] text-center mt-1 ${MUT}`}>{attachedRefs.length} context reference{attachedRefs.length !== 1 ? "s" : ""} attached</p>}
                </motion.div>
              )}
              {messages.map((msg, i) => <MessageBubble key={i} msg={msg} index={i} onContextRefClick={onContextRefClick} />)}
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
            <div className={`shrink-0 border-t ${BORD} p-4`}>
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
                <button onClick={() => sendMessage()} disabled={!input.trim() || streaming || !projectId}
                  className="h-10 w-10 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                  {streaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              {!projectId && <p className={`text-[10px] ${MUT} mt-1`}>Select a project to enable chat</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}