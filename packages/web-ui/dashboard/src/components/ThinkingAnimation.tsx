/**
 * ThinkingAnimation — animated thinking indicator with live writing effect.
 *
 * Three distinct animation states:
 * - "thinking": Pulsing dots + rotating brain icon (agent is generating)
 * - "executing": Bouncing tool icon (agent is running a tool)
 * - "deciding": Gentle cycling arrow (agent is evaluating results)
 *
 * The `text` prop streams in letter-by-letter when `animateText` is true,
 * creating a live writing effect.
 */

import { useEffect, useRef, useState } from "react";

type ThinkingState = "thinking" | "executing" | "deciding" | "compacting" | "idle";

interface ThinkingAnimationProps {
  /** Current state of the agent */
  state: ThinkingState;
  /** Status text to display (supports streaming animation) */
  text?: string;
  /** Whether to animate the text letter-by-letter (default: true) */
  animateText?: boolean;
  /** Whether this is a transient flash (disappears after delay) */
  transient?: boolean;
  /** Auto-dismiss delay in ms for transient animations (default: 2000) */
  transientDuration?: number;
  /** Optional className for outer container */
  className?: string;
}

// ─── Color schemes per state ────────────────────────────────────────────────

const STATE_STYLES: Record<ThinkingState, {
  dot: string;
  bg: string;
  text: string;
  border: string;
  icon: string;
}> = {
  thinking: {
    dot: "bg-blue-500 dark:bg-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-800",
    icon: "\u{1F9E0}", // brain
  },
  executing: {
    dot: "bg-emerald-500 dark:bg-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: "\u{1F527}", // wrench
  },
  deciding: {
    dot: "bg-purple-500 dark:bg-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-800",
    icon: "\u{1F500}", // shuffle
  },
  compacting: {
    dot: "bg-amber-500 dark:bg-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
    icon: "\u{1F4BE}", // floppy
  },
  idle: {
    dot: "bg-stone-300 dark:bg-stone-600",
    bg: "bg-stone-50 dark:bg-stone-900/30",
    text: "text-stone-500 dark:text-stone-400",
    border: "border-stone-200 dark:border-stone-800",
    icon: "\u{23F8}\uFE0F", // pause
  },
};

// ─── Dot animation ──────────────────────────────────────────────────────────

function AnimatedDots({ state }: { state: ThinkingState }) {
  const { dot } = STATE_STYLES[state];
  return (
    <span className="inline-flex items-center gap-[3px] ml-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot} animate-thinking-dot-1`} />
      <span className={`w-1.5 h-1.5 rounded-full ${dot} animate-thinking-dot-2`} />
      <span className={`w-1.5 h-1.5 rounded-full ${dot} animate-thinking-dot-3`} />
    </span>
  );
}

// ─── Animated icon ──────────────────────────────────────────────────────────

function AnimatedIcon({ state }: { state: ThinkingState }) {
  const style = STATE_STYLES[state];
  const animationClass =
    state === "thinking" ? "animate-brain-pulse" :
    state === "executing" ? "animate-tool-bounce" :
    state === "compacting" ? "animate-spin-slow" :
    state === "deciding" ? "animate-arrow-cycle" :
    "";

  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${style.bg} shrink-0 ${animationClass}`}>
      <span className="text-sm leading-none">{style.icon}</span>
    </span>
  );
}

// ─── Animated status bar ────────────────────────────────────────────────────

function StatusBar({ state, text }: { state: ThinkingState; text: string }) {
  const style = STATE_STYLES[state];
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-medium">
      <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
        {state}
      </span>
      <span className={`truncate max-w-[200px] ${style.text}`}>{text}</span>
      <AnimatedDots state={state} />
    </div>
  );
}

// ─── Full animation component ───────────────────────────────────────────────

export function ThinkingAnimation({
  state,
  text = "",
  animateText = true,
  transient = false,
  transientDuration = 2000,
  className = "",
}: ThinkingAnimationProps) {
  const [visible, setVisible] = useState(!transient);
  const [displayedText, setDisplayedText] = useState("");
  const [showCursor, setShowCursor] = useState(false);
  const textIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const style = STATE_STYLES[state];

  // Auto-dismiss transient animations
  useEffect(() => {
    if (!transient) {
      setVisible(true);
      return;
    }
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), transientDuration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [transient, transientDuration, state, text]);

  // Letter-by-letter text animation
  useEffect(() => {
    if (!animateText || !text) {
      setDisplayedText(text);
      setShowCursor(!!text);
      return;
    }

    textIndexRef.current = 0;
    setDisplayedText("");

    const interval = setInterval(() => {
      if (textIndexRef.current < text.length) {
        setDisplayedText(text.slice(0, textIndexRef.current + 1));
        textIndexRef.current++;
      } else {
        clearInterval(interval);
        setShowCursor(false);
      }
    }, 15); // 15ms per character ≈ 66 chars/sec

    setShowCursor(true);

    return () => clearInterval(interval);
  }, [text, animateText]);

  if (!visible) return null;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${style.border} ${style.bg} transition-all duration-300 ${className}`}
    >
      <AnimatedIcon state={state} />
      <div className="flex-1 min-w-0">
        <StatusBar state={state} text={text} />
        {displayedText && (
          <p className="text-xs mt-1 text-stone-700 dark:text-stone-300 leading-relaxed">
            {displayedText}
            {showCursor && (
              <span className="inline-block w-[2px] h-[14px] bg-stone-500 dark:bg-stone-400 ml-[1px] align-text-bottom animate-cursor-blink" />
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Live writing text component ────────────────────────────────────────────

interface LiveWritingTextProps {
  /** Full text to animate in */
  text: string;
  /** Animation speed: chars per interval (default: 1) */
  charsPerTick?: number;
  /** Interval in ms between ticks (default: 20) */
  tickMs?: number;
  /** Whether to show a blinking cursor (default: true) */
  showCursor?: boolean;
  /** ClassName for the text span */
  className?: string;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Letter-by-letter writing animation for any text.
 * Stops cursor blinking on completion. Re-animates when text changes.
 */
export function LiveWritingText({
  text,
  charsPerTick = 1,
  tickMs = 20,
  showCursor = true,
  className = "",
  onComplete,
}: LiveWritingTextProps) {
  const [displayed, setDisplayed] = useState("");
  const [completed, setCompleted] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");
    setCompleted(false);

    if (!text) return;

    const interval = setInterval(() => {
      const target = indexRef.current + charsPerTick;
      if (target >= text.length) {
        setDisplayed(text);
        clearInterval(interval);
        setCompleted(true);
        onComplete?.();
      } else {
        setDisplayed(text.slice(0, target));
        indexRef.current = target;
      }
    }, tickMs);

    return () => clearInterval(interval);
  }, [text, charsPerTick, tickMs, onComplete]);

  if (!text) return null;

  return (
    <span className={className}>
      {displayed}
      {showCursor && !completed && (
        <span className="inline-block w-[2px] h-[1em] bg-stone-500 dark:bg-stone-400 ml-[1px] align-text-bottom animate-cursor-blink" />
      )}
    </span>
  );
}

// ─── CSS keyframes (injected once) ──────────────────────────────────────────

const CSS_KEYFRAMES_ID = "thinking-animation-keyframes";

function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(CSS_KEYFRAMES_ID)) return;

  const style = document.createElement("style");
  style.id = CSS_KEYFRAMES_ID;
  style.textContent = `
    @keyframes thinking-dot-1 {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    @keyframes thinking-dot-2 {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    @keyframes thinking-dot-3 {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    @keyframes brain-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    @keyframes tool-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-2px); }
    }
    @keyframes arrow-cycle {
      0%, 100% { transform: rotate(0deg); }
      50% { transform: rotate(180deg); }
    }
    @keyframes spin-slow {
      to { transform: rotate(360deg); }
    }
    @keyframes cursor-blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
    .animate-thinking-dot-1 { animation: thinking-dot-1 1.4s ease-in-out infinite; }
    .animate-thinking-dot-2 { animation: thinking-dot-2 1.4s ease-in-out 0.2s infinite; }
    .animate-thinking-dot-3 { animation: thinking-dot-3 1.4s ease-in-out 0.4s infinite; }
    .animate-brain-pulse { animation: brain-pulse 2s ease-in-out infinite; }
    .animate-tool-bounce { animation: tool-bounce 1s ease-in-out infinite; }
    .animate-arrow-cycle { animation: arrow-cycle 1.5s ease-in-out infinite; }
    .animate-spin-slow { animation: spin-slow 2s linear infinite; }
    .animate-cursor-blink { animation: cursor-blink 1s step-end infinite; }
  `;
  document.head.appendChild(style);
}

injectKeyframes();
