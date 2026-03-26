import { agentService } from "$features/agent/agent.service";
import { getUnifiedWorkspaceState, type UnifiedWorkspaceStateManager, } from "$features/workspace/workspace-unified-state.svelte";
import { openTerminalOverlay } from "$lib/store/slices/terminals/terminals-slice";
import { selectForegroundWorkspaceAgents } from "$lib/store/slices/workspace-agents/workspace-agents-selectors";
import { selectLoadedWorkspaceTerminals } from "$lib/store/slices/terminals/terminals-selectors";
import { createTerminalRequested, type WorkspaceTerminal, } from "$lib/store/slices/terminals/terminals-slice";
import { isFocusInEditableElement, isFocusInTerminal } from "$lib/utils/keyboardShortcuts";
import type { AgentSession } from "$shared/types";
import { eventChannel, type EventChannel } from "redux-saga";
import { call, put, take } from "typed-redux-saga";
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
function isCurrentAgentStreaming(manager: UnifiedWorkspaceStateManager): boolean {
    const currentAgentId = manager.state.drawer.type === "agent" ? manager.state.drawer.itemId : null;
    if (!currentAgentId)
        return false;
    return agentService.isStreaming(currentAgentId);
}
function getDockItems(agents: AgentSession[], terminals: WorkspaceTerminal[]): DockItem[] {
    return [
        ...agents.map((agent) => ({ id: agent.id, type: "agent" as const })),
        ...terminals.map((terminal) => ({ id: terminal.id, type: "terminal" as const })),
    ];
}
function getNextDockItem(manager: UnifiedWorkspaceStateManager, items: DockItem[], direction: "next" | "previous"): DockItem | null {
    if (items.length === 0)
        return null;
    const currentId = manager.state.drawer.itemId;
    const currentType = manager.state.drawer.type;
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
    window.dispatchEvent(new CustomEvent("navigate-message", { detail: { direction } }));
}
export function createDockNavigationChannel(manager: UnifiedWorkspaceStateManager): EventChannel<DockShortcutEvent> {
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
                if (isCurrentAgentStreaming(manager)) {
                    return;
                }
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
export function* watchDockNavigationForWorkspaceSaga(wsId: string) {
    if (typeof window === "undefined")
        return;
    const manager = getUnifiedWorkspaceState(wsId);
    if (!manager) {
        return;
    }
    const channel = createDockNavigationChannel(manager);
    try {
        while (true) {
            const shortcut: DockShortcutEvent = yield* take(channel);
            if (shortcut.type === "create-terminal") {
                yield* put(createTerminalRequested(wsId));
                continue;
            }
            if (shortcut.type === "navigate-message") {
                yield* call(dispatchNavigateMessageEvent, shortcut.direction);
                continue;
            }
            const agents: AgentSession[] = yield* selectForegroundWorkspaceAgents.effect(wsId);
            const terminals: WorkspaceTerminal[] = yield* selectLoadedWorkspaceTerminals.effect(wsId);
            const nextItem = getNextDockItem(manager, getDockItems(agents, terminals), shortcut.direction);
            if (!nextItem)
                continue;
            if (nextItem.type === "agent") {
                yield* call([manager, manager.openDrawer], "agent", nextItem.id);
                continue;
            }
            yield* put(openTerminalOverlay(wsId, nextItem.id));
        }
    }
    finally {
        channel.close();
    }
}
