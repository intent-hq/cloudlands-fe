<script lang="ts">
  import * as Dialog from './dialog';
  import * as Menu from './menu';
  import * as Sheet from './sheet';
  import { Combobox } from './combobox';
  import HoverCard from './HoverCard.svelte';
  import { Select } from './select';
  import SurfaceContextConsumer from './SurfaceContextConsumer.svelte';
  import SurfaceProvider from './SurfaceProvider.svelte';
  import * as Tooltip from './tooltip';
  import Toast from './toast/Toast.svelte';

  let {
    kind,
    substrate = 2,
  }: {
    kind:
      | 'dialog'
      | 'sheet'
      | 'menu'
      | 'select'
      | 'combobox'
      | 'tooltip'
      | 'toast'
      | 'hover-card'
      | 'nested-menu';
    substrate?: number;
  } = $props();
  const items = [{ value: 'one', label: 'One' }];
</script>

{#snippet probe()}
  <SurfaceContextConsumer testId={`${kind}-surface`} />
{/snippet}

<SurfaceProvider value={substrate}>
  {#if kind === 'dialog'}
    <Dialog.Root open={true}>
      <Dialog.Content showCloseButton={false}>{@render probe()}</Dialog.Content>
    </Dialog.Root>
  {:else if kind === 'sheet'}
    <Sheet.Root open={true}>
      <Sheet.Content showCloseButton={false}>{@render probe()}</Sheet.Content>
    </Sheet.Root>
  {:else if kind === 'menu'}
    <Menu.Root open={true}>
      <Menu.Trigger>Menu trigger</Menu.Trigger>
      <Menu.Content portal={false}>{@render probe()}</Menu.Content>
    </Menu.Root>
  {:else if kind === 'select'}
    <Select.Root value="one" open={true} {items}>
      <Select.Trigger aria-label="Surface select"><Select.Value /></Select.Trigger>
      <Select.Content>{@render probe()}</Select.Content>
    </Select.Root>
  {:else if kind === 'combobox'}
    <Combobox
      value="one"
      open={true}
      options={items}
      ariaLabel="Surface combobox"
      header="Surface probe"
      headerAction={probe}
      portal={false}
    />
  {:else if kind === 'tooltip'}
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root open={true}>
        <Tooltip.Trigger>Tooltip trigger</Tooltip.Trigger>
        <Tooltip.Content>{@render probe()}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  {:else if kind === 'toast'}
    <Toast />
  {:else if kind === 'hover-card'}
    <HoverCard anchor="--surface-probe" absolute>{@render probe()}</HoverCard>
  {:else}
    <Dialog.Root open={true}>
      <Dialog.Content showCloseButton={false}>
        <Menu.Root open={true}>
          <Menu.Trigger>Nested menu trigger</Menu.Trigger>
          <Menu.Content portal={false}>{@render probe()}</Menu.Content>
        </Menu.Root>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
</SurfaceProvider>
