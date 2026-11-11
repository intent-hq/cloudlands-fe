<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { crispOut, springIn } from '$lib/motion';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { HomeBulkAction } from './home-workspace-menu';

  let {
    count,
    actions,
    onclear,
  }: { count: number; actions: readonly HomeBulkAction[]; onclear: () => void } = $props();
</script>

<div
  role="toolbar"
  aria-label={m.home_selection_toolbar_ariaLabel()}
  class="home-selection-bar absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-(--radius-medium) border border-border bg-popover p-1 pl-3 shadow-(--elevation-overlay)"
  data-home-selection-bar
  in:springIn={{ tier: 'moderate', y: 8, scale: 1 }}
  out:crispOut={{ tier: 'moderate', y: 8, scale: 1 }}
>
  <span class="mr-2 whitespace-nowrap type-caption font-medium tabular-nums" aria-live="polite"
    >{count === 1
      ? m.home_selection_count_one({ count: formatInteger(count) })
      : m.home_selection_count_many({ count: formatInteger(count) })}</span
  >
  {#each actions as action (action.id)}
    <Button variant="ghost" size="sm" onclick={action.run}
      >{#snippet leadingIcon()}<Fa icon={action.icon!} />{/snippet}{action.label}</Button
    >
  {/each}
  <Button
    variant="ghost"
    size="icon-sm"
    iconOnly
    aria-label={m.home_selection_clear_label()}
    tooltip={m.home_selection_clear_label()}
    onclick={onclear}><Fa icon={faXmark} /></Button
  >
</div>
