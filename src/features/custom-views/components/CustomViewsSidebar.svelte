<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { ActionBar } from '$lib/components/patterns/action-menu';
  import { confirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import type { CustomView } from '$shared/types/custom-views';
  import { store as appStore } from '$store/renderer/store';
  import { editCustomView, loadCustomViews, removeCustomView } from '../custom-views-slice';
  import { selectCustomViews, selectCustomViewsState } from '../custom-views-selectors';
  import { customViewErrorMessage, customViewIconDefinitions } from '../custom-views-labels';
  import CustomViewForm from './CustomViewForm.svelte';

  let {
    activeId = null,
    onselect,
    preview = false,
  }: { activeId?: string | null; onselect: (id: string) => void; preview?: boolean } = $props();
  const views$ = selectCustomViews();
  const state$ = selectCustomViewsState();
  const editing = $derived($views$.find((view) => view.id === $state$.editingId));
  onMount(() => {
    if (!preview) appStore.dispatch(loadCustomViews());
  });

  async function remove(view: CustomView) {
    if (
      preview ||
      !(await confirm({
        title: m.custom_views_remove_title({ name: view.name }),
        description: m.custom_views_remove_description(),
        confirmLabel: m.custom_views_remove(),
        destructive: true,
      }))
    )
      return;
    appStore.dispatch(removeCustomView(view.id));
  }
</script>

<section class="grid gap-1" aria-label={m.custom_views_title()}>
  <div class="flex items-center justify-between gap-2 px-2">
    <h2 class="type-caption text-muted-foreground">{m.custom_views_title()}</h2>
    <Button
      variant="ghost-light"
      size="icon-compact"
      iconOnly
      aria-label={m.custom_views_add()}
      tooltip={m.custom_views_add()}
      disabled={$state$.busy}
      onclick={() => appStore.dispatch(editCustomView(null))}><Fa icon={faPlus} /></Button
    >
  </div>
  {#each $views$ as view (view.id)}
    <div class="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        active={activeId === view.id}
        aria-pressed={activeId === view.id}
        class="min-w-0 flex-1 justify-start px-2"
        onclick={() => {
          onselect(view.id);
        }}
      >
        <Fa icon={customViewIconDefinitions[view.icon]} /><span
          class="truncate text-left font-normal">{view.name}</span
        >
      </Button>
      <ActionBar
        visibleCount={0}
        overflowLabel={m.custom_views_actions({ name: view.name })}
        actions={[
          { id: 'edit', label: m.custom_views_edit(), disabled: $state$.busy },
          {
            id: 'remove',
            label: m.custom_views_remove(),
            destructive: true,
            disabled: preview || $state$.busy,
          },
        ]}
        onAction={(id) => {
          if (id === 'edit') appStore.dispatch(editCustomView(view.id));
          else if (id === 'remove') void remove(view);
        }}
      />
    </div>
  {/each}
  {#if $state$.error && !$state$.editorOpen}
    <p role="alert" class="px-2 type-caption text-muted-foreground">
      {customViewErrorMessage($state$.error)}
    </p>
    {#if !$state$.errorFromMutation}
      <Button
        variant="ghost-light"
        size="sm"
        disabled={preview || $state$.busy}
        onclick={() => appStore.dispatch(loadCustomViews())}>{m.ui_combobox_retry_label()}</Button
      >
    {/if}
  {/if}
</section>
{#if $state$.editorOpen}
  {#key $state$.editingId}<CustomViewForm view={editing} {preview} />{/key}
{/if}
