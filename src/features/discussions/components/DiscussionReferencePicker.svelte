<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Combobox } from '$lib/components/ui/combobox';
  import { createDiscussionReferenceSearch } from '../discussion-reference-search';
  import { m } from '$shared/paraglide/messages.js';
  let {
    workspaceId,
    disabled = false,
    onSelect,
  }: { workspaceId: string; disabled?: boolean; onSelect: (markdown: string) => void } = $props();
  let open = $state(false);
  let selected = false;
  let inputRef = $state<HTMLInputElement | null>(null);
  const search = createDiscussionReferenceSearch();
  const initialOptions = $derived(open ? search.initial(workspaceId) : []);
  $effect(() => {
    const id = workspaceId;
    return () => {
      void id;
      search.destroy();
    };
  });
  $effect(() => {
    if (disabled) open = false;
    if (!open) search.destroy();
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    >{#snippet child({ props })}<Button
        {...props}
        variant="ghost"
        size="icon-sm"
        {disabled}
        aria-label={m.workspace_discussion_reference_label()}
        tooltip={m.workspace_discussion_reference_label()}><Fa icon={faPlus} size="sm" /></Button
      >{/snippet}</Popover.Trigger
  >
  <Popover.Content
    side="top"
    align="start"
    class="w-80 max-w-[calc(100vw-2rem)] p-2"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      inputRef?.focus();
    }}
    onCloseAutoFocus={(event) => {
      if (selected) event.preventDefault();
      selected = false;
    }}
  >
    <Combobox
      staticPosition
      options={initialOptions}
      bind:inputRef
      ariaLabel={m.workspace_discussion_reference_label()}
      placeholder={m.workspace_discussion_reference_search()}
      onsearch={(query) => search.search(query, workspaceId)}
      oncommit={(value) => {
        if (typeof value === 'string') {
          selected = true;
          onSelect(value);
          open = false;
        }
      }}
    />
  </Popover.Content>
</Popover.Root>
