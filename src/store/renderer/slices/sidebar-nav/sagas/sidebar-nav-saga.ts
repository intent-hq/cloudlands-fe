import { call, put, take, takeEvery, fork, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  selectAllSpacesViewMode,
  selectChiefActiveAgentId,
  selectIsCardPinned,
  selectMultiSelectSidebarTabOrder,
  selectPanelItem,
  selectPanelWidth,
  selectPinnedWorkspaceIds,
} from '../sidebar-nav-selectors';
import {
  CARD_PINNED_KEY,
  CHIEF_ACTIVE_AGENT_ID_KEY,
  closeAll,
  closeHoverCards,
  closePanel,
  hydrateSidebarNav,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  openPanel,
  PANEL_ITEM_KEY,
  PANEL_WIDTH_KEY,
  pinWorkspace,
  PINNED_WORKSPACES_KEY,
  setAllSpacesViewMode,
  setCardPinned,
  setChiefActiveAgentId,
  setMultiSelectSidebarTabOrder,
  setPanelWidth,
  setPinnedWorkspaceIds,
  toggleCardPinned,
  togglePanel,
  togglePinWorkspace,
  unpinWorkspace,
  VIEW_MODE_KEY,
} from '../sidebar-nav-slice';
import type { AllSpacesViewMode, SidebarNavItem } from '../sidebar-nav-types';

const PINNED_ACTIONS = [setPinnedWorkspaceIds, pinWorkspace, unpinWorkspace, togglePinWorkspace];
const PANEL_ITEM_ACTIONS = [openPanel, closePanel, togglePanel, closeAll];
const CARD_PINNED_ACTIONS = [
  setCardPinned,
  toggleCardPinned,
  openPanel,
  closePanel,
  togglePanel,
  closeAll,
  closeHoverCards,
];
const ALL_PERSIST_ACTIONS = [
  ...PINNED_ACTIONS,
  setAllSpacesViewMode,
  setPanelWidth,
  ...PANEL_ITEM_ACTIONS,
  setCardPinned,
  toggleCardPinned,
  closeHoverCards,
  setChiefActiveAgentId,
  setMultiSelectSidebarTabOrder,
];
const PINNED_TYPES = new Set(PINNED_ACTIONS.map((action) => action.type));
const PANEL_ITEM_TYPES = new Set(PANEL_ITEM_ACTIONS.map((action) => action.type));
const CARD_PINNED_TYPES = new Set(CARD_PINNED_ACTIONS.map((action) => action.type));

// Pinned workspace IDs, the multi-select sidebar tab order, and the chief
// active agent id all reference backend-specific workspace/agent IDs, so they
// are namespaced per backend (local keeps the legacy un-prefixed key). The
// remaining keys (view mode, panel width/item, card-pinned) are global UI
// preferences shared across backends and stay un-namespaced.
function pinnedWorkspacesKey(backendId: string): string {
  return namespaceBackendKey(PINNED_WORKSPACES_KEY, backendId);
}

function chiefActiveAgentIdKey(backendId: string): string {
  return namespaceBackendKey(CHIEF_ACTIVE_AGENT_ID_KEY, backendId);
}

function multiSelectTabOrderKey(backendId: string): string {
  return namespaceBackendKey(MULTISELECT_SIDEBAR_TAB_ORDER_KEY, backendId);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function parseViewMode(raw: string | null): {
  mode?: AllSpacesViewMode;
  legacy: boolean;
} {
  if (raw === null) return { legacy: false };
  let value: unknown;
  let legacy = false;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
    legacy = true;
  }
  return value === 'recent' || value === 'repo' || value === 'status'
    ? { mode: value, legacy }
    : { legacy };
}

function panelItem(value: unknown): SidebarNavItem | null | undefined {
  if (value === null) return null;
  const validItems: readonly string[] = [
    'home',
    'new-workspace',
    'active',
    'chief',
    'all-workspaces',
    'settings',
  ];
  return typeof value === 'string' && validItems.includes(value)
    ? (value as SidebarNavItem)
    : undefined;
}

export function* hydrateSidebarNavState(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    const data: Parameters<typeof hydrateSidebarNav>[0] = {};
    const pinned = stringArray(
      yield* call(getLocalStorageJSON<unknown>, pinnedWorkspacesKey(backendId)),
    );
    if (pinned !== undefined) data.pinnedWorkspaceIds = pinned;

    const viewMode = parseViewMode(yield* call(getLocalStorageItem, VIEW_MODE_KEY));
    if (viewMode.mode !== undefined) {
      data.allSpacesViewMode = viewMode.mode;
      if (viewMode.legacy) yield* call(setLocalStorageJSON, VIEW_MODE_KEY, viewMode.mode);
    }

    const width = yield* call(getLocalStorageJSON<unknown>, PANEL_WIDTH_KEY);
    if (typeof width === 'number' && Number.isFinite(width)) data.panelWidth = width;

    const item = panelItem(yield* call(getLocalStorageJSON<unknown>, PANEL_ITEM_KEY));
    if (item !== undefined) data.panelItem = item;

    const pinnedCard = yield* call(getLocalStorageJSON<unknown>, CARD_PINNED_KEY);
    if (typeof pinnedCard === 'boolean') data.isCardPinned = pinnedCard;

    const chiefAgentId = yield* call(
      getLocalStorageJSON<unknown>,
      chiefActiveAgentIdKey(backendId),
    );
    if (chiefAgentId === null || typeof chiefAgentId === 'string') {
      data.chiefActiveAgentId = chiefAgentId;
    }

    const tabOrder = stringArray(
      yield* call(getLocalStorageJSON<unknown>, multiSelectTabOrderKey(backendId)),
    );
    if (tabOrder !== undefined) data.multiSelectTabOrder = tabOrder;

    if (Object.keys(data).length > 0) yield* put(hydrateSidebarNav(data));
  } catch {
    // Hydration is best-effort; malformed or unavailable storage is ignored.
  }
}

export function* persistSidebarNavState(action: { type: string }): SagaGenerator<void> {
  try {
    if (PINNED_TYPES.has(action.type)) {
      yield* call(
        setLocalStorageJSON,
        pinnedWorkspacesKey(yield* selectActiveBackendId()),
        yield* selectPinnedWorkspaceIds.effect(),
      );
    }
    if (action.type === setAllSpacesViewMode.type) {
      yield* call(setLocalStorageJSON, VIEW_MODE_KEY, yield* selectAllSpacesViewMode.effect());
    }
    if (action.type === setPanelWidth.type) {
      yield* call(setLocalStorageJSON, PANEL_WIDTH_KEY, yield* selectPanelWidth.effect());
    }
    if (PANEL_ITEM_TYPES.has(action.type)) {
      yield* call(setLocalStorageJSON, PANEL_ITEM_KEY, yield* selectPanelItem.effect());
    }
    if (CARD_PINNED_TYPES.has(action.type)) {
      yield* call(setLocalStorageJSON, CARD_PINNED_KEY, yield* selectIsCardPinned.effect());
    }
    if (action.type === setChiefActiveAgentId.type) {
      yield* call(
        setLocalStorageJSON,
        chiefActiveAgentIdKey(yield* selectActiveBackendId()),
        yield* selectChiefActiveAgentId.effect(),
      );
    }
    if (action.type === setMultiSelectSidebarTabOrder.type) {
      yield* call(
        setLocalStorageJSON,
        multiSelectTabOrderKey(yield* selectActiveBackendId()),
        yield* selectMultiSelectSidebarTabOrder.effect(),
      );
    }
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-hydrate the per-backend keys from the incoming
 * backend's namespace, resetting to empty where it has none so the previous
 * backend's pins/tab order don't linger.
 */
export function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    const pinned = stringArray(
      yield* call(getLocalStorageJSON<unknown>, pinnedWorkspacesKey(backendId)),
    );
    const chiefAgentId = yield* call(
      getLocalStorageJSON<unknown>,
      chiefActiveAgentIdKey(backendId),
    );
    const tabOrder = stringArray(
      yield* call(getLocalStorageJSON<unknown>, multiSelectTabOrderKey(backendId)),
    );
    yield* put(
      hydrateSidebarNav({
        pinnedWorkspaceIds: pinned ?? [],
        chiefActiveAgentId: typeof chiefAgentId === 'string' ? chiefAgentId : null,
        multiSelectTabOrder: tabOrder ?? [],
      }),
    );
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* sidebarNavSaga(): SagaGenerator<void> {
  yield* call(hydrateSidebarNavState);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(ALL_PERSIST_ACTIONS, persistSidebarNavState);
}