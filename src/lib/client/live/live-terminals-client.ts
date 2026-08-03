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
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type {
  MutationResult,
  SubscriptionHandler,
  TerminalCreateParams,
  TerminalEventHandlers,
  TerminalListResult,
  TerminalsClient,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from "./backend-transport";
import { runMutation } from "./live-support";

/** UTF-8 → base64 (renderer-safe; handles arbitrary bytes via TextEncoder). */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Base64 → UTF-8 string; empty/invalid input folds to `""`. */
function decodeBase64(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Coerce a raw `terminal.list` entry into a `TerminalTab` for the renderer
 * slice. The daemon shape is `{ id, name, cwd, isExecutingCommand }` (PROTOCOL
 * §5.9) — `name` is the display name given at spawn (e.g. "Setup Script") and
 * flows straight into `TerminalTab.name`; display fallbacks live in the
 * selectors (`customName || name || 'Terminal'`), never a raw id-derived label.
 */
function toTerminalTab(raw: unknown, fallbackWorkspaceId?: string): TerminalTab | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = String(entry.terminalId ?? entry.id ?? "");
  if (!id) return null;
  const workspaceId =
    typeof entry.workspaceId === "string" ? entry.workspaceId : fallbackWorkspaceId;
  return {
    id,
    name: typeof entry.name === "string" ? entry.name : "",
    workspaceId,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
    isConnected: true,
    ...(typeof entry.isExecutingCommand === "boolean"
      ? { isExecuting: entry.isExecutingCommand }
      : {}),
  };
}

interface EventEnvelope {
  type?: string;
  data?: { terminalId?: string; chunk?: string; exitCode?: number; cwd?: string; title?: string };
}

/** Extract the `event` block from an `events.event` notification's params. */
function extractEvent(params: unknown): EventEnvelope | null {
  if (!params || typeof params !== "object") return null;
  const outer = params as { event?: unknown; type?: unknown; data?: unknown };
  if (outer.event && typeof outer.event === "object") return outer.event as EventEnvelope;
  if (typeof outer.type === "string") return outer as EventEnvelope;
  return null;
}

/** Read the wire-level `params.subscriptionId` tag attached by the daemon's fan-out. */
function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === "string" ? id : undefined;
}

export class LiveTerminalsClient implements TerminalsClient {
  async list(workspaceId: string): Promise<TerminalListResult> {
    const result = await backendRequest<
      { terminals?: unknown[]; daemonBootId?: unknown } | unknown[]
    >("terminal.list", { workspaceId });
    // Envelope shape (PROTOCOL §5.13): { terminals, daemonBootId }. A legacy
    // pre-envelope daemon returns a bare array — tolerated by shape detection
    // and treated as carrying no boot metadata (daemonBootId omitted), which
    // the store maps to the preserve-tabs behavior.
    const isLegacyArray = Array.isArray(result);
    const raw = isLegacyArray
      ? result
      : Array.isArray((result as { terminals?: unknown[] })?.terminals)
        ? (result as { terminals: unknown[] }).terminals
        : [];
    const bootId =
      !isLegacyArray && typeof (result as { daemonBootId?: unknown })?.daemonBootId === "string"
        ? (result as { daemonBootId: string }).daemonBootId
        : undefined;
    const tabs: TerminalTab[] = [];
    for (const entry of raw) {
      const tab = toTerminalTab(entry, workspaceId);
      if (tab) tabs.push(tab);
    }
    return { terminals: tabs, ...(bootId !== undefined ? { daemonBootId: bootId } : {}) };
  }

  async create(params: TerminalCreateParams): Promise<MutationResult> {
    try {
      const result = await backendRequest<{ terminalId?: unknown }>("terminal.create", {
        workspaceId: params.workspaceId,
        cols: params.cols,
        rows: params.rows,
        ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
        ...(params.command !== undefined ? { command: params.command } : {}),
      });
      const id = typeof result?.terminalId === "string" ? result.terminalId : undefined;
      return id ? { success: true, id } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async write(terminalId: string, data: string): Promise<MutationResult> {
    return runMutation("terminal.write", { terminalId, data: encodeBase64(data) });
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<MutationResult> {
    return runMutation("terminal.resize", { terminalId, cols, rows });
  }

  async kill(terminalId: string): Promise<MutationResult> {
    return runMutation("terminal.kill", { terminalId });
  }

  async getBuffer(terminalId: string, maxBytes?: number): Promise<string> {
    try {
      const result = await backendRequest<{ data?: unknown }>("terminal.getBuffer", {
        terminalId,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      });
      return decodeBase64(result?.data);
    } catch {
      return "";
    }
  }

  async output(workspaceId: string, terminalId: string): Promise<string> {
    try {
      const result = await backendRequest<{ output?: unknown } | string>("terminal.readOutput", {
        workspaceId,
        terminalId,
      });
      if (typeof result === "string") return result;
      const output = (result as { output?: unknown })?.output;
      return typeof output === "string" ? output : "";
    } catch {
      return "";
    }
  }

  subscribeEvents(terminalId: string, handlers: TerminalEventHandlers): Unsubscribe {
    let disposed = false;
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
      if (n.method !== "events.event") return;
      const tag = extractSubscriptionId(n.params);
      if (subscriptionId === undefined || tag !== subscriptionId) return;
      const event = extractEvent(n.params);
      if (!event || typeof event.type !== "string") return;
      if (!event.type.startsWith("terminal:")) return;
      const data = event.data ?? {};
      if (data.terminalId !== terminalId) return;
      switch (event.type) {
        case "terminal:data":
          handlers.onData?.({ terminalId, chunk: decodeBase64(data.chunk) });
          break;
        case "terminal:exit":
          handlers.onExit?.({
            terminalId,
            exitCode: typeof data.exitCode === "number" ? data.exitCode : 0,
          });
          break;
        case "terminal:cwd":
          if (typeof data.cwd === "string") handlers.onCwd?.({ terminalId, cwd: data.cwd });
          break;
        case "terminal:title":
          if (typeof data.title === "string")
            handlers.onTitle?.({ terminalId, title: data.title });
          break;
      }
    });

    const doSubscribe = () =>
      backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: ["terminal:data", "terminal:exit", "terminal:cwd", "terminal:title"],
      })
        .then((result) => {
          subscriptionId = result?.subscriptionId;
          if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
        })
        .catch(() => {
          // If the daemon subscribe fails we leave `subscriptionId` unset; the
          // gate above then drops every notification (we have no id to match on),
          // which matches reality: without a live subscription the daemon won't
          // route terminal events to this connection in the first place.
        });

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
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }

  subscribe(handler: SubscriptionHandler<TerminalTab[]>): Unsubscribe {
    // The renderer slice consumes per-workspace snapshots via `list(workspaceId)`;
    // this slice-wide subscription is not used by the integrated terminal panel.
    handler([]);
    return () => {};
  }
}
