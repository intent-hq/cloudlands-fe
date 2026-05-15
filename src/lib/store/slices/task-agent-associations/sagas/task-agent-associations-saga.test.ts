import {
  describe,
  it,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import {
  getLocalStorageJSON,
  getLocalStorageKeysWithPrefix,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeAgent } from "../../workspace-agents/workspace-agents-slice";
import {
  addTaskAgentAssociation,
  applyRemoveTaskAgentAssociationsForAgent,
  hydrateTaskAgentAssociations,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
  TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX,
} from "../task-agent-associations-slice";
import {
  selectTaskAgentAssociationsByNoteId,
  selectAssociationsForNote,
} from "../task-agent-associations-selectors";
import {
  dispatchAgentAssociationsRemovedEvent,
  dispatchTaskAssociationChangedEvent,
} from "../task-agent-associations-window-events";
import {
  hydrateWorkspaceTaskAgentAssociationsSaga,
  persistAssociationsForNote,
  persistTaskAgentAssociationChangeSaga,
  removeWorkspaceAgentAssociationsSaga,
} from "./task-agent-associations-saga";

describe("taskAgentAssociations persistence sagas", () => {
  it("hydrates valid associations and ignores malformed stored data", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };
    const prefix = `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:`;

    testSaga(hydrateWorkspaceTaskAgentAssociationsSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageKeysWithPrefix, prefix)
      .next([`${prefix}note-1`, `${prefix}note-2`])
      .call(getLocalStorageJSON, `${prefix}note-1`)
      .next([association, { taskText: "bad" }])
      .call(getLocalStorageJSON, `${prefix}note-2`)
      .next("malformed")
      .put(hydrateTaskAgentAssociations("ws-1", { "note-1": { "Do work": association } }))
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("hydrates duplicate task labels by task key", () => {
    const firstAssociation = {
      taskText: "Do work",
      taskKey: "0\u001fDo work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };
    const secondAssociation = {
      taskText: "Do work",
      taskKey: "1\u001fDo work",
      agentId: "agent-2",
      noteId: "note-1",
      createdAt: 2,
    };
    const prefix = `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:`;

    testSaga(hydrateWorkspaceTaskAgentAssociationsSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageKeysWithPrefix, prefix)
      .next([`${prefix}note-1`])
      .call(getLocalStorageJSON, `${prefix}note-1`)
      .next([firstAssociation, secondAssociation])
      .put(hydrateTaskAgentAssociations("ws-1", {
        "note-1": {
          [firstAssociation.taskKey]: firstAssociation,
          [secondAssociation.taskKey]: secondAssociation,
        },
      }))
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("falls back to empty hydration when association key enumeration throws", () => {
    const prefix = `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:`;

    testSaga(hydrateWorkspaceTaskAgentAssociationsSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageKeysWithPrefix, prefix)
      .throw(new Error("storage failure"))
      .put(hydrateTaskAgentAssociations("ws-1", {}))
      .next()
      .isDone();
  });

  it("continues association hydration when one stored note throws", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-2",
      createdAt: 1,
    };
    const prefix = `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:`;

    testSaga(hydrateWorkspaceTaskAgentAssociationsSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageKeysWithPrefix, prefix)
      .next([`${prefix}note-1`, `${prefix}note-2`])
      .call(getLocalStorageJSON, `${prefix}note-1`)
      .throw(new Error("storage failure"))
      .call(getLocalStorageJSON, `${prefix}note-2`)
      .next([association])
      .put(hydrateTaskAgentAssociations("ws-1", { "note-2": { "Do work": association } }))
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("persists task-agent association add changes and dispatches the change event", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };

    testSaga(
      persistTaskAgentAssociationChangeSaga,
      addTaskAgentAssociation("ws-1", "note-1", association)
    )
      .next()
      .call(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("persists task-agent association remove changes and dispatches the change event", () => {
    testSaga(
      persistTaskAgentAssociationChangeSaga,
      removeTaskAgentAssociation("ws-1", "note-1", "Do work")
    )
      .next()
      .call(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("persists pruned stale task mappings and dispatches the change event", () => {
    testSaga(
      persistTaskAgentAssociationChangeSaga,
      pruneTaskAgentAssociationsForNote("ws-1", "note-1", ["Other work"])
    )
      .next()
      .call(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("writes non-empty task-agent associations and swallows storage failure", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };

    testSaga(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .select(selectAssociationsForNote.select, "ws-1", "note-1")
      .next([association])
      .call(setLocalStorageJSON, `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:note-1`, [association])
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("removes empty task-agent association storage and swallows storage failure", () => {
    testSaga(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .select(selectAssociationsForNote.select, "ws-1", "note-1")
      .next([])
      .call(removeLocalStorageItem, `${TASK_AGENT_ASSOCIATIONS_STORAGE_PREFIX}ws-1:note-1`)
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("cleans up task-agent associations when an agent is removed", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };
    const remainingAssociation = {
      taskText: "Other work",
      agentId: "agent-2",
      noteId: "note-1",
      createdAt: 2,
    };

    testSaga(removeWorkspaceAgentAssociationsSaga, removeAgent("ws-1", "agent-1"))
      .next()
      .select(selectTaskAgentAssociationsByNoteId.select, "ws-1")
      .next({ "note-1": { "Do work": association, "Other work": remainingAssociation } })
      .put(applyRemoveTaskAgentAssociationsForAgent("ws-1", "agent-1"))
      .next()
      .call(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .call(dispatchAgentAssociationsRemovedEvent, {
        agentId: "agent-1",
        noteId: "note-1",
        workspaceId: "ws-1",
      })
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });

  it("removes persisted note storage when agent cleanup removes the last association", () => {
    const association = {
      taskText: "Do work",
      agentId: "agent-1",
      noteId: "note-1",
      createdAt: 1,
    };

    testSaga(removeWorkspaceAgentAssociationsSaga, removeAgent("ws-1", "agent-1"))
      .next()
      .select(selectTaskAgentAssociationsByNoteId.select, "ws-1")
      .next({ "note-1": { "Do work": association } })
      .put(applyRemoveTaskAgentAssociationsForAgent("ws-1", "agent-1"))
      .next()
      .call(persistAssociationsForNote, "ws-1", "note-1")
      .next()
      .call(dispatchAgentAssociationsRemovedEvent, {
        agentId: "agent-1",
        noteId: "note-1",
        workspaceId: "ws-1",
      })
      .next()
      .call(dispatchTaskAssociationChangedEvent)
      .next()
      .isDone();
  });
});
