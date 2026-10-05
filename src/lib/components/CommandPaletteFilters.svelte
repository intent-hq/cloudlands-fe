<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ButtonGroup } from '$lib/components/ui/button-group';
  import { m } from '$shared/paraglide/messages.js';
  import type { PaletteFilter } from '$store/renderer/slices/command-palette/command-palette-utils';

  let {
    workspaceId,
    activeFilter,
    isCollaborator,
    onFilter,
  }: {
    workspaceId?: string;
    activeFilter: PaletteFilter | null;
    isCollaborator: boolean;
    onFilter: (prefix: string) => void;
  } = $props();

  let filterStrip: HTMLDivElement | undefined = $state();
  const filters = $derived([
    { filter: null, label: m.lib_commandPalette_all_label(), prefix: '' },
    ...(workspaceId
      ? [{ filter: 'agent', label: m.layout_commandPalette_agents_group(), prefix: '@' }]
      : []),
    { filter: 'note', label: m.layout_commandPalette_context_group(), prefix: '#' },
    ...(workspaceId
      ? [{ filter: 'file', label: m.layout_commandPalette_files_group(), prefix: '/' }]
      : []),
    { filter: 'workspace', label: m.lib_commandPalette_workspaces_label(), prefix: '*' },
    { filter: 'message', label: m.layout_commandPalette_messages_group(), prefix: '?' },
    ...(workspaceId
      ? [{ filter: 'change', label: m.layout_commandPalette_changes_group(), prefix: '~' }]
      : []),
    ...(workspaceId && !isCollaborator
      ? [
          { filter: 'terminal', label: m.layout_commandPalette_terminals_group(), prefix: '>' },
          { filter: 'browser', label: m.layout_commandPalette_browser_group(), prefix: '^' },
        ]
      : []),
  ]);

  $effect(() => {
    filterStrip
      ?.querySelector<HTMLButtonElement>(`[data-filter="${activeFilter ?? 'all'}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  export function cycle(direction: 1 | -1) {
    const current = filters.findIndex((item) => item.filter === activeFilter);
    const next = (current + direction + filters.length) % filters.length;
    onFilter(filters[next].prefix);
  }
</script>

<div
  bind:this={filterStrip}
  class="min-w-0 shrink-0 scroll-px-3 overflow-x-auto overscroll-x-contain px-3 py-2"
>
  <ButtonGroup aria-label={m.lib_commandPalette_filters_ariaLabel()} class="w-max">
    {#each filters as filter (filter.prefix)}
      <Button
        variant="ghost"
        size="sm"
        active={activeFilter === filter.filter}
        aria-pressed={activeFilter === filter.filter}
        data-filter={filter.filter ?? 'all'}
        tabindex={-1}
        class={activeFilter === filter.filter ? 'text-foreground' : 'text-muted-foreground'}
        onclick={() => onFilter(filter.prefix)}
      >
        {filter.label}
      </Button>
    {/each}
  </ButtonGroup>
</div>
