import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { invoke, isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  isWorkspaceCommandPayload,
  type BrowserCloseTabPayload,
  type BrowserFocusTabPayload,
  type BrowserListTabsRequestPayload,
  type BrowserOpenTabPayload,
} from '$shared/ipc/workspace-command-payloads';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectAllTabs,
  selectPanelLayoutWorkspaces,
} from '../../panel-layout/panel-layout-selectors';
import {
  hydrateWorkspaceLayout,
  waitForWorkspaceLayoutRestore,
} from '../../panel-layout/sagas/panel-layout-saga';
import {
  closeTab,
  openTab,
  openTabInAdjacentOrSplit,
  setActiveTab,
  updateTabBrowserUrl,
} from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectWorkspaceTabOrder } from '../../tab-state/tab-state-selectors';
import { focusBrowserTabRequested } from '../app-layout-slice';

let running = false;

const logger = createLogger('BrowserIpcSaga');

function browserTab(url: string, requestedUrl?: string): Omit<PanelTab, 'id'> {
  return {
    type: 'browser',
    title: 'Browser',
    browserUrl: url,
    closable: true,
    // Persist the pre-rewrite URL so a restart can re-run the rewrite
    // (monorepo#2789).
    ...(requestedUrl === undefined ? {} : { browserRequestedUrl: requestedUrl }),
  };
}

type LayoutReadiness =
  | { status: 'ready' }
  | { status: 'not-hosted' }
  | { status: 'hydration-failed'; message: string };

/**
 * Ensure the workspace's panel-layout state is usable for a browser IPC
 * request. A workspace sitting in this window's tab bar but never visited
 * this session has no layout entry yet — hydrate its persisted layout on
 * demand so state-level ops (listTabs, openTab, closeTab, focusTab routing)
 * work without the user activating it (monorepo#2789). A workspace this
 * window does not host is left alone: callers must stay silent for it so a
 * wrong-window reply can never poison main's per-workspace tab cache
 * (monorepo#2756 RC1, #2602).
 *
 * Never throws: hostedness is settled before any fallible work, and a
 * hydration failure is reported as a result so one poisoned persisted layout
 * cannot abort the whole browser IPC saga for the window.
 */
function* ensureWorkspaceLayoutForRequest(workspaceId: string): SagaGenerator<LayoutReadiness> {
  const held = workspaceId in (yield* selectPanelLayoutWorkspaces.effect());
  if (!held && !(yield* selectWorkspaceTabOrder.effect()).includes(workspaceId)) {
    return { status: 'not-hosted' };
  }
  try {
    if (held) {
      // The entry may have been created by a restore that is still in
      // flight (restoreStatus 'pending'); answer with post-restore state.
      yield* call(waitForWorkspaceLayoutRestore, workspaceId);
      const after = (yield* selectPanelLayoutWorkspaces.effect())[workspaceId];
      // Still 'pending' with no restore in flight means an earlier restore
      // failed or was cancelled and never delivered a layout — fall through
      // and retry the hydration instead of answering untruthfully from the
      // never-restored default state. Any other status (or a reducer-created
      // live entry) is usable as-is.
      if (after?.restoreStatus !== 'pending') return { status: 'ready' };
    }
    yield* call(hydrateWorkspaceLayout, workspaceId);
    return { status: 'ready' };
  } catch (error) {
    return {
      status: 'hydration-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function* openBrowser(data: BrowserOpenTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.url !== 'string') return;
  const workspaceId = data.workspaceId;
  // Hydrate a hosted-but-unvisited workspace first so the open lands on its
  // persisted layout (and the 'replace' branch can find existing browser
  // tabs) instead of a fresh default layout (monorepo#2789). A hydration
  // failure falls back to opening against the current (default) layout —
  // matching pre-hydration behavior — since main has already handed the
  // caller this tabId and dropping the open would create a phantom tab.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:open-tab; opening against current state', {
      workspaceId,
      error: readiness.message,
    });
  }

  // Main pre-generates the tab id so it can lease agent-opened tabs for
  // exact-URL dedupe (monorepo#2541); fall back to renderer generation for
  // payloads without one. allowDuplicate mirrors the agent's explicit opt-out
  // of dedupe so the panel layout's equivalent-tab reuse doesn't override it.
  const newTabId = typeof data.tabId === 'string' && data.tabId.length > 0 ? data.tabId : undefined;
  const allowDuplicate = data.allowDuplicate === true ? true : undefined;
  // Pre-rewrite URL for rewritten opens; persisted with the tab so a restart
  // can re-run the rewrite (monorepo#2789).
  const requestedUrl = typeof data.requestedUrl === 'string' ? data.requestedUrl : undefined;

  const position = data.position ?? 'adjacent';
  if (position === 'replace') {
    const tabs = yield* selectAllTabs.effect(workspaceId);
    const existing = tabs.find((tab) => tab.type === 'browser');
    if (existing) {
      yield* put(updateTabBrowserUrl(workspaceId, existing.id, data.url, requestedUrl ?? null));
      yield* put(setActiveTab(workspaceId, existing.id));
      return;
    }
    yield* put(
      openTab(
        workspaceId,
        browserTab(data.url, requestedUrl),
        undefined,
        newTabId,
        undefined,
        undefined,
        allowDuplicate,
      ),
    );
    return;
  }
  if (position === 'adjacent') {
    yield* put(
      openTabInAdjacentOrSplit(workspaceId, browserTab(data.url, requestedUrl), undefined, {
        newTabId,
        allowDuplicate,
      }),
    );
    return;
  }
  yield* put(
    openTab(
      workspaceId,
      browserTab(data.url, requestedUrl),
      undefined,
      newTabId,
      undefined,
      undefined,
      allowDuplicate,
    ),
  );
}

function* closeBrowser(data: BrowserCloseTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.tabId !== 'string' || data.tabId.length === 0)
    return;
  const workspaceId = data.workspaceId;

  // The tab to close may live in a hosted-but-unvisited workspace's
  // persisted layout (monorepo#2789). When hydration fails the tab cannot be
  // in state, so stop here: main confirms closes via a fresh tab list and
  // will report the failure truthfully rather than "already closed".
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:close-tab; ignoring close', {
      workspaceId,
      tabId: data.tabId,
      error: readiness.message,
    });
    return;
  }
  const tabs = yield* selectAllTabs.effect(workspaceId);
  const existing = tabs.find((tab) => tab.id === data.tabId && tab.type === 'browser');
  if (!existing || existing.closable === false) return;

  yield* put(closeTab(workspaceId, data.tabId));
}

function* focusBrowser(data: BrowserFocusTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.tabId !== 'string' || data.tabId.length === 0)
    return;
  // Route by the payload's workspaceId so a request for a background
  // workspace (or a non-focused window) still focuses the right layout's
  // tab — the old PanelLayout listener gated on the active layout and
  // answered with its own workspaceId (monorepo#2756 RC2). Hydrate a
  // hosted-but-unvisited workspace first so the focus handler can find the
  // tab in its restored layout (monorepo#2789). A hydration failure still
  // dispatches the focus request — matching pre-hydration behavior — and the
  // handler no-ops if the tab is not in state.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, data.workspaceId);
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:focus-tab', {
      workspaceId: data.workspaceId,
      tabId: data.tabId,
      error: readiness.message,
    });
  }
  yield* put(focusBrowserTabRequested(data.workspaceId, data.tabId));
}

function* listBrowserTabs(data: BrowserListTabsRequestPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;

  // Only answer for workspaces this window actually hosts (layout state or
  // tab bar). A window that does not host the requested workspace must never
  // resolve the requestId: an empty wrong-workspace reply poisons main's
  // per-workspace tab cache (monorepo#2756 RC1, #2602). A hosted workspace
  // that was never visited this session is hydrated on demand so its
  // persisted tab list answers instead of a silent timeout (monorepo#2789).
  // Hostedness is settled before any fallible work inside ensure…, so an
  // error reply below can only come from a window that hosts the workspace.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'not-hosted') return;
  if (readiness.status === 'hydration-failed') {
    // Truthful error: distinguish "hydration failed" from "renderer did not
    // respond" so main can reject instead of timing out (monorepo#2789).
    yield* call(invoke, 'browser:list-tabs-response', {
      requestId,
      // i18n-ignore (agent-facing protocol error, not user-facing)
      error: `layout hydration failed: ${readiness.message}`,
    });
    return;
  }

  const browserTabs = (yield* selectAllTabs.effect(workspaceId))
    .filter((tab) => tab.type === 'browser')
    .map((tab) => ({
      tabId: tab.id,
      url: tab.browserUrl || '',
      title: tab.title || m.layout_panelLayout_browser_fallback(),
      closable: tab.closable !== false,
    }));

  // Echo the requestId back so main resolves the matching pending request
  // (concurrent requests must not consume each other's replies).
  yield* call(invoke, 'browser:list-tabs-response', { tabs: browserTabs, requestId });
}

export function* browserIpcSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
  try {
    const tasks: Task[] = [
      yield* takeEveryFromElectronChannel<BrowserOpenTabPayload | null>(
        'browser:open-tab',
        openBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab must be opened in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserCloseTabPayload | null>(
        'browser:close-tab',
        closeBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab close must be applied in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserFocusTabPayload | null>(
        'browser:focus-tab',
        focusBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab focus must be applied in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserListTabsRequestPayload | null>(
        'browser:list-tabs-request',
        listBrowserTabs,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every list request must be answered; main resolves replies by requestId.',
          },
        },
      ),
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
