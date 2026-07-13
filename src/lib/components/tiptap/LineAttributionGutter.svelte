<!--
  Line Attribution Gutter - PoC

  Displays vertical indicators on the left side of blocks that were recently edited.
  Uses fake data for testing the visual concept.

  Architecture:
  - Receives editor instance as prop
  - Maps line attributions to block positions using line-to-block-mapper
  - Positions indicators absolutely based on block DOM positions
  - Updates on scroll and resize
-->
<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import type { Editor } from '@tiptap/core';
  import {
  mapLineAttributionsToBlocks,
  type LineAttributions,
  type AttributionInfo,
  type LineAuthor,
} from './line-to-block-mapper';
  import {
  resolveBlockPosition,
  resolveCodeBlockLinePositions,
} from './block-position-resolver';
  import { getAttributionOpacity } from './attribution-color-scale';
  import {
    coalesceAttributionSpans,
    type CoalescedSpan,
    type IndicatorEntry,
  } from './attribution-span-coalescer';
  import { listenSync } from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import type { WorkspaceId, NoteId } from '$shared/types';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    editor: Editor;
    workspaceId: WorkspaceId;
    noteId: NoteId;
    markdown: string; // The markdown content of the note
  }

  let { editor, workspaceId, noteId, markdown }: Props = $props();

  // Line attribution data loaded from disk
  let lineAttributions: LineAttributions = $state(new Map());

  interface SpanIndicator extends CoalescedSpan {
    opacity: number;
    tooltip: string;
    ariaLabel: string;
    isFirstOfLatestVersion: boolean;
    labelTop: number; // Clamped position for label/avatar
  }

  let spans: SpanIndicator[] = $state([]);
  let updateTimeout: number | null = null;
  let timestampUpdateInterval: number | null = null;

  /**
   * Tunable parameter for absolute recency window (in minutes)
   * Edits within this window get a brightness boost
   */
  const ABSOLUTE_RECENCY_WINDOW_MINUTES = 10;

  /**
   * Format timestamp for tooltip
   */
  function formatTimestamp(timestamp: number): string {
    const ageMs = Date.now() - timestamp;
    const ageMinutes = Math.floor(ageMs / (1000 * 60));
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    if (ageMinutes < 1) {
      return 'Just now';
    } else if (ageMinutes < 60) {
      return `${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago`;
    } else {
      return `${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
    }
  }

  /**
   * Handle click on span indicator
   * For agent-authored spans, navigate to the agent's chat
   */
  function handleSpanClick(event: MouseEvent | KeyboardEvent, span: SpanIndicator) {
    if (span.author?.type === 'agent' && span.author.id) {
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
          agentId: span.author.id,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }

  /**
   * Handle keyboard events on span indicator (for accessibility)
   */
  function handleSpanKeydown(event: KeyboardEvent, span: SpanIndicator) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSpanClick(event, span);
    }
  }

  /**
   * Load line attribution data via the daemon (PROTOCOL §5.2.1
   * `note.lineAttribution.load`). Returns the bare `LineAttributionData |
   * null` payload; a `null` result means the daemon has not computed
   * attributions yet, in which case the gutter renders empty.
   */
  async function loadAttributions() {
    try {
      const data = await appClient.notes.lineAttribution.load(workspaceId, noteId);

      if (data) {
        // Convert from Record<lineNumber, AttributionInfo> to Map<number, AttributionInfo>
        const map = new Map<number, AttributionInfo>();
        for (const [lineNum, attrInfo] of Object.entries(data.attributions)) {
          map.set(Number(lineNum), attrInfo as AttributionInfo);
        }
        lineAttributions = map;

        // Update indicators after loading data
        updateIndicators();
      } else {
        logger.debug('[LineAttributionGutter] No attribution data found');
      }
    } catch (error) {
      logger.debug('[LineAttributionGutter] Failed to load attributions', { error });
    }
  }

  /**
   * Update indicator positions based on current block positions
   */
  function getEditorDom(): HTMLElement | null {
    // Check if editor is available and not destroyed
    if (!editor || editor.isDestroyed) return null;

    // Check if editor is editable - this is a safer check that doesn't throw
    // If the editor isn't editable yet, the view likely isn't mounted
    if (!editor.isEditable) return null;

    try {
      // Accessing editor.view can throw if the editor is not fully mounted
      const view = editor.view;
      if (!view) return null;
      return view.dom;
    } catch (error) {
      // This can happen when the editor is being initialized or destroyed
      logger.debug('[LineAttributionGutter] Editor view not available', { error });
      return null;
    }
  }

  function updateIndicators() {
    // Check editor and view are available (view might not be mounted yet)
    const editorDom = getEditorDom();
    if (!editor || !editorDom || lineAttributions.size === 0 || !markdown) return;

    logger.debug('[LineAttributionGutter] Updating indicators...');
    // Map line attributions to block positions using the markdown content
    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Calculate oldest and newest timestamps for color scaling
    let oldestTimestamp = Infinity;
    let newestTimestamp = -Infinity;

    for (const attrValue of blockAttributions.values()) {
      if (typeof attrValue === 'object' && 'type' in attrValue && attrValue.type === 'codeBlock') {
        // For code blocks, check all line attributions
        for (const lineAttr of attrValue.lines) {
          oldestTimestamp = Math.min(oldestTimestamp, lineAttr.attribution.timestamp);
          newestTimestamp = Math.max(newestTimestamp, lineAttr.attribution.timestamp);
        }
      } else {
        // Regular block attribution (AttributionInfo)
        const attrInfo = attrValue as AttributionInfo;
        oldestTimestamp = Math.min(oldestTimestamp, attrInfo.timestamp);
        newestTimestamp = Math.max(newestTimestamp, attrInfo.timestamp);
      }
    }

    const now = Date.now();
    const oldestAgeMinutes = Math.floor((now - oldestTimestamp) / (60 * 1000));
    const newestAgeMinutes = Math.floor((now - newestTimestamp) / (60 * 1000));
    const rangeMinutes = Math.floor((newestTimestamp - oldestTimestamp) / (60 * 1000));

    logger.debug(
      `[LineAttributionGutter] Color scale range: oldest=${oldestAgeMinutes}min ago, newest=${newestAgeMinutes}min ago, range=${rangeMinutes}min`,
    );

    // Build positioned entries for coalescing
    const entries: IndicatorEntry[] = [];

    // For each attributed block, find its DOM element and get position
    for (const [position, attrValue] of blockAttributions.entries()) {
      // Check if this is a code block with per-line attributions
      if (typeof attrValue === 'object' && 'type' in attrValue && attrValue.type === 'codeBlock') {
        // Handle code block with per-line attributions
        const linePositions = resolveCodeBlockLinePositions(editor, position);

        if (linePositions.length > 0) {
          // Create an entry for each line in the code block
          for (const lineAttr of attrValue.lines) {
            const linePos = linePositions[lineAttr.lineIndex];
            if (!linePos) continue;

            const attrInfo = lineAttr.attribution;

            entries.push({
              position: position + lineAttr.lineIndex, // Unique position for each line
              timestamp: attrInfo.timestamp,
              author: attrInfo.author,
              top: linePos.top,
              height: linePos.height,
            });
          }
        }
      } else {
        // Handle regular block attribution
        const attrInfo = attrValue as AttributionInfo;

        // Resolve the block's position in the DOM
        const positionInfo = resolveBlockPosition(editor, position);

        if (positionInfo) {
          const { top, height } = positionInfo;

          entries.push({
            position,
            timestamp: attrInfo.timestamp,
            author: attrInfo.author,
            top,
            height,
          });
        }
      }
    }

    // Coalesce entries into spans
    const coalescedSpans = coalesceAttributionSpans(entries, newestTimestamp);

    // Get viewport info for clamping
    const editorContent = document.getElementById('editor-content');
    const viewportTop = editorContent ? editorContent.scrollTop : 0;

    // Track if the next span could be the first of the latest version
    let couldBeFirstOfLatestVersion = true;

    // Build final span indicators with rendering info
    const newSpans: SpanIndicator[] = coalescedSpans.map((span) => {
      // Build tooltip with author info if available
      let tooltip = `Edited ${formatTimestamp(span.timestamp)}`;
      if (span.author) {
        const authorLabel = span.author.type === 'agent' ? 'Agent' : 'User';
        tooltip += ` by ${authorLabel}: ${span.author.name}`;

        // Add turn number for agent edits
        if (span.author.type === 'agent' && span.author.turnNumber !== undefined) {
          tooltip += ` (Turn ${span.author.turnNumber})`;
        }
      }

      // Build aria-label for accessibility
      let ariaLabel = tooltip;
      if (span.author?.type === 'agent') {
        ariaLabel += '. Click to view in chat';
      }

      const opacity = getAttributionOpacity(
        span.timestamp,
        oldestTimestamp,
        newestTimestamp,
        ABSOLUTE_RECENCY_WINDOW_MINUTES,
      );

      const isFirstOfLatestVersion = span.isFromLatestVersion && couldBeFirstOfLatestVersion;
      if (isFirstOfLatestVersion) {
        couldBeFirstOfLatestVersion = false;
      }

      // Clamp label position to viewport
      // Label anchors to span top, but clamps to viewport top edge
      const labelTop = Math.max(span.top, viewportTop);

      return {
        ...span,
        opacity,
        tooltip,
        ariaLabel,
        isFirstOfLatestVersion,
        labelTop,
      };
    });

    spans = newSpans;
  }

  /**
   * Debounced update
   */
  function scheduleUpdate() {
    if (updateTimeout !== null) {
      clearTimeout(updateTimeout);
    }
    updateTimeout = window.setTimeout(updateIndicators, 100);
  }

  /**
   * Check if editor is fully ready (mounted and view available)
   */
  function isEditorReady(): boolean {
    if (!editor || editor.isDestroyed) return false;
    // Check isEditable first - this is a safer check that doesn't throw
    if (!editor.isEditable) return false;
    try {
      // Try to access view.dom - this will throw if not ready
      return !!editor.view?.dom;
    } catch {
      return false;
    }
  }

  // Load attributions once on mount (untracked to avoid infinite loop)
  $effect(() => {
    logger.debug('[LineAttributionGutter] Mounting, loading attributions once');
    loadAttributions();

    // Update timestamps every minute to keep them fresh
    timestampUpdateInterval = window.setInterval(() => {
      logger.debug('[LineAttributionGutter] Updating timestamps...');
      updateIndicators();
    }, 60000); // 60 seconds

    return () => {
      if (timestampUpdateInterval !== null) {
        clearInterval(timestampUpdateInterval);
      }
    };
  });

  // Set up editor listeners (separate effect to avoid re-running on state changes)
  $effect(() => {
    let editorReadyCheckInterval: number | null = null;
    let observer: ResizeObserver | null = null;
    let editorContent: HTMLElement | null = null;

    const setupListeners = () => {
      // Check if editor is ready
      if (!isEditorReady()) {
        return; // Will retry via interval
      }

      // Clear the check interval once ready
      if (editorReadyCheckInterval !== null) {
        clearInterval(editorReadyCheckInterval);
        editorReadyCheckInterval = null;
      }

      logger.debug('[LineAttributionGutter] Setting up editor listeners');
      // Update on editor changes
      editor.on('update', scheduleUpdate);

      // Update on scroll (the editor container scrolls)
      editorContent = document.getElementById('editor-content');
      if (editorContent) {
        editorContent.addEventListener('scroll', scheduleUpdate);
      }

      // Update on resize
      observer = new ResizeObserver(scheduleUpdate);
      const editorDom = getEditorDom();
      if (editorDom) {
        observer.observe(editorDom);
      }
    };

    // Try immediately, then poll if not ready
    if (!isEditorReady()) {
      editorReadyCheckInterval = window.setInterval(setupListeners, 100);
    }
    setupListeners();

    return () => {
      logger.debug('[LineAttributionGutter] Cleanup');
      if (editorReadyCheckInterval !== null) {
        clearInterval(editorReadyCheckInterval);
      }
      // Note: editor.on() doesn't return an unsubscribe function in TipTap
      // The editor will clean up listeners when destroyed
      if (editorContent) {
        editorContent.removeEventListener('scroll', scheduleUpdate);
      }
      if (observer) {
        observer.disconnect();
      }
      if (updateTimeout !== null) {
        clearTimeout(updateTimeout);
      }
    };
  });

  // Listen for line-attribution:updated events from backend
  // Use a single listener that checks current noteId/workspaceId at event time
  $effect(() => {
    // Capture current values as strings to ensure consistent comparison
    const currentWorkspaceId = String(workspaceId);
    const currentNoteId = String(noteId);

    logger.debug('[LineAttributionGutter] Setting up line-attribution:updated listener', {
      workspaceId: currentWorkspaceId,
      noteId: currentNoteId,
    });

    // Use listenSync for synchronous cleanup without race conditions
    const unsubscribe = listenSync('line-attribution:updated', (event: any) => {
      // Handle both wrapped and unwrapped payloads
      const payload = event?.payload || event || {};
      const eventWorkspaceId = String(payload.workspaceId || '');
      const eventNoteId = String(payload.noteId || '');

      logger.debug('[LineAttributionGutter] Received line-attribution:updated event', {
        eventWorkspaceId,
        eventNoteId,
        currentWorkspaceId,
        currentNoteId,
        match: eventWorkspaceId === currentWorkspaceId && eventNoteId === currentNoteId,
      });

      // Only reload if it's for this workspace and note (use string comparison)
      if (eventWorkspaceId === currentWorkspaceId && eventNoteId === currentNoteId) {
        logger.debug('[LineAttributionGutter] Reloading attributions due to backend update');
        loadAttributions();
      }
    });

    return () => {
      logger.debug('[LineAttributionGutter] Cleaning up line-attribution:updated listener');
      unsubscribe();
    };
  });
</script>

<!-- Gutter container -->
<div class="absolute left-0 top-0 w-6 h-full pointer-events-none z-10">
  {#each spans as span (span.positions.join(','))}
    <div
      class="absolute left-0 cursor-pointer pointer-events-auto group/span"
      class:isLatest={span.isFromLatestVersion}
      class:isFirstOfLatestVersion={span.isFirstOfLatestVersion}
      style:top="{span.top}px"
      style:height="{span.height}px"
      title={span.tooltip}
      aria-label={span.ariaLabel}
      onclick={(e) => handleSpanClick(e, span)}
      onkeydown={(e) => handleSpanKeydown(e, span)}
      role="button"
      tabindex="0"
    >
      <div
        class="absolute w-1 right-0 h-full rounded-sm bg-muted transition-[width] duration-200 group-hover/span:w-1.5"
        style:opacity={span.opacity}
      ></div>
      <!-- Avatar for agent-authored spans (shown on hover) -->
      <div
        class="flex flex-col gap-0.5 leading-none absolute right-0 text-right pr-4 pl-0.5 rounded-md text-xs whitespace-nowrap text-muted-foreground opacity-0 group-hover/span:opacity-100 transition-opacity duration-200"
        style:top="{span.labelTop - span.top}px"
      >
        <div>{formatTimestamp(span.timestamp)}</div>
        <div>
          {#if span.author?.type === 'agent'}
            <div class="absolute right-5 top-0 pointer-events-none z-1001">
              <AuggieAvatar
                size={20}
                agentId={span.author.id}
              />
            </div>
          {/if}

          {span.author?.name}
        </div>
      </div>
    </div>
  {/each}
</div>
