<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ActionMenu, defineActions } from '$lib/components/patterns/action-menu';
  import { setOwnedPopupContext } from '$lib/components/ui/owned-popup-context';
  import { createDockConversationPopupOwner } from './dock-conversation-popup-owner';
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockMachineOption } from './dock-machine-types';
  import { m } from '$shared/paraglide/messages.js';

  let {
    open = $bindable(false),
    anchor,
    machines,
    currentId,
    pending = null,
    error = false,
    side = 'bottom',
    onSwitch,
    onRegionsChange,
  }: {
    open?: boolean;
    anchor: HTMLButtonElement;
    machines: DockMachineOption[];
    currentId: string;
    pending?: string | null;
    error?: boolean;
    side?: 'bottom' | 'top' | 'left' | 'right';
    onSwitch: (id: string) => void;
    onRegionsChange: (regions: DockPointerRect[]) => void;
  } = $props();
  let target = $state<HTMLDivElement>();
  let owner: ReturnType<typeof createDockConversationPopupOwner> | undefined;
  let disposed = false;
  let anchorPosition = $state({ x: 0, y: 0 });
  let anchorFrame: number | undefined;
  function followAnchor(): void {
    if (disposed) return;
    const rect = anchor.getBoundingClientRect();
    const x = side === 'right' ? rect.right : rect.left;
    const y = side === 'bottom' ? rect.bottom : rect.top;
    if (anchorPosition.x !== x || anchorPosition.y !== y) anchorPosition = { x, y };
    anchorFrame = requestAnimationFrame(followAnchor);
  }
  setOwnedPopupContext({
    target: () => target,
    active: () => !disposed && open,
    register: (element, close) => owner?.register(element, close) ?? (() => {}),
  });
  onMount(() => {
    followAnchor();
    const portal = document.createElement('div');
    portal.dataset.dockMachinePortals = '';
    portal.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:var(--layer-modal,100);';
    document.body.append(portal);
    target = portal;
    owner = createDockConversationPopupOwner({
      surface: () => undefined,
      target: portal,
      active: () => !disposed && open,
      onRegionsChange,
      onPopupStateChange: () => {},
    });
  });
  onDestroy(() => {
    disposed = true;
    if (anchorFrame !== undefined) cancelAnimationFrame(anchorFrame);
    owner?.destroy();
    target?.remove();
    onRegionsChange([]);
  });
  const actions = $derived(
    defineActions([
      {
        id: 'machines',
        kind: 'radio-group',
        label: m.dock_machines_label(),
        value: currentId,
        children: machines.map((machine) => ({
          id: machine.id,
          kind: 'radio' as const,
          value: machine.id,
          label:
            pending === machine.id
              ? m.dock_machineConnecting_label({ machine: machine.label })
              : machine.label,
          disabled: pending !== null || machine.id === currentId,
          closeOnSelect: false,
        })),
      },
      ...(error
        ? [{ id: 'error', kind: 'label' as const, label: m.dock_machineSwitchFailed_error() }]
        : []),
    ]),
  );
  const contextMenu = $derived.by(() => {
    if (!open) return undefined;
    return { ...anchorPosition, returnFocus: anchor };
  });
</script>

{#if target && open}
  <ActionMenu
    bind:open
    {actions}
    {contextMenu}
    {side}
    align="start"
    ariaLabel={m.dock_machines_label()}
    class="dock-machine-menu-content min-w-56 max-w-80 shadow-none animate-none! transition-none!"
    onAction={(id) => {
      if (!pending && id !== currentId) onSwitch(id);
    }}
  />
  {#if error}
    <p class="sr-only" role="alert">{m.dock_machineSwitchFailed_error()}</p>
  {:else if pending}
    <p class="sr-only" role="status">
      {m.dock_machineConnecting_label({
        machine: machines.find((item) => item.id === pending)?.label ?? pending,
      })}
    </p>
  {/if}
{/if}
