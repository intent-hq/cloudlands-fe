/**
 * Workspace-navigation layout service — post-reducer handler that reifies the
 * hydrated `workspace-navigation` intent (main-panel note + drawer agent) into
 * actual `panel-layout` tabs.
 *
 * `CompactWorkspaceInitializer` and `OnboardingPage` both dispatch
 * `hydrateWorkspaceNavigation({ mainPanel: empty, drawer: agent/{initialAgentId} })`
 * today (agent-only landing) — earlier versions also declared `mainPanel:
 * notes/spec` for a spec + agent split view, which this middleware still
 * supports for any future hydration source that opts in. The old
 * `workspace-navigation-saga` + `app-layout-saga.watchOpenNoteSaga` /
 * `watchOpenAgentSaga` used to translate that state into `openTab(...)` /
 * `openTabInAdjacentOrSplit(...)` on the panel-layout slice, but those sagas
 * were removed with the saga runtime and only the *click*-time triggers
 * (`openAgentTabRequested`, `openWorkspaceCommitChangeset`) were re-homed as
 * middlewares. Result: after workspace creation the panel-layout mounted empty.
 *
 * This middleware re-homes the hydrate-time path WITHOUT re-adding a saga and
 * WITHOUT changing any call site: after `hydrateWorkspaceNavigation` passes
 * through the reducer, we dispatch a `panelLayout/openTab` for a hydrated
 * main-panel note and (when the drawer is open on an agent) an
 * `appLayout/openAgentTabRequested` — reusing the already-installed
 * `createAppLayoutNavigationMiddleware` for the agent-tab side so
 * session-loading and adjacent-panel semantics stay in one place. The drawer
 * agent is opened in the adjacent panel only when a main-panel note is being
 * opened alongside; agent-only intents land full-width in the main panel.
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
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import {
  hydrateWorkspaceNavigation,
  type WorkspaceNavigationWorkspaceState,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import { openTab } from "$store/renderer/slices/panel-layout/panel-layout-slice";
import { openAgentTabRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import type { PanelTab } from "$store/renderer/slices/panel-layout/panel-layout-types";
import { m } from "$shared/paraglide/messages.js";

/**
 * Build the human-friendly title shown for a note tab. `"spec"` renders as the
 * canonical "Spec" label matching the sidebar / notes-write-service naming;
 * everything else falls through to the raw id so the tab is at least openable.
 */
function buildNoteTabTitle(noteId: string): string {
  return noteId === "spec" ? m.layout_shared_spec_title() : noteId;
}

/**
 * Return the `selectedNoteId` from a hydrated main-panel intent when — and
 * only when — that intent should materialize as a real note tab in the main
 * panel. Anything other than `type === "notes"` with a non-empty
 * `selectedNoteId` is treated as "no main-panel tab to open" (agent-only
 * screens use `type === "empty"`); other main-panel types (file, diff,
 * browser, etc.) were owned by the removed `app-layout-saga.watch*Saga`
 * family and are out of scope for this middleware.
 */
function hydratedMainPanelNoteId(state: WorkspaceNavigationWorkspaceState): string | null {
  const mainPanel = state.mainPanel;
  if (mainPanel?.type !== "notes") return null;
  const noteId = mainPanel.selectedNoteId;
  if (typeof noteId !== "string" || noteId.length === 0) return null;
  return noteId;
}

/**
 * Reify the hydrated `mainPanel` intent into a note tab in the main (default)
 * panel. No-op when no main-panel note is declared.
 */
function openMainPanelNoteTab(wsId: string, noteId: string): void {
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
 * Reify the hydrated `drawer` intent into an agent tab. The workspace-
 * navigation `drawer` shape is legacy (no `WorkspaceLayout.drawer` snippet
 * exists); the current UI models the "drawer" as a panel-layout tab.
 *
 * When a main-panel note is being opened alongside, we honor the classic
 * "drawer" visual by requesting the adjacent panel so the two tabs render
 * side-by-side. When the hydrated intent is agent-only (no main-panel note
 * to sit next to), the agent tab opens in the main panel at full width —
 * splitting into an empty adjacent panel would just leave an empty pane.
 *
 * Routes through `openAgentTabRequested` so the sibling
 * `createAppLayoutNavigationMiddleware` handles session hydration
 * (`ensureAgentSessionLoaded`) and tab dedup/focus in one place.
 */
function openDrawerAgentTab(
  wsId: string,
  state: WorkspaceNavigationWorkspaceState,
  hasMainPanelNote: boolean,
): void {
  const drawer = state.drawer;
  if (!drawer?.open || drawer.type !== "agent") return;
  const agentId = drawer.itemId;
  if (typeof agentId !== "string" || agentId.length === 0) return;

  appStore.dispatch(
    openAgentTabRequested(wsId, { agentId, openInAdjacentPanel: hasMainPanelNote }),
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
  const noteId = hydratedMainPanelNoteId(state);
  if (noteId !== null) openMainPanelNoteTab(wsId, noteId);
  openDrawerAgentTab(wsId, state, noteId !== null);
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
