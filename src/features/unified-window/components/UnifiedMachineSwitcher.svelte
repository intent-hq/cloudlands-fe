<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown, faUsers } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import { CONNECTION_ACCENT_CLASSES } from '$lib/utils/connection-accents';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { UnifiedMachine } from '../unified-machines';

  interface Props {
    machines: UnifiedMachine[];
    selectedId: string;
    onselect: (machineId: string) => void;
    open?: boolean;
  }

  let { machines, selectedId, onselect, open = $bindable(false) }: Props = $props();
  const selected = $derived(machines.find((machine) => machine.id === selectedId) ?? machines[0]);
</script>

{#snippet machineIcon(machine: UnifiedMachine, size: number)}
  {#if machine.kind === 'guest'}
    <Fa icon={faUsers} class="shrink-0" style="width: {size}px; height: {size}px" />
  {:else}
    <DeviceIcon record={machine.icon} {size} />
  {/if}
{/snippet}

{#if selected}
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="compact"
          wrapContent={false}
          active={open}
          class="h-(--control-height-medium) max-w-40 gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-sidebar/50 hover:text-foreground"
          aria-label={m.unifiedWindow_switcher_ariaLabel({ machine: selected.label })}
          data-unified-machine-switcher
        >
          {@render machineIcon(selected, 14)}
          <span class="min-w-0 truncate text-xs font-medium">{selected.label}</span>
          <Fa icon={faChevronDown} class="size-2.5! shrink-0 opacity-70" />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="start" class="w-max min-w-60 max-w-80">
      <Menu.RadioGroup
        value={selected.id}
        onValueChange={(value) => {
          if (value) onselect(value);
        }}
      >
        <Menu.Label>{m.unifiedWindow_switcher_header()}</Menu.Label>
        {#each machines as machine (machine.id)}
          <Menu.RadioItem
            value={machine.id}
            closeOnSelect
            textValue={machine.label}
            data-unified-machine-option={machine.id}
            data-online={machine.online}
          >
            {#snippet leading()}
              <span class={cn('flex', !machine.online && 'text-muted-foreground')}>
                {@render machineIcon(machine, 16)}
              </span>
            {/snippet}
            <span
              class={cn(
                'flex min-w-0 flex-1 items-center gap-1.5',
                !machine.online && 'text-muted-foreground',
              )}
            >
              <span class="truncate">{machine.label}</span>
              {#if machine.kind !== 'local' && machine.accent}
                <span
                  class={cn(
                    'size-2 shrink-0 rounded-full',
                    CONNECTION_ACCENT_CLASSES[machine.accent],
                    !machine.online && 'opacity-50',
                  )}
                  aria-hidden="true"
                ></span>
              {/if}
            </span>
            {#if machine.kind === 'guest'}
              <span class="ml-3 shrink-0 type-caption text-muted-foreground"
                >{m.unifiedWindow_machine_guest_badge()}</span
              >
            {:else if !machine.online}
              <span class="ml-3 shrink-0 type-caption text-muted-foreground"
                >{m.unifiedWindow_machine_offline_label()}</span
              >
            {/if}
          </Menu.RadioItem>
        {/each}
      </Menu.RadioGroup>
    </Menu.Content>
  </Menu.Root>
{/if}
