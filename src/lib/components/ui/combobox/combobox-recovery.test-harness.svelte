<script lang="ts">
  import { tick } from 'svelte';
  import Combobox from './combobox.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';

  let { compact = false }: { compact?: boolean } = $props();
  let value = $state('');
  let open = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);
  let attempts = $state(0);

  async function search() {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return [{ value: 'remote', label: 'Remote person' }];
  }
</script>

{#if compact}
  <Popover.Root bind:open>
    <Popover.Trigger>Choose person</Popover.Trigger>
    <Popover.Content
      onOpenAutoFocus={async (event) => {
        event.preventDefault();
        await tick();
        inputRef?.focus();
      }}
    >
      <Combobox
        bind:value
        bind:inputRef
        ariaLabel="People"
        staticPosition
        onsearch={search}
        onopenchange={(nextOpen) => {
          if (!nextOpen) open = false;
        }}
      />
    </Popover.Content>
  </Popover.Root>
{:else}
  <Button onclick={() => inputRef?.focus()}>Focus people search</Button>
  <Combobox bind:value bind:inputRef ariaLabel="People" onsearch={search} />
{/if}
<Button>Next action</Button>
<output aria-label="Selected person">{value}</output>
<output aria-label="Search attempts">{attempts}</output>
