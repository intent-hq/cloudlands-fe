import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  getContext: function* (key: string) {
    return yield sagaEffects.getContext(key);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
}));

vi.mock("ag-redux-toolkit/utils/sagas/selector-channel-effects",
  () => ({
  takeLatestFromSelector: function* () {
    // No-op for these tests — return a fake task object.
    return { id: "fake-task" };
  },
  }));

const { eventChannelMock,
  appStoreFactoryMock,
  isFocusInEditableElementMock,
  isFocusInTerminalMock,
  isRespondingMock } =
  vi.hoisted(() => ({
    eventChannelMock: vi.fn(),
  appStoreFactoryMock: vi.fn(),
  isFocusInEditableElementMock: vi.fn(),
  isFocusInTerminalMock: vi.fn(),
  isRespondingMock: vi.fn(),
  }));

vi.mock("redux-saga",
  async () => {
  const actual = await vi.importActual<typeof import("redux-saga")>("redux-saga");
  return { ...actual,
  eventChannel: eventChannelMock };
});

vi.mock("$store/renderer/store", async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => appStoreFactoryMock()?.getState?.() ?? {},
    dispatch: (...args: any[]) => appStoreFactoryMock()?.dispatch?.(...args),
  });
});


vi.mock("$lib/utils/keyboardShortcuts",
  () => ({
  isFocusInEditableElement: isFocusInEditableElementMock,
  isFocusInTerminal: isFocusInTerminalMock,
  }));

vi.mock("$store/renderer/slices/agent-session/agent-session-selectors",
  () => ({
  selectAgentIsResponding: {
    select: isRespondingMock,
    effect: function* (...args: any[]) {
      return yield sagaEffects.select(isRespondingMock, ...args);
    },
  },
  }));

vi.mock("$store/renderer/slices/workspace-agents/workspace-agents-selectors", async () => {
  const actual = await vi.importActual<typeof import("$store/renderer/slices/workspace-agents/workspace-agents-selectors")>("$store/renderer/slices/workspace-agents/workspace-agents-selectors");
  return {
    ...actual,
    selectForegroundWorkspaceAgents: {
      ...actual.selectForegroundWorkspaceAgents,
      effect: function* (...args: any[]) {
        return yield sagaEffects.select(actual.selectForegroundWorkspaceAgents.select, ...args);
      },
    },
  };
});

vi.mock("$store/renderer/slices/terminals/terminals-selectors", async () => {
  const actual = await vi.importActual<typeof import("$store/renderer/slices/terminals/terminals-selectors")>("$store/renderer/slices/terminals/terminals-selectors");
  return {
    ...actual,
    selectLoadedWorkspaceTerminals: {
      ...actual.selectLoadedWorkspaceTerminals,
      effect: function* (...args: any[]) {
        return yield sagaEffects.select(actual.selectLoadedWorkspaceTerminals.select, ...args);
      },
    },
  };
});

vi.mock("$store/renderer/slices/workspace-navigation/workspace-navigation-selectors", async () => {
  const actual = await vi.importActual<typeof import("$store/renderer/slices/workspace-navigation/workspace-navigation-selectors")>("$store/renderer/slices/workspace-navigation/workspace-navigation-selectors");
  return {
    ...actual,
    selectWorkspaceNavigationDrawer: {
      ...actual.selectWorkspaceNavigationDrawer,
      effect: function* (...args: any[]) {
        return yield sagaEffects.select(actual.selectWorkspaceNavigationDrawer.select, ...args);
      },
    },
  };
});

vi.mock("$store/renderer/slices/workspace/workspace-selectors", async () => {
  const actual = await vi.importActual<typeof import("$store/renderer/slices/workspace/workspace-selectors")>("$store/renderer/slices/workspace/workspace-selectors");
  return {
    ...actual,
    selectActiveWorkspace: {
      ...actual.selectActiveWorkspace,
      effect: function* (...args: any[]) {
        return yield sagaEffects.select(actual.selectActiveWorkspace.select, ...args);
      },
    },
  };
});

import {
  openTerminalOverlay,
  createTerminalRequested,
} from "$store/renderer/slices/terminals/terminals-slice";
import { selectForegroundWorkspaceAgents } from "$store/renderer/slices/workspace-agents/workspace-agents-selectors";
import { selectLoadedWorkspaceTerminals } from "$store/renderer/slices/terminals/terminals-selectors";
import { selectActiveWorkspace } from "$store/renderer/slices/workspace/workspace-selectors";

import { selectWorkspaceNavigationDrawer } from "$store/renderer/slices/workspace-navigation/workspace-navigation-selectors";
import { openWorkspaceDrawer } from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import {
  createDockNavigationChannel,
  watchDockNavigationForWorkspaceSaga,
} from "./dock-navigation-saga";

describe("dockNavigationSaga", () => {
  function createMockChannel() {
    return {
      take: vi.fn(),
      close: vi.fn(),
    } as any;
  }

  const windowStub = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  let currentState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", windowStub as unknown as Window & typeof globalThis);
    vi.stubGlobal("navigator", { userAgent: "Macintosh", userAgentData: { platform: "macOS" } });
    currentState = {
      workspace: {
        activeWorkspaceId: "ws-1",
        workspaces: {
          ids: ["ws-1"],
          map: { "ws-1": { id: "ws-1" } },
        },
      },
      workspaceNavigation: {
        byWorkspaceId: {
          "ws-1": {
            drawer: { open: false, type: null, itemId: null },
          },
        },
      },
    };
    appStoreFactoryMock.mockReturnValue({ getState: () => currentState });
    isFocusInEditableElementMock.mockReturnValue(false);
    isFocusInTerminalMock.mockReturnValue(false);
    isRespondingMock.mockReturnValue(false);
  });

  it("emits dock navigation shortcuts from the keydown channel", () => {
    currentState.workspaceNavigation.byWorkspaceId["ws-1"].drawer = {
      open: true,
      type: "agent",
      itemId: "agent-1",
    };
    const emit = vi.fn();
    let unsubscribe: (() => void) | undefined;

    eventChannelMock.mockImplementation((subscriber) => {
      unsubscribe = subscriber(emit);
      return { close: vi.fn(() => unsubscribe?.()) };
    });

    const channel = createDockNavigationChannel();
    const keydown = windowStub.addEventListener.mock.calls[0][1];
    const event = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      key: "ArrowDown",
      target: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any;

    keydown(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({ type: "dock", direction: "next" });

    channel.close();
    expect(windowStub.removeEventListener).toHaveBeenCalledWith("keydown", keydown, { capture: true });
  });

  it("skips dock navigation when focus is in a terminal", () => {
    const emit = vi.fn();

    eventChannelMock.mockImplementation((subscriber) => {
      subscriber(emit);
      return { close: vi.fn() };
    });
    isFocusInTerminalMock.mockReturnValue(true);

    createDockNavigationChannel();
    const keydown = windowStub.addEventListener.mock.calls[0][1];
    keydown({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      key: "ArrowUp",
      target: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any);

    expect(emit).not.toHaveBeenCalled();
  });

  it("blocks dock navigation when the current agent is streaming", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga();

    iterator.next();
    iterator.next({ type: "dock", direction: "previous" });
    expect(iterator.next({ id: "ws-1" })).toEqual({
      value: sagaEffects.select(selectWorkspaceNavigationDrawer.select, "ws-1"),
      done: false,
    });
    expect(iterator.next({ open: true, type: "agent", itemId: "agent-1" })).toEqual({
      value: sagaEffects.select(isRespondingMock, "agent-1"),
      done: false,
    });
    expect(iterator.next(true)).toEqual({ value: sagaEffects.take(channel), done: false });
  });

  it("opens the next agent drawer item", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.take(channel),
      done: false,
    });
    expect(iterator.next({ type: "dock", direction: "next" })).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    expect(iterator.next({ id: "ws-1" })).toEqual({
      value: sagaEffects.select(selectWorkspaceNavigationDrawer.select, "ws-1"),
      done: false,
    });
    expect(iterator.next({ open: false, type: null, itemId: null })).toEqual({
      value: sagaEffects.select(selectForegroundWorkspaceAgents.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([{ id: "agent-1", isBackground: false, metadata: {} }])).toEqual({
      value: sagaEffects.select(selectLoadedWorkspaceTerminals.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([])).toEqual({
      value: sagaEffects.put(openWorkspaceDrawer("ws-1", "agent", "agent-1")),
      done: false,
    });
  });

  it("opens the next terminal overlay item", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga();

    iterator.next(); // → take(channel)
    iterator.next({ type: "dock", direction: "next" });
    expect(iterator.next({ id: "ws-1" })).toEqual({
      value: sagaEffects.select(selectWorkspaceNavigationDrawer.select, "ws-1"),
      done: false,
    });
    expect(iterator.next({ open: true, type: "agent", itemId: "agent-1" })).toEqual({
      value: sagaEffects.select(isRespondingMock, "agent-1"),
      done: false,
    });
    expect(iterator.next(false)).toEqual({
      value: sagaEffects.select(selectForegroundWorkspaceAgents.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([{ id: "agent-1", isBackground: false, metadata: {} }])).toEqual({
      value: sagaEffects.select(selectLoadedWorkspaceTerminals.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([{ id: "terminal-1", type: "terminal" }])).toEqual({
      value: sagaEffects.put(openTerminalOverlay("ws-1", "terminal-1")),
      done: false,
    });
  });

  it("dispatches terminal creation and message navigation shortcuts", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.take(channel),
      done: false,
    });
    expect(iterator.next({ type: "create-terminal" })).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    expect(iterator.next({ id: "ws-1" })).toEqual({
      value: sagaEffects.put(createTerminalRequested("ws-1")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });

    const effect = iterator.next({ type: "navigate-message", direction: "previous" }).value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual(["previous"]);
  });

  it("skips workspace-scoped dock shortcuts when no workspace is active", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga();

    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });
    expect(iterator.next({ type: "dock", direction: "next" })).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    expect(iterator.next(undefined)).toEqual({ value: sagaEffects.take(channel), done: false });
  });
});