import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Bot, User, X, AlertCircle, Terminal, Code, CheckCircle2, XCircle } from "lucide-react";

const API_BASE = "";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEvent[];
}

interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  toolCallId?: string;
  status?: "running" | "success" | "error";
  result?: string;
}

interface ChatPanelProps {
  projectId: string | null;
  onClose: () => void;
}

export function ChatPanel({ projectId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Load chat history from backend when project changes
  useEffect(() => {
    if (!projectId) return;
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setStreamBuffer("");
    setError(null);

    fetch(`${API_BASE}/api/projects/${projectId}/chat/history`)
      .then((r) => r.ok ? r.json() : { messages: [] })
      .then((data) => {
        if (data.messages?.length) {
          setMessages(data.messages);
        }
      })
      .catch(() => {/* ignore */});
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !projectId || streaming) return;

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
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
        body: JSON.stringify({ projectId, message: text, sessionId }),
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

    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(String(err));
      }
    } finally {
      setStreamBuffer("");
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, projectId, streaming, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1E1E1E]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 h-10 border-b border-[#E8E6E1] dark:border-[#333]">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Pi Chat</span>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-400 dark:text-stone-500">
            <Bot size={24} strokeWidth={1.2} />
            <p className="text-xs text-center">Ask about the project, execution results,<br />or request changes.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />
            )}
            <div className="max-w-[85%] space-y-1.5">
              {/* Message content */}
              <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-stone-100 dark:bg-[#2A2A2A] text-stone-700 dark:text-stone-300"
              }`}>
                <pre className="whitespace-pre-wrap break-words font-sans">{msg.content}</pre>
              </div>
              {/* Tool calls */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-1">
                  {msg.toolCalls.map((tc, j) => (
                    <div key={j} className="flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-[#252525] rounded px-2 py-1">
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
                      {tc.status === "success" && <CheckCircle2 size={10} className="ml-auto shrink-0 text-green-500" />}
                      {tc.status === "error" && <XCircle size={10} className="ml-auto shrink-0 text-red-500" />}
                      {tc.status === "running" && <Loader2 size={10} className="ml-auto shrink-0 text-blue-500 animate-spin" />}
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
                <div key={j} className="flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-[#252525] rounded px-2 py-1">
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
                  {tc.status === "running" && <Loader2 size={10} className="ml-auto shrink-0 text-blue-500 animate-spin" />}
                  {tc.status === "success" && <CheckCircle2 size={10} className="ml-auto shrink-0 text-green-500" />}
                  {tc.status === "error" && <XCircle size={10} className="ml-auto shrink-0 text-red-500" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {streamBuffer && (
          <div className="flex gap-2 justify-start">
            <Bot size={14} className="shrink-0 mt-1 text-blue-600 dark:text-blue-400" />
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-stone-100 dark:bg-[#2A2A2A] text-stone-700 dark:text-stone-300">
              <pre className="whitespace-pre-wrap break-words font-sans">{streamBuffer}</pre>
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
      <div className="shrink-0 border-t border-[#E8E6E1] dark:border-[#333] p-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the project or suggest fixes..."
            rows={2}
            disabled={!projectId || streaming}
            className="flex-1 resize-none rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#161616] px-3 py-2 text-xs text-stone-700 dark:text-stone-300 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || !projectId}
            className="h-9 w-9 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        {!projectId && (
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1">Select a project to enable chat</p>
        )}
      </div>
    </div>
  );
}
