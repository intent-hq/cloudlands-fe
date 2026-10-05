<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import { Select } from '$lib/components/ui/select';
  import { Combobox } from '$lib/components/ui/combobox';
  import { Button } from '$lib/components/ui/button';

  let {
    kind = 'menu',
    edge = 'left',
    bottom = false,
    portal,
    collisionPadding,
  }: {
    kind?: 'menu' | 'select' | 'combobox' | 'popover';
    edge?: 'left' | 'right';
    bottom?: boolean;
    portal?: boolean;
    collisionPadding?: number;
  } = $props();

  let value = $state('apple');
  let popoverOpen = $state(false);
  const options = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
  ];
</script>

<div
  class="fixed flex w-80 max-w-full"
  style:left={edge === 'left' ? '0' : undefined}
  style:right={edge === 'right' ? '0' : undefined}
  style:top={bottom ? undefined : '0'}
  style:bottom={bottom ? '0' : undefined}
  style:justify-content={edge === 'left' ? 'flex-start' : 'flex-end'}
>
  {#if kind === 'menu'}
    <Menu.Root>
      <Menu.Trigger>Open menu</Menu.Trigger>
      <Menu.Content {portal} {collisionPadding} class="w-80">
        <Menu.Item onSelect={() => (value = 'banana')}>Choose banana</Menu.Item>
        <Menu.Sub>
          <Menu.SubTrigger>More choices</Menu.SubTrigger>
          <Menu.SubContent {collisionPadding} class="w-80">
            <Menu.Item onSelect={() => (value = 'banana')}>Banana</Menu.Item>
            <Menu.Item onSelect={() => (value = 'apple')}>Apple</Menu.Item>
            <Menu.Item onSelect={() => (value = 'cherry')}>Cherry</Menu.Item>
          </Menu.SubContent>
        </Menu.Sub>
      </Menu.Content>
    </Menu.Root>
  {:else if kind === 'select'}
    <Select.Root bind:value items={options}>
      <Select.Trigger aria-label="Choose fruit"><Select.Value /></Select.Trigger>
      <Select.Content {portal}>
        {#each options as option}
          <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  {:else if kind === 'combobox'}
    <Combobox
      {value}
      {options}
      {portal}
      ariaLabel="Choose fruit"
      class="w-full"
      onchange={(next) => (value = String(next))}
    />
  {:else}
    <Popover.Root bind:open={popoverOpen}>
      <Popover.Trigger>Open popover</Popover.Trigger>
      <Popover.Content {portal} {collisionPadding} class="w-80 p-2">
        <Button
          onclick={() => {
            value = 'banana';
            popoverOpen = false;
          }}>Banana</Button
        >
      </Popover.Content>
    </Popover.Root>
  {/if}
</div>
<output aria-label="Selected fruit">{value}</output>
