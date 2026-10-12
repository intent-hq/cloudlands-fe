/**
 * Live terminals domain backed by the intentd daemon (PROTOCOL §5.13).
 *
 * Wires the renderer's terminal panel through the daemon's interactive PTY
 * surface: `terminal.create/write/resize/kill/getBuffer/list/readOutput`.
 * Terminal payloads cross the JSON-RPC text channel as base64 (PROTOCOL §5.13
 * "Base64 framing"), so this client base64-encodes outgoing `write` payloads
 * and decodes incoming `getBuffer` scrollback and streamed `terminal:data`
 * chunks. The lighter `output(...)` wraps the ported plaintext
 * `terminal.readOutput` for MCP-style callers.
 *
 * Per-terminal events (`terminal:data/exit/cwd/title`) reach subscribers via
 * `subscribeEvents` — the client filters the daemon notification stream by
 * `event.data.terminalId` and routes payloads to the supplied handlers.
 */
import type { TerminalTab } from '$store/renderer/slices/terminals/terminals-slice';
import type {
  MutationResult,
  SubscriptionHandler,
  TerminalCreateParams,
  TerminalEventHandlers,
  TerminalListResult,
  TerminalsClient,
  Unsubscribe,
} from '../app-client';
import { createBackendTerminalsClient } from './backend-terminals-client';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from './backend-transport';
import { runMutation } from './live-support';

/** UTF-8 → base64 (renderer-safe; handles arbitrary bytes via TextEncoder). */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Base64 → UTF-8 string; empty/invalid input folds to `""`. */
function decodeBase64(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

interface EventEnvelope {
  type?: string;
  data?: { terminalId?: string; chunk?: string; exitCode?: number; cwd?: string; title?: string };
}

/** Extract the `event` block from an `events.event` notification's params. */
function extractEvent(params: unknown): EventEnvelope | null {
  if (!params || typeof params !== 'object') return null;
  const outer = params as { event?: unknown; type?: unknown; data?: unknown };
  if (outer.event && typeof outer.event === 'object') return outer.event as EventEnvelope;
  if (typeof outer.type === 'string') return outer as EventEnvelope;
  return null;
}

/** Read the wire-level `params.subscriptionId` tag attached by the daemon's fan-out. */
function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

// Compatibility for LiveAppClient until the Svelte renderer is retired.
// Read the transport export inside the moved async body, preserving overrides.
const terminalReads = createBackendTerminalsClient({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
});

export class LiveTerminalsClient implements TerminalsClient {
  list(workspaceId: string): Promise<TerminalListResult> {
    return terminalReads.list(workspaceId);
  }

  async create(params: TerminalCreateParams): Promise<MutationResult> {
    try {
      const result = await backendRequest<{ terminalId?: unknown }>('terminal.create', {
        workspaceId: params.workspaceId,
        cols: params.cols,
        rows: params.rows,
        ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
        ...(params.command !== undefined ? { command: params.command } : {}),
      });
      const id = typeof result?.terminalId === 'string' ? result.terminalId : undefined;
      return id ? { success: true, id } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async write(terminalId: string, data: string, workspaceId?: string): Promise<MutationResult> {
    return runMutation('terminal.write', {
      terminalId,
      data: encodeBase64(data),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
  }

  async resize(
    terminalId: string,
    cols: number,
    rows: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return runMutation('terminal.resize', {
      terminalId,
      cols,
      rows,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
  }

  async kill(terminalId: string, workspaceId?: string): Promise<MutationResult> {
    return runMutation('terminal.kill', {
      terminalId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
  }

  async getBuffer(terminalId: string, maxBytes?: number, workspaceId?: string): Promise<string> {
    try {
      const result = await backendRequest<{ data?: unknown }>('terminal.getBuffer', {
        terminalId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      });
      return decodeBase64(result?.data);
    } catch {
      return '';
    }
  }

  async output(workspaceId: string, terminalId: string): Promise<string> {
    try {
      const result = await backendRequest<{ output?: unknown } | string>('terminal.readOutput', {
        workspaceId,
        terminalId,
      });
      if (typeof result === 'string') return result;
      const output = (result as { output?: unknown })?.output;
      return typeof output === 'string' ? output : '';
    } catch {
      return '';
    }
  }

  subscribeEvents(
    terminalId: string,
    handlers: TerminalEventHandlers,
    workspaceId?: string,
  ): Unsubscribe {
    let disposed = false;
    let generation = 0;
    let subscriptionId: string | undefined;

    // Daemon fan-out is one `events.event` per matching subscription on the
    // socket, each tagged with `params.subscriptionId` (PROTOCOL §5.13 /
    // intent-transport build_event_notification). When two terminals share the
    // renderer socket, the same `terminal:data` is delivered once per
    // subscription — without the subscriptionId gate below xterm would write
    // each chunk N times (e.g. 'a' rendering as 'aa'). Pre-resolve events are
    // dropped: the daemon resolves `events.subscribe` before any interactive
    // input flows, so the only events crossing the wire before resolution
    // belong to other subscriptions and were never ours to process.
    const off = onBackendNotification((n) => {
      if (n.method !== 'events.event') return;
      const tag = extractSubscriptionId(n.params);
      if (subscriptionId === undefined || tag !== subscriptionId) return;
      const event = extractEvent(n.params);
      if (!event || typeof event.type !== 'string') return;
      if (!event.type.startsWith('terminal:')) return;
      const data = event.data ?? {};
      if (data.terminalId !== terminalId) return;
      switch (event.type) {
        case 'terminal:data':
          handlers.onData?.({ terminalId, chunk: decodeBase64(data.chunk) });
          break;
        case 'terminal:exit':
          handlers.onExit?.({
            terminalId,
            exitCode: typeof data.exitCode === 'number' ? data.exitCode : 0,
          });
          break;
        case 'terminal:cwd':
          if (typeof data.cwd === 'string') handlers.onCwd?.({ terminalId, cwd: data.cwd });
          break;
        case 'terminal:title':
          if (typeof data.title === 'string') handlers.onTitle?.({ terminalId, title: data.title });
          break;
      }
    });

    const doSubscribe = () => {
      const attempt = ++generation;
      return backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: ['terminal:data', 'terminal:exit', 'terminal:cwd', 'terminal:title'],
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      })
        .then((result) => {
          const id = result?.subscriptionId;
          if (disposed || attempt !== generation) {
            if (id) void backendUnsubscribe(id, workspaceId);
            return;
          }
          subscriptionId = id;
        })
        .catch(() => {
          // If the daemon subscribe fails we leave `subscriptionId` unset; the
          // gate above then drops every notification (we have no id to match on),
          // which matches reality: without a live subscription the daemon won't
          // route terminal events to this connection in the first place.
        });
    };

    doSubscribe();

    // On reconnect the daemon dropped its subscription registry; re-subscribe
    // on the same handler so this terminal's events keep flowing. The scope
    // gate above rekeys on the fresh id (RESUB-1).
    const offReconnect = onBackendReconnected(() => {
      subscriptionId = undefined;
      void doSubscribe();
    });

    return () => {
      disposed = true;
      off();
      offReconnect();
      if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
    };
  }

  subscribe(handler: SubscriptionHandler<TerminalTab[]>): Unsubscribe {
    // The renderer slice consumes per-workspace snapshots via `list(workspaceId)`;
    // this slice-wide subscription is not used by the integrated terminal panel.
    handler([]);
    return () => {};
  }
}
