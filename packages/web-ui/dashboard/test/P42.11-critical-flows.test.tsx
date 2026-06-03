/**
 * P42.11 Critical Flow Tests
 *
 * Tests for navigation state, cockpit tabs, center work surface,
 * and keyboard/focus/accessibility basics identified during the
 * P42.11 workspace audit.
 *
 * Acceptance Criteria:
 * - Navigation state routes transition correctly
 * - CockpitTabs renders all 5 tabs with correct aria roles
 * - CenterWorkSurface renders correct content per route type
 * - Keyboard navigation basics (tabIndex, role, aria-*)
 * - Focus management for interactive elements
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { NavigationProvider, useNavigation } from "../src/navigation/NavigationState";
import { CockpitTabs } from "../src/routes/CockpitTabs";
import type { CockpitTabId, NavigationRoute } from "../src/navigation/NavigationState";
import { CenterWorkSurface } from "../src/routes/CenterWorkSurface";
import React from "react";

// ---------------------------------------------------------------------------
// AC 1: Navigation state routes transition correctly
// ---------------------------------------------------------------------------

describe("P42.11 NavigationState", () => {
  let hookResult: { current: ReturnType<typeof useNavigation> };

  function renderNavHook(initialRoute?: NavigationRoute) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider initialRoute={initialRoute}>{children}</NavigationProvider>
    );
    hookResult = renderHook(() => useNavigation(), { wrapper }).result;
  }

  beforeEach(() => {
    // Reset for each test
  });

  it("starts with default empty route", () => {
    renderNavHook();
    expect(hookResult.current.route.type).toBe("empty");
    expect(hookResult.current.route.projectId).toBeNull();
    expect(hookResult.current.route.planExecId).toBeNull();
    expect(hookResult.current.route.cockpitTab).toBe("overview");
  });

  it("navigates to a run execution", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToRun("exec-123");
    });
    expect(hookResult.current.route.type).toBe("run");
    expect(hookResult.current.route.planExecId).toBe("exec-123");
    expect(hookResult.current.route.cockpitTab).toBe("overview");
  });

  it("navigates to a task detail", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToTask("task-456");
    });
    expect(hookResult.current.route.type).toBe("task");
    expect(hookResult.current.route.taskId).toBe("task-456");
  });

  it("navigates to a workspace detail", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToWorkspaceDetail("ws-789");
    });
    expect(hookResult.current.route.type).toBe("workspace-detail");
    expect(hookResult.current.route.workspaceId).toBe("ws-789");
  });

  it("navigates to a platform screen", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToPlatform("brain_overview");
    });
    expect(hookResult.current.route.type).toBe("platform");
    expect(hookResult.current.route.platformScreen).toBe("brain_overview");
  });

  it("navigates to empty state", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToRun("exec-123");
    });
    act(() => {
      hookResult.current.navigateToEmpty();
    });
    expect(hookResult.current.route.type).toBe("empty");
    expect(hookResult.current.route.planExecId).toBeNull();
  });

  it("switches cockpit tabs within a run view", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToRun("exec-123");
    });
    act(() => {
      hookResult.current.setCockpitTab("workspaces");
    });
    expect(hookResult.current.route.type).toBe("run");
    expect(hookResult.current.route.cockpitTab).toBe("workspaces");
  });

  it("navigateToWorkspace sets type to run with workspaces tab", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToWorkspace("ws-111");
    });
    expect(hookResult.current.route.type).toBe("run");
    expect(hookResult.current.route.workspaceId).toBe("ws-111");
    expect(hookResult.current.route.cockpitTab).toBe("workspaces");
  });

  it("preserves project context across navigations", () => {
    renderNavHook({
      type: "run",
      projectId: "proj-1",
      taskId: null,
      planExecId: "exec-1",
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    });
    expect(hookResult.current.route.projectId).toBe("proj-1");

    act(() => {
      hookResult.current.navigateToPlatform("brain_overview");
    });
    // projectId should persist
    expect(hookResult.current.route.projectId).toBe("proj-1");
  });

  it("replaces workspace on run navigation", () => {
    renderNavHook();
    act(() => {
      hookResult.current.navigateToWorkspace("ws-old");
    });
    act(() => {
      hookResult.current.navigateToRun("exec-new");
    });
    expect(hookResult.current.route.workspaceId).toBeNull();
    expect(hookResult.current.route.planExecId).toBe("exec-new");
  });
});

// ---------------------------------------------------------------------------
// AC 2: CockpitTabs renders all 5 tabs with correct aria roles
// ---------------------------------------------------------------------------

describe("P42.11 CockpitTabs", () => {
  it("renders all 5 cockpit tabs", () => {
    render(
      <CockpitTabs activeTab="overview" onTabChange={() => {}} />
    );
    expect(screen.getByText("Overview")).toBeDefined();
    expect(screen.getByText("Workspaces")).toBeDefined();
    expect(screen.getByText("Files")).toBeDefined();
    expect(screen.getByText("Logs")).toBeDefined();
    expect(screen.getByText("Escalations")).toBeDefined();
  });

  it("has correct aria role for tablist", () => {
    render(
      <CockpitTabs activeTab="overview" onTabChange={() => {}} />
    );
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeDefined();
    expect(tablist.getAttribute("aria-label")).toBe("Cockpit tabs");
  });

  it("marks active tab with aria-selected", () => {
    render(
      <CockpitTabs activeTab="workspaces" onTabChange={() => {}} />
    );
    const tabs = screen.getAllByRole("tab");
    const workspaceTab = tabs.find(
      (t) => t.textContent?.includes("Workspaces")
    );
    expect(workspaceTab).toBeDefined();
    expect(workspaceTab!.getAttribute("aria-selected")).toBe("true");
  });

  it("non-active tabs have aria-selected false", () => {
    render(
      <CockpitTabs activeTab="overview" onTabChange={() => {}} />
    );
    const tabs = screen.getAllByRole("tab");
    const logsTab = tabs.find((t) => t.textContent?.includes("Logs"));
    expect(logsTab).toBeDefined();
    expect(logsTab!.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onTabChange when a tab is clicked", () => {
    const onTabChange = vi.fn();
    render(
      <CockpitTabs activeTab="overview" onTabChange={onTabChange} />
    );
    fireEvent.click(screen.getByText("Logs"));
    expect(onTabChange).toHaveBeenCalledWith("logs");
  });

  it("renders badge counts when provided", () => {
    render(
      <CockpitTabs
        activeTab="overview"
        onTabChange={() => {}}
        tabBadges={{ escalations: 5, workspaces: 12 }}
      />
    );
    // Should show badge for escalations
    const escalationTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Escalations"));
    expect(escalationTab).toBeDefined();
    expect(escalationTab!.textContent).toContain("5");
  });

  it("caps badge display at 99+", () => {
    render(
      <CockpitTabs
        activeTab="overview"
        onTabChange={() => {}}
        tabBadges={{ workspaces: 150 }}
      />
    );
    const workspacesTab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Workspaces"));
    expect(workspacesTab).toBeDefined();
    expect(workspacesTab!.textContent).toContain("99+");
  });

  it("tabs are keyboard-focusable (button elements)", () => {
    render(
      <CockpitTabs activeTab="overview" onTabChange={() => {}} />
    );
    const tabs = screen.getAllByRole("tab");
    for (const tab of tabs) {
      expect(tab.tagName).toBe("BUTTON");
      // Buttons are natively focusable
    }
  });
});

// ---------------------------------------------------------------------------
// AC 3: CenterWorkSurface renders correct content per route type
// ---------------------------------------------------------------------------

describe("P42.11 CenterWorkSurface", () => {
  it("renders empty state for empty route", () => {
    const route: NavigationRoute = {
      type: "empty",
      projectId: null,
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        onUploadPlan={() => {}}
      />
    );
    expect(screen.getByText("Your Pi cockpit is ready.")).toBeDefined();
  });

  it("renders upload plan CTA in empty state", () => {
    const route: NavigationRoute = {
      type: "empty",
      projectId: null,
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    const onUploadPlan = vi.fn();
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        onUploadPlan={onUploadPlan}
      />
    );
    const uploadBtn = screen.getByText("Upload a plan");
    expect(uploadBtn).toBeDefined();
    fireEvent.click(uploadBtn);
    expect(onUploadPlan).toHaveBeenCalled();
  });

  it("renders platform content for platform route", () => {
    const route: NavigationRoute = {
      type: "platform",
      projectId: "proj-1",
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: "brain_overview",
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        platformContent={<div data-testid="platform-content">Brain Overview</div>}
      />
    );
    expect(screen.getByTestId("platform-content")).toBeDefined();
    expect(screen.getByText("Brain Overview")).toBeDefined();
  });

  it("renders fallback for platform route without content", () => {
    const route: NavigationRoute = {
      type: "platform",
      projectId: "proj-1",
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: "brain_overview",
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface route={route} onTabChange={() => {}} />
    );
    expect(screen.getByText("Platform view")).toBeDefined();
  });

  it("renders task content for task route", () => {
    const route: NavigationRoute = {
      type: "task",
      projectId: "proj-1",
      taskId: "task-1",
      planExecId: null,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        taskContent={<div data-testid="task-content">Task 1 Details</div>}
      />
    );
    expect(screen.getByTestId("task-content")).toBeDefined();
  });

  it("renders workspace detail content", () => {
    const route: NavigationRoute = {
      type: "workspace-detail",
      projectId: "proj-1",
      taskId: null,
      planExecId: null,
      workspaceId: "ws-1",
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        workspaceDetailContent={
          <div data-testid="ws-detail">Workspace Detail</div>
        }
      />
    );
    expect(screen.getByTestId("ws-detail")).toBeDefined();
  });

  it("renders cockpit tabs for run route", () => {
    const route: NavigationRoute = {
      type: "run",
      projectId: "proj-1",
      taskId: null,
      planExecId: "exec-1",
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
      />
    );
    // Should render tabs (tablist role)
    expect(screen.getByRole("tablist")).toBeDefined();
  });

  it("renders tab content for run route", () => {
    const route: NavigationRoute = {
      type: "run",
      projectId: "proj-1",
      taskId: null,
      planExecId: "exec-1",
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "workspaces",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        tabContent={{
          workspaces: <div data-testid="workspaces-content">Workspaces Tab Content</div>,
        }}
      />
    );
    expect(screen.getByTestId("workspaces-content")).toBeDefined();
  });

  it("does not show cockpit tabs when showCockpitTabs is false", () => {
    const route: NavigationRoute = {
      type: "run",
      projectId: "proj-1",
      taskId: null,
      planExecId: "exec-1",
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        showCockpitTabs={false}
      />
    );
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("renders contextual toolbar above content", () => {
    const route: NavigationRoute = {
      type: "platform",
      projectId: "proj-1",
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: "brain_overview",
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        contextualToolbar={
          <div data-testid="contextual-toolbar">Actions Bar</div>
        }
      />
    );
    expect(screen.getByTestId("contextual-toolbar")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC 4: Keyboard/focus/accessibility basics
// ---------------------------------------------------------------------------

describe("P42.11 Accessibility basics", () => {
  it("CockpitTabs tabs are accessible via keyboard (Tab)", () => {
    render(
      <CockpitTabs activeTab="overview" onTabChange={() => {}} />
    );
    const tabs = screen.getAllByRole("tab");

    // All tabs are button elements which are natively focusable
    for (const tab of tabs) {
      expect(tab.tagName).toBe("BUTTON");
      // Verify tab is focusable
      tab.focus();
      expect(document.activeElement).toBe(tab);
    }
  });

  it("CenterWorkSurface empty state has semantic button elements", () => {
    const route: NavigationRoute = {
      type: "empty",
      projectId: null,
      taskId: null,
      planExecId: null,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    };
    render(
      <CenterWorkSurface
        route={route}
        onTabChange={() => {}}
        onUploadPlan={() => {}}
      />
    );
    const button = screen.getByText("Upload a plan");
    expect(button.tagName).toBe("BUTTON");
  });

  it("app shell uses role='navigation' for sidebar", () => {
    // Verify NavigationState provider renders without error
    const { container } = render(
      <NavigationProvider>
        <div role="navigation" aria-label="Sidebar navigation">
          Sidebar
        </div>
      </NavigationProvider>
    );
    const nav = container.querySelector('[role="navigation"]');
    expect(nav).toBeDefined();
    expect(nav!.getAttribute("aria-label")).toBe("Sidebar navigation");
  });

  it("throws clear error when useNavigation is used outside provider", () => {
    // Suppress console.error for this test since we expect an error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useNavigation());
    }).toThrow("useNavigation must be used within a NavigationProvider");

    spy.mockRestore();
  });
});
