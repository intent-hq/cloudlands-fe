<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import DockComposerIcon from './DockComposerIcon.svelte';
  import DockCaptureModeMenu, { DOCK_CAPTURE_GLYPHS } from './DockCaptureModeMenu.svelte';
  import type {
    DockComposerCaptureMode,
    DockComposerMediaLabels,
    DockComposerMediaState,
  } from './dock-composer-media-presentation';

  let {
    state: media,
    labels,
    disabled = false,
    onCapture,
    onSelect,
    onAlert,
  }: {
    state: DockComposerMediaState;
    labels: DockComposerMediaLabels;
    disabled?: boolean;
    onCapture: () => void;
    onSelect?: (mode: DockComposerCaptureMode) => void;
    onAlert?: () => void;
  } = $props();

  // A remount with an existing image is not a new successful capture.
  // svelte-ignore state_referenced_locally -- retain the initial acknowledgement revision.
  const initialCaptureRevision = media.captureRevision;
  const mode = $derived(media.captureMode ?? 'fullscreen');
  const blocked = $derived(disabled || !!media.captureDisabled || !!media.capturePending);
  const menuLabels = $derived(labels.captureModes);
  const pickable = $derived(
    !!media.captureModesAvailable && !!menuLabels && !blocked && !media.alerts?.capture,
  );
  const modeLabel = $derived(
    mode === 'fullscreen' ? labels.capture : (labels.captureMode?.[mode] ?? labels.capture),
  );
  const tooltip = $derived(
    media.alerts?.capture ??
      media.captureTooltip ??
      (media.captureDisabled
        ? labels.captureLimit
        : (labels.actionHints?.capture.label ?? modeLabel)),
  );
  const tooltipShortcut = $derived(
    !media.alerts?.capture && !media.captureTooltip && !media.captureDisabled
      ? labels.actionHints?.capture.shortcut
      : undefined,
  );

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let keyboardOpen = $state(false);
  let returnFocus: HTMLElement | 'trigger' | null = null;
  let stickyOpen = false;
  let suppressClick = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelTimers(): void {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    clearTimeout(holdTimer);
  }
  onDestroy(cancelTimers);
  $effect(() => {
    if (!pickable) {
      cancelTimers();
      open = false;
    }
  });

  // Choice, Escape and outside dismissal restore the activation context.
  let wasOpen = false;
  $effect(() => {
    if (open) {
      wasOpen = true;
      return;
    }
    if (!wasOpen) return;
    wasOpen = false;
    const target = returnFocus === 'trigger' ? trigger : returnFocus;
    returnFocus = null;
    keyboardOpen = false;
    stickyOpen = false;
    if (target?.isConnected) void tick().then(() => target.focus({ preventScroll: true }));
  });

  function show(input: 'hover' | 'keyboard' | 'touch'): void {
    cancelTimers();
    if (!pickable) return;
    if (open) {
      if (input === 'keyboard') {
        keyboardOpen = true;
        stickyOpen = true;
        returnFocus = 'trigger';
      }
      return;
    }
    keyboardOpen = input === 'keyboard';
    stickyOpen = input !== 'hover';
    const active = document.activeElement;
    returnFocus = keyboardOpen ? 'trigger' : active instanceof HTMLElement ? active : null;
    open = true;
  }
  function enter(event: PointerEvent): void {
    clearTimeout(closeTimer);
    if (!pickable || event.pointerType !== 'mouse' || open) return;
    hoverTimer = setTimeout(() => show('hover'), 150);
  }
  function leave(): void {
    clearTimeout(hoverTimer);
    clearTimeout(holdTimer);
    clearTimeout(closeTimer);
    if (!stickyOpen)
      closeTimer = setTimeout(() => {
        open = false;
      }, 250);
  }
  function choose(next: DockComposerCaptureMode): void {
    cancelTimers();
    open = false;
    onSelect?.(next);
  }
</script>

<Button
  bind:ref={trigger}
  variant="ghost-light"
  size="icon-sm"
  class="media-button capture-button"
  disabled={blocked}
  aria-label={modeLabel}
  aria-haspopup={pickable ? 'menu' : undefined}
  aria-expanded={pickable ? open : undefined}
  aria-busy={media.capturePending || undefined}
  data-alert={media.alerts?.capture ? '' : undefined}
  data-capture-mode={mode}
  {tooltip}
  {tooltipShortcut}
  tooltipContentClass="dock-chrome-tooltip"
  tooltipDisabled={open}
  onpointerenter={enter}
  onpointerleave={leave}
  onpointerdown={(event) => {
    clearTimeout(hoverTimer);
    suppressClick = false;
    if (event.pointerType === 'mouse') event.preventDefault();
    if (event.pointerType === 'touch' && pickable) {
      holdTimer = setTimeout(() => {
        suppressClick = true;
        show('touch');
      }, 450);
    }
  }}
  onpointerup={() => clearTimeout(holdTimer)}
  onpointercancel={() => clearTimeout(holdTimer)}
  oncontextmenu={(event) => {
    if (!pickable) return;
    event.preventDefault();
    if ((event as PointerEvent).pointerType === 'touch') suppressClick = true;
    show('touch');
  }}
  onkeydown={(event) => {
    if (
      !pickable ||
      !(
        ['ArrowUp', 'ArrowDown', 'ContextMenu'].includes(event.key) ||
        (event.shiftKey && event.key === 'F10')
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    show('keyboard');
  }}
  onclick={() => {
    cancelTimers();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    open = false;
    if (media.alerts?.capture) onAlert?.();
    else onCapture();
  }}
>
  {#if media.alerts?.capture}<span class="alert-dot" aria-hidden="true"></span>{/if}
  {#key media.captureRevision}
    {#if media.captureRevision > initialCaptureRevision}<span
        class="capture-flash"
        aria-hidden="true"
      ></span>{/if}
  {/key}
  <DockComposerIcon glyph={DOCK_CAPTURE_GLYPHS[mode]} />
</Button>
{#if menuLabels && media.captureModesAvailable}
  <DockCaptureModeMenu
    bind:open
    anchor={trigger}
    {mode}
    labels={menuLabels}
    label={labels.captureOptions}
    heading={labels.actionHints?.capture.label}
    shortcut={labels.actionHints?.capture.shortcut}
    focusChecked={keyboardOpen}
    onSelect={choose}
    onpointerenter={() => clearTimeout(closeTimer)}
    onpointerleave={leave}
    onInteractOutside={() => {
      returnFocus = null;
    }}
  />
{/if}

<style>
  .capture-flash {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    animation: capture-confirm var(--spring-fast) var(--spring-fast-ease) both;
  }
  @keyframes capture-confirm {
    from {
      background: hsl(var(--primary));
    }
    to {
      background: transparent;
    }
  }
  @container style(--motion-reduced: 1) {
    .capture-flash {
      animation: none;
    }
  }
</style>
