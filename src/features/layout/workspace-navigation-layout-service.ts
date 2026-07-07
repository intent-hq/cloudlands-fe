/**
 * Workspace-navigation layout service — post-reducer handler that reifies the
 * hydrated `workspace-navigation` intent (main-panel note + drawer agent) into
 * actual `panel-layout` tabs.
 *
 * `CompactWorkspaceInitializer` and `OnboardingPage` both dispatch
 * `hydrateWorkspaceNavigation({ mainPanel: notes/spec, drawer: agent/{initialAgentId} })`
 * to record the desired workspace-page state before `goto(/workspace/{id})`. The
 * old `workspace-navigation-saga` + `app-layout-saga.watchOpenNoteSaga` /
 * `watchOpenAgentSaga` used to translate that state into `openTab(...)` /
 * `openTabInAdjacentOrSplit(...)` on the panel-layout slice, but those sagas
 * were removed with the saga runtime and only the *click*-time triggers
 * (`openAgentTabRequested`, `openWorkspaceCommitChangeset`) were re-homed as
 * middlewares. Result: after workspace creation the panel-layout mounted empty.
 *
 * This middleware re-homes the hydrate-time path WITHOUT re-adding a saga and
 * WITHOUT changing any call site: after `hydrateWorkspaceNavigation` passes
 * through the reducer, we dispatch a `panelLayout/openTab` for the main-panel
 * note and (when the drawer is open on an agent) an
 * `appLayout/openAgentTabRequested` — reusing the already-installed
 * `createAppLayoutNavigationMiddleware` for the agent-tab side so
 * session-loading and adjacent-panel semantics stay in one place.
 *
 * Tab dedup is delegated to the panel-layout reducer: `findExistingTab`
 * dedupes agent tabs across panels by `agentId` and `findDuplicateTabInPanel`
 * dedupes note tabs within a panel by `noteId`, so re-dispatching this action
 * on a workspace whose tabs are already open is a no-op focus.
 *
 * Dependency-light per `src/store` AGENTS.md: imports only the configured store,
 * slice actions/types, and other actions — no selectors (importing selectors
 * would evaluate `store.createSelector` mid store-init through the middleware
 * chain).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import {
  hydrateWorkspaceNavigation,
  type WorkspaceNavigationWorkspaceState,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import { openTab } from "$store/renderer/slices/panel-layout/panel-layout-slice";
import { openAgentTabRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import type { PanelTab } from "$store/renderer/slices/panel-layout/panel-layout-types";

/**
 * Build the human-friendly title shown for a note tab. `"spec"` renders as the
 * canonical "Spec" label matching the sidebar / notes-write-service naming;
 * everything else falls through to the raw id so the tab is at least openable.
 */
function buildNoteTabTitle(noteId: string): string {
  return noteId === "spec" ? "Spec" : noteId;
}

/**
 * Reify the hydrated `mainPanel` intent into a note tab in the main (default)
 * panel. Only `mainPanel.type === "notes"` with a `selectedNoteId` is handled
 * here — other main-panel types (file, diff, browser, etc.) were owned by the
 * removed `app-layout-saga.watch*Saga` family and are out of scope for the
 * initial-agent-conversation regression this middleware targets.
 */
function openMainPanelNoteTab(wsId: string, state: WorkspaceNavigationWorkspaceState): void {
  const mainPanel = state.mainPanel;
  if (mainPanel?.type !== "notes") return;
  const noteId = mainPanel.selectedNoteId;
  if (typeof noteId !== "string" || noteId.length === 0) return;

  const tab: Omit<PanelTab, "id"> = {
    type: "note",
    title: buildNoteTabTitle(noteId),
    noteId,
    workspaceId: wsId,
    closable: true,
  };
  appStore.dispatch(openTab(wsId, tab));
}

/**
 * Reify the hydrated `drawer` intent into an adjacent agent tab. The workspace-
 * navigation `drawer` shape is legacy (no `WorkspaceLayout.drawer` snippet
 * exists); the current UI models the "drawer" as a panel-layout tab opened in
 * the adjacent-or-split panel next to the main content.
 *
 * Routes through `openAgentTabRequested` so the sibling
 * `createAppLayoutNavigationMiddleware` handles session hydration
 * (`ensureAgentSessionLoaded`) and tab dedup/focus in one place.
 */
function openDrawerAgentTab(wsId: string, state: WorkspaceNavigationWorkspaceState): void {
  const drawer = state.drawer;
  if (!drawer?.open || drawer.type !== "agent") return;
  const agentId = drawer.itemId;
  if (typeof agentId !== "string" || agentId.length === 0) return;

  appStore.dispatch(
    openAgentTabRequested(wsId, { agentId, openInAdjacentPanel: true }),
  );
}

/**
 * Public helper for direct callers that want to apply an already-known
 * hydration state to the panel-layout without going through the dispatch cycle.
 * The middleware below invokes the same function after the reducer runs.
 */
export function applyHydratedLayout(
  wsId: string,
  state: WorkspaceNavigationWorkspaceState,
): void {
  if (!wsId || !state) return;
  openMainPanelNoteTab(wsId, state);
  openDrawerAgentTab(wsId, state);
}

/**
 * Middleware that gives `hydrateWorkspaceNavigation` a real handler: after the
 * action passes through the reducer, it opens the main-panel note tab and
 * (when applicable) the adjacent agent tab. Action payload is the
 * `[wsId, workspaceState]` tuple.
 */
export function createWorkspaceNavigationLayoutMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === hydrateWorkspaceNavigation.type) {
      const payload = (action as { payload?: unknown }).payload;
      if (Array.isArray(payload) && payload.length >= 2) {
        const [wsId, state] = payload as [
          string,
          WorkspaceNavigationWorkspaceState,
        ];
        if (typeof wsId === "string" && state) {
          applyHydratedLayout(wsId, state);
        }
      }
    }
    return result;
  };
}
