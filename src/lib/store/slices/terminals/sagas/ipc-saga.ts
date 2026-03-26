import { put } from "typed-redux-saga";
import { takeEveryFromElectronChannel, takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import { addTerminal, removeTerminal } from "../terminals-slice";
interface TerminalCreatedPayload {
  terminalId: string;
  workspaceId: string;
  title?: string;
  createdAt?: string;
  background?: boolean;
}

type MaybeWrappedPayload<T> = T | { payload: T };

function unwrapPayload<T>(event: MaybeWrappedPayload<T>): T {
  if (event && typeof event === "object" && "payload" in event) {
    return event.payload;
  }
  return event;
}

interface TerminalDisposedEvent {
  terminalId: string;
  workspaceId: string;
}

/**
 * Watches for terminal:disposed IPC events using a saga channel.
 * This keeps the handler within the saga lifecycle for proper state access.
 *
 * With per-workspace state, we no longer need to filter by "current workspace" —
 * the workspaceId from the event tells us which workspace Record entry to update.
 */
export function* watchTerminalDisposed() {
  yield* takeEveryFromListenSync<TerminalDisposedEvent>('terminal:disposed', function* (data) {
    if (!data || !data.terminalId || !data.workspaceId) return;
    yield* put(removeTerminal(data.workspaceId, data.terminalId));
  });
}

/**
 * Watches for terminal:created IPC events for a specific workspace.
 * Previously lived in workspace-terminals-saga; now consolidated here.
 */
export function* watchTerminalCreated(wsId: string) {
  yield* takeEveryFromElectronChannel<MaybeWrappedPayload<TerminalCreatedPayload>>(
    "terminal:created",
    function* (event) {
      const data = unwrapPayload(event);

      if (
        typeof data.terminalId !== "string" ||
        typeof data.workspaceId !== "string" ||
        data.workspaceId !== wsId
      ) {
        return;
      }

      yield* put(addTerminal(wsId, data.terminalId, data.title ?? "Terminal"));
    },
  );
}
