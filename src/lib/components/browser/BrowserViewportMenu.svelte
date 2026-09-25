<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
  import { BROWSER_VIEWPORT_PRESETS } from './browser-viewport-presets';
  import BrowserViewportItems from './BrowserViewportItems.svelte';
  import BrowserViewportDialog from './BrowserViewportDialog.svelte';

  interface Props {
    viewport: BrowserTabViewport;
    onViewportChange: (viewport: BrowserTabViewport) => void;
  }

  let { viewport, onViewportChange }: Props = $props();
  let open = $state(false);
  let editingCustom = $state(false);
  let triggerRef: HTMLButtonElement | null = $state(null);
  const selectedPreset = $derived(
    viewport.mode === 'preset'
      ? BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
      : undefined,
  );
  const dimensionsLabel = $derived(
    viewport.mode === 'fit'
      ? ''
      : m.browser_viewport_dimensions_label({
          width: formatInteger(viewport.width),
          height: formatInteger(viewport.height),
        }),
  );
  const triggerLabel = $derived(
    viewport.mode === 'fit'
      ? m.browser_viewport_fit_short_label()
      : viewport.mode === 'preset' && selectedPreset
        ? selectedPreset.name
        : dimensionsLabel,
  );
  const triggerAriaLabel = $derived(
    viewport.mode === 'fit' ? m.browser_viewport_fitPanel_label() : triggerLabel,
  );
  async function showCustomEditor() {
    open = false;
    await tick();
    editingCustom = true;
  }
</script>

<Menu.Root bind:open>
  <Menu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        bind:ref={triggerRef}
        variant="ghost-light"
        size="xs"
        class="h-6 max-w-36 gap-1 rounded-full bg-muted px-2 text-xs hover:bg-muted/80"
        aria-label={m.browser_viewport_trigger_ariaLabel({ mode: triggerAriaLabel })}
        data-testid="browser-viewport-trigger"
      >
        <span class="truncate">{triggerLabel}</span>
        <Fa icon={faChevronDown} size="xs" class="shrink-0" />
      </Button>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content
    align="end"
    class="w-64"
    onCloseAutoFocus={(event) => editingCustom && event.preventDefault()}
  >
    <BrowserViewportItems {viewport} {onViewportChange} onCustom={showCustomEditor} />
  </Menu.Content>
</Menu.Root>
<BrowserViewportDialog
  bind:open={editingCustom}
  {viewport}
  {onViewportChange}
  returnFocus={triggerRef}
/>
