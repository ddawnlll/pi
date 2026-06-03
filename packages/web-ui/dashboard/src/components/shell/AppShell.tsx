/**
 * AppShell — P42 V3 App Shell
 *
 * Main shell layout composing:
 * - TopbarV3 (with breadcrumbs)
 * - Left TaskRunSidebar
 * - CenterWorkSurface (with CockpitTabs)
 * - StatusBarV3
 * - ContextualRightDrawer (hidden by default)
 * - Error banner
 * - Dialogs
 *
 * This provides the V3 layout frame. App.tsx delegates its layout
 * responsibilities to this shell.
 */

import { AnimatePresence, motion } from "framer-motion";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
  AlertCircle,
  X,
} from "lucide-react";
import type { BreadcrumbSegment } from "../../navigation/BreadcrumbModel";
import type { CockpitTabId, NavigationRoute } from "../../navigation/NavigationState";
import type { DrawerPanel } from "./ContextualRightDrawer";
import { ContextualRightDrawer } from "./ContextualRightDrawer";

// ---------------------------------------------------------------------------
// Style tokens (matching existing App.tsx conventions)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppShellProps {
  /** Breadcrumb segments for the topbar. */
  breadcrumbs: BreadcrumbSegment[];

  /** Topbar content (custom topbar or pre-built TopbarV3). */
  topbar: React.ReactNode;

  /** Left sidebar content (TaskRunSidebar or custom). */
  leftSidebar: React.ReactNode;

  /** Center work surface content. */
  centerContent: React.ReactNode;

  /** Status bar content (StatusBarV3 or custom). */
  statusBar?: React.ReactNode;

  /** Right drawer panel (null = hidden). */
  contextualDrawer?: DrawerPanel | null;

  /** Close handler for the contextual drawer. */
  onCloseDrawer?: () => void;

  /** Error banner message (null = hidden). */
  errorBanner?: string | null;

  /** Error banner clear handler. */
  onClearError?: () => void;

  /** Whether the left sidebar is open. */
  leftSidebarOpen?: boolean;

  /** Left sidebar toggle handler. */
  onToggleLeftSidebar?: () => void;

  /** Left sidebar width in px (default: 230). */
  leftSidebarWidth?: number;

  /** Mobile nav overlay type (null = no overlay). */
  mobileNav?: "left" | "right" | null;

  /** Mobile nav close handler. */
  onMobileNavClose?: () => void;

  /** Right sidebar (legacy) content — rendered only if explicitly open. */
  legacyRightSidebar?: React.ReactNode;

  /** Whether legacy right sidebar is open. */
  legacyRightOpen?: boolean;

  /** Dialogs rendered below the shell. */
  dialogs?: React.ReactNode;

  /** Additional content outside the main grid (e.g. overlay panels). */
  overlays?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppShell({
  breadcrumbs,
  topbar,
  leftSidebar,
  centerContent,
  statusBar,
  contextualDrawer,
  onCloseDrawer,
  errorBanner,
  onClearError,
  leftSidebarOpen = true,
  onToggleLeftSidebar,
  leftSidebarWidth = 230,
  mobileNav,
  onMobileNavClose,
  legacyRightSidebar,
  legacyRightOpen,
  dialogs,
  overlays,
}: AppShellProps) {
  return (
    <div className={`w-full h-screen flex flex-col ${BG} font-sans overflow-hidden`}>
      {/* ── Skip to main content (accessibility) ── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 text-white focus:text-primary-foreground focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* ── Topbar ── */}
      {topbar}

      {/* ── Error banner ── */}
      <AnimatePresence>
        {errorBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-900 px-4 py-2.5 flex items-center gap-2 text-xs text-red-700 dark:text-red-300 shrink-0"
          >
            <AlertCircle size={13} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{errorBanner}</span>
            <button
              onClick={onClearError}
              className="text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-300"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main body (sidebar + center + drawer) ── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Mobile overlay */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-30 md:hidden"
              onClick={onMobileNavClose}
            />
          )}
        </AnimatePresence>

        {/* ── Left sidebar ── */}
        <AnimatePresence initial={false}>
          {(leftSidebarOpen || mobileNav === "left") && (
            <motion.aside
              key="left-sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: leftSidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 ${SURF} border-r ${BORD} flex flex-col overflow-hidden
                md:relative md:z-auto ${mobileNav === "left" ? "absolute left-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              {leftSidebar}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── Center column ── */}
        <main id="main-content" className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {centerContent}
        </main>

        {/* ── Contextual drawer (right, hidden by default) ── */}
        <AnimatePresence>
          {contextualDrawer && (
            <motion.aside
              key="contextual-drawer"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <ContextualRightDrawer
                panel={contextualDrawer}
                onClose={onCloseDrawer ?? (() => {})}
                width={360}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── Legacy right sidebar (compat, only when explicitly open) ── */}
        {legacyRightSidebar && legacyRightOpen && (
          <AnimatePresence initial={false}>
            <motion.aside
              key="legacy-right"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              {legacyRightSidebar}
            </motion.aside>
          </AnimatePresence>
        )}

        {/* ── Overlays (brain context, artifact panels, etc.) ── */}
        {overlays}
      </div>

      {/* ── Status bar ── */}
      {statusBar}

      {/* ── Dialogs ── */}
      {dialogs}
    </div>
  );
}
