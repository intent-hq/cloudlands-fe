/**
 * Workspace presence aggregator (multiplayer w5, PROTOCOL §5.46).
 *
 * `presence.update` replaces the CONNECTION's whole focus set + typing target
 * and the daemon connection is pooled per backend in main, so each window
 * reports its own contribution over `presence:report` and this module merges
 * every window of a backend into ONE update: focus is the union (deduplicated
 * by item identity), typing is the most recent non-null window target.
 *
 * Sends are serialized per backend with trailing coalescing — a report that
 * lands while an update is in flight marks the backend dirty and rides the
 * next send, so a burst of focus changes never fans out into parallel
 * requests. A `-32601` latches the backend as unsupported (older daemon)
 * until it reconnects; other failures are logged and the next report retries.
 */
import { Logger } from '$shared/logger';
import {
  PRESENCE_UNSUPPORTED_RPC_CODE,
  type PresenceFocusItem,
  type PresenceReportParams,
  type PresenceUpdateParams,
  type PresenceUpdateResult,
} from '$shared/types/presence';
import { JsonRpcError } from './json-rpc-errors';

const logger = new Logger('Presence');

/** `presence.update` on the backend's pooled connection. */
export type PresenceRequest = (
  backendId: string,
  params: PresenceUpdateParams,
) => Promise<PresenceUpdateResult>;

interface WindowReport {
  focus: PresenceFocusItem[];
  typing: { agentId: string } | null;
  /** Monotonic order of the window's last non-null typing report. */
  typingSeq: number;
}

interface BackendState {
  windows: Map<number, WindowReport>;
  inFlight: Promise<void> | null;
  dirty: boolean;
  typingSource: string | null;
  unsupported: boolean;
}

function focusKey(item: PresenceFocusItem): string {
  return `${item.workspaceId}\u0000${item.agentId ?? ''}\u0000${item.noteId ?? ''}`;
}

export class PresenceAggregator {
  private readonly backends = new Map<string, BackendState>();
  private typingSeq = 0;

  constructor(private readonly request: PresenceRequest) {}

  /** Record one window's report and flush the merged state for its backend. */
  async report(
    backendId: string,
    windowId: number,
    params: PresenceReportParams,
  ): Promise<string | null> {
    const backend = this.backendState(backendId);
    const previous = backend.windows.get(windowId);
    const typing = params.typing ?? null;
    backend.windows.set(windowId, {
      focus: params.focus,
      typing,
      typingSeq: typing ? ++this.typingSeq : (previous?.typingSeq ?? 0),
    });
    await this.flush(backendId);
    return backend.unsupported ? null : backend.typingSource;
  }

  /**
   * A window went away: its contribution leaves the merged state (the last
   * window of a backend clears the connection's presence with an empty set).
   */
  dropWindow(windowId: number): void {
    for (const [backendId, backend] of this.backends) {
      if (backend.windows.delete(windowId)) void this.flush(backendId);
    }
  }

  /**
   * The backend's pooled connection (re)connected: the daemon forgot the
   * connection's presence, so re-send the merged state and re-probe support.
   */
  reconnected(backendId: string): void {
    const backend = this.backends.get(backendId);
    if (!backend) return;
    backend.unsupported = false;
    backend.typingSource = null;
    void this.flush(backendId);
  }

  /** The merged `presence.update` params for a backend (exposed for tests). */
  merged(backendId: string): PresenceUpdateParams {
    const backend = this.backends.get(backendId);
    const focus = new Map<string, PresenceFocusItem>();
    let typing: { agentId: string } | null = null;
    let typingSeq = -1;
    for (const window of backend?.windows.values() ?? []) {
      for (const item of window.focus) focus.set(focusKey(item), item);
      if (window.typing && window.typingSeq > typingSeq) {
        typing = window.typing;
        typingSeq = window.typingSeq;
      }
    }
    return { focus: [...focus.values()], typing };
  }

  private backendState(backendId: string): BackendState {
    let backend = this.backends.get(backendId);
    if (!backend) {
      backend = {
        windows: new Map(),
        inFlight: null,
        dirty: false,
        typingSource: null,
        unsupported: false,
      };
      this.backends.set(backendId, backend);
    }
    return backend;
  }

  /**
   * The unsupported latch short-circuits before any promise is stored, and
   * the cleanup runs as a `finally` continuation — never inside the async
   * body — so `inFlight` can never keep an already-settled promise and wedge
   * every later send (the latch is only cleared by `reconnected`).
   */
  private flush(backendId: string): Promise<void> {
    const backend = this.backendState(backendId);
    backend.dirty = true;
    if (backend.inFlight) return backend.inFlight;
    if (backend.unsupported) return Promise.resolve();
    const drain = async () => {
      while (backend.dirty && !backend.unsupported) {
        backend.dirty = false;
        await this.send(backendId, backend);
      }
    };
    backend.inFlight = drain().finally(() => {
      backend.inFlight = null;
    });
    return backend.inFlight;
  }

  private async send(backendId: string, backend: BackendState): Promise<void> {
    const params = this.merged(backendId);
    try {
      const result = await this.request(backendId, params);
      backend.typingSource = result.typingSource;
    } catch (error) {
      if (error instanceof JsonRpcError && error.rpcCode === PRESENCE_UNSUPPORTED_RPC_CODE) {
        backend.unsupported = true;
        logger.info('presence.update unsupported by daemon; presence disabled', { backendId });
        return;
      }
      logger.debug('presence.update failed', { backendId, error: String(error) });
    }
  }
}
