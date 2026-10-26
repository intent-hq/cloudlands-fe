<!--
  Line Attribution Gutter

  Draws a thin bar beside blocks that were recently edited; brighter bars are
  newer edits. Bars for agent edits open that agent's chat on click.

  Architecture:
  - Receives editor instance as prop
  - Maps line attributions to block positions using line-to-block-mapper
  - Positions indicators absolutely based on block DOM positions
  - Updates on scroll and resize
-->
<script lang="ts">
  import { logger } from '$lib/utils/client-logger';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';

  import type { Editor } from '@tiptap/core';
  import {
    mapLineAttributionsToBlocks,
    type LineAttributions,
    type AttributionInfo,
  } from './line-to-block-mapper';
  import { resolveBlockPosition, resolveCodeBlockLinePositions } from './block-position-resolver';
  import { getAttributionOpacity } from './attribution-color-scale';
  import {
    coalesceAttributionSpans,
    type CoalescedSpan,
    type IndicatorEntry,
  } from './attribution-span-coalescer';
  import type { WorkspaceId, NoteId } from '$shared/types';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { selectNoteAttributionView } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    noteAttributionViewReleased,
    noteAttributionViewRequested,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';

  interface Props {
    editor: Editor;
    workspaceId: WorkspaceId;
    noteId: NoteId;
    markdown: string; // The markdown content of the note
  }

  let { editor, workspaceId, noteId, markdown }: Props = $props();

  const componentId = $props.id();
  const attributionConsumerId = `line-attribution:${componentId}`;
  // svelte-ignore state_referenced_locally - selector targets are retargeted below
  const attributionWorkspaceIdStore = writable(String(workspaceId));
  // svelte-ignore state_referenced_locally - selector targets are retargeted below
  const attributionNoteIdStore = writable(String(noteId));
  $effect(() => attributionWorkspaceIdStore.set(String(workspaceId)));
  $effect(() => attributionNoteIdStore.set(String(noteId)));
  const attributionView = selectNoteAttributionView(
    attributionWorkspaceIdStore,
    attributionConsumerId,
  );
  const principalConnectionContext = selectPrincipalConnectionContext();
  let attributionRequestSequence = 0;

  // Line attribution data loaded from disk
  let lineAttributions: LineAttributions = $state(new Map());

  interface SpanIndicator extends CoalescedSpan {
    opacity: number;
    /** Accessible name; set only for agent spans, which are buttons. */
    ariaLabel?: string;
  }

  let spans: SpanIndicator[] = $state([]);
  let updateTimeout: number | null = null;
  let timestampUpdateInterval: number | null = null;

  /**
   * Tunable parameter for absolute recency window (in minutes)
   * Edits within this window get a brightness boost
   */
  const ABSOLUTE_RECENCY_WINDOW_MINUTES = 10;

  function formatTimestamp(timestamp: number): string {
    const ageMs = Date.now() - timestamp;
    const ageMinutes = Math.floor(ageMs / (1000 * 60));
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    if (ageMinutes < 1) {
      return m.tiptap_attributionGutter_justNow_label();
    } else if (ageMinutes < 60) {
      return ageMinutes === 1
        ? m.tiptap_attributionGutter_minutesAgo_one()
        : m.tiptap_attributionGutter_minutesAgo_many({ count: formatInteger(ageMinutes) });
    } else {
      return ageHours === 1
        ? m.tiptap_attributionGutter_hoursAgo_one()
        : m.tiptap_attributionGutter_hoursAgo_many({ count: formatInteger(ageHours) });
    }
  }

  function agentSpanAriaLabel(span: CoalescedSpan): string | undefined {
    if (span.author?.type !== 'agent') return undefined;
    let label = `${m.tiptap_attributionGutter_edited_tooltip({ time: formatTimestamp(span.timestamp) })} ${m.tiptap_attributionGutter_byAuthor_tooltip({ author: m.tiptap_attributionGutter_agent_label(), name: span.author.name })}`;
    if (span.author.turnNumber !== undefined) {
      label += ` ${m.tiptap_attributionGutter_turn_tooltip({ number: formatInteger(span.author.turnNumber) })}`;
    }
    return `${label}. ${m.tiptap_attributionGutter_clickToView_ariaLabel()}`;
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
      // i18n-ignore (developer log message)
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

    // Fully faded bars are invisible; skip them so they leave no hover or click target.
    const newSpans: SpanIndicator[] = [];
    for (const span of coalescedSpans) {
      const opacity = getAttributionOpacity(
        span.timestamp,
        oldestTimestamp,
        newestTimestamp,
        ABSOLUTE_RECENCY_WINDOW_MINUTES,
      );
      if (opacity <= 0) continue;
      newSpans.push({ ...span, opacity, ariaLabel: agentSpanAriaLabel(span) });
    }

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

  // The read saga owns the request and event-driven refresh lifetime. This
  // component only maps the serializable result onto editor geometry.
  $effect(() => {
    const currentWorkspaceId = String(workspaceId);
    const currentNoteId = String(noteId);
    const authority = $principalConnectionContext;
    if (!authority) return;
    attributionRequestSequence += 1;
    appStore.dispatch(
      noteAttributionViewRequested(
        attributionConsumerId,
        `${attributionConsumerId}:${attributionRequestSequence}`,
        currentWorkspaceId,
        currentNoteId,
      ),
    );
    return () =>
      appStore.dispatch(noteAttributionViewReleased(currentWorkspaceId, attributionConsumerId));
  });

  $effect(() => {
    const data = $attributionView?.data;
    const map = new Map<number, AttributionInfo>();
    for (const [lineNum, attrInfo] of Object.entries(data?.attributions ?? {})) {
      map.set(Number(lineNum), attrInfo as AttributionInfo);
    }
    lineAttributions = map;
    if (map.size === 0) spans = [];
    untrack(updateIndicators);
  });

  $effect(() => {
    // Recompute every minute so bar brightness and accessible names follow edit age
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
</script>

<!-- Gutter container -->
<div class="absolute left-0 top-0 w-6 h-full pointer-events-none z-10">
  {#each spans as span (span.positions.join(','))}
    {@const isClickable = span.author?.type === 'agent'}
    <div
      class="absolute left-0 group/span"
      class:pointer-events-auto={isClickable}
      class:cursor-pointer={isClickable}
      style:top="{span.top}px"
      style:height="{span.height}px"
      aria-label={span.ariaLabel}
      data-attribution-span
      onclick={isClickable ? (e) => handleSpanClick(e, span) : undefined}
      onkeydown={isClickable ? (e) => handleSpanKeydown(e, span) : undefined}
      role={isClickable ? 'button' : undefined}
      tabindex={isClickable ? 0 : undefined}
    >
      <div
        class="absolute w-1 right-0 h-full rounded-sm bg-muted transition-[width] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none group-hover/span:w-1.5"
        style:opacity={span.opacity}
      ></div>
    </div>
  {/each}
</div>
