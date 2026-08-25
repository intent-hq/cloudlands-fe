<script lang="ts">
  /**
   * OffscreenWebviewHost — keeps browser-tab webviews of background (hosted
   * but not displayed) workspaces alive offscreen, so content-level browser
   * ops (evaluate / screenshot / capture) work without the workspace being
   * displayed (monorepo#2789 slice 2). Mounted once per window in the (app)
   * layout, outside the keyed workspace surface.
   *
   * Candidates derive from the panel-layout slice (all hosted workspace
   * layouts minus the displayed ones); a cap bounds guest memory, evicting
   * by backgrounding time (see offscreen-webview-cache.ts). When a workspace
   * is displayed again its tabs leave the candidate set and the visible
   * EmbeddedBrowser re-registers the tab; when a workspace is
   * archived/deleted its layout state is cleared (workspaceUnmounted), which
   * drops its entries here and destroys the guests.
   *
   * Known limitation (multi-window): the exclusion set is per-window, so a
   * workspace displayed in another window can also mount a hidden guest
   * here, and the main-process tab registry keeps whichever registration
   * came last. Arbitrating registrations across windows (e.g. preferring
   * visible-panel guests) is left to a follow-up slice.
   */
  import { untrack } from 'svelte';
  import { BROWSER_PANEL_PARTITION, BROWSER_PROTOCOLS } from '../../../shared/constants';
  import { selectPanelLayoutWorkspaces } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { offscreenWebview } from './offscreen-webview-action';
  import {
    areOffscreenWebviewCachesEqual,
    MAX_OFFSCREEN_WEBVIEWS,
    updateOffscreenWebviewCache,
    type OffscreenWebviewCandidate,
  } from './offscreen-webview-cache';

  interface Props {
    /** Workspaces whose surfaces render normally — their tabs never mount here. */
    excludedWorkspaceIds: ReadonlySet<string>;
    maxWebviews?: number;
  }

  let { excludedWorkspaceIds, maxWebviews = MAX_OFFSCREEN_WEBVIEWS }: Props = $props();

  const layouts$ = selectPanelLayoutWorkspaces();

  function isKeepAliveUrl(url: string): boolean {
    try {
      return BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  const candidates = $derived.by(() => {
    const out: OffscreenWebviewCandidate[] = [];
    for (const [workspaceId, layout] of Object.entries($layouts$)) {
      if (!excludedWorkspaceIds.has(workspaceId)) {
        for (const panel of Object.values(layout.panels)) {
          for (const tab of panel.tabs) {
            if (tab.type !== 'browser' || !tab.browserUrl || !isKeepAliveUrl(tab.browserUrl)) {
              continue;
            }
            // Agent-owned tabs stay mounted for the agent's lifetime:
            // pinned entries are exempt from the cap (monorepo#2857).
            const pinned =
              typeof tab.ownerAgentId === 'string' && tab.ownerAgentId.length > 0
                ? { pinned: true }
                : {};
            out.push({ tabId: tab.id, workspaceId, url: tab.browserUrl, ...pinned });
          }
        }
      }
      // Hidden (user-closed) owned tabs have no visible EmbeddedBrowser even
      // in the displayed workspace, so they always mount here — pinned, kept
      // alive until agent deletion or workspace archive/delete
      // (monorepo#2857). hiddenTabs is a Collection; read its ids/map here
      // since components must not import collection-utils.
      for (const id of layout.hiddenTabs?.ids ?? []) {
        const tab = layout.hiddenTabs.map[id];
        if (!tab || tab.type !== 'browser' || !tab.browserUrl || !isKeepAliveUrl(tab.browserUrl)) {
          continue;
        }
        out.push({ tabId: tab.id, workspaceId, url: tab.browserUrl, pinned: true });
      }
    }
    return out;
  });

  let cache = $state<Map<string, number>>(new Map());
  // URL/workspace frozen when a tab enters the keep-alive set, so later
  // browserUrl updates (including our own did-navigate sync below) never
  // reload the live guest.
  const frozenByTabId = new Map<string, { url: string; workspaceId: string }>();

  $effect(() => {
    const currentCandidates = candidates;
    const currentMax = maxWebviews;
    const { currentCache, nextCache } = untrack(() => ({
      currentCache: cache,
      nextCache: updateOffscreenWebviewCache(cache, currentCandidates, Date.now(), currentMax),
    }));
    if (!areOffscreenWebviewCachesEqual(currentCache, nextCache)) {
      for (const candidate of currentCandidates) {
        if (nextCache.has(candidate.tabId) && !frozenByTabId.has(candidate.tabId)) {
          frozenByTabId.set(candidate.tabId, {
            url: candidate.url,
            workspaceId: candidate.workspaceId,
          });
        }
      }
      for (const tabId of [...frozenByTabId.keys()]) {
        if (!nextCache.has(tabId)) frozenByTabId.delete(tabId);
      }
      cache = nextCache;
    }
  });

  const entries = $derived.by(() => {
    // Live persisted URL per tab: the frozen mount URL never changes, but an
    // external browserUrl update (agent openTab replacing a hidden tab,
    // monorepo#2857) must reach the live guest via the action's update hook.
    const liveUrlByTabId = new Map(candidates.map((c) => [c.tabId, c.url]));
    return [...cache.keys()].flatMap((tabId) => {
      const frozen = frozenByTabId.get(tabId);
      return frozen ? [{ tabId, ...frozen, desiredUrl: liveUrlByTabId.get(tabId) }] : [];
    });
  });
</script>

<!--
  Kept in-viewport but visually hidden: display:none guests stop painting,
  and out-of-viewport guests (the old left:-10000px parking) get
  viewport-culled by the compositor — no BeginFrames, so CDP
  Page.captureScreenshot and webContents.capturePage() hang until the
  caller's budget kills them (monorepo#3366). A 1x1 overflow-hidden
  container at the viewport origin (opacity 0, no pointer events) keeps
  the full-size guests genuinely painting while staying invisible and
  non-interactive.
-->
<div
  class="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
  aria-hidden="true"
  data-offscreen-webview-host
>
  <div class="relative h-[800px] w-[1280px]">
    {#each entries as entry (entry.tabId)}
      <webview
        class="absolute inset-0 h-full w-full border-none"
        src={entry.url}
        partition={BROWSER_PANEL_PARTITION}
        allowpopups
        data-offscreen-webview-tab={entry.tabId}
        use:offscreenWebview={entry}
      ></webview>
    {/each}
  </div>
</div>
