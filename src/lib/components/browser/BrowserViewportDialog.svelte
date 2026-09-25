<script lang="ts">
  import { tick } from 'svelte';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';

  let {
    open = $bindable(false),
    viewport,
    onViewportChange,
    returnFocus,
  }: {
    open?: boolean;
    viewport: BrowserTabViewport;
    onViewportChange: (viewport: BrowserTabViewport) => void;
    returnFocus?: HTMLElement | null;
  } = $props();
  const min = 320;
  const max = 3840;
  let width: number | null = $state(1280);
  let height: number | null = $state(800);
  let widthRef = $state<HTMLInputElement | null>(null);
  function validDimension(value: number | null) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  }
  const valid = $derived(validDimension(width) && validDimension(height));
  $effect(() => {
    if (!open) return;
    return () => {
      void tick().then(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  });
  $effect(() => {
    if (!open) {
      width = viewport.mode === 'fit' ? 1280 : viewport.width;
      height = viewport.mode === 'fit' ? 800 : viewport.height;
    }
  });
  function apply() {
    if (!valid || width === null || height === null) return;
    onViewportChange({ mode: 'custom', width, height });
    open = false;
  }
</script>

<FormDialog
  bind:open
  title={m.browser_viewport_custom_label()}
  description={m.browser_viewport_sizeRange_description({
    min: formatInteger(min),
    max: formatInteger(max),
  })}
  submitLabel={m.browser_viewport_apply_label()}
  canSubmit={valid}
  onSubmit={apply}
  initialFocus={widthRef}
>
  <div class="grid grid-cols-2 gap-3">
    <label class="space-y-1 type-caption">
      <span>{m.browser_viewport_width_label()}</span>
      <Input
        type="number"
        {min}
        {max}
        step="1"
        bind:value={width}
        bind:ref={widthRef}
        aria-invalid={!validDimension(width)}
      />
    </label>
    <label class="space-y-1 type-caption">
      <span>{m.browser_viewport_height_label()}</span>
      <Input
        type="number"
        {min}
        {max}
        step="1"
        bind:value={height}
        aria-invalid={!validDimension(height)}
      />
    </label>
  </div>
</FormDialog>
