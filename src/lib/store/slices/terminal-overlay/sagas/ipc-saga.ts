import { call, put, take, select } from "typed-redux-saga";
import { eventChannel, type EventChannel } from "redux-saga";
import { removeTerminal } from "../terminal-overlay-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger('TerminalOverlaySaga');

interface TerminalDisposedEvent {
  terminalId: string;
  workspaceId: string;
}

function createTerminalDisposedChannel(): EventChannel<TerminalDisposedEvent> {
  return eventChannel<TerminalDisposedEvent>((emit) => {
    const handler = (data: TerminalDisposedEvent) => {
      if (data && data.terminalId) {
        emit(data);
      }
    };

    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.on('terminal:disposed', handler);
    }

    return () => {
      // Cleanup - electronAPI.on doesn't have a removeListener in this pattern
    };
  });
}

/**
 * Listen for terminal:disposed IPC events from Electron main process.
 * Only removes terminals for the current workspace.
 */
export function* watchTerminalDisposed() {
  if (typeof window === 'undefined' || !window.electronAPI) return;

  const channel: EventChannel<TerminalDisposedEvent> = yield* call(createTerminalDisposedChannel);

  try {
    while (true) {
      const event: TerminalDisposedEvent = yield* take(channel);

      // Only process events for the current workspace
      const currentWsId = yield* select((state) => state.terminalOverlay.workspaceId);
      if (event.workspaceId !== currentWsId) {
        logger.debug('[TerminalOverlaySaga] Ignoring terminal:disposed for different workspace', {
          eventWorkspaceId: event.workspaceId,
          currentWorkspaceId: currentWsId,
        });
        continue;
      }

      logger.info('[TerminalOverlaySaga] Received terminal:disposed event', {
        terminalId: event.terminalId,
        workspaceId: event.workspaceId,
      });

      yield* put(removeTerminal(event.terminalId));
    }
  } finally {
    channel.close();
  }
}

