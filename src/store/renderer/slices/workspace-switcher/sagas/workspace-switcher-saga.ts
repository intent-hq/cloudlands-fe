import { goto } from "$app/navigation";
import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import {
  END,
  eventChannel,
  type EventChannel,
} from "redux-saga";
import {
  call,
  fork,
  put,
  take,
  type SagaGenerator,
} from "typed-redux-saga";
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

export function buildSwitcherWorkspaceIds(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): string[] {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspaceId);

  if (otherWorkspaces.length === 0) {
    return [];
  }

  const orderedWorkspaces = activeWorkspace
    ? [activeWorkspace, ...otherWorkspaces]
    : otherWorkspaces;

  return orderedWorkspaces.map((workspace) => workspace.id);
}

export function* openWorkspaceSwitcher(): SagaGenerator<void> {
  const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();
  const workspaces = yield* selectWorkspaceItems.effect();
  const activeWorkspaces = workspaces.filter(
    (workspace) => workspace.status !== WorkspaceStatusEnum.Archived,
  );
  const workspacesSortedByRecency = yield* selectWorkspacesSortedByRecency.effect(activeWorkspaces);
  const workspaceIds = buildSwitcherWorkspaceIds(workspacesSortedByRecency, activeWorkspaceId);

  if (workspaceIds.length === 0) {
    return;
  }

  yield* put(openSwitcher(workspaceIds, activeWorkspaceId));
}

export function* confirmWorkspaceSwitcherSelection(): SagaGenerator<void> {
  const workspaceIds = yield* selectSwitcherWorkspaceIds.effect();
  if (workspaceIds.length === 0) {
    return;
  }

  const selectedWorkspaceId = yield* selectSelectedWorkspaceId.effect();
  const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();
  yield* put(confirmSelection());

  if (selectedWorkspaceId && selectedWorkspaceId !== activeWorkspaceId) {
    yield* put(openWorkspaceRequested(selectedWorkspaceId));
    yield* call(goto, `/workspace/${selectedWorkspaceId}`);
  }
}

export function* handleSwitcherKeydown(event: KeyboardEvent): SagaGenerator<void> {
  const switcher = yield* selectSwitcherState.effect();
  const workspaceIds = yield* selectSwitcherWorkspaceIds.effect();
  const workspaceCount = workspaceIds.length;

  if (event.ctrlKey && event.key === "Tab") {
    yield* call([event, "preventDefault"]);
    yield* call([event, "stopPropagation"]);

    if (workspaceCount === 0) {
      yield* call(openWorkspaceSwitcher);
    } else if (event.shiftKey) {
      yield* put(cyclePrevious(workspaceCount));
    } else {
      yield* put(cycleNext(workspaceCount));
    }
    return;
  }

  if (workspaceCount === 0) {
    return;
  }

  switch (event.key) {
    case "Escape": {
      yield* call([event, "preventDefault"]);
      yield* put(closeSwitcher());
      return;
    }
    case "ArrowDown":
    case "j": {
      yield* call([event, "preventDefault"]);
      yield* put(cycleNext(workspaceCount));
      return;
    }
    case "ArrowUp":
    case "k": {
      yield* call([event, "preventDefault"]);
      yield* put(cyclePrevious(workspaceCount));
      return;
    }
    case "Enter": {
      yield* call([event, "preventDefault"]);
      yield* call(confirmWorkspaceSwitcherSelection);
      return;
    }
    case "Home": {
      const stepsToStart = Math.max(0, switcher.selectedIndex);
      if (stepsToStart === 0) {
        return;
      }

      yield* call([event, "preventDefault"]);
      for (let step = 0; step < stepsToStart; step += 1) {
        yield* put(cyclePrevious(workspaceCount));
      }
      return;
    }
    case "End": {
      const stepsToEnd = Math.max(0, workspaceCount - 1 - switcher.selectedIndex);
      if (stepsToEnd === 0) {
        return;
      }

      yield* call([event, "preventDefault"]);
      for (let step = 0; step < stepsToEnd; step += 1) {
        yield* put(cycleNext(workspaceCount));
      }
      return;
    }
  }
}

export function* handleSwitcherKeyup(event: KeyboardEvent): SagaGenerator<void> {
  if (event.key !== "Meta" && event.key !== "Control") {
    return;
  }

  const workspaceIds = yield* selectSwitcherWorkspaceIds.effect();
  if (workspaceIds.length === 0) {
    return;
  }

  yield* call([event, "preventDefault"]);
  yield* call(confirmWorkspaceSwitcherSelection);
}

export type KeyboardWindowEventName = "keydown" | "keyup";

export function createKeyboardEventChannel(
  eventName: KeyboardWindowEventName,
): EventChannel<KeyboardEvent> {
  return eventChannel<KeyboardEvent>((emitter) => {
    if (typeof window === "undefined") {
      emitter(END as any);
      return () => {};
    }

    const handler = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        emitter(event);
      }
    };

    window.addEventListener(eventName, handler);

    return () => {
      window.removeEventListener(eventName, handler);
    };
  });
}

export function* watchWorkspaceSwitcherKeydownSaga() {
  const channel = createKeyboardEventChannel("keydown");

  try {
    while (true) {
      const event: KeyboardEvent = yield* take(channel);
      yield* call(handleSwitcherKeydown, event);
    }
  } finally {
    channel.close();
  }
}

export function* watchWorkspaceSwitcherKeyupSaga() {
  const channel = createKeyboardEventChannel("keyup");

  try {
    while (true) {
      const event: KeyboardEvent = yield* take(channel);
      yield* call(handleSwitcherKeyup, event);
    }
  } finally {
    channel.close();
  }
}

export function* workspaceSwitcherSaga() {
  yield* fork(watchWorkspaceSwitcherKeydownSaga);
  yield* fork(watchWorkspaceSwitcherKeyupSaga);
}