<script lang="ts">
  import DockCaptureModeMenu from '../DockCaptureModeMenu.svelte';
  import DockComposerIcon from '../DockComposerIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockCaptureMode } from '$shared/dock-evidence';
  let anchor = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let focusChecked = $state(false);
  let selections = $state<DockCaptureMode[]>([]);
  let mode = $state<DockCaptureMode>('fullscreen');
  const labels = {
    fullscreen: m.dock_composer_captureFullscreen_label(),
    window: m.dock_composer_captureWindow_label(),
    region: m.dock_composer_captureRegion_label(),
  };
</script>

<div data-testid="caption-comparison" data-selections={JSON.stringify(selections)}>
  <div style="position:absolute;left:100px;top:300px">
    <Button
      bind:ref={anchor}
      aria-label="Open screenshot options"
      size="icon-sm"
      onpointerenter={() => {
        focusChecked = false;
        open = true;
      }}
      onclick={() => {
        open = true;
      }}
      onkeydown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          focusChecked = true;
          open = true;
        }
      }}><DockComposerIcon glyph="viewfinder" /></Button
    >
  </div>
  <div style="position:absolute;left:450px;top:300px">
    <TooltipShortcut
      label={m.dock_composer_captureModes_ariaLabel()}
      shortcut="ctrl+shift+4"
      delayDuration={0}
      contentClass="dock-chrome-tooltip"
      align="start"
    >
      <Button data-testid="reference-tooltip">Shortcut tooltip reference</Button>
    </TooltipShortcut>
  </div>
  <label style="position:absolute;left:100px;top:380px"
    >Synthetic draft
    <textarea aria-label="Synthetic draft" style="display:block;width:320px;height:80px"></textarea>
  </label>
  <DockCaptureModeMenu
    bind:open
    {anchor}
    {mode}
    {labels}
    {focusChecked}
    label={m.dock_composer_captureModes_ariaLabel()}
    onSelect={(value) => {
      mode = value;
      selections = [...selections, value];
    }}
  />
</div>
