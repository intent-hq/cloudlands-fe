<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { faDesktop } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import type { StartOnOption } from '$features/remote-machines/start-on';
  import { workspacePickerStyles } from './workspace-picker-styles';

  /**
   * New Workspace → "Start On": the machine the first agent starts on. Only
   * rendered while another machine can take it (see `startOnVisible`).
   */
  interface Props {
    presentation?: 'form' | 'footer';
    /** Selected option id: a machine id, or '' for the current backend. */
    value: string;
    options: StartOnOption[];
    onChange: (machineId: string) => void;
    /** Why only the current backend can be used (shown under the value; the row is disabled). */
    lockedReason?: string;
    /** Whether the machine list is open (bindable; previews open it directly). */
    open?: boolean;
  }

  let {
    presentation = 'form',
    value,
    options,
    onChange,
    lockedReason,
    open = $bindable(false),
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-start-on-label`;
  const valueId = `${uid}-start-on-value`;
  const dialogPortalTarget = useDialogPortalTarget();
  const selected = $derived(options.find((option) => option.id === value) ?? options[0]);
</script>

<div class={presentation === 'footer' ? 'min-w-0' : 'w-full'} data-testid="start-on-picker">
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="sm"
          type="button"
          wrapContent={false}
          disabled={!!lockedReason}
          aria-labelledby="{labelId} {valueId}"
          class={presentation === 'footer'
            ? 'h-9 min-w-0 max-w-36 gap-1 px-2 text-sm font-normal'
            : workspacePickerStyles.fieldTrigger}
        >
          <span
            class={presentation === 'footer' ? 'sr-only' : workspacePickerStyles.fieldLabel}
            id={labelId}>{m.workspace_initialAgentPicker_startOn_label()}</span
          >
          <span class="min-w-0 flex-1 text-left" id={valueId}>
            <span class="block truncate">{selected?.label}</span>
            {#if lockedReason}
              <span class="block truncate text-xs text-subtle" data-testid="start-on-locked-reason"
                >{lockedReason}</span
              >
            {/if}
          </span>
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content
      portalProps={{ to: dialogPortalTarget() }}
      aria-label={m.workspace_initialAgentPicker_startOn_label()}
      class="w-[320px] max-w-[calc(100vw-1rem)]"
    >
      <Menu.RadioGroup
        value={selected?.id}
        onValueChange={(next) => {
          if (next !== value) onChange(next);
        }}
      >
        {#each options as option (option.id)}
          <Menu.RadioItem
            value={option.id}
            disabled={option.disabled}
            closeOnSelect
            class="h-auto py-2 whitespace-normal"
            data-testid="start-on-option"
            data-machine-id={option.id}
          >
            {#snippet leading()}<Fa icon={faDesktop} class={workspacePickerStyles.icon} />{/snippet}
            <span class="min-w-0 flex-1">
              <span class="block truncate">{option.label}</span>
              {#if option.reason || option.platform}
                <span class="block truncate text-xs text-subtle"
                  >{option.reason ?? option.platform}</span
                >
              {/if}
            </span>
          </Menu.RadioItem>
        {/each}
      </Menu.RadioGroup>
    </Menu.Content>
  </Menu.Root>
</div>
