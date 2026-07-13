import {
  describe,
  expect,
  it,
} from "vitest";
import {
  addTaskAgentAssociation,
  applyRemoveTaskAgentAssociationsForAgent,
  hydrateTaskAgentAssociations,
  initialState,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
  taskAgentAssociationsReducer,
} from "./task-agent-associations-slice";
import type { TaskAgentAssociation } from "./task-agent-associations-types";

const association: TaskAgentAssociation = {
  taskText: "Do work",
  agentId: "agent-1",
  noteId: "note-1",
  createdAt: 1,
};

const keyedAssociation: TaskAgentAssociation = {
  ...association,
  taskKey: "0\u001fDo work",
};

describe("taskAgentAssociationsReducer", () => {
  it("hydrates associations by workspace and note", () => {
    const next = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", { "note-1": { "Do work": association } })
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]["Do work"]).toEqual(association);
  });

  it("adds and removes a task association", () => {
    const added = taskAgentAssociationsReducer(
      initialState,
      addTaskAgentAssociation("ws-1", "note-1", association)
    );
    const removed = taskAgentAssociationsReducer(
      added,
      removeTaskAgentAssociation("ws-1", "note-1", "Do work")
    );

    expect(added.byWorkspaceId["ws-1"].byNoteId["note-1"]["Do work"]).toEqual(association);
    expect(removed.byWorkspaceId["ws-1"].byNoteId["note-1"]).toBeUndefined();
  });

  it("stores duplicate task labels under independent task keys", () => {
    const first = { ...keyedAssociation, agentId: "agent-1" };
    const second = { ...keyedAssociation, taskKey: "1\u001fDo work", agentId: "agent-2" };
    const withFirst = taskAgentAssociationsReducer(
      initialState,
      addTaskAgentAssociation("ws-1", "note-1", first)
    );
    const withBoth = taskAgentAssociationsReducer(
      withFirst,
      addTaskAgentAssociation("ws-1", "note-1", second)
    );
    const withoutFirst = taskAgentAssociationsReducer(
      withBoth,
      removeTaskAgentAssociation("ws-1", "note-1", first.taskKey!)
    );

    expect(withBoth.byWorkspaceId["ws-1"].byNoteId["note-1"][first.taskKey!]).toEqual(first);
    expect(withBoth.byWorkspaceId["ws-1"].byNoteId["note-1"][second.taskKey!]).toEqual(second);
    expect(withoutFirst.byWorkspaceId["ws-1"].byNoteId["note-1"]).toEqual({
      [second.taskKey!]: second,
    });
  });

  it("removes all associations for an agent", () => {
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          "Do work": association,
          Other: { ...association, taskText: "Other", agentId: "agent-2" },
        },
      })
    );

    const next = taskAgentAssociationsReducer(
      state,
      applyRemoveTaskAgentAssociationsForAgent("ws-1", "agent-1")
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toEqual({
      Other: { ...association, taskText: "Other", agentId: "agent-2" },
    });
  });

  it("prunes associations for deleted task items in a note", () => {
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          "Do work": association,
          Other: { ...association, taskText: "Other", agentId: "agent-2" },
        },
      })
    );

    const next = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", ["Other"])
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toEqual({
      Other: { ...association, taskText: "Other", agentId: "agent-2" },
    });
  });

  it("prunes stable keyed task associations without removing same-label siblings", () => {
    const first = { ...association, taskKey: "agent:agent-1", agentId: "agent-1" };
    const second = { ...association, taskKey: "agent:agent-2", agentId: "agent-2" };
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          [first.taskKey!]: first,
          [second.taskKey!]: second,
        },
      })
    );

    const next = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", [second.taskKey!, "Do work"])
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toEqual({
      [second.taskKey!]: second,
    });
  });

  it("drops ambiguous occurrence-key and text associations after same-label deletion reindexes", () => {
    const occurrenceAssociation = { ...keyedAssociation, agentId: "agent-1" };
    const textAssociation = { ...association, agentId: "agent-2", createdAt: 2 };
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          [occurrenceAssociation.taskKey!]: occurrenceAssociation,
          [textAssociation.taskText]: textAssociation,
        },
      })
    );

    const next = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", [occurrenceAssociation.taskKey!, "Do work"])
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toBeUndefined();
  });

  it("keeps present stable agent-derived keys when pruning ambiguous same-label associations", () => {
    const first = { ...association, taskKey: "agent:agent-1", agentId: "agent-1" };
    const second = { ...association, taskKey: "agent:agent-2", agentId: "agent-2", createdAt: 2 };
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          [first.taskKey]: first,
          [second.taskKey]: second,
        },
      })
    );

    const next = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", [second.taskKey, "Do work"])
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toEqual({
      [second.taskKey]: second,
    });
  });

  it("removes the note bucket when pruning deletes all associations", () => {
    const state = taskAgentAssociationsReducer(
      initialState,
      hydrateTaskAgentAssociations("ws-1", { "note-1": { "Do work": association } })
    );

    const next = taskAgentAssociationsReducer(
      state,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", [])
    );

    expect(next.byWorkspaceId["ws-1"].byNoteId["note-1"]).toBeUndefined();
  });
});
