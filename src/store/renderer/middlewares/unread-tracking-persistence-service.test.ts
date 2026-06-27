import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// REAL store: the unread-tracking persistence middleware is already registered
// in the configured store. `test-setup.ts` replaces `window.localStorage` with
// inert vi.fn() stubs, so back them with an in-memory Map here. Storage is seeded
// BEFORE `init()` so the factory-time boot hydration (which dispatches through
// `baseDispatch` before the chain is composed) reads it; per-action persistence
// and the `clearWorkspaceUnread` translation are exercised by dispatching the
// real actions afterward.
import type { AgentSession } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  clearAllUnread,
  clearWorkspaceUnread,
  newAssistantMessage,
} from "$store/renderer/slices/unread-tracking/unread-tracking-slice";
import { addAgent } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";

const STORAGE_KEY = "augment:unread-agents";

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null
  );
  vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
    mem.set(key, String(value));
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
}

const agent = (id: string, workspaceId: string): AgentSession =>
  ({ id, workspaceId }) as unknown as AgentSession;

describe("unreadTrackingPersistenceService (real store)", () => {
  beforeAll(() => {
    installMemoryLocalStorage();
    safeLocalStorage.setJSON(STORAGE_KEY, ["boot-agent-1", "boot-agent-2"]);
    appStore.init();
  });
  afterEach(() => appStore.dispatch(clearAllUnread()));

  it("hydrates unread agent ids from localStorage on boot", () => {
    expect(appStore.state.unreadTracking.unreadAgentIds).toEqual(
      expect.arrayContaining(["boot-agent-1", "boot-agent-2"])
    );
  });

  it("persists unread ids to localStorage when an agent becomes unread", () => {
    appStore.dispatch(newAssistantMessage("persist-agent", "ws-persist"));
    expect(safeLocalStorage.getJSON<string[]>(STORAGE_KEY)).toEqual(
      expect.arrayContaining(["persist-agent"])
    );
  });

  it("persists an empty array to localStorage on clearAllUnread", () => {
    appStore.dispatch(newAssistantMessage("temp-agent", "ws-temp"));
    appStore.dispatch(clearAllUnread());
    expect(safeLocalStorage.getJSON<string[]>(STORAGE_KEY)).toEqual([]);
  });

  it("clearWorkspaceUnread clears only that workspace's unread agents", () => {
    const ws = "ws-clear";
    appStore.dispatch(addAgent(ws, agent("ca-1", ws)));
    appStore.dispatch(addAgent(ws, agent("ca-2", ws)));
    appStore.dispatch(newAssistantMessage("ca-1", ws));
    appStore.dispatch(newAssistantMessage("ca-2", ws));
    appStore.dispatch(newAssistantMessage("other-agent", "ws-other"));

    appStore.dispatch(clearWorkspaceUnread(ws));

    const unread = appStore.state.unreadTracking.unreadAgentIds;
    expect(unread).not.toContain("ca-1");
    expect(unread).not.toContain("ca-2");
    expect(unread).toContain("other-agent");
  });

  it("clearWorkspaceUnread is a no-op for an unknown workspace", () => {
    appStore.dispatch(newAssistantMessage("keep-agent", "ws-keep"));
    appStore.dispatch(clearWorkspaceUnread("ws-does-not-exist"));
    expect(appStore.state.unreadTracking.unreadAgentIds).toContain("keep-agent");
  });
});
