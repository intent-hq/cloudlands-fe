import { put, take } from "typed-redux-saga";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { removeTerminal } from "../terminal-overlay-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger('TerminalOverlaySaga');

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
  if (typeof window === "undefined" || !window.electronAPI) return;

  const channel = createListenSyncChannel<TerminalDisposedEvent>('terminal:disposed');
  try {
    while (true) {
      const data: TerminalDisposedEvent = yield* take(channel);
      if (!data || !data.terminalId || !data.workspaceId) continue;
      logger.info('[TerminalOverlaySaga] Received terminal:disposed event', {
        terminalId: data.terminalId,
        workspaceId: data.workspaceId,
      });
      yield* put(removeTerminal(data.workspaceId, data.terminalId));
    }
  } finally {
    channel.close();
  }
}

