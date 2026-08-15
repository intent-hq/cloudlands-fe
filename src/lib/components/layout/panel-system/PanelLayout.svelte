<script lang="ts">
  /* eslint-disable max-lines */
  import { setContext, onMount, onDestroy, tick, untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { getPanelLayoutManager, type PanelTab } from '$features/layout/panel-layout-adapter';
  import {
    getPanelMovePreview,
    getPanelMovePreviewWidthRatio,
    getPanelRootEdgeMovePreview,
  } from '$features/layout/panel-move-preview';
  import { invoke as ipcInvoke } from '$shared/generated/ipc-client';
  import {
    createPanelKeyboardShortcuts,
    registerPanelKeyboardShortcuts,
    unregisterPanelKeyboardShortcuts,
  } from '$features/layout/panel-keyboard-shortcuts.svelte';
  import {
    resolveLocalPanelCycleTarget,
    type PanelCycleBoundaryTarget,
    type PanelCycleDirection,
  } from '$features/layout/panel-cycle-navigation';
  import PanelContainer from './PanelContainer.svelte';
  import PanelCanvasFrame from './PanelCanvasFrame.svelte';
  import { getPanelCanvasWidths, getPanelViewportContentWidth } from './panel-canvas-width';
  import PanelDragPreview from './PanelDragPreview.svelte';
  import {
    EMPTY_LAYOUT_LOADING_TIMEOUT_MS,
    isLayoutSettledNow,
    shouldRenderPanelContainer as computeShouldRenderPanelContainer,
  } from './panel-render-gate';
  import HandleDropOverlay from './HandleDropOverlay.svelte';
  import { terminalManager } from '$features/terminal/terminal-manager.svelte';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { appClient } from '$lib/client';
  import { selectIsTerminalOverlayOpen } from '$store/renderer/slices/terminals/terminals-selectors';
  import { derived, get, writable } from 'svelte/store';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
  import { createLogger } from '$lib/utils/client-logger';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { dispatchWindowEvent } from '$lib/utils/window-events';

  import { resize } from '$lib/components/layout/size-transition';
  import { fade } from 'svelte/transition';
  import { flattenPanels, openTabFromConfig } from './panel-ai-layout-helpers';
  import { NoteId } from '$shared/types/branded-ids';
  import { updateNoteTitle } from '$features/notes/notes-write-service';
  import { renameWithUndo } from '$lib/utils/reversible-actions';
  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { cn } from '$lib/utils';
  import { createBrowserFocusOwnershipReporter } from './browser-focus-ownership';
  import { closePanelWithLastPanelPolicy } from './close-panel';
  import {
    clearDraggedPanelState,
    getDraggedPanelId,
    getPanelLayoutEdgePlacement,
    type PanelDragPlacement,
  } from './panel-drag';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { animatePanelPreviewPositions, capturePanelPositions } from './panel-reorder-animation';

  import {
    selectPanelLayoutRoot,
    selectExpandedPanelId,
    selectPanels,
    selectFocusedPanelId,
    selectFocusedPanel,
    selectActiveTab,
    selectAllTabs,
    selectPanelIds,
    selectPanelColumnDefaultWidthTiers,
    selectPanelCanvasWidth,
    selectPanelCanvasWidthSource,
    selectRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { focusBrowserTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
  import { renameAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    markPanelTouched,
    movePanelToRootEdge,
    panelLayoutScopeMounted,
    panelLayoutScopeUnmounted,
    resizePanelLayoutRightEdge,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    getAutomaticPanelCanvasWidth,
    getPanelDefaultWidth,
    type PanelCanvasSizing,
  } from '$shared/panel-layout-sizing';

  const logger = createLogger('PanelLayout');

  interface Props {
    workspaceId: string;
    layoutId?: string;
    active?: boolean;
    contained?: boolean;
    canvasSizing?: PanelCanvasSizing;
    hideEmptyLayout?: boolean;
    allowCloseLastPanel?: boolean;
    /** Callbacks for creating new items (passed to panel tab bars) */
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
    onPanelMovePreviewWidthRatioChange?: (ratio: number) => void;
    onPanelCanvasWidthChange?: (width: number) => void;
    onAvailableCanvasWidthChange?: (width: number) => void;
    onCyclePanelBoundary?: (direction: PanelCycleDirection) => PanelCycleBoundaryTarget | null;
  }

  let {
    workspaceId,
    layoutId,
    active = true,
    contained = false,
    canvasSizing = 'viewport',
    hideEmptyLayout = false,
    allowCloseLastPanel = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onPanelMovePreviewWidthRatioChange,
    onPanelCanvasWidthChange,
    onAvailableCanvasWidthChange,
    onCyclePanelBoundary,
  }: Props = $props();

  const effectiveLayoutId = $derived(layoutId ?? workspaceId);

  $effect(() => {
    const mountedLayoutId = effectiveLayoutId;
    appStore.dispatch(panelLayoutScopeMounted(mountedLayoutId));
    return () => appStore.dispatch(panelLayoutScopeUnmounted(mountedLayoutId));
  });

  // Reactive writable store that mirrors the layout scope so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  const layoutIdStore = writable('');
  $effect(() => {
    layoutIdStore.set(effectiveLayoutId);
  });

  // Reactive selector subscriptions for template rendering
  const root$ = selectPanelLayoutRoot(layoutIdStore);
  const expandedPanelId$ = selectExpandedPanelId(layoutIdStore);
  const panels$ = selectPanels(layoutIdStore);
  const focusedPanelId$ = selectFocusedPanelId(layoutIdStore);
  const activeTab$ = selectActiveTab(layoutIdStore);
  const allTabs$ = selectAllTabs(layoutIdStore);
  const panelColumnDefaultWidthTiers$ = selectPanelColumnDefaultWidthTiers(layoutIdStore);
  const panelDefaultWidthViewport = writable(0);
  const panelColumnDefaultWidths$ = derived(
    [panelColumnDefaultWidthTiers$, panelDefaultWidthViewport],
    ([$tiers, viewportWidth]) => $tiers.map((tier) => getPanelDefaultWidth(tier, viewportWidth)),
  );
  const panelCanvasWidth$ = selectPanelCanvasWidth(layoutIdStore);
  const panelCanvasWidthSource$ = selectPanelCanvasWidthSource(layoutIdStore);
  const restoreStatus$ = selectRestoreStatus(layoutIdStore);
  const isDragging$ = selectIsDragging();
  // Keep the root renderer on the split branch when the first adjacent panel
  // opens. The existing panel then retains its keyed component instance while
  // only the new child mounts and runs its enter transition.
  const stableContainerRoot = $derived(
    $root$.type === 'panel'
      ? {
          type: 'split' as const,
          direction: 'horizontal' as const,
          children: [$root$],
          sizes: [100],
        }
      : $root$,
  );
  let panelMovePreview = $state<
    | {
        kind: 'panel';
        draggedPanelId: string;
        targetPanelId: string;
        position: PanelDragPlacement;
      }
    | { kind: 'edge'; draggedPanelId: string; position: PanelDragPlacement }
    | null
  >(null);
  let panelLayoutMotionElement = $state.raw<HTMLDivElement | null>(null);
  let panelWorkspaceInset = $state.raw<HTMLDivElement | null>(null);
  let panelViewportWidth = $state(0);
  $effect(() => {
    panelDefaultWidthViewport.set(canvasSizing === 'viewport' ? panelViewportWidth : 0);
  });
  let panelRootReferenceSize = $state(0);
  let panelCanvasResizeDelta = $state(0);
  let panelCanvasResizeCommittedWidth = $state<number | null>(null);
  let panelOuterResizeDelta = $state(0);
  let panelOuterResizeCommittedDelta = $state(0);
  let panelOuterResizeCommittedWidth = $state<number | null>(null);
  let panelOuterResizeStartReferenceSize: number | null = null;
  const expandedAutomaticViewportWidth = $derived(
    $expandedPanelId$ !== null &&
      canvasSizing === 'viewport' &&
      $panelCanvasWidthSource$ !== 'explicit'
      ? Math.max(
          panelViewportWidth,
          $panelCanvasWidth$ ?? 0,
          getPanelCanvasWidths(
            panelViewportWidth,
            $panelColumnDefaultWidths$,
            canvasSizing,
            $panelCanvasWidth$,
            $panelCanvasWidthSource$,
          ).defaultWidth,
        )
      : null,
  );
  const panelGeometryCanvasWidth = $derived(
    (panelOuterResizeCommittedWidth ??
      panelCanvasResizeCommittedWidth ??
      expandedAutomaticViewportWidth ??
      getPanelCanvasWidths(
        panelViewportWidth,
        $panelColumnDefaultWidths$,
        canvasSizing,
        $panelCanvasWidth$,
        panelOuterResizeCommittedWidth !== null || panelCanvasResizeCommittedWidth !== null
          ? 'explicit'
          : $panelCanvasWidthSource$,
      ).defaultWidth) +
      panelCanvasResizeDelta +
      panelOuterResizeDelta,
  );
  let retainedRootPanel = $state<{ panelId: string; width: number } | null>(null);

  $effect(() => {
    const authoritativeWidth = getPanelCanvasWidths(
      panelViewportWidth,
      $panelColumnDefaultWidths$,
      canvasSizing,
      $panelCanvasWidth$,
      $panelCanvasWidthSource$,
    ).defaultWidth;
    if (panelCanvasResizeCommittedWidth === authoritativeWidth) {
      panelCanvasResizeCommittedWidth = null;
    }
    if (
      panelOuterResizeCommittedWidth !== null &&
      authoritativeWidth === panelOuterResizeCommittedWidth
    ) {
      panelOuterResizeCommittedWidth = null;
      panelOuterResizeCommittedDelta = 0;
    }
  });

  function measurePanelViewportWidth(node: HTMLElement) {
    function update() {
      const styles = getComputedStyle(node);
      panelViewportWidth = getPanelViewportContentWidth(
        node.clientWidth,
        Number.parseFloat(styles.paddingLeft) || 0,
        Number.parseFloat(styles.paddingRight) || 0,
      );
      onAvailableCanvasWidthChange?.(panelViewportWidth);
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  const retainedRootPanelWidth = $derived(
    $root$.type === 'panel' && retainedRootPanel?.panelId === $root$.panelId
      ? retainedRootPanel.width
      : null,
  );
  $effect(() => {
    if (retainedRootPanel && $root$.type !== 'panel') retainedRootPanel = null;
  });

  function handlePanelCanvasResizeStart() {
    markPristinePanelsTouched();
    panelOuterResizeCommittedWidth = null;
    panelOuterResizeCommittedDelta = 0;
    panelOuterResizeStartReferenceSize = panelRootReferenceSize > 0 ? panelRootReferenceSize : null;
  }

  function handlePanelCanvasResizeEnd(previousWidth: number, nextWidth: number) {
    const startReferenceSize = panelOuterResizeStartReferenceSize;
    panelOuterResizeStartReferenceSize = null;
    if (previousWidth === nextWidth) return;
    const gutterWidth =
      startReferenceSize !== null ? Math.max(0, previousWidth - startReferenceSize) : 0;
    const automaticWidth = getAutomaticPanelCanvasWidth($panelColumnDefaultWidths$, 'content');
    panelOuterResizeCommittedWidth = nextWidth;
    panelOuterResizeCommittedDelta = nextWidth - previousWidth;
    appStore.dispatch(
      resizePanelLayoutRightEdge(
        effectiveLayoutId,
        Math.max(1, previousWidth - gutterWidth),
        Math.max(1, nextWidth - gutterWidth),
        nextWidth,
        nextWidth === automaticWidth,
      ),
    );
    panelOuterResizeDelta = 0;
  }

  function handlePanelCanvasResizeCancel() {
    panelOuterResizeCommittedWidth = null;
    panelOuterResizeCommittedDelta = 0;
    panelOuterResizeStartReferenceSize = null;
    panelOuterResizeDelta = 0;
  }
  let panelDragPreviewElement = $state.raw<HTMLDivElement | null>(null);
  let panelPreviewStartPositions = new Map<string, DOMRect>();
  let panelPreviewAnimationVersion = 0;
  let panelMovePreviewClearFrame: number | null = null;
  let panelMoveCommitVersion = 0;
  let panelMoveCommitReleaseFrame: number | null = null;
  let suppressCommittedPanelMoveMotion = $state(false);
  const panelMovePreviewRoot = $derived(
    panelMovePreview
      ? panelMovePreview.kind === 'edge'
        ? getPanelRootEdgeMovePreview(
            $root$,
            panelMovePreview.draggedPanelId,
            panelMovePreview.position,
          )
        : getPanelMovePreview(
            $root$,
            panelMovePreview.draggedPanelId,
            panelMovePreview.targetPanelId,
            panelMovePreview.position,
          )
      : null,
  );
  const panelMovePreviewWidthRatio = $derived(
    panelMovePreviewRoot ? getPanelMovePreviewWidthRatio($root$, panelMovePreviewRoot) : 1,
  );
  let reportedPanelMovePreviewWidthRatio = 1;

  $effect(() => {
    const nextRatio = panelMovePreviewWidthRatio;
    if (nextRatio === reportedPanelMovePreviewWidthRatio) return;
    reportedPanelMovePreviewWidthRatio = nextRatio;
    onPanelMovePreviewWidthRatioChange?.(nextRatio);
  });

  function clearPanelMovePreviewNow() {
    if (panelMovePreviewClearFrame !== null) cancelAnimationFrame(panelMovePreviewClearFrame);
    panelMovePreviewClearFrame = null;
    panelMovePreview = null;
  }

  function commitPanelMoveWithoutReplay(commit: () => void) {
    if (panelMovePreviewClearFrame !== null) cancelAnimationFrame(panelMovePreviewClearFrame);
    panelMovePreviewClearFrame = null;
    if (panelMoveCommitReleaseFrame !== null) cancelAnimationFrame(panelMoveCommitReleaseFrame);
    panelMoveCommitReleaseFrame = null;
    const version = ++panelMoveCommitVersion;
    suppressCommittedPanelMoveMotion = true;
    commit();

    void tick().then(() => {
      if (version !== panelMoveCommitVersion) return;
      clearPanelMovePreviewNow();
      panelMoveCommitReleaseFrame = requestAnimationFrame(() => {
        panelMoveCommitReleaseFrame = null;
        if (version === panelMoveCommitVersion) suppressCommittedPanelMoveMotion = false;
      });
    });
  }

  function handlePanelMovePreview(
    draggedPanelId: string,
    targetPanelId: string,
    position: PanelDragPlacement | null,
  ) {
    if (panelMovePreviewClearFrame !== null) cancelAnimationFrame(panelMovePreviewClearFrame);
    panelMovePreviewClearFrame = null;
    if (!position) {
      panelMovePreviewClearFrame = requestAnimationFrame(() => {
        panelMovePreviewClearFrame = null;
        panelMovePreview = null;
      });
      return;
    }
    panelMovePreview = { kind: 'panel', draggedPanelId, targetPanelId, position };
  }

  function handleLayoutEdgeDragOver(event: DragEvent) {
    const draggedPanelId = getDraggedPanelId();
    if (!draggedPanelId || !panelLayoutMotionElement) return;
    const position = getPanelLayoutEdgePlacement(
      event.clientX,
      event.clientY,
      panelLayoutMotionElement.getBoundingClientRect(),
    );
    if (!position) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    panelMovePreview = { kind: 'edge', draggedPanelId, position };
  }

  function handleLayoutEdgeDrop(event: DragEvent) {
    const draggedPanelId = getDraggedPanelId();
    if (!draggedPanelId || !panelLayoutMotionElement) return;
    const position = getPanelLayoutEdgePlacement(
      event.clientX,
      event.clientY,
      panelLayoutMotionElement.getBoundingClientRect(),
    );
    if (!position) return;

    event.preventDefault();
    event.stopPropagation();
    commitPanelMoveWithoutReplay(() => {
      clearDraggedPanelState();
      appStore.dispatch(endDrag());
      appStore.dispatch(movePanelToRootEdge(effectiveLayoutId, draggedPanelId, position));
    });
  }

  $effect.pre(() => {
    if (!panelMovePreviewRoot || suppressCommittedPanelMoveMotion) return;
    const previewElement = untrack(() => panelDragPreviewElement);
    const motionElement = untrack(() => panelLayoutMotionElement);
    panelPreviewStartPositions = previewElement
      ? capturePanelPositions(previewElement)
      : capturePanelPositions(motionElement, '[data-panel-id]');
  });

  $effect(() => {
    if (!panelMovePreviewRoot || suppressCommittedPanelMoveMotion) return;
    const version = ++panelPreviewAnimationVersion;
    void tick().then(() => {
      const previewElement = untrack(() => panelDragPreviewElement);
      if (version === panelPreviewAnimationVersion && previewElement) {
        animatePanelPreviewPositions(previewElement, panelPreviewStartPositions);
      }
    });
  });

  $effect(() => {
    if (!$isDragging$ && !suppressCommittedPanelMoveMotion) clearPanelMovePreviewNow();
  });

  // Per-workspace "settled" latch: once the layout has been considered
  // resolved for a workspace (backend restored it, tabs appeared, or the
  // fallback loading window elapsed), keep it settled until workspaceId
  // changes. Without the latch, closing the last tab re-armed the loading
  // window and unmounted <PanelContainer> for the fallback duration, causing
  // a blank content area before the empty state reappeared.
  let settledForWorkspaceId = $state<string | null>(null);
  const isSettled = $derived(settledForWorkspaceId === effectiveLayoutId);

  $effect(() => {
    if (untrack(() => settledForWorkspaceId) === effectiveLayoutId) return;

    if (isLayoutSettledNow($restoreStatus$, $allTabs$.length)) {
      settledForWorkspaceId = effectiveLayoutId;
      return;
    }

    const currentWorkspaceId = effectiveLayoutId;
    const timeoutId = window.setTimeout(() => {
      settledForWorkspaceId = currentWorkspaceId;
    }, EMPTY_LAYOUT_LOADING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  });

  const shouldRenderPanelContainer = $derived(
    computeShouldRenderPanelContainer({
      restoreStatus: $restoreStatus$,
      totalTabs: $allTabs$.length,
      hasSettled: isSettled,
    }),
  );
  let lifecycleMotionReadyForLayoutId = $state<string | null>(null);
  const layoutMotionDuration = $derived(
    lifecycleMotionReadyForLayoutId === effectiveLayoutId && !suppressCommittedPanelMoveMotion
      ? 220
      : 0,
  );

  $effect(() => {
    const layoutId = effectiveLayoutId;
    if (!shouldRenderPanelContainer || lifecycleMotionReadyForLayoutId === layoutId) return;

    const frame = requestAnimationFrame(() => {
      if (effectiveLayoutId === layoutId) lifecycleMotionReadyForLayoutId = layoutId;
    });
    return () => cancelAnimationFrame(frame);
  });

  // Get or create the panel layout manager for this workspace (action methods only)
  let layoutManager = $derived(getPanelLayoutManager(effectiveLayoutId));

  // Create keyboard shortcuts manager and register it globally
  const keyboardShortcuts = createPanelKeyboardShortcuts(
    () => layoutManager,
    (direction) => focusCycledPanel(direction),
  );

  // Register keyboard shortcuts in cache so they can be accessed from outside
  $effect(() => {
    registerPanelKeyboardShortcuts(effectiveLayoutId, keyboardShortcuts);
    return () => {
      unregisterPanelKeyboardShortcuts(effectiveLayoutId);
    };
  });

  // Notify main process when a browser panel becomes the active/focused panel.
  // Ownership tokens let teardown clear only the browser identity it claimed.
  const browserFocusOwnership = createBrowserFocusOwnershipReporter(invoke);
  $effect(() => {
    const activeTab = $activeTab$;
    const browserIdentity =
      active && activeTab?.type === 'browser'
        ? `${effectiveLayoutId}:${$focusedPanelId$ ?? ''}:${activeTab.id}`
        : null;
    browserFocusOwnership.update(browserIdentity);
  });

  // Terminal list state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let terminals = $state<
    Array<{
      id: string;
      name: string;
      lastCommand?: string;
      lastOutput?: string;
      hasRunningProcess: boolean;
    }>
  >([]);

  // Load terminals - called explicitly when workspace changes or terminals update
  function loadTerminals(wsId: string) {
    const terminalMetadata = terminalManager.loadTerminalMetadata(wsId);
    terminals = terminalMetadata.map((t) => {
      const history = terminalHistoryTracker.getHistory(t.terminalId);
      return {
        id: t.terminalId,
        name: t.title || m.layout_panelLayout_terminal_fallback(),
        lastCommand: history?.lastCommand,
        lastOutput: history?.lastOutput,
        hasRunningProcess: history?.isExecuting || false,
      };
    });
  }

  // Track last loaded to prevent redundant loads
  // Using a non-reactive variable to avoid dependency tracking
  let lastLoadedWorkspaceId: string | null = null;

  // Effect to load terminals when workspaceId changes
  // Terminal history updates are handled via the onMount subscription
  $effect(() => {
    const wsId = workspaceId;

    // Only reload if workspace changed
    if (wsId !== lastLoadedWorkspaceId) {
      lastLoadedWorkspaceId = wsId;
      // Use untrack to prevent the terminals state update from re-triggering effects
      untrack(() => {
        loadTerminals(wsId);
      });
    }
  });

  // Subscribe to terminal history updates via onMount
  // We track the first call to skip the immediate invocation that happens on subscribe
  onMount(() => {
    let isFirstCall = true;
    const unsubscribe = terminalHistoryTracker.updateCounter.subscribe(() => {
      // Skip the first call (immediate invocation on subscribe)
      // as we already load terminals in the $effect
      if (isFirstCall) {
        isFirstCall = false;
        return;
      }
      // Reload terminals when history updates
      loadTerminals(workspaceId);
    });
    return unsubscribe;
  });

  // Handler to create a new terminal via the daemon (`terminal.create`,
  // PROTOCOL §5.13). The daemon assigns the terminalId; we surface it as
  // `MutationResult.id` from the live client.
  async function handleCreateTerminal() {
    try {
      const result = await appClient.terminals.create({
        workspaceId,
        cols: 80,
        rows: 24,
      });

      if (result.success && result.id) {
        logger.info('Created new terminal', { terminalId: result.id });

        // Clear any stale Redux entry for this id before saving fresh metadata.
        // `saveTerminalMetadata` spreads the existing entry to preserve
        // customName across remounts, but for a freshly daemon-assigned id
        // (e.g. after a daemon restart that resets the id counter) a stale
        // customName from a previously renamed terminal must not carry over.
        appStore.dispatch(removeTerminal(workspaceId, result.id));

        // Save terminal metadata without a hardcoded title — the reducer keeps
        // any daemon-provided name and only falls back to 'Terminal'.
        terminalManager.saveTerminalMetadata(result.id, workspaceId);

        // Reload terminals to include the new one
        loadTerminals(workspaceId);

        // Open the new terminal as a tab in the panel layout
        layoutManager.openTab({
          type: 'terminal',
          title: m.layout_panelLayout_terminal_fallback(),
          terminalId: result.id,
          closable: true,
        });
      } else if (!result.success) {
        logger.error('Failed to create terminal', { error: result.error });
      }
    } catch (error) {
      logger.error('Failed to create terminal', error);
    }
  }

  // Handler to open a new browser tab. The embedded browser panel needs the
  // Electron <webview> + CDP bridge, so the handler is only offered when the
  // capability exists — child components hide their "New Browser" entry points
  // when onOpenBrowser is undefined.
  const canOpenBrowserPanel = hasCapability('browserPanel');
  function handleOpenBrowser() {
    layoutManager.openBrowserPanel('about:blank');
  }

  // Provide a getter function to child components via context
  // This ensures they always get the current manager even if workspaceId changes
  setContext('panelLayoutManager', () => layoutManager);

  // Event handlers
  function markPristinePanelsTouched() {
    for (const panel of Object.values($panels$)) {
      if (panel.pristine) appStore.dispatch(markPanelTouched(effectiveLayoutId, panel.id));
    }
  }

  function handleFocusPanel(panelId: string) {
    layoutManager.focusPanel(panelId);
  }

  function handleTabClick(panelId: string, tabId: string) {
    layoutManager.focusPanel(panelId);
    layoutManager.setActiveTab(tabId, panelId);
  }

  function handleTabClose(panelId: string, tabId: string) {
    // Closing a panel's final tab removes the panel itself (closePanelHelper
    // runs inside the closeTab reducer), so it collapses the split exactly
    // like a panel close and needs the same motion suppression to avoid the
    // surviving-sibling overflow flicker during the exit outro.
    const panel = $panels$[panelId];
    const collapsesPanel =
      panel?.tabs.length === 1 &&
      panel.tabs[0].id === tabId &&
      Object.keys($panels$).length > 1;
    if (collapsesPanel) {
      commitPanelMoveWithoutReplay(() => layoutManager.closeTab(tabId, panelId));
    } else {
      layoutManager.closeTab(tabId, panelId);
    }
  }

  function handleTabReorder(panelId: string, fromIndex: number, toIndex: number) {
    layoutManager.reorderTabs(panelId, fromIndex, toIndex);
  }

  function handleCloseOtherTabs(panelId: string, tabId: string) {
    layoutManager.closeOtherTabs(tabId, panelId);
  }

  function handleCloseTabsToRight(panelId: string, tabId: string) {
    layoutManager.closeTabsToRight(tabId, panelId);
  }

  function handleCloseAllTabs(panelId: string) {
    layoutManager.closeAllTabs(panelId);
  }

  function handleCloseAllOthersEverywhere(panelId: string, tabId: string) {
    if (panelLayoutMotionElement) {
      const panelElement = Array.from(
        panelLayoutMotionElement.querySelectorAll<HTMLElement>('[data-panel-id]'),
      ).find((element) => element.dataset.panelId === panelId);
      const width = panelElement?.getBoundingClientRect().width ?? 0;
      retainedRootPanel = width > 0 ? { panelId, width } : null;
    }
    layoutManager.closeAllOthersEverywhere(tabId, panelId);
  }

  function handleSplitPanel(panelId: string, direction: 'horizontal' | 'vertical') {
    retainedRootPanel = null;
    layoutManager.splitPanel(panelId, direction);
  }

  function handleClosePanel(panelId: string) {
    // Commit the close without layout motion: during the removed wrapper's
    // exit outro the surviving siblings already carry their new (larger)
    // pixel flex bases, so the combined width overflows the canvas for the
    // exit duration and visibly shifts/clips the survivors. Suppressing the
    // replay applies the collapse in a single frame.
    commitPanelMoveWithoutReplay(() => {
      closePanelWithLastPanelPolicy(layoutManager, panelId, allowCloseLastPanel);
    });
  }

  function handleZoomToggle(_panelId: string) {
    keyboardShortcuts.executeAction('zoom-toggle');
  }

  function handleUpdateSizes(nodePath: number[], sizes: number[]) {
    markPristinePanelsTouched();
    // nodePath represents the path to the split node whose sizes are being updated
    // Empty path means root
    layoutManager.updateSizes(nodePath, sizes);
  }

  function handleGrowCanvasAtHorizontalPanel(
    previousWidth: number,
    nextWidth: number,
    panelIndex: number,
    nextCanvasWidth: number,
  ) {
    markPristinePanelsTouched();
    // Pin the accepted outer pixels before removing the preview delta. Redux then
    // replaces this handoff value with the same authoritative width after Svelte
    // reconciles, so pointer-up cannot expose the old canvas for one frame.
    panelCanvasResizeCommittedWidth = nextCanvasWidth;
    handlePanelCanvasResizePreview(0);
    layoutManager.growCanvasAtHorizontalPanel(
      previousWidth,
      nextWidth,
      panelIndex,
      nextCanvasWidth,
    );
  }

  function handlePanelCanvasResizePreview(delta: number) {
    panelCanvasResizeDelta = delta;
  }

  function handlePanelCanvasWidthChange(width: number) {
    onPanelCanvasWidthChange?.(width);
  }

  function handlePanelOuterResizePreview(delta: number) {
    panelOuterResizeDelta = delta;
  }

  function handleTabDropToSplit(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    zone: 'top' | 'bottom' | 'left' | 'right' | 'center',
  ) {
    if (zone === 'center') {
      // Move to panel, not split
      layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId);
    } else {
      layoutManager.moveTabToSplit(tabId, fromPanelId, targetPanelId, zone);
    }
  }

  function handleTabMoveToPanel(
    targetPanelId: string,
    tabId: string,
    fromPanelId: string,
    insertIndex?: number,
  ) {
    layoutManager.moveTabToPanel(tabId, fromPanelId, targetPanelId, insertIndex);
  }

  function handleTabDropToSplitHandle(
    tabId: string,
    fromPanelId: string,
    nodePath: number[],
    position: 'before' | 'after',
    direction: 'horizontal' | 'vertical',
  ) {
    layoutManager.moveTabToSplitLevel(tabId, fromPanelId, nodePath, position, direction);
  }

  function handlePanelMove(
    draggedPanelId: string,
    targetPanelId: string,
    position: 'before' | 'after' | 'above' | 'below',
  ) {
    commitPanelMoveWithoutReplay(() => {
      layoutManager.movePanel(draggedPanelId, targetPanelId, position);
    });
  }

  /**
   * Handle renaming a tab (note, agent, or file).
   * Shows a toast with undo support.
   */
  async function handleTabRename(tab: PanelTab, newName: string) {
    const oldName = tab.title || m.layout_panelLayout_untitled_fallback();

    if (tab.type === 'note' && tab.noteId) {
      // Rename note
      const noteId = NoteId(tab.noteId);
      await renameWithUndo(
        'note',
        oldName,
        newName,
        () => {
          void updateNoteTitle(workspaceId, noteId, newName);
          // Update the tab title in the layout manager
          layoutManager.updateTabTitle(tab.id, newName);
        },
        () => {
          void updateNoteTitle(workspaceId, noteId, oldName);
          layoutManager.updateTabTitle(tab.id, oldName);
        },
      );
    } else if (tab.type === 'agent' && tab.agentId) {
      // Rename agent
      const agentId = tab.agentId;
      // Capture the pre-rename nameExplicitlySet flag so revert paths can
      // restore the exact disk state. Auto-named sessions have
      // nameExplicitlySet: false; hardcoding true here would diverge Redux
      // from disk and permanently block MCP/automatic naming on failure.
      const preRenameSession = selectAgentSession.select(appStore.state, agentId);
      const oldNameExplicitlySet = preRenameSession?.nameExplicitlySet ?? false;
      await renameWithUndo(
        'agent',
        oldName,
        newName,
        async () => {
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: newName,
              nameExplicitlySet: true,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, newName);
          // Persist the rename via the mutation middleware (`agent.rename`,
          // PROTOCOL §5.5) so other windows pick it up immediately.
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, newName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert optimistic UI so tab title and Redux match disk, then
            // rethrow so ReversibleActionManager surfaces the error toast
            // and skips the undo toast.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: oldName,
                nameExplicitlySet: oldNameExplicitlySet,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, oldName);
            throw err;
          }
        },
        async () => {
          // Undo: restore old name with the captured nameExplicitlySet so
          // Redux matches what disk held before the rename.
          appStore.dispatch(
            updateAgentSessionFields(agentId, {
              name: oldName,
              nameExplicitlySet: oldNameExplicitlySet,
            } as any),
          );
          layoutManager.updateTabTitle(tab.id, oldName);
          try {
            const action = renameAgentSessionRequested(workspaceId, agentId, oldName);
            appStore.dispatch(action);
            await action.promise;
          } catch (err) {
            // Revert the revert: undo failed, so restore the new name in the UI
            // and rethrow so the user sees the error.
            appStore.dispatch(
              updateAgentSessionFields(agentId, {
                name: newName,
                nameExplicitlySet: true,
              } as any),
            );
            layoutManager.updateTabTitle(tab.id, newName);
            throw err;
          }
        },
      );
    }
    // Note: File renaming is more complex (involves filesystem) - skipping for now
  }

  /**
   * Dispatch an event to focus the content of a panel.
   * Content components (ChatPanel, NoteWithComments) listen for this event
   * and focus their main input element accordingly.
   * For other tab types, blur any currently focused element.
   */
  function dispatchFocusPanelContent(
    panelId: string,
    targetLayoutManager = layoutManager,
    targetWorkspaceId = workspaceId,
  ) {
    const panel = targetLayoutManager.getPanel(panelId);
    if (!panel || !panel.activeTabId) {
      // No active tab, blur any currently focused element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (!activeTab) return;

    // Types that have focusable content that should receive focus
    const focusableTypes = ['agent', 'note', 'file'];

    // Use a delay to ensure panel switch animation/rendering is complete
    // and any click event processing from the source panel has finished
    setTimeout(() => {
      if (focusableTypes.includes(activeTab.type)) {
        // Dispatch event with panel and tab info - content components will handle focus
        dispatchWindowEvent('panel:focus-content', {
          panelId,
          tabId: activeTab.id,
          tabType: activeTab.type,
          agentId: activeTab.agentId,
          noteId: activeTab.noteId,
          workspaceId: targetWorkspaceId,
        });
      } else {
        // For other tab types (terminal, file, diff, browser, etc.),
        // blur any currently focused element to defocus from previous content
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }, 100);
  }

  function focusCycledPanel(direction: PanelCycleDirection): boolean {
    const panelIds = selectPanelIds.select(appStore.state, effectiveLayoutId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, effectiveLayoutId);
    const localTargetId = resolveLocalPanelCycleTarget(panelIds, focusedPanelId, direction);
    if (localTargetId) {
      appStore.dispatch(markPanelTouched(effectiveLayoutId, localTargetId));
      layoutManager.focusPanel(localTargetId);
      dispatchFocusPanelContent(localTargetId);
      return true;
    }

    const boundaryTarget = onCyclePanelBoundary?.(direction);
    if (boundaryTarget) {
      const targetPanelIds = selectPanelIds.select(appStore.state, boundaryTarget.layoutId);
      const targetPanelId =
        direction === 'next' ? targetPanelIds[0] : targetPanelIds[targetPanelIds.length - 1];
      if (targetPanelId) {
        appStore.dispatch(markPanelTouched(boundaryTarget.layoutId, targetPanelId));
        const targetLayoutManager = getPanelLayoutManager(boundaryTarget.layoutId);
        targetLayoutManager.focusPanel(targetPanelId);
        dispatchFocusPanelContent(targetPanelId, targetLayoutManager, boundaryTarget.workspaceId);
        return true;
      }
    }

    const wrappedPanelId = direction === 'next' ? panelIds[0] : panelIds[panelIds.length - 1];
    if (!wrappedPanelId || (panelIds.length === 1 && wrappedPanelId === focusedPanelId))
      return false;
    appStore.dispatch(markPanelTouched(effectiveLayoutId, wrappedPanelId));
    layoutManager.focusPanel(wrappedPanelId);
    dispatchFocusPanelContent(wrappedPanelId);
    return true;
  }

  const terminalOverlayOpen = selectIsTerminalOverlayOpen();

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if (!active) return;
    // First, let the leader key system handle it
    if (keyboardShortcuts.handleKeyDown(e)) {
      return;
    }

    // On Mac, "Mod" is Cmd (metaKey) only — Ctrl is reserved for Emacs bindings and other uses.
    // On Win/Linux, "Mod" is Ctrl.
    const isMod = isMac ? e.metaKey : e.ctrlKey;

    // Note: Mod+/ for keyboard shortcuts cheat sheet is handled globally in +layout.svelte
    // Do NOT add a handler here or it will toggle twice (once per handler)

    // Mod+\ - Split horizontally
    if (isMod && e.key === '\\' && !e.shiftKey) {
      e.preventDefault();
      const focusedId = selectFocusedPanelId.select(appStore.state, effectiveLayoutId);
      if (focusedId) {
        handleSplitPanel(focusedId, 'horizontal');
      }
      return;
    }

    // Mod+Shift+\ also inserts into the horizontal stack.
    if (isMod && e.key === '\\' && e.shiftKey) {
      e.preventDefault();
      const focusedId = selectFocusedPanelId.select(appStore.state, effectiveLayoutId);
      if (focusedId) {
        handleSplitPanel(focusedId, 'horizontal');
      }
      return;
    }

    // Mod+Shift+M - Toggle zoom on focused panel
    if (isMod && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      e.stopPropagation();
      keyboardShortcuts.executeAction('zoom-toggle');
      return;
    }

    // Mod+Shift+Enter - Toggle zoom on focused panel (alternative)
    if (isMod && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      keyboardShortcuts.executeAction('zoom-toggle');
      return;
    }

    // Cmd+PageDown - Next tab in focused panel
    // Cmd+PageUp - Previous tab in focused panel
    if (e.metaKey && !e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
      const panel = selectFocusedPanel.select(appStore.state, effectiveLayoutId);
      if (panel && panel.tabs.length > 1) {
        e.preventDefault();
        const currentIndex = panel.tabs.findIndex((t) => t.id === panel.activeTabId);
        let newIndex: number;
        if (e.key === 'PageUp') {
          // Previous tab
          newIndex = currentIndex <= 0 ? panel.tabs.length - 1 : currentIndex - 1;
        } else {
          // Next tab
          newIndex = currentIndex >= panel.tabs.length - 1 ? 0 : currentIndex + 1;
        }
        layoutManager.setActiveTab(panel.tabs[newIndex].id, panel.id);
      }
      return;
    }

    // Mod+Shift+] (or }) or Cmd+Shift+PageDown - Next panel
    // Mod+Shift+[ (or {) or Cmd+Shift+PageUp - Previous panel
    // Note: Shift+] produces } and Shift+[ produces { on US keyboards, so we check for both
    //
    // IMPORTANT: These shortcuts are context-aware based on which section has focus:
    // - If terminal is open AND focused: Let terminal handle tab cycling (don't handle here)
    // - Otherwise: Cycle through panels
    if (
      isMod &&
      e.shiftKey &&
      (e.key === ']' ||
        e.key === '}' ||
        e.key === '[' ||
        e.key === '{' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp')
    ) {
      // Check if terminal is open and has focus - let terminal handle its own tab cycling
      const terminalIsOpen = get(terminalOverlayOpen);
      const terminalHasFocus = isFocusInTerminal(e.target as HTMLElement);

      if (terminalIsOpen && terminalHasFocus) {
        // Terminal is focused - don't handle here, let QuakeTerminalOverlay handle it
        return;
      }

      const direction = e.key === ']' || e.key === '}' || e.key === 'PageDown' ? 'next' : 'prev';
      if (focusCycledPanel(direction)) e.preventDefault();
      return;
    }
  }

  // Use capture phase for panel-specific shortcuts.
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown, true);

    // Listen for terminal creation events
    const handleTerminalCreated = (event: any) => {
      const { workspaceId: eventWorkspaceId } = event;
      if (eventWorkspaceId === workspaceId) {
        // Reload terminals to include the new one
        loadTerminals(workspaceId);
      }
    };

    // Listen for layout:configure-panels events from AI-generated layouts
    const handleConfigurePanels = async (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent)?.detail;
      const panels = detail?.panels as Array<{
        tabs: Array<{
          type: string;
          agentId?: string;
          agentName?: string;
          noteId?: string;
          noteTitle?: string;
          filePath?: string;
          browserUrl?: string;
          createNew?: boolean;
          newAgentName?: string;
          title?: string;
        }>;
        activeTabIndex?: number;
      }>;

      if (!panels || !layoutManager) {
        logger.warn('Invalid configure-panels event', { detail });
        return;
      }

      const flatPanels = flattenPanels(panels);
      logger.info('Configuring panels from AI layout', {
        originalPanelCount: panels.length,
        flatPanelCount: flatPanels.length,
        flatPanels,
      });

      // Batch all changes into a single history entry
      await layoutManager.batchMutations(async () => {
        // Create the right number of panels using createGridLayout
        // This ensures we have exactly the number of panels needed
        const panelCount = Math.max(1, Math.min(flatPanels.length, 6)); // Cap at 6 panels
        const panelIds = layoutManager.createGridLayout(panelCount);
        logger.info('Created grid layout for AI panels', {
          panelIds,
          panelCount,
          flatPanelCount: flatPanels.length,
        });

        // Open tabs in each panel (createGridLayout already created fresh empty panels)
        for (
          let panelIndex = 0;
          panelIndex < flatPanels.length && panelIndex < panelIds.length;
          panelIndex++
        ) {
          const panelConfig = flatPanels[panelIndex];
          const panelId = panelIds[panelIndex];

          const tabs = panelConfig.tabs;
          logger.info('Processing panel tabs', {
            panelIndex,
            panelId,
            tabCount: tabs.length,
            tabs,
          });
          for (const tab of tabs) {
            await openTabFromConfig(tab, panelId, panelIndex, {
              layoutManager,
              workspaceId,
              logger,
            });
          }
        }
      });
    };

    document.addEventListener('layout:configure-panels', handleConfigurePanels);

    // Use listenSync for proper cleanup without race conditions
    const unsubTerminalCreated = listenSync('terminal:created', (event: any) => {
      handleTerminalCreated(event.payload || event);
    });

    // Listen for browser tab focus requests from main process (CDP agent).
    // Translate the IPC payload into a Redux action handled by the app-layout saga.
    const unsubBrowserFocus = listenSync('browser:focus-tab', (event: any) => {
      if (!active) return;
      const tabId = event?.payload?.tabId;
      if (!tabId) {
        logger.warn('browser:focus-tab received without tabId', { event });
        return;
      }
      appStore.dispatch(focusBrowserTabRequested(workspaceId, tabId));
    });

    // Listen for browser tab list requests from main process
    const unsubBrowserListTabs = listenSync('browser:list-tabs-request', (event: any) => {
      if (!active) return;
      // Echo the requestId back so the main process resolves the matching
      // pending request (concurrent requests must not consume each other's
      // replies).
      const requestId = event?.payload?.requestId;
      // Collect all browser tabs from the panel layout
      const browserTabs = selectAllTabs
        .select(appStore.state, effectiveLayoutId)
        .filter((t) => t.type === 'browser')
        .map((t) => ({
          tabId: t.id,
          url: t.browserUrl || '',
          title: t.title || m.layout_panelLayout_browser_fallback(),
          closable: t.closable !== false,
        }));

      logger.debug('Responding to browser:list-tabs-request', {
        count: browserTabs.length,
        requestId,
      });

      // Send the list back to main process
      if (canOpenBrowserPanel) {
        void ipcInvoke('browser:list-tabs-response', { tabs: browserTabs, requestId });
      }
    });

    return () => {
      document.removeEventListener('layout:configure-panels', handleConfigurePanels);
      unsubTerminalCreated();
      unsubBrowserFocus();
      unsubBrowserListTabs();
    };
  });

  onDestroy(() => {
    panelMoveCommitVersion += 1;
    if (panelMoveCommitReleaseFrame !== null) cancelAnimationFrame(panelMoveCommitReleaseFrame);
    clearPanelMovePreviewNow();
    if (reportedPanelMovePreviewWidthRatio !== 1) onPanelMovePreviewWidthRatioChange?.(1);
    browserFocusOwnership.destroy();
    window.removeEventListener('keydown', handleKeyDown, true);
    keyboardShortcuts.cleanup();
  });
</script>

{#snippet panelCanvas()}
  {#if shouldRenderPanelContainer && (!hideEmptyLayout || $allTabs$.length > 0)}
    <div
      bind:this={panelLayoutMotionElement}
      class="relative h-full w-full min-w-0"
      data-panel-layout-motion
      ondragovercapture={handleLayoutEdgeDragOver}
      ondropcapture={handleLayoutEdgeDrop}
      transition:resize={{ axis: 'x', duration: layoutMotionDuration }}
    >
      <div class:opacity-0={panelMovePreviewRoot !== null} class="h-full w-full min-w-0">
        <PanelContainer
          node={stableContainerRoot}
          panels={$panels$}
          focusedPanelId={active ? $focusedPanelId$ : null}
          zoomedPanelId={keyboardShortcuts.zoomedPanelId}
          dominantPanelId={$expandedPanelId$}
          {workspaceId}
          layoutId={effectiveLayoutId}
          {contained}
          suppressLayoutMotion={suppressCommittedPanelMoveMotion}
          {retainedRootPanelWidth}
          rootPanelReferenceSize={panelGeometryCanvasWidth > 0 ? panelGeometryCanvasWidth : null}
          rootCanvasResizeDelta={panelOuterResizeDelta + panelOuterResizeCommittedDelta}
          onFocusPanel={handleFocusPanel}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={handleTabReorder}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseAllOthersEverywhere={handleCloseAllOthersEverywhere}
          onSplitPanel={handleSplitPanel}
          onClosePanel={handleClosePanel}
          onZoomToggle={handleZoomToggle}
          onUpdateSizes={handleUpdateSizes}
          onRootReferenceSizeChange={(width) => (panelRootReferenceSize = width)}
          onCanvasResizePreview={handlePanelCanvasResizePreview}
          onGrowCanvasAtHorizontalPanel={handleGrowCanvasAtHorizontalPanel}
          onTabDropToSplit={handleTabDropToSplit}
          onTabMoveToPanel={handleTabMoveToPanel}
          onPanelMove={handlePanelMove}
          onPanelMovePreview={handlePanelMovePreview}
          onTabDropToSplitHandle={handleTabDropToSplitHandle}
          onTabRename={handleTabRename}
          {onCreateAgent}
          {onCreateAgentWithSpecialist}
          {onCreateNote}
          onCreateTerminal={handleCreateTerminal}
          onOpenBrowser={canOpenBrowserPanel ? handleOpenBrowser : undefined}
        />
      </div>
      {#if panelMovePreviewRoot}
        <div
          bind:this={panelDragPreviewElement}
          class="pointer-events-none absolute inset-y-0 left-0 z-40"
          style:width={`${
            (contained && !onPanelMovePreviewWidthRatioChange ? panelMovePreviewWidthRatio : 1) *
            100
          }%`}
          data-panel-layout-drag-preview={panelMovePreview?.position}
          data-panel-layout-edge-preview={panelMovePreview?.kind === 'edge'
            ? panelMovePreview.position
            : undefined}
          aria-hidden="true"
        >
          <PanelDragPreview
            node={panelMovePreviewRoot}
            draggedPanelId={panelMovePreview?.draggedPanelId ?? ''}
            {contained}
          />
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="panel-layout h-full w-full flex flex-col" aria-label={m.layout_panelLayout_ariaLabel()}>
  <!-- Main panel area -->
  <div
    bind:this={panelWorkspaceInset}
    use:measurePanelViewportWidth
    class={cn(
      'flex-1 min-h-0 overflow-y-hidden scrollbar-none',
      contained ? 'overflow-hidden py-2 px-2' : 'overflow-x-auto py-2 pr-2 sm:py-3 sm:pr-3',
    )}
    data-testid="panel-workspace-inset"
    use:scrollFade={{ axis: 'x', fadeSize: contained ? 0 : 24 }}
  >
    <!-- Content-sized wrapper so the container's right padding is preserved
         at the end of the horizontal scroll range (padding after a w-full
         child is otherwise swallowed by descendant overflow). -->
    <div class={contained ? 'h-full w-full min-w-0' : 'h-full w-max min-w-full'}>
      {#key effectiveLayoutId}
        <PanelCanvasFrame
          sizing={canvasSizing}
          viewportWidth={panelViewportWidth}
          panelColumnWidths={$panelColumnDefaultWidths$}
          canvasWidth={panelOuterResizeCommittedWidth ??
            panelCanvasResizeCommittedWidth ??
            expandedAutomaticViewportWidth ??
            $panelCanvasWidth$}
          canvasWidthSource={panelOuterResizeCommittedWidth !== null ||
          panelCanvasResizeCommittedWidth !== null ||
          expandedAutomaticViewportWidth !== null
            ? 'explicit'
            : $panelCanvasWidthSource$}
          transientWidthDelta={panelCanvasResizeDelta}
          scrollContainer={panelWorkspaceInset}
          onWidthChange={handlePanelCanvasWidthChange}
          onResizeStart={handlePanelCanvasResizeStart}
          onResizePreview={handlePanelOuterResizePreview}
          onResizeEnd={handlePanelCanvasResizeEnd}
          onResizeCancel={handlePanelCanvasResizeCancel}
        >
          {@render panelCanvas()}
        </PanelCanvasFrame>
      {/key}
    </div>
  </div>
</div>
<!-- Leader key indicator -->
{#if active && keyboardShortcuts.leaderActive}
  <div
    class="fixed bottom-20 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-lg shadow-lg px-4 py-2 z-50"
    transition:fade={{ duration: 100 }}
  >
    <div class="text-sm font-medium text-foreground">
      {#if keyboardShortcuts.showPanelNumbers}
        <span class="text-primary">{m.layout_panelLayout_pressKeys_before()}</span>
        {m.layout_panelLayout_jumpToPanel_after()}
      {:else}
        <span class="text-primary">⌘K</span>
        {m.layout_panelLayout_leaderActivated_label()}
        <span class="text-subtle ml-2"> {m.layout_panelLayout_leaderHints_label()} </span>
      {/if}
    </div>
  </div>
{/if}
<!-- Global overlay for split handle drop zones (renders outside overflow:hidden containers) -->
{#if active}
  <HandleDropOverlay />
{/if}

<style>
  .panel-layout {
    display: flex;
    flex-direction: column;
  }
</style>
