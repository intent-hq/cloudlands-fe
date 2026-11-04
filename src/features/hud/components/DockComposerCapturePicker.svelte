<script lang="ts">
  import { tick } from 'svelte';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
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
      (media.captureDisabled ? labels.captureLimit : modeLabel),
  );

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let keyboardOpen = $state(false);
  // Pointer activation preserves the editor selection. Keyboard activation returns
  // to the dedicated picker, so Space on the primary remains a capture action.
  let returnFocus: HTMLElement | 'trigger' | null = null;
  $effect(() => {
    if (!pickable) open = false;
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
    if (target?.isConnected) void tick().then(() => target.focus({ preventScroll: true }));
  });

  function show(fromKeyboard: boolean): void {
    if (!pickable) return;
    keyboardOpen = fromKeyboard;
    const active = document.activeElement;
    returnFocus = fromKeyboard ? 'trigger' : active instanceof HTMLElement ? active : null;
    open = true;
  }
  function choose(next: DockComposerCaptureMode): void {
    open = false;
    onSelect?.(next);
  }
</script>

<div class="capture-split" data-open={open || undefined}>
  <Button
    variant="ghost-light"
    size="icon-sm"
    class="media-button capture-button"
    disabled={blocked}
    aria-label={modeLabel}
    aria-busy={media.capturePending || undefined}
    data-alert={media.alerts?.capture ? '' : undefined}
    data-capture-mode={mode}
    tooltip={open ? undefined : tooltip}
    onpointerdown={(event) => {
      if (event.pointerType === 'mouse') event.preventDefault();
    }}
    onclick={() => {
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
    <Button
      bind:ref={trigger}
      variant="ghost-light"
      size="icon-sm"
      class="capture-picker"
      disabled={!pickable}
      aria-label={labels.captureOptions}
      aria-haspopup="menu"
      aria-expanded={open}
      tooltip={open ? undefined : labels.captureOptions}
      onpointerdown={(event) => {
        if (event.pointerType === 'mouse') event.preventDefault();
      }}
      onclick={(event) => {
        if (open) open = false;
        else show(event.detail === 0);
      }}
      onkeydown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        show(true);
      }}
    >
      <CaretDownIcon size={12} aria-hidden="true" />
    </Button>
    <DockCaptureModeMenu
      bind:open
      anchor={trigger}
      {mode}
      labels={menuLabels}
      label={labels.captureOptions}
      focusChecked={keyboardOpen}
      onSelect={choose}
      onInteractOutside={() => {
        returnFocus = null;
      }}
    />
  {/if}
</div>

<style>
  .capture-split {
    display: flex;
    flex: none;
    align-items: center;
  }
  .capture-split :global(.capture-picker) {
    position: relative;
    width: 24px;
    min-width: 24px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
    color: hsl(var(--muted-foreground));
  }
  /* Reserve the segment's space: revealing it never shifts the main action. */
  @media (hover: hover) and (pointer: fine) {
    .capture-split :global(.capture-picker) {
      opacity: 0;
      transition: opacity var(--spring-fast) var(--spring-fast-ease);
    }
    .capture-split:hover :global(.capture-picker),
    .capture-split:focus-within :global(.capture-picker),
    .capture-split[data-open] :global(.capture-picker) {
      opacity: 1;
    }
  }

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
    .capture-split :global(.capture-picker) {
      transition: none;
    }
    .capture-flash {
      animation: none;
    }
  }
</style>
