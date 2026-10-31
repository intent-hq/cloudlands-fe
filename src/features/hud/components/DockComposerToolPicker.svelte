<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import DockComposerIcon from './DockComposerIcon.svelte';
  import type {
    DockComposerMediaLabels,
    DockComposerTool,
  } from './dock-composer-media-presentation';

  let {
    tool,
    active,
    used,
    disabled = false,
    notice,
    alert,
    pickAlert,
    labels,
    onToggle,
    onSelect,
    onAlert,
  }: {
    tool: DockComposerTool;
    active: boolean;
    used: boolean;
    disabled?: boolean;
    notice?: string;
    /** Missing permission for the tool a click would start: dot, tooltip, click opens Settings. */
    alert?: string;
    /** Missing Accessibility grant: the pick tool shows the same error state. */
    pickAlert?: string;
    labels: DockComposerMediaLabels;
    onToggle: () => void;
    onSelect: (tool: DockComposerTool) => void;
    onAlert?: (target: 'annotate' | 'pick') => void;
  } = $props();

  const tools: DockComposerTool[] = ['pick', 'box', 'pen', 'arrow'];
  const glyphs = { pick: 'target', box: 'box', pen: 'pen', arrow: 'arrow' } as const;
  const popupId = $props.id();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let content = $state<HTMLDivElement | null>(null);
  let focusedTool = $state<DockComposerTool>('pick');
  let keyboardOpen = false;
  let restoreFocus = false;
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
    if (disabled) {
      cancelTimers();
      open = false;
    }
  });

  function enter(event: PointerEvent): void {
    clearTimeout(closeTimer);
    if (disabled || event.pointerType !== 'mouse' || open) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      keyboardOpen = false;
      focusedTool = tool;
      open = true;
    }, 150);
  }
  function leave(): void {
    clearTimeout(hoverTimer);
    clearTimeout(holdTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      // Keyboard interaction is not dismissed by an unrelated mouse movement.
      if (!content?.contains(document.activeElement)) open = false;
    }, 250);
  }
  async function openFromKeyboard(): Promise<void> {
    cancelTimers();
    keyboardOpen = true;
    focusedTool = tool;
    open = true;
    await tick();
    content?.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)?.focus();
  }
  function choose(next: DockComposerTool): void {
    cancelTimers();
    restoreFocus = keyboardOpen;
    open = false;
    if (next === 'pick' && pickAlert) onAlert?.('pick');
    else onSelect(next);
  }
  function navigate(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // A focused tool can own a tooltip above the popover's Escape layer.
      // Dismiss the picker itself before that auxiliary layer consumes the key.
      event.preventDefault();
      event.stopPropagation();
      cancelTimers();
      restoreFocus = true;
      open = false;
      return;
    }
    let next: number;
    const index = tools.indexOf(focusedTool);
    if (event.key === 'ArrowRight') next = (index + 1) % tools.length;
    else if (event.key === 'ArrowLeft') next = (index + tools.length - 1) % tools.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tools.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    keyboardOpen = true;
    focusedTool = tools[next];
    content?.querySelector<HTMLButtonElement>(`[data-tool="${focusedTool}"]`)?.focus();
  }
</script>

<Popover.Root bind:open>
  <Button
    bind:ref={trigger}
    variant="ghost-light"
    size="icon-sm"
    class="dock-media-tool"
    data-active={active || undefined}
    data-alert={alert ? '' : undefined}
    {disabled}
    aria-label={labels.annotateCurrent(labels.tools[tool])}
    aria-pressed={active}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? popupId : undefined}
    tooltip={open ? undefined : (alert ?? notice ?? labels.annotate)}
    onpointerenter={enter}
    onpointerleave={leave}
    onpointerdown={(event) => {
      // Every press starts clean: a stale suppression would swallow this click.
      suppressClick = false;
      if (event.pointerType === 'mouse') event.preventDefault();
      if (event.pointerType !== 'touch') return;
      holdTimer = setTimeout(() => {
        suppressClick = true;
        keyboardOpen = false;
        focusedTool = tool;
        open = true;
      }, 400);
    }}
    onpointerup={() => clearTimeout(holdTimer)}
    onpointercancel={(event) => {
      clearTimeout(holdTimer);
      // Only a cancelled touch hold suppresses its trailing click; a mouse or pen
      // cancel never swallows the person's next click.
      if (event.pointerType === 'touch') suppressClick = true;
    }}
    onclick={() => {
      clearTimeout(holdTimer);
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      cancelTimers();
      open = false;
      if (alert) onAlert?.('annotate');
      else onToggle();
    }}
    onkeydown={(event) => {
      if (event.key === 'ArrowUp' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        void openFromKeyboard();
      }
    }}
  >
    <DockComposerIcon glyph={used || active ? glyphs[tool] : 'pencil'} />
    {#if alert}<span class="tool-alert-dot" aria-hidden="true"></span>{/if}
  </Button>
  <Popover.Content
    bind:ref={content}
    id={popupId}
    customAnchor={trigger}
    side="top"
    align="center"
    sideOffset={0}
    arrowPadding={8}
    class="dock-media-tool-popover w-auto overflow-visible p-[3px] rounded-[10px] border border-border shadow-none"
    data-dock-palette="notch"
    aria-label={labels.annotationTools}
    onpointerenter={() => clearTimeout(closeTimer)}
    onpointerleave={leave}
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      if (keyboardOpen)
        void tick().then(() =>
          content?.querySelector<HTMLButtonElement>(`[data-tool="${focusedTool}"]`)?.focus(),
        );
    }}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (restoreFocus) trigger?.focus();
      restoreFocus = false;
    }}
    onEscapeKeydown={(event) => {
      event.stopPropagation();
      restoreFocus = keyboardOpen;
    }}
  >
    <div
      class="tool-options"
      role="toolbar"
      aria-label={labels.annotationTools}
      tabindex="-1"
      onkeydown={navigate}
    >
      {#each tools as option}
        <Button
          variant="ghost-light"
          size="icon-sm"
          class="dock-media-tool"
          data-tool={option}
          data-active={tool === option || undefined}
          data-alert={option === 'pick' && pickAlert ? '' : undefined}
          aria-label={labels.tools[option]}
          aria-pressed={tool === option}
          tabindex={focusedTool === option ? 0 : -1}
          {disabled}
          tooltip={option === 'pick' && pickAlert ? pickAlert : labels.tools[option]}
          onfocus={() => {
            focusedTool = option;
          }}
          onpointerdown={(event) => {
            if (event.pointerType === 'mouse') event.preventDefault();
          }}
          onclick={() => choose(option)}
        >
          <DockComposerIcon glyph={glyphs[option]} />
          {#if option === 'pick' && pickAlert}<span class="tool-alert-dot" aria-hidden="true"
            ></span>{/if}
        </Button>
      {/each}
    </div>
    <!-- 6px caret toward the annotate button: the card's fill and edge on a rotated square.
         With the caret, the card sits 44px above the button top (38px card + 6px gap). -->
    <Popover.Arrow width={12} height={6}>
      {#snippet child({ props })}
        <span {...props} class="tool-caret" aria-hidden="true"><span></span></span>
      {/snippet}
    </Popover.Arrow>
  </Popover.Content>
</Popover.Root>

<style>
  :global(.dock-media-tool-popover[data-dock-palette='notch']) {
    /* Portals may sit under a light app body. This dock control keeps its own
       dark palette: the spec's #2A2A2A card is the dark surface-4 step, including
       the caret; the 1px edge is the dark border (#3D3D3C). */
    --popover: var(--theme-dark-surface-4);
    --color-popover: hsl(var(--theme-dark-surface-4));
    --border: var(--theme-dark-border);
    --color-border: hsl(var(--theme-dark-border));
  }
  .tool-caret {
    width: 12px;
    height: 6px;
    pointer-events: none;
  }
  .tool-caret span {
    position: absolute;
    left: 2px;
    top: -3.5px;
    width: 8px;
    height: 8px;
    rotate: 45deg;
    border-right: 1px solid hsl(var(--border));
    border-bottom: 1px solid hsl(var(--border));
    border-bottom-right-radius: 2px;
    background: hsl(var(--popover));
  }
  .tool-options {
    display: flex;
    gap: 2px;
  }
  :global(.dock-media-tool) {
    width: 30px;
    height: 30px;
    min-width: 30px;
    padding: 0;
    border-radius: 8px;
    color: hsl(var(--muted-foreground));
  }
  :global(.dock-media-tool:not([data-active]):hover) {
    color: hsl(var(--foreground));
  }
  :global(.dock-media-tool) {
    position: relative;
  }
  .tool-alert-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: hsl(var(--capture-active));
    pointer-events: none;
  }
  :global(.dock-media-tool[data-active]) {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
</style>
