<script lang="ts">
  import { untrack } from 'svelte';
  import { fade } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import {
    dockToolbarPosition,
    type DockAnnotationOverlayState,
    type DockAnnotationRect,
    type DockAnnotationToolbarRequest,
  } from '$shared/dock-annotation';
  import type { DockMarkTool } from '$shared/dock-evidence';
  import { Button } from '$lib/components/ui/button';
  import DockComposerIcon from './DockComposerIcon.svelte';
  import { formatDockElapsed } from '$features/hud/composer/dock-annotation-bar-media';
  import { formatInteger } from '$lib/i18n/format';

  /**
   * On-screen tool bar of a dock annotate session. Lives inside the overlay window,
   * so it is excluded from captures and recordings with it; main keeps its rect
   * clickable and never lets a gesture start on it. Keyboard shortcuts stay with
   * the dock (this window never takes focus).
   */
  let {
    overlay,
    send,
  }: {
    overlay: DockAnnotationOverlayState;
    send: (request: DockAnnotationToolbarRequest) => void;
  } = $props();

  const tools: DockMarkTool[] = ['pick', 'box', 'pen', 'arrow'];
  const glyphs = { pick: 'target', box: 'box', pen: 'pen', arrow: 'arrow' } as const;
  const labels: Record<DockMarkTool, string> = {
    pick: m.dock_composer_pick_label(),
    box: m.dock_composer_box_label(),
    pen: m.dock_composer_pen_label(),
    arrow: m.annotation_arrow_label(),
  };
  let width = $state(0);
  /** Every square control: Mouse, the tools, Screenshot, Record (idle) and X. */
  const TOOL_SIZE = 38;
  let height = $state(0);

  // Next to the dock (below a notch or top pill, beside an edge rail, below or above
  // a floating dock), inside the work area; it follows the dock as it moves or resizes.
  // Record widens into its recording pill: the bar must not re-centre (jump) while
  // it does. It is placed by its width without that growth, so it grows to the right
  // (an edge rail on the right grows to the left by itself), and is kept inside the
  // work area with its real width.
  let recordButton = $state<HTMLElement | null>(null);
  const position = $derived.by(() => {
    const area = overlay.workArea;
    const growth = width && recordButton ? Math.max(0, recordButton.offsetWidth - TOOL_SIZE) : 0;
    const rightRail = overlay.dock?.shape === 'edge' && overlay.dock.side === 'right';
    const placed = dockToolbarPosition(
      overlay.dock,
      { width: rightRail ? width : width - growth, height },
      area,
    );
    const x = Math.max(area.x, Math.min(placed.x, area.x + area.width - width));
    return { x: Math.round(x), y: placed.y };
  });
  const rect = $derived<DockAnnotationRect | null>(
    width && height ? { x: position.x, y: position.y, width, height } : null,
  );
  // Following the dock animates; the first placement does not slide in from 0,0.
  let placed = $state(false);
  $effect(() => {
    if (!rect || placed) return;
    const frame = requestAnimationFrame(() => (placed = true));
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => {
    const request: DockAnnotationToolbarRequest = {
      sessionId: overlay.sessionId,
      action: 'rect',
      rect,
    };
    // Report only: the transport's own reads must not become this effect's dependencies.
    untrack(() => send(request));
  });

  function onPointerDown(event: PointerEvent) {
    // Never a gesture origin: the overlay root must not see this pointer.
    event.stopPropagation();
  }

  // Tooltips go below the bar when there is no room above it (always under a notch or
  // top pill, where the dock and the screen edge are above), and stay inside the work area.
  const TIP_ROOM = 40;
  const tipsBelow = $derived(
    overlay.dock?.shape === 'notch' ||
      overlay.dock?.shape === 'top-pill' ||
      position.y - overlay.workArea.y < TIP_ROOM,
  );
  /** Shift a tooltip sideways so it stays inside the work area (overlay = client coords). */
  function clampTip(node: HTMLElement, area: DockAnnotationRect) {
    let current = area;
    const button = node.parentElement;
    const place = () =>
      requestAnimationFrame(() => {
        node.style.setProperty('--tip-dx', '0px');
        const box = node.getBoundingClientRect();
        const left = current.x + 4 - box.left;
        const right = current.x + current.width - 4 - box.right;
        node.style.setProperty('--tip-dx', `${left > 0 ? left : right < 0 ? right : 0}px`);
      });
    button?.addEventListener('pointerenter', place);
    return {
      update(next: DockAnnotationRect) {
        current = next;
      },
      destroy() {
        button?.removeEventListener('pointerenter', place);
      },
    };
  }
  // Screenshot and Record: the composer's own buttons (state sent by the dock).
  const media = $derived(overlay.media);
  const recording = $derived(!!media?.record.recording);
  let now = $state(Date.now());
  $effect(() => {
    if (!recording) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const recordTime = $derived(
    formatDockElapsed(media?.record.startedAt ? now - media.record.startedAt : 0),
  );
  /** Disabled or busy: no click (aria-disabled keeps the tooltip reachable). */
  const inert = (button: { disabled: boolean; pending: boolean }) =>
    button.disabled || button.pending;
  const mouseLabel = m.dock_composer_mouse_label();
  const attachLabel = m.dock_annotationToolbar_save_label();
  // What Attach will put in the composer: the marks on screen now.
  const attachCount = $derived(overlay.marks.length);
  const clearLabel = m.dock_annotationToolbar_clear_label();
  const endLabel = m.dock_composer_endAnnotation_label();
</script>

<div
  class="dock-annotation-toolbar"
  role="toolbar"
  aria-label={m.annotation_toolbar_ariaLabel()}
  data-testid="dock-annotation-toolbar"
  data-dock-palette="notch"
  data-placed={placed || undefined}
  data-dock-shape={overlay.dock?.shape ?? 'none'}
  data-tips={tipsBelow ? 'below' : 'above'}
  style:transform="translate({position.x}px, {position.y}px)"
  bind:offsetWidth={width}
  bind:offsetHeight={height}
  onpointerdown={onPointerDown}
  transition:fade={{ tier: 'fast' }}
>
  <!-- Tools: one group, Mouse first (a mode like the tools); the current one is tinted. -->
  <div class="tool-group" role="group">
    <!-- Mouse mode: use the screen normally; the session and its marks stay. -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="dock-annotation-tool"
      data-tool="mouse"
      data-active={overlay.mouse || undefined}
      aria-label={mouseLabel}
      aria-pressed={overlay.mouse}
      onclick={() => send({ sessionId: overlay.sessionId, action: 'mouse' })}
    >
      <DockComposerIcon glyph="cursor" size={18} />
      <span class="tip" role="tooltip" use:clampTip={overlay.workArea}>{mouseLabel}</span>
    </Button>
    {#each tools as tool (tool)}
      {@const blocked = tool === 'pick' && overlay.pick === 'permission'}
      <Button
        variant="ghost-light"
        size="icon-sm"
        class="dock-annotation-tool"
        data-tool={tool}
        data-active={(!overlay.mouse && overlay.tool === tool) || undefined}
        data-alert={blocked ? '' : undefined}
        aria-label={labels[tool]}
        aria-pressed={!overlay.mouse && overlay.tool === tool}
        disabled={tool === 'pick' && !!overlay.still}
        onclick={() => send({ sessionId: overlay.sessionId, action: 'tool', tool })}
      >
        <DockComposerIcon glyph={glyphs[tool]} size={18} />
        {#if blocked}<span class="alert-dot" aria-hidden="true"></span>{/if}
        <span class="tip" role="tooltip" use:clampTip={overlay.workArea}
          >{blocked ? m.dock_composer_accessibilityPermission_tooltip() : labels[tool]}</span
        >
      </Button>
    {/each}
  </div>
  {#if media}
    <span class="divider" aria-hidden="true"></span>
    <!-- Screenshot: the composer's capture (the overlay and this bar are never in it). -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="dock-annotation-tool tile"
      data-media="capture"
      data-alert={media.capture.alert ? '' : undefined}
      aria-label={media.capture.label}
      aria-disabled={inert(media.capture) || undefined}
      aria-busy={media.capture.pending || undefined}
      onclick={() => {
        if (!inert(media.capture)) send({ sessionId: overlay.sessionId, action: 'capture' });
      }}
    >
      <DockComposerIcon glyph="viewfinder" size={18} />
      {#if media.capture.alert}<span class="alert-dot" aria-hidden="true"></span>{/if}
      <span class="tip" role="tooltip" use:clampTip={overlay.workArea}>{media.capture.tooltip}</span
      >
    </Button>
    <!-- Record: starts another recording, or stops the live one (the composer's look). -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      class="dock-annotation-tool tile record-tool"
      bind:ref={recordButton}
      data-media="record"
      data-recording={recording || undefined}
      data-alert={media.record.alert ? '' : undefined}
      aria-label={media.record.label}
      aria-pressed={recording}
      aria-disabled={inert(media.record) || undefined}
      aria-busy={media.record.pending || undefined}
      onclick={() => {
        if (!inert(media.record)) send({ sessionId: overlay.sessionId, action: 'record' });
      }}
    >
      {#if recording}
        <span class="record-glyph"
          ><DockComposerIcon glyph="stop" size={16} /><span class="timer" data-record-time
            >{recordTime}</span
          ></span
        >
      {:else}<DockComposerIcon glyph="video" size={18} />{/if}
      {#if media.record.alert}<span class="alert-dot" aria-hidden="true"></span>{/if}
      <span class="tip" role="tooltip" use:clampTip={overlay.workArea}>{media.record.tooltip}</span>
    </Button>
  {/if}
  <span class="divider" aria-hidden="true"></span>
  <!-- Attach: the current marks become one image in the composer; the screen is
       cleared and the bar switches to Mouse. The badge counts what will be attached. -->
  <!-- Attach | Clear: one pill. Clear (only with marks) drops them, nothing attached. -->
  <div class="attach-split" data-split={attachCount > 0 || undefined}>
    <Button
      variant="ghost-light"
      size="sm"
      class="dock-annotation-attach"
      data-commit
      aria-label={attachLabel}
      onclick={() => send({ sessionId: overlay.sessionId, action: 'commit' })}
    >
      <DockComposerIcon glyph="paperclip" size={16} />
      <span class="attach-label" aria-hidden="true">{attachLabel}</span>
      {#if attachCount > 0}<span class="attach-count" data-attach-count aria-hidden="true"
          >{formatInteger(attachCount)}</span
        >{/if}
    </Button>
    {#if attachCount > 0}
      <Button
        variant="ghost-light"
        size="icon-sm"
        class="dock-annotation-tool dock-annotation-clear"
        data-clear
        aria-label={clearLabel}
        onclick={() => send({ sessionId: overlay.sessionId, action: 'clear' })}
      >
        <DockComposerIcon glyph="trash" size={16} />
        <span class="tip" role="tooltip" use:clampTip={overlay.workArea}>{clearLabel}</span>
      </Button>
    {/if}
  </div>
  <!-- Ends the session (marks already attached stay); the bar goes away. -->
  <Button
    variant="ghost-light"
    size="icon-sm"
    class="dock-annotation-tool"
    data-end
    aria-label={endLabel}
    onclick={() => send({ sessionId: overlay.sessionId, action: 'end' })}
  >
    <DockComposerIcon glyph="x" size={18} />
    <span class="tip" role="tooltip" use:clampTip={overlay.workArea}>{endLabel}</span>
  </Button>
</div>

<style>
  /* The reference bar mapped to the dark overlay: a dark card, neutral raised tiles,
     the app accent for the current tool (tinted) and for Attach (filled). */
  .dock-annotation-toolbar {
    --toolbar-card: var(--theme-dark-surface-3);
    --toolbar-tile: var(--theme-dark-surface-5);
    --toolbar-edge: var(--theme-dark-border);
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border-radius: 16px;
    border: 1px solid hsl(var(--toolbar-edge));
    background: hsl(var(--toolbar-card));
    box-shadow: 0 8px 24px var(--theme-dark-shadow-drop);
    cursor: default;
    pointer-events: auto;
    touch-action: none;
  }
  /* Follows the dock with the dock's moderate spring; reduced motion moves at once. */
  .dock-annotation-toolbar[data-placed] {
    transition: transform var(--spring-moderate) var(--spring-moderate-ease);
  }
  .tool-group {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 12px;
    background: hsl(var(--toolbar-tile));
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool) {
    position: relative;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: hsl(var(--theme-dark-foreground) / 0.82);
    cursor: default;
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool.tile) {
    background: hsl(var(--toolbar-tile));
  }
  .dock-annotation-toolbar
    :global(
      .dock-annotation-tool:hover:not(:disabled):not([aria-disabled='true']):not([data-active]):not(
          [data-recording]
        ):not([data-clear])
    ) {
    color: hsl(var(--theme-dark-foreground));
    background: var(--theme-dark-active);
  }
  /* The current tool: a soft accent fill with an accent glyph. */
  .dock-annotation-toolbar :global(.dock-annotation-tool[data-active]) {
    background: hsl(var(--primary) / 0.2);
    color: hsl(var(--primary));
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool:disabled),
  .dock-annotation-toolbar :global(.dock-annotation-tool[aria-disabled='true']) {
    opacity: 0.4;
  }
  /* A limit-disabled control keeps its tooltip (the shared Button drops pointer events). */
  .dock-annotation-toolbar :global(.dock-annotation-tool[aria-disabled='true']) {
    pointer-events: auto;
  }
  /* Recording: the composer's orange pill. A fixed width (the timer is fixed too),
     reached by one short width transition: no reflow per tick, no jump. */
  .dock-annotation-toolbar :global(.dock-annotation-tool.record-tool) {
    transition:
      width var(--spring-fast) var(--spring-fast-ease),
      background-color var(--spring-fast) var(--spring-fast-ease);
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool.record-tool[data-recording]) {
    width: 80px;
    background: hsl(var(--capture-active));
    color: hsl(var(--capture-active-foreground));
  }
  @container style(--motion-reduced: 1) {
    .dock-annotation-toolbar :global(.dock-annotation-tool.record-tool) {
      transition: none;
    }
  }
  .record-glyph {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .timer {
    flex: none;
    /* m:ss (recordings stop at 2:00): a fixed width, so ticks never change layout. */
    width: 4ch;
    font-size: var(--text-caption-size);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Attach: the primary action, filled with the app accent. */
  .dock-annotation-toolbar :global(.dock-annotation-attach) {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding-inline: 12px;
    border: 0;
    border-radius: 10px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: 14px;
    font-weight: 500;
    cursor: default;
  }
  .dock-annotation-toolbar :global(.dock-annotation-attach:hover) {
    background: hsl(var(--primary) / 0.9);
    color: hsl(var(--primary-foreground));
  }
  .attach-split {
    display: flex;
    align-items: stretch;
  }
  /* Split: Attach keeps its left corners; Clear is the attached right segment. */
  .attach-split[data-split] :global(.dock-annotation-attach) {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }
  /* Clear: an icon segment on the raised tile surface beside the accent Attach. */
  .dock-annotation-toolbar :global(.dock-annotation-tool.dock-annotation-clear) {
    width: 38px;
    border-radius: 0 10px 10px 0;
    background: hsl(var(--toolbar-tile));
    color: hsl(var(--theme-dark-foreground));
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool.dock-annotation-clear:hover) {
    background: var(--theme-dark-active);
    color: hsl(var(--theme-dark-foreground));
  }
  .attach-count {
    min-width: 20px;
    padding: 2px 6px;
    border-radius: 6px;
    background: hsl(var(--primary-foreground) / 0.14);
    font-size: 12px;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .alert-dot {
    /* Positioned against the button's glyph box: its top-right corner. */
    position: absolute;
    top: -3px;
    right: -4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: hsl(var(--capture-active));
    box-shadow: 0 0 0 1.5px hsl(var(--toolbar-tile));
  }
  .divider {
    width: 1px;
    height: 22px;
    background: hsl(var(--toolbar-edge));
  }
  /* No room above (under a notch or top pill, or near the top): below the bar. */
  .dock-annotation-toolbar[data-tips='below'] .tip {
    bottom: auto;
    top: calc(100% + var(--tip-gap));
  }
  .tip {
    /* Placed against the glyph box (the Button's content), so the gap clears the rest
       of the 38 px button, the bar's padding and border, plus 8 px of air. */
    --tip-gap: calc((38px - 18px) / 2 + 7px + 8px);
    position: absolute;
    bottom: calc(100% + var(--tip-gap));
    left: 50%;
    /* --tip-dx keeps a long tooltip inside the work area (set on hover). */
    translate: calc(-50% + var(--tip-dx, 0px)) 0;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid hsl(var(--toolbar-edge));
    background: hsl(var(--toolbar-card));
    color: hsl(var(--theme-dark-foreground));
    font-size: 12px;
    font-weight: 400;
    line-height: 16px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .dock-annotation-toolbar :global(.dock-annotation-tool:hover .tip) {
    opacity: 1;
    transition-delay: 300ms;
  }
  @container style(--motion-reduced: 1) {
    .tip,
    .dock-annotation-toolbar[data-placed] {
      transition: none;
    }
  }
</style>
