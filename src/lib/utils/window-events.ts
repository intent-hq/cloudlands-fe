type KnownWindowEventName =
  | 'agent-associations-removed'
  | 'agent-follow'
  | 'agent-follow-animation'
  | 'agent-follow-file'
  | 'agent-follow-note'
  | 'agent:scroll-to-subscription'
  | 'agent:scroll-to-turn'
  | 'app:deep-link-create'
  | 'app:new-agent'
  | 'app:new-note'
  | 'app:new-terminal'
  | 'app:open-new-space-modal'
  | 'app:show-toast'
  | 'app:toggle-sidebar'
  | 'apply-patch'
  | 'browser:focus-tab'
  | 'browser:zoom'
  | 'chat:enhance-prompt'
  | 'chat:open-model-picker'
  | 'chat:resend-message'
  | 'close-accept-changes'
  | 'close-activity'
  | 'close-agent-turn'
  | 'close-browser'
  | 'close-chat-changes'
  | 'close-commit'
  | 'close-commit-changeset'
  | 'close-diff'
  | 'close-file'
  | 'close-local-changes'
  | 'close-note'
  | 'close-source'
  | 'close-tracked-change'
  | 'create-agent-for-note'
  | 'delegate-task'
  | 'diagram:binding-click'
  | 'diff-editor:file-saved'
  | 'editor:go-to-definition'
  | 'editor:selection-change'
  | 'file:changed'
  | 'file:restore-scroll-position'
  | 'file:save-scroll-position'
  | 'github:auth-success'
  | 'initializer-branch-updated'
  | 'layout:configure-panels'
  | 'navigate-message'
  | 'note:restore-scroll-position'
  | 'note:save-scroll-position'
  | 'note:scroll-to-heading'
  | 'open-create-workspace-modal'
  | 'panel:focus'
  | 'panel:focus-content'
  | 'panel:request-focus'
  | 'resize'
  | 'run-agent-action'
  | 'run-agent-for-note'
  | 'run-cli-command'
  | 'scroll-to-task'
  | 'select-open'
  | 'sidebar:locate-item'
  | 'spaces-switcher:select'
  | 'start-section-tasks'
  | 'switch-to-pr-branch'
  | 'synthetic'
  | 'task-association-changed'
  | 'task-delegate'
  | 'task-split'
  | 'terminal-theme-changed'
  | 'terminal:close-active'
  | 'terminal:create-new'
  | 'terminal:toggle-overlay'
  | 'terminal:toggle-search'
  | 'theme-changed'
  | 'toggle'
  | 'updateSpec'
  | 'workspace:approve-spec'
  | 'workspace:code-review-update'
  | 'workspace:create-for-repo'
  | 'workspace:create-pr'
  | 'workspace:file-resolved'
  | 'workspace:go-to-line'
  | 'workspace:navigate-to-changes'
  | 'workspace:new-tab'
  | 'workspace:open-accept-changes'
  | 'workspace:open-agent'
  | 'workspace:open-browser-url'
  | 'workspace:open-chat-changes'
  | 'workspace:open-code-review'
  | 'workspace:open-commit'
  | 'workspace:open-commit-changeset'
  | 'workspace:open-diff'
  | 'workspace:open-file'
  | 'workspace:open-local-changes'
  | 'workspace:open-note'
  | 'workspace:open-terminal'
  | 'workspace:openTerminal'
  | 'workspace:show-agent'
  | 'workspace:stop-code-review'
  | 'workspace:toggle-left-sidebar'
  | 'workspace:trigger-code-review'
  | 'workspace:waiting-for-first-message';

type DynamicWindowEventName =
  | `agent:message-sent:${string}`
  | `agent:session-updated:${string}`
  | `agent:stream:${string}`
  | `panelVisibility:${string}`
  | `window:${string}`;

export type WindowEventName = KnownWindowEventName | DynamicWindowEventName;

type WindowEventOptions<T> = Omit<CustomEventInit<T>, 'detail'>;

export function dispatchWindowEvent(eventName: WindowEventName): void;
export function dispatchWindowEvent<T>(
  eventName: WindowEventName,
  detail: T,
  options?: WindowEventOptions<T>,
): void;
export function dispatchWindowEvent(eventName: string): void;
export function dispatchWindowEvent<T>(eventName: string, detail: T, options?: WindowEventOptions<T>): void;
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