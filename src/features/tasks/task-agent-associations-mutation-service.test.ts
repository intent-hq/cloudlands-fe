import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TaskAgentAssociation } from "$store/renderer/slices/task-agent-associations/task-agent-associations-types";

// FAKE seam: `appClient.tasks.linkAgent` and `unlinkAgent` are stubbed. The
// mutation middleware runs against the REAL configured store so we exercise
// the reducer → middleware → wire-call chain end to end.
const { linkAgent, unlinkAgent } = vi.hoisted(() => ({
  linkAgent: vi.fn(() => Promise.resolve(null)),
  unlinkAgent: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("$lib/client", () => ({
  appClient: { tasks: { linkAgent, unlinkAgent } },
}));

import { store as appStore } from "$store/renderer/store";
import {
  addTaskAgentAssociation,
  applyTaskAgentLinked,
  applyTaskAgentUnlinked,
  hydrateTaskAgentAssociations,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
} from "$store/renderer/slices/task-agent-associations/task-agent-associations-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const association = (
  taskText: string,
  agentId: string,
  taskKey?: string,
): TaskAgentAssociation => ({
  noteId: "note-1",
  taskText,
  agentId,
  createdAt: 1700000000000,
  ...(taskKey ? { taskKey } : {}),
});

describe("taskAgentAssociationsMutationService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("addTaskAgentAssociation forwards to task.linkAgent", async () => {
    const ws = "ws-link-add";
    appStore.dispatch(addTaskAgentAssociation(ws, "note-1", association("do it", "a1", "agent:a1")));
    await flush();

    expect(linkAgent).toHaveBeenCalledWith(ws, "note-1", association("do it", "a1", "agent:a1"));
  });

  it("removeTaskAgentAssociation forwards the dropped taskKey to task.unlinkAgent", async () => {
    const ws = "ws-link-remove";
    appStore.dispatch(
      hydrateTaskAgentAssociations(ws, {
        "note-1": { "agent:a1": association("do it", "a1", "agent:a1") },
      }),
    );
    unlinkAgent.mockClear();
    linkAgent.mockClear();

    appStore.dispatch(removeTaskAgentAssociation(ws, "note-1", "do it"));
    await flush();

    expect(unlinkAgent).toHaveBeenCalledWith(ws, "note-1", "agent:a1");
    expect(linkAgent).not.toHaveBeenCalled();
  });

  it("pruneTaskAgentAssociationsForNote diffs pre/post state and unlinks each dropped row", async () => {
    const ws = "ws-link-prune";
    appStore.dispatch(
      hydrateTaskAgentAssociations(ws, {
        "note-1": {
          "agent:a1": association("do it", "a1", "agent:a1"),
          "agent:a2": association("gone", "a2", "agent:a2"),
        },
      }),
    );
    unlinkAgent.mockClear();

    // Only the `agent:a1` task survives in the editor (taskKey + taskText).
    // `agent:a2` (taskText "gone") is dropped. The action signature is
    // `string[]`; keep the test payload consistent with the wire contract
    // and production call sites.
    appStore.dispatch(
      pruneTaskAgentAssociationsForNote(ws, "note-1", ["agent:a1", "do it"]),
    );
    await flush();

    expect(unlinkAgent).toHaveBeenCalledTimes(1);
    expect(unlinkAgent).toHaveBeenCalledWith(ws, "note-1", "agent:a2");
  });

  it("does NOT echo daemon-authoritative applyTaskAgentLinked back to task.linkAgent", async () => {
    const ws = "ws-link-echo-add";
    appStore.dispatch(applyTaskAgentLinked(ws, "note-1", association("do it", "a1", "agent:a1")));
    await flush();

    expect(linkAgent).not.toHaveBeenCalled();
  });

  it("does NOT echo daemon-authoritative applyTaskAgentUnlinked back to task.unlinkAgent", async () => {
    const ws = "ws-link-echo-remove";
    appStore.dispatch(
      hydrateTaskAgentAssociations(ws, {
        "note-1": { "agent:a1": association("do it", "a1", "agent:a1") },
      }),
    );
    unlinkAgent.mockClear();

    appStore.dispatch(applyTaskAgentUnlinked(ws, "note-1", "agent:a1"));
    await flush();

    expect(unlinkAgent).not.toHaveBeenCalled();
  });
});
