import { m } from '../../../shared/paraglide/messages.js';
import type { TerminalTab } from '../../../store/renderer/slices/terminals/terminals-slice';
import type {
  SubscriptionHandler,
  TerminalCreateParams,
  TerminalEventHandlers,
  TerminalListResult,
  Unsubscribe,
} from '../app-client';
import type {
  InteractiveTerminalsClient,
  TerminalMutationResult,
  TerminalSubscription,
} from '../terminal-client-types';
import type { BackendRuntime } from './backend-transport-runtime';
import { createBackendTerminalsClient } from './backend-terminals-client';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';
/** UTF-8 → base64 (renderer-safe; handles arbitrary bytes via TextEncoder). */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Base64 → UTF-8 string; empty/invalid input folds to `""`. */
function decodeBase64(value: unknown, strict = false): string {
  if (strict && typeof value !== 'string') throw new Error(m.terminal_adapter_openFailed_error());
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (error) {
    if (strict) throw error;
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

/** Shared wire implementation; strict mode is opt-in for explicit terminal ownership. */
export function createBackendInteractiveTerminalsClient(
  backend: Pick<
    BackendRuntime,
    | 'backendRequest'
    | 'backendSubscribe'
    | 'backendUnsubscribe'
    | 'onBackendNotification'
    | 'onBackendReconnected'
  >,
  options: { strict?: boolean; guard?: () => void } = {},
): InteractiveTerminalsClient {
  const { backendSubscribe, backendUnsubscribe, onBackendNotification, onBackendReconnected } =
    backend;
  const backendRequest: BackendRuntime['backendRequest'] = async (
    method,
    params,
    requestOptions,
  ) => {
    options.guard?.();
    if (!options.strict)
      return requestOptions === undefined
        ? backend.backendRequest(method, params)
        : backend.backendRequest(method, params, requestOptions);
    return backend.backendRequest(method, params, {
      ...requestOptions,
      onDispatch: () => {
        options.guard?.();
        requestOptions?.onDispatch?.();
      },
    });
  };
  const terminalReads = createBackendTerminalsClient(
    { backendRequest },
    { strict: options.strict },
  );
  const legacyMutation = createRunMutation(backendRequest);
  async function runMutation(method: string, params: unknown): Promise<TerminalMutationResult> {
    if (!options.strict) return legacyMutation(method, params);
    let dispatched = false;
    try {
      const receipt = await backendRequest<{ ok?: boolean }>(method, params, {
        onDispatch: () => {
          dispatched = true;
        },
      });
      return receipt?.ok === true
        ? { success: true }
        : { success: false, terminalOutcome: 'unknown' };
    } catch (error) {
      return {
        success: false,
        error: mutationErrorMessage(error),
        ...(dispatched ? { terminalOutcome: 'unknown' as const } : {}),
      };
    }
  }
  return {
    list(workspaceId: string): Promise<TerminalListResult> {
      return terminalReads.list(workspaceId);
    },

    async create(params: TerminalCreateParams): Promise<TerminalMutationResult> {
      let dispatched = false;
      try {
        const payload = {
          workspaceId: params.workspaceId,
          cols: params.cols,
          rows: params.rows,
          ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
          ...(params.command !== undefined ? { command: params.command } : {}),
        };
        const result = options.strict
          ? await backendRequest<{ terminalId?: unknown }>('terminal.create', payload, {
              onDispatch: () => {
                dispatched = true;
              },
            })
          : await backendRequest<{ terminalId?: unknown }>('terminal.create', payload);
        const id = typeof result?.terminalId === 'string' ? result.terminalId : undefined;
        return id
          ? { success: true, id }
          : options.strict
            ? { success: false, terminalOutcome: 'unknown' }
            : { success: true };
      } catch (error) {
        return {
          success: false,
          error: mutationErrorMessage(error),
          ...(options.strict && dispatched ? { terminalOutcome: 'unknown' as const } : {}),
        };
      }
    },

    async write(
      terminalId: string,
      data: string,
      workspaceId?: string,
    ): Promise<TerminalMutationResult> {
      return runMutation('terminal.write', {
        terminalId,
        data: encodeBase64(data),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
    },

    async resize(
      terminalId: string,
      cols: number,
      rows: number,
      workspaceId?: string,
    ): Promise<TerminalMutationResult> {
      return runMutation('terminal.resize', {
        terminalId,
        cols,
        rows,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
    },

    async kill(terminalId: string, workspaceId?: string): Promise<TerminalMutationResult> {
      return runMutation('terminal.kill', {
        terminalId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
    },

    async getBuffer(terminalId: string, maxBytes?: number, workspaceId?: string): Promise<string> {
      try {
        const result = await backendRequest<{ data?: unknown }>('terminal.getBuffer', {
          terminalId,
          ...(workspaceId !== undefined ? { workspaceId } : {}),
          ...(maxBytes !== undefined ? { maxBytes } : {}),
        });
        options.guard?.();
        return decodeBase64(result?.data, options.strict);
      } catch (error) {
        if (options.strict) throw error;
        return '';
      }
    },

    async output(workspaceId: string, terminalId: string): Promise<string> {
      try {
        const result = await backendRequest<{ output?: unknown } | string>('terminal.readOutput', {
          workspaceId,
          terminalId,
        });
        if (typeof result === 'string') return result;
        const output = (result as { output?: unknown })?.output;
        return typeof output === 'string' ? output : '';
      } catch (error) {
        if (options.strict) throw error;
        return '';
      }
    },

    subscribeEvents(
      terminalId: string,
      handlers: TerminalEventHandlers,
      workspaceId?: string,
    ): TerminalSubscription {
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
        if (disposed || n.method !== 'events.event') return;
        try {
          options.guard?.();
        } catch {
          return;
        }
        const tag = extractSubscriptionId(n.params);
        if (subscriptionId === undefined || tag !== subscriptionId) return;
        const event = extractEvent(n.params);
        if (!event || typeof event.type !== 'string') return;
        if (!event.type.startsWith('terminal:')) return;
        const data = event.data ?? {};
        if (data.terminalId !== terminalId) return;
        switch (event.type) {
          case 'terminal:data':
            try {
              handlers.onData?.({ terminalId, chunk: decodeBase64(data.chunk, options.strict) });
            } catch (error) {
              handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
            }
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
            if (typeof data.title === 'string')
              handlers.onTitle?.({ terminalId, title: data.title });
            break;
        }
      });

      const doSubscribe = () => {
        const attempt = ++generation;
        try {
          options.guard?.();
        } catch (error) {
          return Promise.reject(error);
        }
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
            try {
              options.guard?.();
            } catch (error) {
              if (id) void backendUnsubscribe(id, workspaceId);
              throw error;
            }
            if (options.strict && !id) throw new Error(m.terminal_adapter_openFailed_error());
            subscriptionId = id;
            handlers.onReady?.();
          })
          .catch((error) => {
            if (options.strict && !disposed) {
              handlers.onError?.(error);
              throw error;
            }
            // If the daemon subscribe fails we leave `subscriptionId` unset; the
            // gate above then drops every notification (we have no id to match on),
            // which matches reality: without a live subscription the daemon won't
            // route terminal events to this connection in the first place.
          });
      };

      const ready = doSubscribe();
      void ready.catch(() => {});

      // On reconnect the daemon dropped its subscription registry; re-subscribe
      // on the same handler so this terminal's events keep flowing. The scope
      // gate above rekeys on the fresh id (RESUB-1).
      const offReconnect = options.strict
        ? () => {}
        : onBackendReconnected(() => {
            subscriptionId = undefined;
            void doSubscribe();
          });

      const unsubscribe: TerminalSubscription = () => {
        disposed = true;
        off();
        offReconnect();
        if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId);
      };
      if (options.strict) unsubscribe.ready = ready;
      return unsubscribe;
    },

    subscribe(handler: SubscriptionHandler<TerminalTab[]>): Unsubscribe {
      // The renderer slice consumes per-workspace snapshots via `list(workspaceId)`;
      // this slice-wide subscription is not used by the integrated terminal panel.
      handler([]);
      return () => {};
    },
  };
}
