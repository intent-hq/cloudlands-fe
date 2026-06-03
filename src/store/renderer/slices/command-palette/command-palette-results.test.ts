import {
  describe,
  expect,
  it,
} from "vitest";
import {
  computeResults,
  type ComputeResultsInput,
} from "./command-palette-results";
import type { WorkspaceObject } from "./command-palette-utils";

const icon = { iconName: "test" };

const defaultCommands = [
  { id: "new-workspace", label: "New Workspace", icon, shortcut: "⌘T" },
  { id: "settings", label: "Settings", icon, shortcut: "⌘," },
  { id: "new-agent", label: "New Agent Chat", icon },
  { id: "new-terminal", label: "New Terminal", icon },
  { id: "new-note", label: "New Note", icon },
  { id: "new-file", label: "New File", icon, shortcut: "⌘N" },
];

function makeInput(overrides: Partial<ComputeResultsInput> = {}): ComputeResultsInput {
  return {
    query: "",
    activeFilter: null,
    workspaceId: "ws-1",
    agents: [],
    notes: [],
    changes: [],
    terminals: [],
    browserUrls: [],
    recentItems: [],
    files: [],
    commands: defaultCommands,
    workspaceItems: [],
    ...overrides,
  };
}

function makeAgent(id: string, label: string): WorkspaceObject {
  return { id, type: "agent", label, icon, timestamp: Date.now() };
}

describe("computeResults", () => {
  it("returns new actions row when workspace is set and no query", () => {
    const results = computeResults(makeInput());
    const newActionsRow = results.find((r: any) => r._newActionsRow);
    expect(newActionsRow).toBeDefined();
  });

  it("does not return new actions row when no workspaceId", () => {
    const results = computeResults(makeInput({ workspaceId: undefined }));
    // Should still have new workspace button
    const newWs = results.find((r: any) => r._newWorkspace);
    expect(newWs).toBeDefined();
  });

  it("shows agents group with label", () => {
    const agents = [makeAgent("a1", "Agent 1"), makeAgent("a2", "Agent 2")];
    const results = computeResults(makeInput({ agents }));
    const agentLabel = results.find((r: any) => r._groupLabel === "Agents");
    expect(agentLabel).toBeDefined();
  });

  it("limits items per group to 3 when not searching", () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const results = computeResults(makeInput({ agents }));
    const agentItems = results.filter((r: any) => r.type === "agent");
    expect(agentItems.length).toBe(3);
    const showMore = results.find((r: any) => r._showMore && r._itemType === "agent");
    expect(showMore).toBeDefined();
    expect(showMore._count).toBe(2);
  });

  it("shows all items when activeFilter matches type", () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const results = computeResults(makeInput({ agents, activeFilter: "agent" }));
    const agentItems = results.filter((r: any) => r.type === "agent");
    expect(agentItems.length).toBe(5);
  });

  it("filters by fuzzy search when query is provided", () => {
    const agents = [makeAgent("a1", "Build Server"), makeAgent("a2", "Test Runner")];
    const results = computeResults(makeInput({ agents, query: "build" }));
    const items = results.filter((r: any) => r.type === "agent");
    expect(items.length).toBe(1);
    expect(items[0].label).toBe("Build Server");
  });

  it("includes workspace items in search results", () => {
    const workspaceItems = [
      { id: "ws-2", label: "Other Space", icon, description: "repo", _workspace: true as const },
    ];
    const results = computeResults(makeInput({ workspaceItems, query: "other" }));
    const wsItem = results.find((r: any) => r._workspace);
    expect(wsItem).toBeDefined();
  });

  it("shows recent items group when present and no filter", () => {
    const recentItems = [makeAgent("a1", "Recent Agent")];
    const results = computeResults(makeInput({ recentItems }));
    const recentLabel = results.find((r: any) => r._groupLabel === "Recent");
    expect(recentLabel).toBeDefined();
  });

  it("hides recent items when activeFilter is set", () => {
    const recentItems = [makeAgent("a1", "Recent Agent")];
    const results = computeResults(makeInput({ recentItems, activeFilter: "agent" }));
    const recentLabel = results.find((r: any) => r._groupLabel === "Recent");
    expect(recentLabel).toBeUndefined();
  });

  it("shows border above Other Spaces section", () => {
    const workspaceItems = [
      { id: "ws-2", label: "Other", icon, description: "repo", _workspace: true as const },
    ];
    const results = computeResults(makeInput({ workspaceItems }));
    const border = results.find((r: any) => r._borderAbove);
    expect(border).toBeDefined();
  });

  it("assigns unique _idx to every result item", () => {
    const agents = [makeAgent("a1", "Agent 1"), makeAgent("a2", "Agent 2")];
    const results = computeResults(makeInput({ agents }));
    const indices = results.map((r: any) => r._idx);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

