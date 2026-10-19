<script lang="ts">
  import Fa from 'svelte-fa';
  import { faAt } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Combobox } from '$lib/components/ui/combobox';
  import { m } from '$shared/paraglide/messages.js';

  let {
    agents,
    selectedIds,
    disabled = false,
    open = $bindable(false),
    onOpen,
    onSelect,
  }: {
    agents: readonly { id: string; name: string }[];
    selectedIds: readonly string[];
    disabled?: boolean;
    open?: boolean;
    onOpen: () => void;
    onSelect: (agent: { id: string; name: string }) => void;
  } = $props();
  let inputRef = $state<HTMLInputElement | null>(null);
  let selected = false;
  const options = $derived(
    agents
      .filter((agent) => !selectedIds.includes(agent.id))
      .map((agent) => ({
        value: agent.id,
        label: agent.name,
        description:
          agents.filter((other) => other.name === agent.name).length > 1
            ? agent.id.slice(-6)
            : undefined,
      })),
  );
  $effect(() => {
    if (disabled) open = false;
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}<Button
        {...props}
        variant="ghost"
        size="icon-sm"
        {disabled}
        aria-label={m.workspace_discussion_addressAgent_label()}
        tooltip={m.workspace_discussion_addressAgent_label()}><Fa icon={faAt} size="sm" /></Button
      >{/snippet}
  </Popover.Trigger>
  <Popover.Content
    side="top"
    align="start"
    class="w-80 max-w-[calc(100vw-2rem)] p-2"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      onOpen();
      inputRef?.focus();
    }}
    onCloseAutoFocus={(event) => {
      if (selected) event.preventDefault();
      selected = false;
    }}
  >
    <p class="px-1 pb-2 type-caption text-muted-foreground">
      {m.workspace_discussion_addressAgent_description()}
    </p>
    <Combobox
      staticPosition
      open
      {options}
      bind:inputRef
      ariaLabel={m.workspace_discussion_addressAgent_label()}
      placeholder={m.workspace_discussion_searchAgents_placeholder()}
      emptyText={m.workspace_discussion_noAgents_label()}
      oncommit={(value) => {
        const agent = agents.find((candidate) => candidate.id === value);
        if (agent) {
          selected = true;
          onSelect(agent);
          open = false;
        }
      }}
    />
  </Popover.Content>
</Popover.Root>
