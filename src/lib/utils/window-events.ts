import type { CanonicalAgentStatusFields } from '$features/events/types';

type KnownWindowEventName =
  | 'agent-associations-removed'
  | 'agent-follow-animation'
  | 'agent:scroll-to-turn'
  | 'app:deep-link-create'
  | 'chat:enhance-prompt'
  | 'chat:open-model-picker'
  | 'chat:resend-message'
  | 'diff-editor:file-saved'
  | 'editor:go-to-definition'
  | 'editor:selection-change'
  | 'file:changed'
  | 'file:restore-scroll-position'
  | 'navigate-message'
  | 'note-content-update'
  | 'note:restore-scroll-position'
  | 'panel:focus-content'
  // Browser-emitted built-in event; consumed by a saga via takeEveryFromWindowEvent
  // (`resize-saga.ts`) and by many component listeners.
  | 'resize'
  | 'scroll-to-task'
  | 'select-open'
  | 'task-association-changed'
  | 'terminal-theme-changed'
  | 'theme-changed'
  | 'workspace:go-to-line'
  | 'workspace:new-terminal'
  | 'workspace:toggle-left-sidebar'
  // Orphan listener saga (`watchWaitingForFirstMessageSaga` in
  // workspace-agents-saga.ts) — no dispatcher exists today. Tracked as a
  // follow-up cleanup, kept in the union so the listener type-checks.
  | 'workspace:waiting-for-first-message';

/**
 * Pre-existing orphan dispatchers that have no live listener anywhere in the
 * tree but pre-date the window-event → Redux migration. They were retyped from
 * raw `window.dispatchEvent(new CustomEvent(...))` to `dispatchWindowEvent`
 * during the Wave 2a hygiene tightening. Each is tracked as a separate
 * follow-up investigation: either a missing listener needs to be wired or the
 * dispatch site should be deleted.
 *
 * **Do not add new entries here.** New code that needs to dispatch a window
 * event must add the name to `KnownWindowEventName` and ensure a live listener
 * exists. The dispatch-gate (`scripts/check-workspace-event-dispatchers.mjs`)
 * already prevents raw `window.dispatchEvent(new CustomEvent(...))` for new
 * call sites; this typed escape hatch keeps the `dispatchWindowEvent()` API
 * honest by enumerating exactly which legacy strings are accepted.
 */
type LegacyOrphanWindowEventName =
  | 'apply-patch'
  | 'app:show-toast'
  | 'github:auth-success'
  | 'run-agent-action'
  | 'run-cli-command'
  | 'workspace:file-resolved'
  | 'workspace:post-merge-update';

type DynamicWindowEventName =
  | `agent:message-sent:${string}`
  | `agent:session-updated:${string}`
  | `agent:stream:${string}`
  | `panelVisibility:${string}`
  | `window:${string}`;

export type WindowEventName = KnownWindowEventName | DynamicWindowEventName;

type WindowEventOptions<T> = Omit<CustomEventInit<T>, 'detail'>;

export type WorkspaceNewTerminalDetail = {
  workspaceId: string;
};

/**
 * Detail payload for `agent:stream:${agentId}` window events.
 *
 * Stream events are heterogeneous (chunk, content-blocks, status, end, error,
 * etc.); the only field every dispatcher reliably provides is `type`. Listeners
 * narrow on `type` and read the rest of the payload accordingly.
 */
export type AgentStreamDetail = {
  type: string;
  [key: string]: unknown;
} & CanonicalAgentStatusFields;

export type AgentStreamInputDetail = {
  type: string;
  [key: string]: unknown;
} & Partial<CanonicalAgentStatusFields>;

export type AgentSessionUpdatedDetail = CanonicalAgentStatusFields;
export type AgentSessionUpdatedInputDetail = Partial<CanonicalAgentStatusFields>;

function withCanonicalAgentStreamFields(detail: AgentStreamInputDetail): AgentStreamDetail {
  let fields: CanonicalAgentStatusFields;

  if (detail.type === 'start' || detail.type === 'status') {
    fields = {
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    };
  } else if (detail.type === 'end' || detail.type === 'complete') {
    fields = {
      status: 'idle',
      activationState: null,
      isActive: false,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: typeof detail.stopReason === 'string'
        ? detail.stopReason
        : typeof detail.finishReason === 'string'
          ? detail.finishReason
          : null,
    };
  } else if (detail.type === 'error') {
    fields = {
      status: 'failed',
      activationState: 'error',
      isActive: false,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: typeof detail.stopReason === 'string'
        ? detail.stopReason
        : typeof detail.error === 'string'
          ? detail.error
          : null,
    };
  } else {
    fields = {
      status: 'responding',
      activationState: 'active',
      isActive: true,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      stopReason: null,
    };
  }

  return { ...fields, ...detail };
}

function withCanonicalSessionUpdatedFields(
  detail: AgentSessionUpdatedInputDetail = {},
): AgentSessionUpdatedDetail {
  return {
    status: detail.status ?? null,
    activationState: detail.activationState ?? null,
    isActive: detail.isActive ?? null,
    isStreaming: detail.isStreaming ?? null,
    isProcessing: detail.isProcessing ?? null,
    isResponding: detail.isResponding ?? null,
    stopReason: detail.stopReason ?? null,
  };
}

export function dispatchWindowEvent(eventName: WindowEventName): void;
export function dispatchWindowEvent(
  eventName: 'workspace:new-terminal',
  detail: WorkspaceNewTerminalDetail,
  options?: WindowEventOptions<WorkspaceNewTerminalDetail>,
): void;
export function dispatchWindowEvent<T>(
  eventName: WindowEventName,
  detail: T,
  options?: WindowEventOptions<T>,
): void;
// Legacy escape hatch — see `LegacyOrphanWindowEventName` above. Tracked in
// follow-up; do not add new entries to that union.
export function dispatchWindowEvent(eventName: LegacyOrphanWindowEventName): void;
export function dispatchWindowEvent<T>(
  eventName: LegacyOrphanWindowEventName,
  detail: T,
  options?: WindowEventOptions<T>,
): void;
export function dispatchWindowEvent<T>(eventName: string, detail?: T, options?: WindowEventOptions<T>): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (detail === undefined) {
    window.dispatchEvent(new CustomEvent(eventName));
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { ...options, detail }));
}

// ---------------------------------------------------------------------------
// Typed dispatchers for per-agent dynamic-name window events.
//
// These are thin wrappers around `dispatchWindowEvent` that fix the channel
// prefix (`agent:stream:`, `agent:session-updated:`, `agent:message-sent:`)
// so call sites cannot drift from the template-literal contract declared in
// `DynamicWindowEventName`. Listeners (addEventListener etc.) and IPC channel
// names are unchanged.
// ---------------------------------------------------------------------------

export function dispatchAgentStream(agentId: string, detail: AgentStreamInputDetail): void {
  dispatchWindowEvent(`agent:stream:${agentId}`, withCanonicalAgentStreamFields(detail));
}

export function dispatchAgentSessionUpdated(agentId: string, detail?: AgentSessionUpdatedInputDetail): void {
  dispatchWindowEvent(`agent:session-updated:${agentId}`, withCanonicalSessionUpdatedFields(detail));
}

export function dispatchAgentMessageSent(agentId: string): void {
  dispatchWindowEvent(`agent:message-sent:${agentId}`);
}