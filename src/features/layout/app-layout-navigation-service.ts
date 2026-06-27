/**
 * App-layout navigation service — the post-saga handler for the orphaned
 * `appLayout/openAgentTabRequested` trigger.
 *
 * The agent-tab navigation lost its handler when the saga runtime was removed
 * (it lived in `slices/app-layout/sagas/app-layout-saga.ts` as `watchOpenAgentSaga`),
 * so the AgentCard / AgentsList dispatch sites became no-ops and clicking an
 * agent no longer opened (or focused) its conversation tab. This restores the
 * behavior WITHOUT re-adding a saga and WITHOUT changing any call site:
 * `createAppLayoutNavigationMiddleware()` observes dispatched actions and, on
 * `openAgentTabRequested`, hydrates the session via `ensureAgentSessionLoaded`
 * and opens/focuses the agent's panel tab.
 *
 * Tab open/focus semantics are delegated entirely to the panel-layout reducer:
 * `openTab` (and `openTabInAdjacentOrSplit`) already reuse an existing agent tab
 * for the same `agentId` across panels (see `findExistingTab`), so re-clicking an
 * open agent focuses its tab instead of duplicating it. `force: true` mirrors the
 * old saga's user-initiated open. The conversation title resolves from the agent
 * session name once loaded, falling back to "Agent" until then.
 *
 * Dependency-light per src/store AGENTS.md: imports only the configured store and
 * the slice actions/types (NOT selectors — importing them would evaluate
 * `store.createSelector` while the store module is still mid-initialization
 * through the middleware chain). The agent name is read straight off the
 * already-typed store state instead.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { openAgentTabRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import type { OpenAgentTabDetail } from "$store/renderer/slices/app-layout/app-layout-types";
import { ensureAgentSessionLoaded } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import {
  openTab,
  openTabInAdjacentOrSplit,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import type { PanelTab } from "$store/renderer/slices/panel-layout/panel-layout-types";

/**
 * Hydrate a selected agent's session and open (or focus) its conversation tab.
 * Honors `openInAdjacentPanel` / `sourcePanelId` from the dispatched detail and
 * relies on the panel-layout reducer to dedup an already-open agent tab.
 */
export function openAgentTab(wsId: string, detail: OpenAgentTabDetail): void {
  const { agentId, openInAdjacentPanel, sourcePanelId } = detail;
  if (!wsId || !agentId) return;

  // Kick off the (deduped) on-demand session/conversation load.
  appStore.dispatch(ensureAgentSessionLoaded(wsId, agentId));

  const title = appStore.state.agentSessions?.byAgentId[agentId]?.name || "Agent";
  const tab: Omit<PanelTab, "id"> = {
    type: "agent",
    title,
    agentId,
    workspaceId: wsId,
    closable: true,
  };

  if (openInAdjacentPanel) {
    appStore.dispatch(openTabInAdjacentOrSplit(wsId, tab, sourcePanelId, { force: true }));
    return;
  }
  appStore.dispatch(openTab(wsId, tab, sourcePanelId, undefined, true));
}

/**
 * Middleware that gives `openAgentTabRequested` a real handler: after the action
 * passes through the reducer, it loads the agent session and opens/focuses the
 * agent tab. The action payload is the `[wsId, detail]` tuple.
 */
export function createAppLayoutNavigationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === openAgentTabRequested.type) {
      const payload = (action as { payload?: unknown }).payload;
      if (Array.isArray(payload)) {
        const [wsId, detail] = payload as [string, OpenAgentTabDetail];
        if (typeof wsId === "string" && detail?.agentId) {
          openAgentTab(wsId, detail);
        }
      }
    }
    return result;
  };
}
