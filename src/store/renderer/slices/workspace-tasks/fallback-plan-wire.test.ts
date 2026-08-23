/**
 * Fallback plan card wire pipeline (monorepo#3249, mock-BE).
 *
 * FAKE transport only: the backend bridge is mocked so nothing reaches a real
 * daemon. Proves the full read path the fallback card depends on — the exact
 * `task.list` wire request (PROTOCOL §5.4), a PROTOCOL-shaped response
 * normalized by LiveTasksClient, folded through the real reducer, and
 * surfaced by `selectFallbackPlanTasksForAgent` — with no client-side task
 * derivation anywhere in between.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from "../../../../lib/client/live/backend-transport";
import { LiveTasksClient } from "../../../../lib/client/live/live-tasks-client";
import type { StoreState } from "../../types";
import { selectFallbackPlanTasksForAgent } from "./workspace-tasks-selectors";
import {
  initialState,
  loadWorkspaceTasksSucceeded,
  workspaceTasksReducer,
} from "./workspace-tasks-slice";

const mockedRequest = vi.mocked(backendRequest);

describe("fallback plan card wire pipeline (mock-BE)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drives the rendered fallback list from a PROTOCOL-shaped task.list response", async () => {
    // PROTOCOL §5.4 response shape: entity rows + the BE-computed aggregate.
    mockedRequest.mockResolvedValueOnce({
      tasks: [
        { id: "n1", title: "Ship API", status: "complete", specLinked: true },
        { id: "n2", title: "Wire UI", status: "in_progress", specLinked: true },
        { id: "n3", title: "Scratch note", status: "not_started", specLinked: false },
        { id: "n4", title: "Dropped", status: "cancelled", specLinked: true },
        { id: "n5", title: "Docs", status: "not_started", specLinked: true },
      ],
      stats: { total: 4, completed: 1, inProgress: 1 },
    });

    const client = new LiveTasksClient();
    const { tasks, stats } = await client.list("ws-1");

    expect(mockedRequest).toHaveBeenCalledExactlyOnceWith("task.list", { workspaceId: "ws-1" });

    const workspaceTasks = workspaceTasksReducer(
      initialState,
      loadWorkspaceTasksSucceeded("ws-1", tasks, stats),
    );
    const state = { workspaceTasks } as unknown as StoreState;

    // Coordinator/root view (no agent-task associations): spec-linked rows in
    // source order, cancelled and specLinked:false rows excluded.
    expect(
      selectFallbackPlanTasksForAgent.select(state, "ws-1", "coordinator-1").map((t) => t.id),
    ).toEqual(["n1", "n2", "n5"]);
  });

  it("drives the delegated single-task view from task.list + task.listAgentLinks responses", async () => {
    mockedRequest
      .mockResolvedValueOnce({
        tasks: [
          { id: "n1", title: "Coordinator task", status: "not_started", specLinked: true },
          { id: "n2", title: "Delegated task", status: "in_progress", specLinked: true },
        ],
        stats: { total: 2, completed: 0, inProgress: 1 },
      })
      // PROTOCOL §5.4 task.listAgentLinks response shape (pre-grouped map).
      .mockResolvedValueOnce({
        linksByNoteId: {
          n2: {
            "agent:agent-9": {
              workspaceId: "ws-1",
              noteId: "n2",
              taskKey: "agent:agent-9",
              taskText: "Delegated task",
              agentId: "agent-9",
              createdAt: 1700000000000,
            },
          },
        },
      });

    const client = new LiveTasksClient();
    const { tasks, stats } = await client.list("ws-1");
    const linksByNoteId = await client.listAgentLinks("ws-1");

    expect(mockedRequest).toHaveBeenNthCalledWith(1, "task.list", { workspaceId: "ws-1" });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "task.listAgentLinks", {
      workspaceId: "ws-1",
    });

    const workspaceTasks = workspaceTasksReducer(
      initialState,
      loadWorkspaceTasksSucceeded("ws-1", tasks, stats),
    );
    const state = {
      workspaceTasks,
      taskAgentAssociations: { byWorkspaceId: { "ws-1": { byNoteId: linksByNoteId } } },
    } as unknown as StoreState;

    expect(
      selectFallbackPlanTasksForAgent.select(state, "ws-1", "agent-9").map((t) => t.id),
    ).toEqual(["n2"]);
    expect(
      selectFallbackPlanTasksForAgent.select(state, "ws-1", "coordinator-1").map((t) => t.id),
    ).toEqual(["n1", "n2"]);
  });
});
