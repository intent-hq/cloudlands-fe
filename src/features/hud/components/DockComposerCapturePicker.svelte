<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import DockComposerIcon from './DockComposerIcon.svelte';
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

  const modes: DockComposerCaptureMode[] = ['fullscreen', 'window', 'region'];
  const glyphs = { fullscreen: 'viewfinder', window: 'window', region: 'region' } as const;

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
  let content = $state<HTMLElement | null>(null);
  let keyboardOpen = false;
  // Hovering moves focus into the menu; closing returns it to where the person was typing.
  let returnFocus: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelTimers(): void {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
  }
  onDestroy(cancelTimers);
  $effect(() => {
    if (!pickable) {
      cancelTimers();
      open = false;
    }
  });

  function show(fromKeyboard: boolean): void {
    cancelTimers();
    keyboardOpen = fromKeyboard;
    const active = document.activeElement;
    returnFocus = fromKeyboard ? trigger : active instanceof HTMLElement ? active : null;
    open = true;
  }
  function enter(event: PointerEvent): void {
    clearTimeout(closeTimer);
    if (!pickable || event.pointerType !== 'mouse' || open) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(false), 150);
  }
  function leave(): void {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      // Keyboard interaction is not dismissed by an unrelated mouse movement.
      if (!keyboardOpen) open = false;
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
  aria-busy={media.capturePending || undefined}
  aria-haspopup={pickable ? 'menu' : undefined}
  aria-expanded={pickable ? open : undefined}
  data-alert={media.alerts?.capture ? '' : undefined}
  data-capture-mode={mode}
  tooltip={open ? undefined : tooltip}
  onpointerenter={enter}
  onpointerleave={leave}
  onpointerdown={(event) => {
    if (event.pointerType === 'mouse') event.preventDefault();
  }}
  onclick={() => {
    cancelTimers();
    open = false;
    if (media.alerts?.capture) onAlert?.();
    else onCapture();
  }}
  onkeydown={(event) => {
    if (!pickable || (event.key !== 'ArrowUp' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    show(true);
  }}
>
  {#if media.alerts?.capture}<span class="alert-dot" aria-hidden="true"></span>{/if}
  {#key media.captureRevision}
    {#if media.captureRevision > initialCaptureRevision}<span
        class="capture-flash"
        aria-hidden="true"
      ></span>{/if}
  {/key}
  <DockComposerIcon glyph={glyphs[mode]} />
</Button>
{#if menuLabels && media.captureModesAvailable}
  <Menu.Root bind:open>
    <Menu.Content
      bind:ref={content}
      customAnchor={trigger}
      side="top"
      align="center"
      sideOffset={6}
      class="dock-media-tool-popover min-w-0 rounded-[10px] p-[3px] shadow-none"
      data-dock-palette="notch"
      aria-label={labels.captureOptions}
      onpointerenter={() => clearTimeout(closeTimer)}
      onpointerleave={leave}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (keyboardOpen)
          void tick().then(() =>
            content
              ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
              ?.focus(),
          );
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocus?.focus({ preventScroll: true });
        returnFocus = null;
        keyboardOpen = false;
      }}
    >
      <Menu.RadioGroup value={mode}>
        {#each modes as option (option)}
          <Menu.RadioItem
            value={option}
            closeOnSelect
            data-capture-mode={option}
            onSelect={() => choose(option)}
          >
            {#snippet leading()}<DockComposerIcon glyph={glyphs[option]} />{/snippet}
            {menuLabels[option]}
          </Menu.RadioItem>
        {/each}
      </Menu.RadioGroup>
    </Menu.Content>
  </Menu.Root>
{/if}

<style>
  .capture-flash {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    animation: capture-confirm 150ms ease-out both;
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
