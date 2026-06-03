import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: gotoMock,
}));

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
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

import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import { openWorkspaceRequested } from "../../workspace/workspace-slice";
import {
  selectActiveWorkspaceId,
  selectWorkspacesSortedByRecency,
  selectWorkspaceItems,
} from "../../workspace/workspace-selectors";
import {
  closeSwitcher,
  confirmSelection,
  cycleNext,
  cyclePrevious,
  openSwitcher,
} from "../workspace-switcher-slice";
import {
  selectSelectedWorkspaceId,
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from "../workspace-switcher-selectors";
import {
  buildSwitcherWorkspaceIds,
  confirmWorkspaceSwitcherSelection,
  handleSwitcherKeydown,
  handleSwitcherKeyup,
  openWorkspaceSwitcher,
  watchWorkspaceSwitcherKeydownSaga,
  watchWorkspaceSwitcherKeyupSaga,
  workspaceSwitcherSaga,
} from "./workspace-switcher-saga";

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    id: overrides.id as WorkspaceId,
    title: "Test Workspace",
    path: `/tmp/${overrides.id}`,
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: WorkspaceStatusEnum.Active,
    ...overrides,
  };
}

function makeKeyboardEvent(
  overrides: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey">> = {},
): KeyboardEvent {
  return {
    key: "Tab",
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("workspaceSwitcherSaga", () => {
  it("forks switcher sub-sagas", () => {
    testSaga(workspaceSwitcherSaga)
      .next()
      .fork(watchWorkspaceSwitcherKeydownSaga)
      .next()
      .fork(watchWorkspaceSwitcherKeyupSaga)
      .next()
      .isDone();
  });
});

describe("workspace switcher sagas", () => {
  it("builds switcher ids with the current workspace first", () => {
    const workspaces = [
      makeWorkspace({ id: "ws-1" }),
      makeWorkspace({ id: "ws-2" }),
      makeWorkspace({ id: "ws-3" }),
    ];

    expect(buildSwitcherWorkspaceIds(workspaces, "ws-2")).toEqual(["ws-2", "ws-1", "ws-3"]);
    expect(buildSwitcherWorkspaceIds([makeWorkspace({ id: "ws-2" })], "ws-2")).toEqual([]);
  });

  it("opens the switcher from active, non-archived workspaces sorted by recency", () => {
    const activeWorkspaceId = "ws-2";
    const workspaceItems = [
      makeWorkspace({ id: "ws-1" }),
      makeWorkspace({ id: "ws-2" }),
      makeWorkspace({ id: "ws-3" }),
      makeWorkspace({ id: "ws-archived", status: WorkspaceStatusEnum.Archived }),
    ];
    const activeWorkspaceItems = workspaceItems.filter(
      (workspace) => workspace.status !== WorkspaceStatusEnum.Archived,
    );
    const sortedByRecency = [workspaceItems[2], workspaceItems[1], workspaceItems[0]];

    testSaga(openWorkspaceSwitcher)
      .next()
      .select(selectActiveWorkspaceId.select)
      .next(activeWorkspaceId)
      .select(selectWorkspaceItems.select)
      .next(workspaceItems)
      .select(selectWorkspacesSortedByRecency.select, activeWorkspaceItems)
      .next(sortedByRecency)
      .put(openSwitcher(["ws-2", "ws-3", "ws-1"], activeWorkspaceId))
      .next()
      .isDone();
  });

  it("confirms the switcher selection and opens a different workspace", () => {
    testSaga(confirmWorkspaceSwitcherSelection)
      .next()
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2"])
      .select(selectSelectedWorkspaceId.select)
      .next("ws-2")
      .select(selectActiveWorkspaceId.select)
      .next("ws-1")
      .put(confirmSelection())
      .next()
      .put(openWorkspaceRequested("ws-2"))
      .next()
      .call(gotoMock, "/workspace/ws-2")
      .next()
      .isDone();
  });

  it("does not reopen the current workspace when confirming the switcher selection", () => {
    testSaga(confirmWorkspaceSwitcherSelection)
      .next()
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2"])
      .select(selectSelectedWorkspaceId.select)
      .next("ws-1")
      .select(selectActiveWorkspaceId.select)
      .next("ws-1")
      .put(confirmSelection())
      .next()
      .isDone();
  });

  it("handles Ctrl+Tab by opening the switcher when it is closed", () => {
    const event = makeKeyboardEvent({ key: "Tab", ctrlKey: true });

    testSaga(handleSwitcherKeydown, event)
      .next()
      .select(selectSwitcherState.select)
      .next({
        selectedIndex: 0,
        selectionHandled: true,
      })
      .select(selectSwitcherWorkspaceIds.select)
      .next([])
      .call([event, "preventDefault"])
      .next()
      .call([event, "stopPropagation"])
      .next()
      .call(openWorkspaceSwitcher)
      .next()
      .isDone();
  });

  it("handles navigation keys while the switcher is open", () => {
    const event = makeKeyboardEvent({ key: "ArrowDown" });

    testSaga(handleSwitcherKeydown, event)
      .next()
      .select(selectSwitcherState.select)
      .next({
        selectedIndex: 1,
        selectionHandled: false,
      })
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2", "ws-3"])
      .call([event, "preventDefault"])
      .next()
      .put(cycleNext(3))
      .next()
      .isDone();
  });

  it("handles reverse navigation, home/end, and escape while the switcher is open", () => {
    const arrowUpEvent = makeKeyboardEvent({ key: "ArrowUp" });
    const homeEvent = makeKeyboardEvent({ key: "Home" });
    const endEvent = makeKeyboardEvent({ key: "End" });
    const escapeEvent = makeKeyboardEvent({ key: "Escape" });
    const sharedSwitcherState = {
      selectedIndex: 1,
      selectionHandled: false,
    };

    testSaga(handleSwitcherKeydown, arrowUpEvent)
      .next()
      .select(selectSwitcherState.select)
      .next(sharedSwitcherState)
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2", "ws-3"])
      .call([arrowUpEvent, "preventDefault"])
      .next()
      .put(cyclePrevious(3))
      .next()
      .isDone();

    testSaga(handleSwitcherKeydown, homeEvent)
      .next()
      .select(selectSwitcherState.select)
      .next(sharedSwitcherState)
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2", "ws-3"])
      .call([homeEvent, "preventDefault"])
      .next()
      .put(cyclePrevious(3))
      .next()
      .isDone();

    testSaga(handleSwitcherKeydown, endEvent)
      .next()
      .select(selectSwitcherState.select)
      .next(sharedSwitcherState)
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2", "ws-3"])
      .call([endEvent, "preventDefault"])
      .next()
      .put(cycleNext(3))
      .next()
      .isDone();

    testSaga(handleSwitcherKeydown, escapeEvent)
      .next()
      .select(selectSwitcherState.select)
      .next(sharedSwitcherState)
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2", "ws-3"])
      .call([escapeEvent, "preventDefault"])
      .next()
      .put(closeSwitcher())
      .next()
      .isDone();
  });

  it("confirms the current selection when the modifier key is released", () => {
    const event = makeKeyboardEvent({ key: "Control" });

    testSaga(handleSwitcherKeyup, event)
      .next()
      .select(selectSwitcherWorkspaceIds.select)
      .next(["ws-1", "ws-2"])
      .call([event, "preventDefault"])
      .next()
      .call(confirmWorkspaceSwitcherSelection)
      .next()
      .isDone();
  });
});