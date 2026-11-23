<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SettingsSearchScope, type SettingsTab } from '$lib/components/patterns/settings';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
  import type { SettingsSearchGroup, SettingsSearchHit } from './settings-search-index';

  let {
    groups,
    section,
    onOpen,
  }: {
    groups: readonly SettingsSearchGroup[];
    section: Snippet<[SettingsSearchHit]>;
    onOpen: (tab: SettingsTab, sectionId: string) => void;
  } = $props();
</script>

<div data-settings-search-results class="flex flex-col gap-10">
  {#each groups as group (group.tab)}
    <section
      class="flex min-w-0 flex-col gap-6"
      aria-labelledby={`settings-search-group-${group.tab}`}
      data-settings-search-group={group.tab}
    >
      <Button
        id={`settings-search-group-${group.tab}`}
        variant="plain"
        class="group -mb-3 h-auto self-start gap-1 p-0 type-caption font-normal text-muted-foreground hover:text-foreground"
        onclick={() => onOpen(group.tab, group.hits[0].section.id)}
      >
        {group.label}
        <CaretRightIcon
          size={12}
          aria-hidden="true"
          class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Button>
      {#each group.hits as hit (hit.section.id)}
        <SettingsSearchScope query={hit.rowQuery}>
          {@render section(hit)}
        </SettingsSearchScope>
      {/each}
    </section>
  {:else}
    <EmptyState class="mt-16">
      {#snippet title()}{m.settings_search_empty_title()}{/snippet}
    </EmptyState>
  {/each}
</div>
