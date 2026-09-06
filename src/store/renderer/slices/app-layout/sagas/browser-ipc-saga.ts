import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { invoke, isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  isBrowserEmulatedSize,
  isBrowserTabViewport,
  isWorkspaceCommandPayload,
  type BrowserCloseTabPayload,
  type BrowserEmulatedSize,
  type BrowserTabViewport,
  type BrowserFocusTabPayload,
  type BrowserListTabsRequestPayload,
  type BrowserOpenTabPayload,
  type BrowserShowTabPayload,
  type BrowserTabNavigatedPayload,
  type BrowserTabOwnerChangedPayload,
} from '$shared/ipc/workspace-command-payloads';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { routedWorkspaceId } from '../../../utils/routed-workspace-id';
import {
  selectAllTabs,
  selectHiddenTabs,
  selectPanelLayoutWorkspaces,
} from '../../panel-layout/panel-layout-selectors';
import {
  hydrateWorkspaceLayout,
  waitForWorkspaceLayoutRestore,
} from '../../panel-layout/sagas/panel-layout-saga';
import { dropRevealIfWorkspaceNotDisplayed } from '../../panel-layout/sagas/reveal-suppression';
import {
  activateVisibleTab,
  closeTab,
  openHiddenTab,
  openTab,
  openTabInRightmostColumnRequested,
  restoreHiddenTab,
  setActiveTab,
  setTabOwnerAgent,
  updateTabBrowserUrl,
} from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectWorkspaceTabOrder } from '../../tab-state/tab-state-selectors';
import { focusBrowserTabRequested } from '../app-layout-slice';

let running = false;

const logger = createLogger('BrowserIpcSaga');

function browserTab(
  url: string,
  requestedUrl?: string,
  ownerAgentId?: string,
  emulatedSize?: BrowserEmulatedSize,
  ownerAgentName?: string,
): Omit<PanelTab, 'id'> {
  const viewport: BrowserTabViewport = emulatedSize
    ? { mode: 'custom', ...emulatedSize }
    : { mode: 'fit' };
  return {
    type: 'browser',
    title: 'Browser',
    browserUrl: url,
    closable: true,
    // Persist the pre-rewrite URL so a restart can re-run the rewrite
    // (monorepo#2789).
    ...(requestedUrl === undefined ? {} : { browserRequestedUrl: requestedUrl }),
    // Persist the owning agent on agent opens so ownership survives restart
    // (monorepo#2857).
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
    // Persist the owner's display name so the sidebar owner group can label
    // the tab without an agent-store lookup (monorepo#3438).
    ...(ownerAgentName === undefined ? {} : { ownerAgentName }),
    // Persist the emulated viewport alongside the owner so the tab
    // rehydrates at its actual size after restart (monorepo#2857).
    ...(emulatedSize === undefined ? {} : { emulatedSize }),
    viewport,
  };
}

/**
 * Build a `setTabOwnerAgent` action at the smallest arity carrying the
 * defined fields, so payload tuples do not grow trailing `undefined`s.
 */
function tabOwnerAction(
  workspaceId: string,
  tabId: string,
  ownerAgentId: string,
  emulatedSize?: BrowserEmulatedSize,
  ownerAgentName?: string,
  viewport?: BrowserTabViewport,
): ReturnType<typeof setTabOwnerAgent> {
  if (viewport !== undefined)
    return setTabOwnerAgent(
      workspaceId,
      tabId,
      ownerAgentId,
      emulatedSize,
      ownerAgentName,
      viewport,
    );
  if (ownerAgentName !== undefined)
    return setTabOwnerAgent(workspaceId, tabId, ownerAgentId, emulatedSize, ownerAgentName);
  if (emulatedSize !== undefined)
    return setTabOwnerAgent(workspaceId, tabId, ownerAgentId, emulatedSize);
  return setTabOwnerAgent(workspaceId, tabId, ownerAgentId);
}

type LayoutReadiness =
  { status: 'ready' } | { status: 'not-hosted' } | { status: 'hydration-failed'; message: string };

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
  if (
    !held &&
    !(yield* selectWorkspaceTabOrder.effect()).includes(workspaceId) &&
    routedWorkspaceId() !== workspaceId
  ) {
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
  // Owning agent on agent opens; persisted with the tab (monorepo#2857).
  const ownerAgentId =
    typeof data.ownerAgentId === 'string' && data.ownerAgentId.length > 0
      ? data.ownerAgentId
      : undefined;
  // Owner display name on agent opens; persisted with the tab so the sidebar
  // owner group can label it without an agent-store lookup (monorepo#3438).
  const ownerAgentName =
    ownerAgentId !== undefined &&
    typeof data.ownerAgentName === 'string' &&
    data.ownerAgentName.length > 0
      ? data.ownerAgentName
      : undefined;
  // Emulated viewport on agent opens; persisted with the tab alongside the
  // owner so the size survives restart and the UI can surface it
  // (monorepo#2857, §5.9). Only meaningful for owned tabs.
  const emulatedSize =
    ownerAgentId !== undefined && isBrowserEmulatedSize(data.emulatedSize)
      ? data.emulatedSize
      : undefined;
  // Agent opens are hidden by default (monorepo#3045): visible: false
  // creates the tab straight into hiddenTabs — no panel mount, no focus or
  // active-tab change. Only owned tabs can be hidden (unowned tabs would be
  // invisible AND unrestorable — hide-on-close and the sidebar owner groups
  // are ownership-scoped).
  const hiddenOpen = ownerAgentId !== undefined && data.visible === false;

  const position = data.position ?? 'adjacent';
  if (position === 'replace') {
    const tabs = yield* selectAllTabs.effect(workspaceId);
    // Main resolves (and, for agent opens, ownership-checks) the adoption
    // target and binds it into the payload as replaceTabId; replace only
    // that exact tab so a layout change since the check cannot redirect the
    // replace onto a different (possibly other-agent-owned) tab
    // (monorepo#2857 TOCTOU). When it's gone — or on legacy payloads without
    // replaceTabId — a user open falls back to the first browser tab, while
    // an agent open must NOT (main never ownership-checked that tab): it
    // opens a new tab instead.
    const replaceTabId = typeof data.replaceTabId === 'string' ? data.replaceTabId : undefined;
    // An AGENT replace may target a hidden (user-closed) owned tab — the
    // per-agent dedupe still reuses it (monorepo#2857). Navigate it in place
    // and leave it hidden: the user's close is respected, the agent keeps
    // operating on the live offscreen webview. Unowned (user) opens never
    // take this branch: main resolves the target from a list that includes
    // hidden tabs, and navigating one in place would look like a no-op to
    // the user while retargeting an agent-owned tab — fall through and open
    // a visible tab instead.
    if (replaceTabId && ownerAgentId) {
      const hiddenTabs = yield* selectHiddenTabs.effect(workspaceId);
      const hidden = hiddenTabs.find((tab) => tab.type === 'browser' && tab.id === replaceTabId);
      if (hidden) {
        yield* put(updateTabBrowserUrl(workspaceId, hidden.id, data.url, requestedUrl ?? null));
        yield* put(
          tabOwnerAction(workspaceId, hidden.id, ownerAgentId, emulatedSize, ownerAgentName),
        );
        return;
      }
    }
    const existing = replaceTabId
      ? tabs.find((tab) => tab.type === 'browser' && tab.id === replaceTabId)
      : ownerAgentId
        ? undefined
        : tabs.find((tab) => tab.type === 'browser');
    if (existing) {
      yield* put(updateTabBrowserUrl(workspaceId, existing.id, data.url, requestedUrl ?? null));
      // An agent replace adopts the existing tab — record its new owner
      // (main enforced ownership before sending this open, monorepo#2857).
      if (ownerAgentId) {
        yield* put(
          tabOwnerAction(workspaceId, existing.id, ownerAgentId, emulatedSize, ownerAgentName),
        );
      }
      // A hidden (default) agent open never changes the active tab or panel
      // focus — the adopted tab keeps its place, only its URL changed
      // (monorepo#3045). Adoption never hides a visible tab.
      if (hiddenOpen) return;
      yield* put(setActiveTab(workspaceId, existing.id));
      return;
    }
    if (hiddenOpen) {
      yield* put(
        openHiddenTab(
          workspaceId,
          browserTab(data.url, requestedUrl, ownerAgentId, emulatedSize, ownerAgentName),
          newTabId,
        ),
      );
      return;
    }
    const openAction = openTabInRightmostColumnRequested(
      workspaceId,
      browserTab(data.url, requestedUrl, ownerAgentId, emulatedSize, ownerAgentName),
      {
        newTabId,
        allowDuplicate,
        agentDriven: ownerAgentId !== undefined ? true : undefined,
      },
    );
    yield* put(openAction);
    return;
  }
  // A hidden (default) agent open creates the tab straight into hiddenTabs:
  // no panel mount, no focus or active-tab change (monorepo#3045). The
  // webview mounts offscreen (OffscreenWebviewHost pins owned hidden tabs)
  // and registers, so the tab is CDP-addressable immediately. `position`
  // and `pin` only apply to visible opens.
  if (hiddenOpen) {
    yield* put(
      openHiddenTab(
        workspaceId,
        browserTab(data.url, requestedUrl, ownerAgentId, emulatedSize, ownerAgentName),
        newTabId,
      ),
    );
    return;
  }
  if (position === 'adjacent') {
    const openAction = openTabInRightmostColumnRequested(
      workspaceId,
      browserTab(data.url, requestedUrl, ownerAgentId, emulatedSize, ownerAgentName),
      {
        newTabId,
        allowDuplicate,
        agentDriven: ownerAgentId !== undefined ? true : undefined,
      },
    );
    yield* put(openAction);
    return;
  }
  const openAction = openTab(
    workspaceId,
    browserTab(data.url, requestedUrl, ownerAgentId, emulatedSize, ownerAgentName),
    undefined,
    newTabId,
    undefined,
    undefined,
    allowDuplicate,
  );
  yield* put(openAction);
  if (ownerAgentId !== undefined) {
    yield* dropRevealIfWorkspaceNotDisplayed(workspaceId, openAction.payload.newTabId);
  }
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
  const hiddenTabs = yield* selectHiddenTabs.effect(workspaceId);
  const existing =
    tabs.find((tab) => tab.id === data.tabId && tab.type === 'browser') ??
    hiddenTabs.find((tab) => tab.id === data.tabId && tab.type === 'browser');
  if (!existing || existing.closable === false) return;

  // Main-driven closes (the agent closeTab op) genuinely destroy the tab —
  // visible or hidden — never hide it (monorepo#2857): the hide-on-close
  // rule applies to user closes only.
  yield* put(closeTab(workspaceId, data.tabId, undefined, undefined, true));
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
  // agentDriven: a main-driven focus on a workspace this window is not
  // displaying applies its layout-state effects but skips the actual UI
  // reveal (monorepo#3045).
  yield* put(focusBrowserTabRequested(data.workspaceId, data.tabId, data.pin, true));
}

function* showBrowser(data: BrowserShowTabPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data) || typeof data.tabId !== 'string' || data.tabId.length === 0)
    return;
  const workspaceId = data.workspaceId;
  const focus = data.focus === true;

  // Same hostedness/hydration discipline as focus-tab: hydrate a
  // hosted-but-unvisited workspace so the hidden tab can be found in its
  // restored layout (monorepo#2789). Main confirms the reveal against a
  // fresh tab list, so on hydration failure we stop and let it report
  // truthfully.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:show-tab; ignoring show', {
      workspaceId,
      tabId: data.tabId,
      error: readiness.message,
    });
    return;
  }

  const hiddenTabs = yield* selectHiddenTabs.effect(workspaceId);
  if (hiddenTabs.some((tab) => tab.id === data.tabId && tab.type === 'browser')) {
    // Reveal: activate into a visible fixed column. focus: false keeps panel
    // focus stable (monorepo#3045, #3112).
    yield* put(restoreHiddenTab(workspaceId, data.tabId, undefined, focus));
    // A reveal on a workspace this window is not displaying keeps its
    // layout-state effects but skips the actual UI reveal/scroll (its
    // requestId is the restored tab's id).
    yield* dropRevealIfWorkspaceNotDisplayed(workspaceId, data.tabId);
    return;
  }
  // Already in a panel: focus: true activates the tab and focuses its panel
  // (reusing the focusTab path); focus: false activates it in place without
  // moving panel focus, so a visible-but-inactive tab is displayed
  // (monorepo#3045). Both are idempotent on an already-active tab.
  if (focus) {
    yield* put(focusBrowserTabRequested(workspaceId, data.tabId, undefined, true));
    return;
  }
  yield* put(activateVisibleTab(workspaceId, data.tabId));
  yield* dropRevealIfWorkspaceNotDisplayed(workspaceId, data.tabId);
}

function* tabNavigated(data: BrowserTabNavigatedPayload | null): SagaGenerator<void> {
  if (
    !isWorkspaceCommandPayload(data) ||
    typeof data.tabId !== 'string' ||
    data.tabId.length === 0 ||
    typeof data.url !== 'string'
  )
    return;
  const workspaceId = data.workspaceId;
  // The navigated tab may live in a hosted-but-unvisited workspace's
  // persisted layout (monorepo#2789). A workspace this window does not host
  // is left alone (the hosting window applies the update), and when
  // hydration fails the tab cannot be in state so the update is dropped.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'not-hosted') return;
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:tab-navigated; ignoring update', {
      workspaceId,
      tabId: data.tabId,
      error: readiness.message,
    });
    return;
  }
  // Main navigated the tab through the rewrite pipeline, so it is the
  // authority on the requested URL: present records it, absent clears it
  // (the tab no longer shows rewritten content) — mirroring the executor's
  // lease-identity semantics (monorepo#2789).
  const requestedUrl = typeof data.requestedUrl === 'string' ? data.requestedUrl : null;
  yield* put(updateTabBrowserUrl(workspaceId, data.tabId, data.url, requestedUrl));
}

function* listBrowserTabs(data: BrowserListTabsRequestPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;

  // Only answer for workspaces this window actually hosts (layout state,
  // tab bar, or route). A window that does not host the requested workspace must never
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
    // Guarded: the reply invoke reaches the real ipcMain handler (bridged by
    // browser-ipc-bridge-seeder, monorepo#2926), so a main-side throw would
    // otherwise cancel the whole browserIpcSaga — main times the request out
    // on a lost reply, which is the correct degraded outcome.
    try {
      yield* call(invoke, 'browser:list-tabs-response', {
        requestId,
        // i18n-ignore (agent-facing protocol error, not user-facing)
        error: `layout hydration failed: ${readiness.message}`,
      });
    } catch (error) {
      logger.warn('browser:list-tabs-response error reply failed', {
        workspaceId,
        requestId,
        error,
      });
    }
    return;
  }

  // Hidden (user-closed or hidden-opened) owned tabs stay in the list: they
  // are alive offscreen and their owner must keep seeing them
  // (monorepo#2857). They carry `hidden: true` so main can project the
  // listTabs `visibility` field and guard focusTab (monorepo#3045).
  const toReplyTab = (tab: PanelTab, hidden: boolean) => ({
    tabId: tab.id,
    url: tab.browserUrl || '',
    title: tab.title || m.layout_panelLayout_browser_fallback(),
    closable: tab.closable !== false,
    // Persisted owner so main's ownership registry can rehydrate after a
    // restart (monorepo#2857); absent for unowned (user) tabs. The
    // persisted emulated size rides along so the tab rehydrates at its
    // actual viewport instead of the default.
    ...(typeof tab.ownerAgentId === 'string' && tab.ownerAgentId.length > 0
      ? {
          ownerAgentId: tab.ownerAgentId,
          ...(isBrowserEmulatedSize(tab.emulatedSize) ? { emulatedSize: tab.emulatedSize } : {}),
        }
      : {}),
    ...(isBrowserTabViewport(tab.viewport) ? { viewport: tab.viewport } : {}),
    ...(hidden ? { hidden: true } : {}),
  });
  const browserTabs = [
    ...(yield* selectAllTabs.effect(workspaceId))
      .filter((tab) => tab.type === 'browser')
      .map((tab) => toReplyTab(tab, false)),
    ...(yield* selectHiddenTabs.effect(workspaceId))
      .filter((tab) => tab.type === 'browser')
      .map((tab) => toReplyTab(tab, true)),
  ];

  // Echo the requestId back so main resolves the matching pending request
  // (concurrent requests must not consume each other's replies).
  // Guarded for the same reason as the error reply above: an unhandled
  // rejection here would cancel the whole saga and kill all six watchers.
  try {
    yield* call(invoke, 'browser:list-tabs-response', { tabs: browserTabs, requestId });
  } catch (error) {
    logger.warn('browser:list-tabs-response reply failed', { workspaceId, requestId, error });
  }
}

function* tabOwnerChanged(data: BrowserTabOwnerChangedPayload | null): SagaGenerator<void> {
  if (
    !isWorkspaceCommandPayload(data) ||
    typeof data.tabId !== 'string' ||
    data.tabId.length === 0 ||
    typeof data.ownerAgentId !== 'string' ||
    data.ownerAgentId.length === 0
  )
    return;
  const workspaceId = data.workspaceId;
  // Main is the atomic claim arbiter; this event persists the accepted
  // owner on the panel-layout tab (monorepo#2857). Same hostedness/hydration
  // discipline as tab-navigated: a non-hosting window leaves it alone.
  const readiness = yield* call(ensureWorkspaceLayoutForRequest, workspaceId);
  if (readiness.status === 'not-hosted') return;
  if (readiness.status === 'hydration-failed') {
    logger.warn('Layout hydration failed before browser:tab-owner-changed; ignoring update', {
      workspaceId,
      tabId: data.tabId,
      error: readiness.message,
    });
    return;
  }
  // The persisted emulated size rides along with the owner (claim size /
  // resizeTab) so it survives restart too (monorepo#2857), as does the
  // owner's display name for the sidebar owner group (monorepo#3438).
  const ownerAgentName =
    typeof data.ownerAgentName === 'string' && data.ownerAgentName.length > 0
      ? data.ownerAgentName
      : undefined;
  yield* put(
    tabOwnerAction(
      workspaceId,
      data.tabId,
      data.ownerAgentId,
      isBrowserEmulatedSize(data.emulatedSize) ? data.emulatedSize : undefined,
      ownerAgentName,
      isBrowserTabViewport(data.viewport) ? data.viewport : undefined,
    ),
  );
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
      yield* takeEveryFromElectronChannel<BrowserShowTabPayload | null>(
        'browser:show-tab',
        showBrowser,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every requested browser tab reveal must be applied in arrival order.',
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
      yield* takeEveryFromElectronChannel<BrowserTabNavigatedPayload | null>(
        'browser:tab-navigated',
        tabNavigated,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale:
              'Every main-driven navigation must update the persisted tab URL in arrival order.',
          },
        },
      ),
      yield* takeEveryFromElectronChannel<BrowserTabOwnerChangedPayload | null>(
        'browser:tab-owner-changed',
        tabOwnerChanged,
        {
          bufferPolicy: {
            kind: 'lossless',
            rationale: 'Every ownership change must be persisted with the tab in arrival order.',
          },
        },
      ),
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
