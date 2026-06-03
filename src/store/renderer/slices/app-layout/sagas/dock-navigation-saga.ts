import {
  openTerminalOverlay,
  createTerminalRequested,
  type WorkspaceTerminal,
} from "$store/renderer/slices/terminals/terminals-slice";
import { selectAgentIsResponding } from "$store/renderer/slices/agent-session/agent-session-selectors";
import { selectForegroundWorkspaceAgents } from "$store/renderer/slices/workspace-agents/workspace-agents-selectors";
import { selectLoadedWorkspaceTerminals } from "$store/renderer/slices/terminals/terminals-selectors";
import { selectActiveWorkspace } from "$store/renderer/slices/workspace/workspace-selectors";

import { selectWorkspaceNavigationDrawer } from "$store/renderer/slices/workspace-navigation/workspace-navigation-selectors";
import {
  openWorkspaceDrawer,
  type WorkspaceNavigationDrawerState,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import {
  isFocusInEditableElement,
  isFocusInTerminal,
} from "$lib/utils/keyboardShortcuts";
import { dispatchWindowEvent } from "$lib/utils/window-events";
import type { AgentSession } from "$shared/types";
import {
  eventChannel,
  type EventChannel,
} from "redux-saga";
import {
  call,
  put,
  take,
} from "typed-redux-saga";
type DockShortcutEvent = {
    type: "dock";
    direction: "next" | "previous";
} | {
    type: "navigate-message";
    direction: "next" | "previous";
} | {
    type: "create-terminal";
};
type DockItem = {
    id: string;
    type: "agent" | "terminal";
};
function isMacPlatform(): boolean {
    // @ts-expect-error Electron platform detection differs across runtimes
    return navigator.userAgentData?.platform === "macOS" || /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
function getCurrentDrawerAgentId(drawerState: WorkspaceNavigationDrawerState): string | null {
    const currentAgentId = drawerState.type === "agent" ? drawerState.itemId : null;
    return currentAgentId || null;
}
function getDockItems(agents: AgentSession[], terminals: WorkspaceTerminal[]): DockItem[] {
    return [
        ...agents.map((agent) => ({ id: agent.id, type: "agent" as const })),
        ...terminals.map((terminal) => ({ id: terminal.id, type: "terminal" as const })),
    ];
}
function getNextDockItem(drawerState: WorkspaceNavigationDrawerState, items: DockItem[], direction: "next" | "previous"): DockItem | null {
    if (items.length === 0)
        return null;
    const currentId = drawerState.itemId;
    const currentType = drawerState.type;
    const currentIndex = currentId && (currentType === "agent" || currentType === "terminal")
        ? items.findIndex((item) => item.id === currentId && item.type === currentType)
        : -1;
    if (currentIndex === -1) {
        return direction === "next" ? items[0] : items[items.length - 1];
    }
    const nextIndex = direction === "next"
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
    return items[nextIndex] ?? null;
}
function dispatchNavigateMessageEvent(direction: "next" | "previous"): void {
    dispatchWindowEvent("navigate-message", { direction });
}
export function createDockNavigationChannel(): EventChannel<DockShortcutEvent> {
    return eventChannel((emit) => {
        const isMac = isMacPlatform();
        const handleKeydown = (event: KeyboardEvent) => {
            const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
            const target = event.target as HTMLElement | null;
            if (event.altKey && !cmdOrCtrl && !event.shiftKey) {
                if (isFocusInEditableElement(target))
                    return;
                if (isFocusInTerminal(target))
                    return;
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    emit({
                        type: "dock",
                        direction: event.key === "ArrowUp" ? "previous" : "next",
                    });
                    return;
                }
            }
            if (event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                (event.key === "~" || (event.shiftKey && event.key === "`"))) {
                event.preventDefault();
                event.stopPropagation();
                emit({ type: "create-terminal" });
                return;
            }
            if (!cmdOrCtrl)
                return;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                return;
            if (isFocusInEditableElement(target))
                return;
            event.preventDefault();
            emit({
                type: "navigate-message",
                direction: event.key === "ArrowUp" ? "previous" : "next",
            });
        };
        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    });
}
export function* watchDockNavigationForWorkspaceSaga() {
    if (typeof window === "undefined")
        return;
    const channel = createDockNavigationChannel();
    try {
        while (true) {
            const shortcut: DockShortcutEvent = yield* take(channel);
            if (shortcut.type === "navigate-message") {
                yield* call(dispatchNavigateMessageEvent, shortcut.direction);
                continue;
            }
            const currentWorkspace = yield* selectActiveWorkspace.effect();
            const wsId = currentWorkspace?.id;
            if (!wsId) {
                continue;
            }
            if (shortcut.type === "create-terminal") {
                yield* put(createTerminalRequested(wsId));
                continue;
            }
            const agents: AgentSession[] = yield* selectForegroundWorkspaceAgents.effect(wsId);
            const terminals: WorkspaceTerminal[] = yield* selectLoadedWorkspaceTerminals.effect(wsId);
            const drawerState: WorkspaceNavigationDrawerState = yield* selectWorkspaceNavigationDrawer.effect(wsId);
            const currentAgentId = getCurrentDrawerAgentId(drawerState);
            if (currentAgentId && (yield* selectAgentIsResponding.effect(currentAgentId))) {
                continue;
            }
            const nextItem = getNextDockItem(drawerState, getDockItems(agents, terminals), shortcut.direction);
            if (!nextItem)
                continue;
            if (nextItem.type === "agent") {
                yield* put(openWorkspaceDrawer(wsId, "agent", nextItem.id));
                continue;
            }
            yield* put(openTerminalOverlay(wsId, nextItem.id));
        }
    }
    finally {
        channel.close();
    }
}
