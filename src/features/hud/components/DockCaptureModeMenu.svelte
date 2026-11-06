<script lang="ts" module>
  import type { DockCaptureMode } from '$shared/dock-evidence';

  export const DOCK_CAPTURE_GLYPHS = {
    fullscreen: 'viewfinder',
    window: 'window',
    region: 'region',
  } as const satisfies Record<DockCaptureMode, string>;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import '$lib/styles/dock-tokens.css';
  import * as Menu from '$lib/components/ui/menu';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { formatShortcut } from '$lib/utils/shortcuts';
  import { DOCK_CAPTURE_MODES } from '$shared/dock-evidence';
  import DockComposerIcon from './DockComposerIcon.svelte';

  /**
   * Screenshot modes for the composer's capture button. The owner opens it on hover or explicit
   * keyboard/touch activation and anchors it to the stable capture button.
   */
  let {
    open = $bindable(false),
    anchor,
    mode,
    labels,
    label,
    heading,
    shortcut,
    focusChecked = false,
    onSelect,
    onInteractOutside,
    onpointerenter,
    onpointerleave,
  }: {
    open?: boolean;
    anchor: HTMLElement | null;
    mode: DockCaptureMode;
    labels: Record<DockCaptureMode, string>;
    label?: string;
    heading?: string;
    shortcut?: string;
    /** Keyboard opening: focus the current mode. Pointer opening never takes focus. */
    focusChecked?: boolean;
    onSelect: (mode: DockCaptureMode) => void;
    onInteractOutside?: (event: PointerEvent) => void;
    onpointerenter?: () => void;
    onpointerleave?: () => void;
  } = $props();
  let content = $state<HTMLElement | null>(null);
  // Arrow keys can enter a menu already shown by hovering without remounting its anchor.
  $effect(() => {
    if (open && focusChecked)
      void tick().then(() =>
        content?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus(),
      );
  });
</script>

<!-- The picker never locks the page: the body lock would outlive a close that lands
     while the dock is hidden for a window or region selection, swallowing every click. -->
<Menu.Root bind:open>
  <Menu.Content
    bind:ref={content}
    customAnchor={anchor}
    side="top"
    align="center"
    sideOffset={6}
    preventScroll={false}
    class="dock-media-tool-popover dock-capture-mode-menu min-w-44"
    data-dock-palette="notch"
    aria-label={label}
    onInteractOutside={(event) => {
      // The capture button owns its primary action. Let its click run once;
      // outside dismissal must not interfere with its current focus context.
      if (event.target instanceof Node && anchor?.contains(event.target)) {
        event.preventDefault();
        return;
      }
      onInteractOutside?.(event);
    }}
    {onpointerenter}
    {onpointerleave}
    onOpenAutoFocus={(event) => event.preventDefault()}
    onCloseAutoFocus={(event) => event.preventDefault()}
  >
    <Menu.Group>
      {#if heading || label}
        <Menu.Label
          class="min-h-0 font-normal text-left text-foreground [&>[data-slot=menu-item-leading]]:hidden"
        >
          <span class="capture-menu-heading">
            <span>{heading ?? label}</span>
            {#if shortcut}<ShortcutChip>{formatShortcut(shortcut)}</ShortcutChip>{/if}
          </span>
        </Menu.Label>
      {/if}
      <Menu.RadioGroup value={mode}>
        {#each DOCK_CAPTURE_MODES as option (option)}
          <Menu.RadioItem
            value={option}
            closeOnSelect
            data-capture-mode={option}
            onSelect={() => onSelect(option)}
          >
            {#snippet leading()}<DockComposerIcon glyph={DOCK_CAPTURE_GLYPHS[option]} />{/snippet}
            {labels[option]}
          </Menu.RadioItem>
        {/each}
      </Menu.RadioGroup>
    </Menu.Group>
  </Menu.Content>
</Menu.Root>

<style>
  .capture-menu-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }
</style>
