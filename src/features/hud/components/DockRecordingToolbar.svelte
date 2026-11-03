<script lang="ts">
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon';
  import { onDestroy, untrack } from 'svelte';
  import { fade, slide } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import {
    dockRecordingElapsedMs,
    dockToolbarAnchorAt,
    dockToolbarPlace,
    type DockBarAnchor,
    type DockAnnotationOverlayState,
    type DockAnnotationRect,
    type DockAnnotationSignal,
    type DockAnnotationToolbarRequest,
  } from '$shared/dock-annotation';
  import type { DockMarkTool } from '$shared/dock-evidence';
  import { Button } from '$lib/components/ui/button';
  import DockComposerIcon, { type DockComposerGlyph } from './DockComposerIcon.svelte';
  import { formatDockElapsed } from '$features/hud/composer/dock-annotation-bar-media';
  import {
    DOCK_RECORDING_TOOLS,
    DOCK_RECORDING_TOOL_KEYS,
    dockRecordingShortcut,
    pushDockRecordingLevel,
  } from './dock-recording-toolbar';

  /**
   * The tool bar of a live recording (Recording toolbar spec, Nov 2026). Annotation on
   * the left: Pointer alone, then a well with Element selector, Rectangle, Draw and
   * Arrow, then Clear (only while marks are on screen). Recording on the right: the
   * time chip (status, timer, live mic waveform; a click pauses or resumes), Discard
   * (with a 5 s Undo on the bar itself) and Done (stop and attach).
   *
   * Lives in the annotate overlay window, so it is never in the recording and never
   * receives marks; main keeps its rect clickable. It follows the system appearance.
   */
  let {
    overlay,
    send,
    signal = null,
    anchor = $bindable(null),
  }: {
    overlay: DockAnnotationOverlayState;
    send: (request: DockAnnotationToolbarRequest) => void;
    /** Where the person dragged the bar; shared with the annotate bar. */
    anchor?: DockBarAnchor | null;
    /** The recording's live microphone; null until the first report. */
    signal?: DockAnnotationSignal | null;
  } = $props();

  const record = $derived(overlay.media?.record ?? null);
  const paused = $derived(!!record?.pausedAt);
  const sessionId = $derived(overlay.sessionId);
  const act = (request: DockAnnotationToolbarRequest) => send(request);

  // Position: bottom centre by default, draggable by any non-button area. The bar
  // keeps its centre while it resizes (Clear appearing), so nothing jumps under the
  // pointer; it always stays fully inside the work area.
  let width = $state(0);
  let height = $state(0);
  let drag: { pointerId: number; dx: number; dy: number } | null = null;
  // Narrow work areas: every control stays; the bar scales down instead.
  const scale = $derived(
    width > 0 ? Math.min(1, (overlay.workArea.width - 16) / Math.max(1, width)) : 1,
  );
  /** The bar as seen (scaled), kept fully inside the work area. */
  const visual = $derived.by(() => {
    const w = width * scale;
    const h = height * scale;
    const { x, y } = dockToolbarPlace({ width: w, height: h }, overlay.workArea, anchor);
    return { x, y, width: w, height: h };
  });
  // The layout box, scaled about its bottom centre onto `visual`.
  const position = $derived({
    x: Math.round(visual.x - (width - visual.width) / 2),
    y: Math.round(visual.y + visual.height - height),
  });
  const rect = $derived<DockAnnotationRect | null>(width && height ? visual : null);
  $effect(() => {
    const request: DockAnnotationToolbarRequest = { sessionId, action: 'rect', rect };
    untrack(() => send(request));
  });
  function onPointerDown(event: PointerEvent) {
    // Never a gesture origin; buttons stay buttons.
    event.stopPropagation();
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      dx: event.clientX - (visual.x + visual.width / 2),
      dy: event.clientY - visual.y,
    };
  }
  function onPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.buttons === 0) return (drag = null);
    anchor = dockToolbarAnchorAt({ width: visual.width, height: visual.height }, overlay.workArea, {
      cx: event.clientX - drag.dx,
      bottom: event.clientY - drag.dy + visual.height,
    });
  }
  const endDrag = () => (drag = null);

  // Elapsed time: the bar ticks its own clock; paused time is cut.
  let now = $state(Date.now());
  $effect(() => {
    if (!record?.recording || paused) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(formatDockElapsed(record ? dockRecordingElapsedMs(record, now) : 0));

  // Waveform: the newest mic levels; flat while paused or without a microphone.
  let levels = $state<number[]>(pushDockRecordingLevel([], 0));
  const noMic = $derived(signal?.mic === false);
  $effect(() => {
    const level = signal?.level ?? 0;
    untrack(() => (levels = pushDockRecordingLevel(levels, paused ? 0 : level)));
  });
  const flat = $derived(paused || noMic || !signal);

  // Announce only the state change, never each second.
  let announcement = $state('');
  let announced: boolean | null = null;
  $effect(() => {
    const value = paused;
    if (announced === null) {
      announced = value;
      return;
    }
    if (announced === value) return;
    announced = value;
    announcement = value
      ? m.dock_recordingToolbar_status_paused()
      : m.dock_recordingToolbar_status_recording();
  });

  // Discard: capture pauses and the screen clears at once; the bar offers Undo for 5 s,
  // then the recording is deleted and the bar goes.
  const DISCARD_UNDO_MS = 5000;
  let discarding = $state(false);
  let discardTimer: ReturnType<typeof setTimeout> | undefined;
  function discard() {
    if (discarding) return;
    discarding = true;
    act({ sessionId, action: 'discard' });
    discardTimer = setTimeout(() => {
      discardTimer = undefined;
      act({ sessionId, action: 'discard-confirm' });
    }, DISCARD_UNDO_MS);
  }
  function undoDiscard() {
    clearTimeout(discardTimer);
    discardTimer = undefined;
    discarding = false;
    act({ sessionId, action: 'discard-undo' });
  }
  onDestroy(() => clearTimeout(discardTimer));

  const togglePause = () => act({ sessionId, action: 'pause', paused: !paused });
  const done = () => act({ sessionId, action: 'done' });
  const pointer = $derived(overlay.mouse);
  function choose(tool: DockMarkTool | 'pointer') {
    if (tool === 'pointer') act({ sessionId, action: 'mouse' });
    else act({ sessionId, action: 'tool', tool });
  }
  function clear() {
    act({ sessionId, action: 'clear' });
    act({ sessionId, action: 'mouse' });
  }
  const marked = $derived(overlay.marks.length > 0);

  const toolLabels: Record<DockMarkTool | 'pointer', string> = {
    pointer: m.dock_recordingToolbar_pointer_label(),
    pick: m.dock_recordingToolbar_element_label(),
    box: m.dock_recordingToolbar_rectangle_label(),
    pen: m.dock_recordingToolbar_draw_label(),
    arrow: m.dock_recordingToolbar_arrow_label(),
  };
  const glyphs: Record<DockMarkTool | 'pointer', DockComposerGlyph> = {
    pointer: 'cursor',
    pick: 'click',
    box: 'box',
    pen: 'pen',
    arrow: 'arrow',
  };
  const tip = (label: string, key?: string) => (key ? `${label} (${key})` : label);
  const chipTip = $derived(
    noMic
      ? m.dock_recordingToolbar_noMic_tooltip()
      : tip(
          paused ? m.dock_recordingToolbar_resume_label() : m.dock_recordingToolbar_pause_label(),
          m.dock_recordingToolbar_space_key(),
        ),
  );

  function onKeyDown(event: KeyboardEvent) {
    if (discarding) return;
    const shortcut = dockRecordingShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut.kind === 'tool') choose(shortcut.tool);
    else if (shortcut.kind === 'escape') choose('pointer');
    else if (shortcut.kind === 'pause') togglePause();
    else done();
  }
  // Arrow keys move focus between the bar's buttons.
  function onBarKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div
  class="recording-toolbar"
  role="toolbar"
  tabindex="-1"
  aria-label={m.dock_recordingToolbar_ariaLabel()}
  data-testid="dock-recording-toolbar"
  data-paused={paused || undefined}
  data-discarding={discarding || undefined}
  data-marked={marked || undefined}
  style:transform="translate({position.x}px, {position.y}px) scale({scale})"
  bind:offsetWidth={width}
  bind:offsetHeight={height}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onlostpointercapture={endDrag}
  onkeydown={onBarKeyDown}
  transition:fade={{ tier: 'fast' }}
>
  <!-- Grip: the visible handle for dragging the bar (its whole surface drags too). -->
  <span class="grip" title={m.dock_annotationToolbar_drag_label()} aria-hidden="true">
    <DotsSixVerticalIcon size={16} weight="bold" aria-hidden="true" focusable="false" />
  </span>
  {#if discarding}
    <div class="discarded" role="status" data-testid="recording-discarded">
      <span>{m.dock_recordingToolbar_discarded_label()}</span>
      <span class="dot-sep" aria-hidden="true">·</span>
      <Button variant="ghost-light" size="sm" class="rt-text rt-undo" onclick={undoDiscard}
        >{m.dock_recordingToolbar_undo_label()}</Button
      >
    </div>
  {:else}
    <section class="annotation" aria-label={m.dock_recordingToolbar_tools_label()}>
      <div class="tools" role="radiogroup" aria-label={m.dock_recordingToolbar_tools_label()}>
        {@render toolButton('pointer')}
        <div class="well">
          {#each DOCK_RECORDING_TOOLS as tool (tool)}{@render toolButton(tool)}{/each}
        </div>
      </div>
      {#if marked}
        <div class="clear-slot" transition:slide={{ tier: 'fast', axis: 'x' }}>
          <Button variant="ghost-light" size="sm" class="rt-text" data-clear onclick={clear}
            >{m.dock_recordingToolbar_clear_label()}</Button
          >
        </div>
      {/if}
    </section>
    <span class="divider" aria-hidden="true"></span>
    <section class="recording" aria-label={m.dock_recordingToolbar_recording_label()}>
      <Button
        variant="ghost-light"
        size="sm"
        class="rt-chip"
        data-testid="recording-chip"
        data-no-mic={noMic || undefined}
        aria-pressed={paused}
        aria-label={paused
          ? m.dock_recordingToolbar_resume_ariaLabel({ time: elapsed })
          : m.dock_recordingToolbar_pause_ariaLabel({ time: elapsed })}
        onclick={togglePause}
      >
        <span class="lead" aria-hidden="true">
          {#if paused}
            <DockComposerIcon glyph="play" size={14} />
          {:else}
            <span class="rec-dot"></span>
            <span class="hover-pause"><DockComposerIcon glyph="pause" size={14} /></span>
          {/if}
        </span>
        <span class="time" data-recording-time>{elapsed}</span>
        <span class="wave" data-flat={flat || undefined} aria-hidden="true">
          {#each levels as level, index (index)}
            <span class="bar" style:--level={flat ? 0 : level}></span>
          {/each}
        </span>
        <span class="tip" role="tooltip">{chipTip}</span>
      </Button>
      <Button
        variant="ghost-light"
        size="icon-sm"
        class="rt-icon rt-discard"
        data-discard
        aria-label={m.dock_recordingToolbar_discard_label()}
        onclick={discard}
      >
        <DockComposerIcon glyph="x" size={18} />
        <span class="tip" role="tooltip">{m.dock_recordingToolbar_discard_label()}</span>
      </Button>
      <Button
        variant="ghost-light"
        size="icon-sm"
        class="rt-done"
        data-done
        aria-label={m.dock_composer_done_label()}
        onclick={done}
      >
        <DockComposerIcon glyph="check" size={18} />
        <span class="tip" role="tooltip"
          >{tip(m.dock_composer_done_label(), m.dock_recordingToolbar_enter_key())}</span
        >
      </Button>
    </section>
  {/if}
  <span class="sr-only" role="status" aria-live="polite">{announcement}</span>
</div>

{#snippet toolButton(tool: DockMarkTool | 'pointer')}
  {@const selected = tool === 'pointer' ? pointer : !pointer && overlay.tool === tool}
  {@const blocked = tool === 'pick' && overlay.pick === 'permission'}
  <Button
    variant="ghost-light"
    size="icon-sm"
    class="rt-tool"
    role="radio"
    data-tool={tool}
    aria-checked={selected}
    aria-label={toolLabels[tool]}
    disabled={tool === 'pick' && !!overlay.still}
    onclick={() => choose(tool)}
  >
    <DockComposerIcon glyph={glyphs[tool]} size={18} />
    {#if blocked}<span class="alert-dot" aria-hidden="true"></span>{/if}
    <span class="tip" role="tooltip"
      >{blocked
        ? m.dock_composer_accessibilityPermission_tooltip()
        : tip(toolLabels[tool], DOCK_RECORDING_TOOL_KEYS[tool])}</span
    >
  </Button>
{/snippet}

<style>
  /* Always dark, like the annotate bar it replaces (same card, tiles, edge and the
     app accent tint for the current tool), whatever the system appearance. */
  .recording-toolbar {
    --rt-surface: hsl(var(--theme-dark-surface-3));
    --rt-well: hsl(var(--theme-dark-surface-5));
    --rt-hover: var(--theme-dark-active);
    --rt-ink: hsl(var(--theme-dark-foreground));
    --rt-muted: hsl(var(--theme-dark-muted-foreground));
    --rt-edge: hsl(var(--theme-dark-border));
    --rt-accent: hsl(var(--primary) / 0.2);
    --rt-accent-ink: hsl(var(--primary));
    --rt-rec: hsl(var(--theme-dark-danger));
    --rt-rec-fill: hsl(var(--theme-dark-danger-background));
    --rt-rec-hover: hsl(var(--theme-dark-danger) / 0.22);
    --rt-paused-fill: hsl(var(--theme-dark-surface-5));
    --rt-done: hsl(var(--theme-dark-foreground));
    --rt-done-ink: hsl(var(--theme-dark-surface-1));
    --rt-focus: hsl(var(--primary));
    --rt-shadow: 0 8px 24px var(--theme-dark-shadow-drop);
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 50% 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 56px;
    padding: 8px;
    border-radius: 20px;
    background: var(--rt-surface);
    color: var(--rt-ink);
    border: 1px solid var(--rt-edge);
    box-shadow: var(--rt-shadow);
    font-size: 14px;
    cursor: grab;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .grip {
    display: flex;
    align-items: center;
    padding: 0 2px 0 4px;
    color: var(--rt-muted);
  }
  .recording-toolbar:active:not(:has(button:active)) {
    cursor: grabbing;
  }
  .annotation,
  .recording,
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
  }
  .recording {
    gap: 4px;
  }
  .well {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    border-radius: 12px;
    background: var(--rt-well);
  }
  .divider {
    align-self: stretch;
    width: 1px;
    margin: -8px 4px;
    background: var(--rt-edge);
  }
  .recording-toolbar :global(button) {
    position: relative;
    cursor: default;
  }
  .recording-toolbar :global(button:focus-visible) {
    outline: 2px solid var(--rt-focus);
    outline-offset: 2px;
  }
  .recording-toolbar :global(.rt-tool),
  .recording-toolbar :global(.rt-icon) {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--rt-ink);
  }
  .recording-toolbar :global(.rt-tool:hover:not([aria-checked='true']):not(:disabled)),
  .recording-toolbar :global(.rt-icon:hover) {
    background: var(--rt-hover);
    color: var(--rt-ink);
  }
  .recording-toolbar :global(.rt-tool[aria-checked='true']) {
    background: var(--rt-accent);
    color: var(--rt-accent-ink);
  }
  .recording-toolbar :global(.rt-tool:disabled) {
    opacity: 0.4;
  }
  .recording-toolbar :global(.rt-discard) {
    color: var(--rt-muted);
  }
  .recording-toolbar :global(.rt-text) {
    height: 40px;
    padding: 0 12px;
    border-radius: 12px;
    background: transparent;
    color: var(--rt-muted);
    font-size: 14px;
    font-weight: 400;
    white-space: nowrap;
  }
  .recording-toolbar :global(.rt-text:hover) {
    background: var(--rt-hover);
    color: var(--rt-ink);
  }
  .clear-slot {
    display: flex;
    overflow: hidden;
  }
  /* Time chip: status and pause toggle in one. */
  .recording-toolbar :global(.rt-chip) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 14px 0 12px;
    border-radius: 20px;
    background: var(--rt-rec-fill);
    color: var(--rt-rec);
    font-size: 15px;
    font-weight: 400;
  }
  .recording-toolbar :global(.rt-chip:hover) {
    background: var(--rt-rec-hover);
    color: var(--rt-rec);
  }
  .recording-toolbar[data-paused] :global(.rt-chip),
  .recording-toolbar[data-paused] :global(.rt-chip:hover) {
    background: var(--rt-paused-fill);
    color: var(--rt-muted);
  }
  .lead {
    position: relative;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
  }
  .rec-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: currentColor;
  }
  .hover-pause {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: 0;
  }
  .recording-toolbar :global(.rt-chip:hover .rec-dot),
  .recording-toolbar :global(.rt-chip:focus-visible .rec-dot) {
    opacity: 0;
  }
  .recording-toolbar :global(.rt-chip:hover .hover-pause),
  .recording-toolbar :global(.rt-chip:focus-visible .hover-pause) {
    opacity: 1;
  }
  .time {
    min-width: 4ch;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .wave {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 16px;
  }
  .bar {
    width: 3px;
    height: calc(4px + var(--level, 0) * 12px);
    border-radius: 2px;
    background: currentColor;
    transition: height var(--motion-fast) linear;
  }
  /* Flat: a row of dots (paused, or no microphone input). */
  .wave[data-flat] .bar {
    height: 3px;
    opacity: 0.8;
  }
  .recording-toolbar :global(.rt-done) {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-left: 4px;
    padding: 0;
    border-radius: 50%;
    background: var(--rt-done);
    color: var(--rt-done-ink);
  }
  .recording-toolbar :global(.rt-done:hover) {
    background: var(--rt-done);
    color: var(--rt-done-ink);
    opacity: 0.88;
  }
  .discarded {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 4px 0 12px;
    color: var(--rt-ink);
    white-space: nowrap;
  }
  .dot-sep {
    color: var(--rt-muted);
  }
  .recording-toolbar :global(.rt-undo) {
    color: var(--rt-ink);
    font-weight: 600;
  }
  .alert-dot {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--rt-rec);
  }
  /* Tooltips: above the bar after 400 ms, with the shortcut. */
  .tip {
    position: absolute;
    bottom: calc(100% + 16px);
    left: 50%;
    translate: -50% 0;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--rt-done);
    color: var(--rt-done-ink);
    font-size: 12px;
    font-weight: 400;
    line-height: 16px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--motion-fast) ease-out;
  }
  .recording-toolbar :global(button:hover > .tip) {
    opacity: 1;
    transition-delay: 400ms;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @container style(--motion-reduced: 1) {
    .bar,
    .tip {
      transition: none;
    }
  }
</style>
