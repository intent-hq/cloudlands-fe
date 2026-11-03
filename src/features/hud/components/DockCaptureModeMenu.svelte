<script lang="ts" module>
  import type { DockCaptureMode } from '$shared/dock-evidence';

  export const DOCK_CAPTURE_GLYPHS = {
    fullscreen: 'viewfinder',
    window: 'window',
    region: 'region',
  } as const satisfies Record<DockCaptureMode, string>;
</script>

<script lang="ts">
  import '$lib/styles/dock-tokens.css';
  import { tick } from 'svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { DOCK_CAPTURE_MODES } from '$shared/dock-evidence';
  import DockComposerIcon from './DockComposerIcon.svelte';

  /**
   * Screenshot modes for a dock capture button (composer and annotate tool bar).
   * The owner opens it (hover or keyboard) and anchors it to its button.
   */
  let {
    open = $bindable(false),
    ref = $bindable(null),
    anchor,
    mode,
    labels,
    label,
    side = 'top',
    sideOffset = 6,
    portal = true,
    focusChecked = false,
    onSelect,
    onpointerenter,
    onpointerleave,
  }: {
    open?: boolean;
    ref?: HTMLElement | null;
    anchor: HTMLElement | null;
    mode: DockCaptureMode;
    labels: Record<DockCaptureMode, string>;
    label?: string;
    side?: 'top' | 'bottom';
    /** Gap from the anchor button's edge. */
    sideOffset?: number;
    /** False keeps the menu inside the owner's DOM (the annotate overlay's tool bar). */
    portal?: boolean;
    /** Keyboard opening: focus the current mode. Pointer opening never takes focus. */
    focusChecked?: boolean;
    onSelect: (mode: DockCaptureMode) => void;
    onpointerenter?: () => void;
    onpointerleave?: () => void;
  } = $props();
</script>

<Menu.Root bind:open>
  <Menu.Content
    bind:ref
    customAnchor={anchor}
    {side}
    align="center"
    {sideOffset}
    {portal}
    class="dock-media-tool-popover min-w-0 rounded-[10px] p-[3px] shadow-none"
    data-dock-palette="notch"
    aria-label={label}
    {onpointerenter}
    {onpointerleave}
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      if (focusChecked)
        void tick().then(() =>
          ref?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus(),
        );
    }}
    onCloseAutoFocus={(event) => event.preventDefault()}
  >
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
  </Menu.Content>
</Menu.Root>
