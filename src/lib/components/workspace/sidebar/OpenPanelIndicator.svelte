<script lang="ts">
  import { faTableColumns } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  let {
    count,
    active = false,
    overlay = false,
    class: className,
  }: { count: number; active?: boolean; overlay?: boolean; class?: string } = $props();

  const description = $derived(
    count > 1
      ? active
        ? m.workspace_openPanelMarker_activeMany_description({ count: formatInteger(count) })
        : m.workspace_openPanelMarker_openMany_description({ count: formatInteger(count) })
      : active
        ? m.workspace_openPanelMarker_active_description()
        : m.workspace_openPanelMarker_open_description(),
  );
</script>

{#if count > 0}
  <span
    class={cn(
      'panel-open-marker pointer-events-none flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-card/95 text-muted-foreground',
      overlay ? 'absolute -right-0.5 -bottom-0.5 z-20' : 'ml-auto',
      active && 'text-foreground',
      className,
    )}
    data-panel-open-marker
    data-panel-open-state={active ? 'active' : 'open'}
    data-panel-open-count={count}
    aria-hidden="true"
  >
    <Fa icon={faTableColumns} class="size-2.5!" />
  </span>
  <span class="sr-only">{description}</span>
{/if}
