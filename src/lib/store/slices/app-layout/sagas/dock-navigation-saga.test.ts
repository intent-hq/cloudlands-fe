import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
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

const { eventChannelMock, getUnifiedWorkspaceStateMock, isFocusInEditableElementMock, isFocusInTerminalMock, isStreamingMock } =
  vi.hoisted(() => ({
    eventChannelMock: vi.fn(),
    getUnifiedWorkspaceStateMock: vi.fn(),
    isFocusInEditableElementMock: vi.fn(),
    isFocusInTerminalMock: vi.fn(),
    isStreamingMock: vi.fn(),
  }));

vi.mock("redux-saga", async () => {
  const actual = await vi.importActual<typeof import("redux-saga")>("redux-saga");
  return { ...actual, eventChannel: eventChannelMock };
});

vi.mock("$features/workspace/workspace-unified-state.svelte", () => ({
  getUnifiedWorkspaceState: getUnifiedWorkspaceStateMock,
}));

vi.mock("$lib/utils/keyboardShortcuts", () => ({
  isFocusInEditableElement: isFocusInEditableElementMock,
  isFocusInTerminal: isFocusInTerminalMock,
}));

vi.mock("$features/agent/agent.service", () => ({
  agentService: { isStreaming: isStreamingMock },
}));

import { openTerminalOverlay } from "$lib/store/slices/terminals/terminals-slice";
import { selectForegroundWorkspaceAgents } from "$lib/store/slices/workspace-agents/workspace-agents-selectors";
import { selectLoadedWorkspaceTerminals } from "$lib/store/slices/terminals/terminals-selectors";
import { createTerminalRequested } from "$lib/store/slices/terminals/terminals-slice";
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", windowStub as unknown as Window & typeof globalThis);
    vi.stubGlobal("navigator", { userAgent: "Macintosh", userAgentData: { platform: "macOS" } });
    isFocusInEditableElementMock.mockReturnValue(false);
    isFocusInTerminalMock.mockReturnValue(false);
    isStreamingMock.mockReturnValue(false);
  });

  it("emits dock navigation shortcuts from the keydown channel", () => {
    const manager = { state: { drawer: { type: "agent", itemId: "agent-1" } } } as any;
    const emit = vi.fn();
    let unsubscribe: (() => void) | undefined;

    eventChannelMock.mockImplementation((subscriber) => {
      unsubscribe = subscriber(emit);
      return { close: vi.fn(() => unsubscribe?.()) };
    });

    const channel = createDockNavigationChannel(manager);
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
    const manager = { state: { drawer: { type: "agent", itemId: "agent-1" } } } as any;
    const emit = vi.fn();

    eventChannelMock.mockImplementation((subscriber) => {
      subscriber(emit);
      return { close: vi.fn() };
    });
    isFocusInTerminalMock.mockReturnValue(true);

    createDockNavigationChannel(manager);
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
    const manager = { state: { drawer: { type: "agent", itemId: "agent-1" } } } as any;
    const emit = vi.fn();

    eventChannelMock.mockImplementation((subscriber) => {
      subscriber(emit);
      return { close: vi.fn() };
    });
    isStreamingMock.mockReturnValue(true);

    createDockNavigationChannel(manager);
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

  it("opens the next agent drawer item", () => {
    const manager = {
      state: { drawer: { open: false, type: null, itemId: null } },
      openDrawer: vi.fn(),
    } as any;
    const channel = createMockChannel();
    getUnifiedWorkspaceStateMock.mockReturnValue(manager);
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga("ws-1");

    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });
    expect(iterator.next({ type: "dock", direction: "next" })).toEqual({
      value: sagaEffects.select(selectForegroundWorkspaceAgents.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([{ id: "agent-1", isBackground: false, metadata: {} }])).toEqual({
      value: sagaEffects.select(selectLoadedWorkspaceTerminals.select, "ws-1"),
      done: false,
    });
    expect(iterator.next([])).toEqual({
      value: sagaEffects.call([manager, manager.openDrawer], "agent", "agent-1"),
      done: false,
    });
  });

  it("opens the next terminal overlay item", () => {
    const manager = {
      state: { drawer: { open: true, type: "agent", itemId: "agent-1" } },
      openDrawer: vi.fn(),
    } as any;
    const channel = createMockChannel();
    getUnifiedWorkspaceStateMock.mockReturnValue(manager);
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga("ws-1");

    iterator.next();
    iterator.next({ type: "dock", direction: "next" });
    iterator.next([{ id: "agent-1", isBackground: false, metadata: {} }]);
    expect(iterator.next([{ id: "terminal-1", type: "terminal" }])).toEqual({
      value: sagaEffects.put(openTerminalOverlay("ws-1", "terminal-1")),
      done: false,
    });
  });

  it("dispatches terminal creation and message navigation shortcuts", () => {
    const manager = { state: { drawer: { open: false, type: null, itemId: null } } } as any;
    const channel = createMockChannel();
    getUnifiedWorkspaceStateMock.mockReturnValue(manager);
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDockNavigationForWorkspaceSaga("ws-1");

    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });
    expect(iterator.next({ type: "create-terminal" })).toEqual({
      value: sagaEffects.put(createTerminalRequested("ws-1")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });

    const effect = iterator.next({ type: "navigate-message", direction: "previous" }).value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual(["previous"]);
  });
});