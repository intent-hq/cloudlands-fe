<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { canPlaceBeside } from '$lib/components/ui/overlay-positioning';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { faDesktop } from '@fortawesome/free-solid-svg-icons';
  import { faCloud } from '$lib/icons/phosphor-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import type { StartOnOption } from '$features/remote-machines/start-on';
  import { workspacePickerStyles } from './workspace-picker-styles';

  /**
   * New Workspace → "Machine": the machine the first agent starts on. Only
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
  const isMobile = new IsMobile();
  let menuBelow = $state(false);
  let trigger = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  const selected = $derived(options.find((option) => option.id === value) ?? options[0]);
  const machineOptions = $derived<ComboboxOption[]>(
    options.map((option) => ({
      // Prefix every id so the backend's empty id is a selectable combobox value.
      value: `machine:${option.id}`,
      label: option.label,
      description: option.reason ?? option.hint ?? option.platform ?? undefined,
      disabled: option.disabled,
      data: option,
    })),
  );
  // The E2B row and its profile hint need a wider list.
  const hasCloud = $derived(options.some((option) => option.kind === 'cloud'));
  const popoverWidth = $derived(hasCloud ? 440 : 360);
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if (!event.isComposing) open = false;
    });
  });
</script>

<div class={presentation === 'footer' ? 'min-w-0' : 'w-full'} data-testid="start-on-picker">
  <Popover.Root
    bind:open
    onOpenChange={(next) => {
      if (next) menuBelow = !canPlaceBeside(trigger, popoverWidth);
    }}
  >
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          bind:ref={trigger}
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
    </Popover.Trigger>
    <Popover.Content
      role="dialog"
      portalProps={{ to: dialogPortalTarget() }}
      aria-label={m.workspace_initialAgentPicker_startOn_label()}
      side={presentation === 'footer' ? 'top' : isMobile.current || menuBelow ? 'bottom' : 'left'}
      align={presentation === 'footer' || isMobile.current || menuBelow ? 'end' : 'start'}
      sideOffset={presentation === 'footer' || isMobile.current || menuBelow ? 4 : 24}
      strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
      preventScroll={false}
      class="flex min-h-0 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 {hasCloud
        ? 'w-110'
        : 'w-90'}"
      style="max-height: min(440px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        searchInput?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        trigger?.focus();
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.stopPropagation();
      }}
    >
      <Combobox
        value={selected ? `machine:${selected.id}` : undefined}
        options={machineOptions}
        {open}
        bind:inputRef={searchInput}
        ariaLabel={m.workspace_initialAgentPicker_startOn_label()}
        placeholder={m.workspace_initialAgentPicker_searchMachines_placeholder()}
        searchPlaceholder={m.workspace_initialAgentPicker_searchMachines_placeholder()}
        staticPosition
        inputVariant="search"
        size="compact"
        class="flex min-h-0 flex-1 flex-col gap-1 px-2 pt-1 pb-2"
        inputClass="shrink-0"
        rowClass={workspacePickerStyles.row}
        viewportClass="min-h-0 max-h-none flex-1 p-0"
        contentClass="flex min-h-0 max-h-none flex-1 flex-col border-0 shadow-none"
        oncommit={(_, option) => {
          const machine = option.data as StartOnOption;
          if (machine.id !== value) onChange(machine.id);
          open = false;
        }}
        onopenchange={(next) => {
          if (!next) open = false;
        }}
      >
        {#snippet optionIcon(option)}<Fa
            icon={(option.data as StartOnOption).kind === 'cloud' ? faCloud : faDesktop}
            class={workspacePickerStyles.icon}
          />{/snippet}
      </Combobox>
    </Popover.Content>
  </Popover.Root>
</div>
