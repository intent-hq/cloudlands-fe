<script lang="ts">
  import { tick } from 'svelte';
  import * as Popover from '$lib/components/ui/popover';
  import Combobox from './combobox.svelte';

  let open = $state(false);
  let value = $state('main');
  let inputRef = $state<HTMLInputElement | null>(null);
  let commits = $state(0);
  const options = [
    { value: 'main', label: 'main' },
    ...Array.from({ length: 30 }, (_, index) => ({
      value: `feature/task-${index}`,
      label: `feature/task-${index}`,
    })),
  ];
</script>

<Popover.Root bind:open>
  <Popover.Trigger>Choose branch</Popover.Trigger>
  <Popover.Content
    class="flex w-80 max-h-64 flex-col overflow-y-auto"
    onOpenAutoFocus={async (event) => {
      event.preventDefault();
      await tick();
      inputRef?.focus();
    }}
  >
    <div class="shrink-0 p-3">Choose a branch to start from.</div>
    <div class="min-h-16 flex-1 overflow-y-auto">
      <Combobox
        bind:value
        bind:inputRef
        {options}
        ariaLabel="Branches"
        staticPosition
        allowCustom
        oncommit={() => {
          commits += 1;
          open = false;
        }}
      />
    </div>
    <div class="shrink-0 p-3">The current branch stays selected until you commit.</div>
  </Popover.Content>
</Popover.Root>
<output aria-label="Selected branch">{value}</output>
<output aria-label="Branch commits">{commits}</output>
