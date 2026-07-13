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
  | `panelVisibility:${string}`
  | `window:${string}`;

export type WindowEventName = KnownWindowEventName | DynamicWindowEventName;

type WindowEventOptions<T> = Omit<CustomEventInit<T>, 'detail'>;

export type WorkspaceNewTerminalDetail = {
  workspaceId: string;
};

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
export function dispatchWindowEvent<T>(
  eventName: string,
  detail?: T,
  options?: WindowEventOptions<T>,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (detail === undefined) {
    window.dispatchEvent(new CustomEvent(eventName));
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { ...options, detail }));
}
