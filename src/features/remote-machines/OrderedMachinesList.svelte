<!--
  Settings → Machines with `machineOrder: 1`: one list of every place the
  current backend can run agents, in its stored order (PROTOCOL
  `methods/nodes.md` → "Ordered machine list"). The first row is preferred.
  The owner reorders by dragging a row's handle or with the Move up / Move
  down items of its menu; each move sends the whole list. Members read it.
  The caller renders each row's content and merges the controls it gets.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { Fa } from 'svelte-fa';
  import { ListView } from '$lib/components/patterns/collection';
  import { faArrowDown, faArrowUp, faGripLines } from '$lib/icons/phosphor-icons';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import {
    machineOrderId,
    type MachineOrderKey,
    type MachineOrderRow,
  } from '$shared/types/remote-machines';
  import { store as appStore } from '$store/renderer/store';
  import type { MachineOrderControls } from './machine-order-controls';
  import { moveMachineOrder, stepMachineOrder } from './machine-order';
  import { machineOrderSetRequested } from './remote-machines-slice';

  const MOVE_UP = 'order:move-up';
  const MOVE_DOWN = 'order:move-down';

  let {
    rows,
    backendLabel,
    canReorder,
    saving = false,
    machineRow,
    footer,
  }: {
    rows: readonly MachineOrderRow[];
    backendLabel: string;
    /** The owner, with more than one row. */
    canReorder: boolean;
    /** A reorder is in flight: moves wait for it. */
    saving?: boolean;
    machineRow: Snippet<[MachineOrderRow, MachineOrderControls]>;
    /** Extra content after the rows (a new cloud entry's setup form). */
    footer?: Snippet;
  } = $props();

  let draggedId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dragOverPosition = $state<'before' | 'after' | null>(null);
  let announcement = $state('');
  let listElement = $state<HTMLElement | null>(null);

  function send(order: MachineOrderKey[] | null, id: string) {
    if (!order || saving) return false;
    appStore.dispatch(machineOrderSetRequested(order));
    const position = order.findIndex((key) => machineOrderId(key) === id) + 1;
    const name = rows.find((entry) => machineOrderId(entry) === id)?.name ?? '';
    announcement = m.remoteMachines_order_announcement({ name, position });
    return true;
  }

  async function step(id: string, direction: -1 | 1) {
    if (!send(stepMachineOrder(rows, id, direction), id)) return;
    // The row moved under its open menu: give focus back to its menu button.
    await tick();
    listElement
      ?.querySelector<HTMLElement>(
        `[data-machine-order-row="${CSS.escape(id)}"] button[aria-haspopup]`,
      )
      ?.focus();
  }

  function controlsFor(entry: MachineOrderRow, index: number): MachineOrderControls {
    const id = machineOrderId(entry);
    return {
      preferred: index === 0,
      actions: canReorder
        ? [
            {
              id: MOVE_UP,
              label: m.remoteMachines_order_moveUp_label(),
              icon: faArrowUp,
              disabled: saving || index === 0,
            },
            {
              id: MOVE_DOWN,
              label: m.remoteMachines_order_moveDown_label(),
              icon: faArrowDown,
              disabled: saving || index === rows.length - 1,
            },
          ]
        : [],
      onAction: (action) => {
        if (action !== MOVE_UP && action !== MOVE_DOWN) return false;
        void step(id, action === MOVE_UP ? -1 : 1);
        return true;
      },
    };
  }

  function dropPosition(event: DragEvent, element: HTMLElement): 'before' | 'after' {
    const rect = element.getBoundingClientRect();
    const y = Number.isFinite(event.clientY) ? event.clientY : rect.top;
    return y <= rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function handleDragStart(event: DragEvent, id: string) {
    if (saving) {
      event.preventDefault();
      return;
    }
    draggedId = id;
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    const element = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(
      '[data-machine-order-row]',
    );
    if (element && typeof event.dataTransfer.setDragImage === 'function')
      event.dataTransfer.setDragImage(element, 16, element.offsetHeight / 2);
  }

  function handleDragOver(event: DragEvent, id: string) {
    if (!draggedId) return;
    if (draggedId === id) {
      dragOverId = null;
      dragOverPosition = null;
      return;
    }
    event.preventDefault();
    dragOverId = id;
    dragOverPosition = dropPosition(event, event.currentTarget as HTMLElement);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent, targetId: string) {
    if (!draggedId) return;
    event.preventDefault();
    const position =
      dragOverId === targetId && dragOverPosition
        ? dragOverPosition
        : dropPosition(event, event.currentTarget as HTMLElement);
    send(moveMachineOrder(rows, draggedId, targetId, position), draggedId);
    handleDragEnd();
  }

  function handleDragEnd() {
    draggedId = null;
    dragOverId = null;
    dragOverPosition = null;
  }
</script>

<section
  class="space-y-3"
  aria-labelledby="machine-order-title"
  data-machine-order-section
  bind:this={listElement}
>
  <div>
    <h3 id="machine-order-title" class="type-title text-foreground">
      {m.remoteMachines_order_title({ backend: backendLabel })}
    </h3>
    <p class="max-w-2xl type-body text-muted-foreground">
      {canReorder
        ? m.remoteMachines_order_description({ backend: backendLabel })
        : m.remoteMachines_order_readOnly_description({ backend: backendLabel })}
    </p>
  </div>
  <div class="overflow-visible rounded-xl border border-border bg-card">
    <ListView
      virtualize={false}
      items={rows}
      getKey={machineOrderId}
      getText={(entry) => entry.name}
      status="ready"
      ariaLabel={m.remoteMachines_order_title({ backend: backendLabel })}
      class="overflow-visible [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item, index })}
        {@const id = machineOrderId(item)}
        <!-- svelte-ignore a11y_no_static_element_interactions (drop target; keyboard moves are the row menu's Move up / Move down) -->
        <div
          class={cn(
            'relative flex items-stretch transition-opacity data-[dragging=true]:opacity-60',
            index > 0 && 'border-t border-border',
          )}
          data-machine-order-row={id}
          data-machine-order-kind={item.kind}
          data-dragging={draggedId === id || undefined}
          ondragover={canReorder ? (event) => handleDragOver(event, id) : undefined}
          ondrop={canReorder ? (event) => handleDrop(event, id) : undefined}
        >
          {#if dragOverId === id && dragOverPosition}
            <div
              data-machine-order-insertion
              data-position={dragOverPosition}
              class={cn(
                'pointer-events-none absolute right-2 left-2 z-10 h-0.5 rounded-full bg-primary',
                dragOverPosition === 'before' ? 'top-0' : 'bottom-0',
              )}
            ></div>
          {/if}
          {#if canReorder}
            <!-- svelte-ignore a11y_no_static_element_interactions (pointer drag handle; the row menu holds the keyboard equivalent) -->
            <span
              class={cn(
                'flex w-6 shrink-0 items-start justify-center pt-4 pl-2 text-muted-foreground',
                saving ? 'cursor-default opacity-50' : 'cursor-grab active:cursor-grabbing',
              )}
              draggable={saving ? 'false' : 'true'}
              aria-hidden="true"
              data-machine-order-handle
              ondragstart={(event) => handleDragStart(event, id)}
              ondragend={handleDragEnd}
            >
              <Fa icon={faGripLines} class="size-3" />
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            {@render machineRow(item, controlsFor(item, index))}
          </div>
        </div>
      {/snippet}
    </ListView>
    {@render footer?.()}
  </div>
  {#if canReorder}
    <span class="sr-only" aria-live="polite">{announcement}</span>
  {/if}
</section>
