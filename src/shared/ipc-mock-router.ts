/**
 * Single mock IPC router.
 *
 * Replaces the real renderer→main IPC boundary so `invoke()` calls and event
 * listeners resolve to in-memory mock data instead of hitting Electron. There is
 * one router for the whole process: callers register per-channel invoke handlers
 * and event listeners.
 *
 * Invoking a channel with NO registered handler REJECTS with
 * `UnbridgedMockIpcChannelError`. It used to resolve `undefined`, which silently
 * corrupted callers (empty transcripts when `agent:backend:stream-message` was
 * unbridged, `setModel` crashes on `agent:set-model`, clipboard writes that
 * claimed success). Loud failure is structural: bridge the channel in a seeder
 * under `src/store/renderer/seeders/`, or — only when every caller legitimately
 * tolerates absence — add it to `UNBRIDGED_INVOKE_ALLOWLIST` with justification.
 *
 * Tests may still opt back into a blanket resolution for unknown channels via
 * `setMockIpcInvokeFallback()`.
 */

/** Resolves an invoke for one channel. Receives the original `invoke()` args. */
export type MockIpcInvokeHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** Invoked with the payload whenever a mock event is emitted on a channel. */
export type MockIpcEventHandler = (payload: unknown) => void;

/** Disposer returned when adding an event listener. */
export type MockIpcUnsubscribe = () => void;

const invokeHandlers = new Map<string, MockIpcInvokeHandler>();
const eventHandlers = new Map<string, Set<MockIpcEventHandler>>();

/** Value returned by `mockInvoke()` for channels without a registered handler. */
let fallbackInvokeValue: unknown = undefined;
/** Whether a blanket unknown-channel fallback was explicitly configured. */
let fallbackInvokeConfigured = false;

/**
 * Channels that may be invoked WITHOUT a registered handler and resolve to the
 * mapped value instead of rejecting. Every entry must justify why absence is
 * legitimately tolerated. Keep this list minimal — an unbridged channel is a
 * bug unless proven otherwise.
 */
export const UNBRIDGED_INVOKE_ALLOWLIST: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  // Fire-and-forget renderer log persistence sink. The renderer logger catches
  // flush failures and RE-QUEUES the batch for retry, so rejecting here would
  // grow the pending-log buffer unboundedly and spam console.error on every
  // flush. There is no daemon-side log sink yet (P3-1.5 retirement candidate);
  // resolving undefined keeps the logger's in-memory behavior harmless.
  ['log:persist-renderer-logs', undefined],
  // Legacy notes-on-disk workspace root (`WorkspaceConfig.paths.workspace(id)`,
  // used to build `.workspace/notes/<id>.md` paths). The daemon owns notes in
  // SQLite (PROTOCOL §5.2) — this build has no on-disk notes mirror, so there
  // is no root to return. The only production caller (NoteTabType's
  // noteFilePath → OpenComboButton) guards `if (rootPath)` and hides the
  // open-file affordance when absent.
  ['workspace:get-root', undefined],
  // MCP "is the Context Engine configured in <CLI>?" probes (ProviderSelector
  // loadMcpStatus, fired on settings-page load). The MCP setup/uninstall flows
  // are deferred (no daemon arm); the caller folds absence to not-configured
  // (`result?.configured ?? false`), so the buttons render as "Setup".
  ['auggie:check-mcp-claude-code', undefined],
  ['auggie:check-mcp-codex', undefined],
  ['auggie:check-mcp-cortex', undefined],
  ['auggie:check-mcp-droid', undefined],
  ['auggie:check-mcp-opencode', undefined],
  ['auggie:check-mcp-pi', undefined],
  // The interaction-gated "Setup Context Engine" actions behind those probes
  // (ProviderSelector handleSetupMcp). Setup edits another CLI's MCP config on
  // the host — no daemon surface; the caller folds `success: false` into an
  // error toast carrying this message.
  [
    'auggie:setup-mcp-claude-code',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  [
    'auggie:setup-mcp-codex',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  [
    'auggie:setup-mcp-cortex',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  [
    'auggie:setup-mcp-droid',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  [
    'auggie:setup-mcp-opencode',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  [
    'auggie:setup-mcp-pi',
    {
      success: false,
      error:
        'Context Engine setup is not available in this build — configure the MCP server in the CLI on the daemon host',
    },
  ],
  // Analytics identity probe (identifyUser). The daemon has no Augment
  // user/session surface; the caller requires `success && data.id` and
  // try/catches, so identify simply never fires — the same graceful skip as a
  // logged-out/BYOK user.
  ['auggie:get-user-info', undefined],
  // Same settings-page probe for the pi-mcp-adapter (bare-boolean channel).
  // `false` renders the install affordance.
  ['pi:check-mcp-adapter', false],
  // The interaction-gated adapter install behind that probe (installPiMcpAdapter):
  // an npm install on the host with no daemon arm; the caller surfaces the
  // shaped failure's message next to the install affordance.
  [
    'pi:install-mcp-adapter',
    {
      success: false,
      error:
        'Pi MCP adapter install is not available in this build — run "npm i -g pi-mcp-adapter" on the daemon host',
    },
  ],
  // Electron main-process auto-updater — not a daemon surface. +layout.svelte
  // reads the state on startup with `.catch(() => null)`, and the settings
  // affordances surface the folded error message; a shaped failure keeps both
  // paths clean instead of a startup UnbridgedMockIpcChannelError.
  [
    'auto-update:check',
    { success: false, error: { message: 'Auto-update is not available in this build' } },
  ],
  [
    'auto-update:check-manual',
    { success: false, error: { message: 'Auto-update is not available in this build' } },
  ],
  [
    'auto-update:download',
    { success: false, error: { message: 'Auto-update is not available in this build' } },
  ],
  [
    'auto-update:get-state',
    { success: false, error: { message: 'Auto-update is not available in this build' } },
  ],
  [
    'auto-update:set-channel',
    { success: false, error: { message: 'Auto-update is not available in this build' } },
  ],
  // Legacy main-process model-config cache (ConfigCacheProxyService). The
  // service is exported but has no production callers — models load through
  // the provider seam. Callers fold `success: false` to null / [], the
  // cache-admin envelopes to a no-op / empty stats.
  [
    'config:get-model',
    { success: false, error: 'Model config cache is not bridged to the daemon' },
  ],
  [
    'config:get-all-models',
    { success: false, error: 'Model config cache is not bridged to the daemon' },
  ],
  ['config:clear-cache', undefined],
  ['config:invalidate', undefined],
  [
    'config:get-stats',
    { success: false, error: 'Model config cache is not bridged to the daemon' },
  ],
  // Legacy main-process ConfigManager store (reference config.ipc.ts). The
  // only production caller (acp-official permission-manager) takes its
  // localStorage branch first (`isBrowser` is true in this build), so these
  // IPC arms are statically present but never reached; the values mirror the
  // reference handler's fallbacks (get → null on error, set → failure
  // envelope) so even a future call degrades the same way.
  ['config:get', null],
  [
    'config:set',
    {
      success: false,
      error:
        'Legacy config store is not bridged to the daemon (renderer persistence uses localStorage)',
    },
  ],
  // Note-editor line-attribution gutter (LineAttributionGutter
  // loadAttributions, fired on note mount). Line attribution was computed by
  // the legacy main process; the daemon has no per-line attribution read
  // (§5.19 file-tracking is file-level). The caller requires `success && data`
  // and folds this shaped failure to an empty gutter (debug log only).
  [
    'line-attribution:load',
    { success: false, error: 'Line attribution is not bridged to the daemon' },
  ],
  // Chat-input context gathering probes the (unported) editor selection
  // tracker; the caller folds a missing/empty selection to null.
  ['editor:get-selection', undefined],
  // Third-party sources (NotesPanel embeds / drag-drop). Not ported to the
  // daemon; every client method folds failure into { success: false, error }
  // and the UI surfaces the message on the triggering interaction.
  ['sources:create', { success: false, error: 'Third-party sources are not ported to the daemon' }],
  ['sources:delete', { success: false, error: 'Third-party sources are not ported to the daemon' }],
  [
    'sources:extract-metadata',
    { success: false, error: 'Third-party sources are not ported to the daemon' },
  ],
  ['sources:get', { success: false, error: 'Third-party sources are not ported to the daemon' }],
  ['sources:list', { success: false, error: 'Third-party sources are not ported to the daemon' }],
  [
    'sources:refresh',
    { success: false, error: 'Third-party sources are not ported to the daemon' },
  ],
  ['sources:update', { success: false, error: 'Third-party sources are not ported to the daemon' }],
  // Electron app version read for analytics common properties
  // (buildStaticCommonProperties, fired on startup via hooks.client.ts). The
  // browser build has no packaged app version and no daemon surface for one;
  // the caller wraps the invoke in try/catch and folds absence to 'unknown'.
  ['app:get-version', undefined],
  // Electron native window-chrome state pushed by boot-path $effects: the
  // Window-menu tab list (+layout SET_OPEN_WORKSPACE_TABS), menu enablement
  // (+layout SET_IN_WORKSPACE), the native window title (WindowTitleBar
  // SET_TITLE), and browser-panel focus tracking for menu shortcuts
  // (PanelLayout SET_BROWSER_FOCUSED). There is no window chrome in this
  // build and no daemon surface for it; every caller is fire-and-forget with
  // `.catch(() => {})`, so resolving undefined keeps startup quiet. The
  // interaction-gated window:open-new stays loud audit debt.
  ['window:set-browser-focused', undefined],
  ['window:set-in-workspace', undefined],
  ['window:set-open-workspace-tabs', undefined],
  ['window:set-title', undefined],
  // Per-agent auto-commit status badges (ChatPanel refreshAutoCommitStatuses).
  // The daemon auto-commits via git.agentCommit (PROTOCOL §5.6) but exposes no
  // per-agent commit-status-history read; the caller requires
  // `response?.success && response.data` and `.catch`es, so the badges simply
  // stay hidden until a daemon surface exists.
  ['git:get-auto-commit-status', undefined],
  // Interaction-gated script detection + repo-config write (TerminalSidebar /
  // QuakeTerminalOverlay). The legacy handlers ran the main-process script
  // scanner and wrote the repo-level scripts file — neither has a daemon arm
  // (§5.8 covers lifecycle only; §5.25 setup-script detection is a different
  // surface). Both callers fold `success: false` into their toast/agent-assist
  // fallback paths.
  [
    'scripts:detect',
    {
      success: false,
      error:
        'Script detection is not available in this build — add scripts manually or ask an agent to register them',
    },
  ],
  [
    'scripts:save-to-repo',
    { success: false, error: 'Saving scripts to the repo config is not available in this build' },
  ],
]);

/**
 * Event channels a production emitter actually delivers. Every entry names its
 * emit site. `addMockIpcListener()` reports loudly when a listener subscribes
 * to a channel that is neither listed here (or under a prefix below) nor
 * justified in `UNEMITTED_LISTENER_ALLOWLIST` — such a listener NEVER fires
 * (the silent-gap / transcript-loss class: stale git status, lost ready-task
 * transitions). The reconciliation suite
 * (`src/store/renderer/seeders/ipc-channel-reconciliation.test.ts`) keeps both
 * lists honest against the scanned listener and emit call sites.
 */
export const EMITTED_MOCK_IPC_EVENT_CHANNELS: ReadonlySet<string> = new Set([
  // terminals-scripts-seeder.ts — emitted when a CLI-block run creates a
  // daemon-backed terminal session.
  'terminal:created',
  // daemon-events-bridge.ts relayLegacyIpcEvent — daemon `events.subscribe`
  // firehose re-emitted onto the legacy channels components still listen on.
  'agent:status-changed',
  'agent:idle',
  'workspace:updated',
  'git:status-changed',
  'file-tracking:changes-updated',
  'task:ready-tasks-changed',
]);

/**
 * Dynamic event-channel families (listened/emitted with a runtime suffix).
 * A listener on `prefix + suffix` counts as emitted when the prefix is listed.
 */
export const EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES: readonly string[] = [
  // terminals-scripts-seeder.ts — per-terminal exit notification for CLI blocks.
  'terminal:professional:exit:',
];

/**
 * Channels with production listeners but legitimately NO emitter in this
 * build. Every entry must justify why the listener staying silent is correct;
 * an unemitted listened channel is a bug unless proven otherwise.
 */
export const UNEMITTED_LISTENER_ALLOWLIST: ReadonlyMap<string, string> = new Map<string, string>([
  // ChatPanel auto-commit badges. The daemon auto-commits internally on
  // agent:idle (intent-services auto_commit.rs) but emits no per-commit
  // git:auto-commit-* events (PROTOCOL §6.5 lists git:* as reserved-but-
  // unused), and the refresh these listeners would trigger reads
  // git:get-auto-commit-status — itself an allowlisted absent surface above.
  // The badges stay hidden until a daemon status surface exists.
  ['git:auto-commit-started', 'no daemon auto-commit events (PROTOCOL §6.5 git:* reserved)'],
  ['git:auto-commit-succeeded', 'no daemon auto-commit events (PROTOCOL §6.5 git:* reserved)'],
  ['git:auto-commit-hook-failure', 'no daemon auto-commit events (PROTOCOL §6.5 git:* reserved)'],
  // PanelLayout ↔ Electron-main CDP agent plumbing (focus a browser tab / list
  // open tabs). The CDP agent lives in the unported Electron main process;
  // nothing in the daemon build issues these requests. The paired
  // browser:list-tabs-response invoke is already frozen audit debt.
  ['browser:focus-tab', 'Electron-main CDP agent request — no emitter in the daemon build'],
  ['browser:list-tabs-request', 'Electron-main CDP agent request — no emitter in the daemon build'],
  // Note-editor line-attribution gutter refresh. Per-line attribution was
  // computed by the legacy main process; the daemon has no per-line
  // attribution surface (§5.19 file-tracking is file-level) — the paired
  // line-attribution:load invoke is allowlisted to a shaped failure above, so
  // the gutter renders empty and a refresh event would change nothing.
  ['line-attribution:updated', 'no daemon per-line attribution surface (§5.19 is file-level)'],
  // Tiptap editor agent-suggestion marks (editor-listeners.ts). The legacy
  // agent note-suggestion flow was never ported — no producer exists on the
  // daemon; the editor simply never renders suggestion marks.
  ['note-suggestion', 'legacy agent note-suggestion flow not ported — no producer'],
]);

/** Whether some production emitter delivers events on `channel`. */
export function isEmittedMockIpcEventChannel(channel: string): boolean {
  if (EMITTED_MOCK_IPC_EVENT_CHANNELS.has(channel)) return true;
  return EMITTED_MOCK_IPC_EVENT_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix));
}

/** Channels already reported by the unemitted-listener guard (once each). */
const reportedUnemittedListenerChannels = new Set<string>();

/** Rejection raised when an invoke hits a channel with no registered handler. */
export class UnbridgedMockIpcChannelError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(
      `No mock IPC handler registered for channel '${channel}'. This build routes legacy ` +
        `renderer→main IPC through the in-memory mock router; an unbridged channel used to resolve ` +
        `undefined and silently corrupt the caller. Bridge the channel to the daemon in a seeder ` +
        `under src/store/renderer/seeders/ (see agent-ipc-bridge-seeder.ts), or — only if every ` +
        `caller legitimately tolerates absence — add it to UNBRIDGED_INVOKE_ALLOWLIST in ` +
        `src/shared/ipc-mock-router.ts with a justification.`,
    );
    this.name = 'UnbridgedMockIpcChannelError';
    this.channel = channel;
  }
}

/** Register (or replace) the mock handler for a single invoke channel. */
export function registerMockIpcHandler(channel: string, handler: MockIpcInvokeHandler): void {
  invokeHandlers.set(channel, handler);
}

/** Remove a previously registered invoke handler. */
export function unregisterMockIpcHandler(channel: string): void {
  invokeHandlers.delete(channel);
}

/** Whether a handler is registered for the given invoke channel. */
export function hasMockIpcHandler(channel: string): boolean {
  return invokeHandlers.has(channel);
}

/** All channels with a registered invoke handler (reconciliation/test aid). */
export function getRegisteredMockIpcChannels(): string[] {
  return [...invokeHandlers.keys()].sort();
}

/**
 * Opt back into a blanket resolution for unknown invoke channels (tests only).
 * Once configured, every unknown channel resolves to `value` instead of
 * rejecting; `resetMockIpcRouter()` restores the loud-failure default.
 */
export function setMockIpcInvokeFallback(value: unknown): void {
  fallbackInvokeValue = value;
  fallbackInvokeConfigured = true;
}

/**
 * Resolve an IPC invoke against the mock router.
 *
 * If a handler is registered for `channel` it is invoked with `args` and its
 * (possibly async) result is returned. Unknown channels resolve to the
 * explicitly configured test fallback (if any) or an allowlisted absence value;
 * otherwise they REJECT with `UnbridgedMockIpcChannelError` so a missing bridge
 * is a visible failure instead of a silent undefined.
 */
export async function mockInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = invokeHandlers.get(channel);
  if (handler) {
    return (await handler(...args)) as T;
  }
  if (fallbackInvokeConfigured) {
    return fallbackInvokeValue as T;
  }
  if (UNBRIDGED_INVOKE_ALLOWLIST.has(channel)) {
    return UNBRIDGED_INVOKE_ALLOWLIST.get(channel) as T;
  }
  throw new UnbridgedMockIpcChannelError(channel);
}

/**
 * Subscribe to mock events on a channel. Returns a disposer.
 *
 * Loud-failure guard: subscribing to a channel no production emitter delivers
 * (not in `EMITTED_MOCK_IPC_EVENT_CHANNELS`/prefixes and not justified in
 * `UNEMITTED_LISTENER_ALLOWLIST`) reports a console error once per channel.
 * Unlike `mockInvoke()` this does not throw — listeners register during
 * component mount, so throwing would break the whole component for a missing
 * event instead of surfacing the gap; the reconciliation suite is the
 * CI-blocking arm of the same guard.
 */
export function addMockIpcListener(
  channel: string,
  handler: MockIpcEventHandler,
): MockIpcUnsubscribe {
  if (
    !isEmittedMockIpcEventChannel(channel) &&
    !UNEMITTED_LISTENER_ALLOWLIST.has(channel) &&
    !reportedUnemittedListenerChannels.has(channel)
  ) {
    reportedUnemittedListenerChannels.add(channel);
    console.error(
      `[ipc-mock-router] Listener registered on event channel '${channel}' that NO production ` +
        `emitter delivers — it will never fire (silent-gap class). Wire an emitter (a seeder ` +
        `under src/store/renderer/seeders/ or the daemon-events-bridge legacy relay) and declare ` +
        `it in EMITTED_MOCK_IPC_EVENT_CHANNELS, or — only if the listener legitimately stays ` +
        `silent in this build — justify an UNEMITTED_LISTENER_ALLOWLIST entry in ` +
        `src/shared/ipc-mock-router.ts.`,
    );
  }
  let handlers = eventHandlers.get(channel);
  if (!handlers) {
    handlers = new Set();
    eventHandlers.set(channel, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = eventHandlers.get(channel);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      eventHandlers.delete(channel);
    }
  };
}

/** Deliver a payload to every listener registered on a channel. */
export function emitMockIpcEvent(channel: string, payload: unknown): void {
  const handlers = eventHandlers.get(channel);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    handler(payload);
  }
}

/** Number of listeners currently registered for a channel (test/debug aid). */
export function mockIpcListenerCount(channel: string): number {
  return eventHandlers.get(channel)?.size ?? 0;
}

/** Reset all router state (handlers, listeners, fallback). Primarily for tests. */
export function resetMockIpcRouter(): void {
  invokeHandlers.clear();
  eventHandlers.clear();
  fallbackInvokeValue = undefined;
  fallbackInvokeConfigured = false;
  reportedUnemittedListenerChannels.clear();
}
