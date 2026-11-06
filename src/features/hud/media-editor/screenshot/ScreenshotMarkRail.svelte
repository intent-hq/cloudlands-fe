<script lang="ts">
  import { untrack } from 'svelte';
  import { menuItem } from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import RectangleIcon from 'phosphor-svelte/lib/RectangleIcon';
  import ScribbleIcon from 'phosphor-svelte/lib/ScribbleIcon';
  import ArrowUpRightIcon from 'phosphor-svelte/lib/ArrowUpRightIcon';
  import TextTIcon from 'phosphor-svelte/lib/TextTIcon';
  import DropIcon from 'phosphor-svelte/lib/DropIcon';
  import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
  import type { DockMediaEditMark } from '$shared/dock-media-edit';
  import { screenshotKindLabel } from './screenshot-labels';

  let {
    items,
    selectedIds,
    disabled = false,
    onSelect,
    onSelectAll,
    onDelete,
  }: {
    items: readonly { id: string; n: number | null; kind: DockMediaEditMark['kind'] | 'blur' }[];
    selectedIds: readonly string[];
    disabled?: boolean;
    onSelect: (id: string, event: MouseEvent | KeyboardEvent) => void;
    onSelectAll: () => void;
    onDelete: () => void;
  } = $props();
  let focusedId = $state<string | null>(null);
  const tabId = $derived(
    focusedId && items.some((item) => item.id === focusedId)
      ? focusedId
      : (selectedIds.find((id) => items.some((item) => item.id === id)) ?? items[0]?.id ?? null),
  );
  $effect(() => {
    const ids = items.map((item) => item.id);
    untrack(() => {
      if (focusedId && !ids.includes(focusedId)) focusedId = null;
    });
  });
  const icons = {
    box: RectangleIcon,
    draw: ScribbleIcon,
    arrow: ArrowUpRightIcon,
    text: TextTIcon,
    click: CursorClickIcon,
    element: RectangleIcon,
    blur: DropIcon,
  };
  function key(event: KeyboardEvent) {
    if (disabled) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      onSelectAll();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const rail = event.currentTarget as HTMLElement;
      const buttons = [...rail.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : Math.max(
                0,
                Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
              );
      const item = items[next];
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      focusedId = item.id;
      buttons[next]?.focus();
      onSelect(item.id, event);
    }
  }
</script>

<div class="mark-panel">
  <div class="rail-heading">
    <span>{m.dock_screenshotEditor_marks()}</span>
  </div>
  <div
    class="rail"
    role="listbox"
    aria-label={m.dock_screenshotEditor_marks()}
    aria-multiselectable="true"
    tabindex={items.length ? -1 : 0}
    onkeydown={key}
  >
    {#each items as item (item.id)}
      {@const Icon = icons[item.kind]}
      {@const label =
        item.n === null
          ? screenshotKindLabel('blur')
          : m.dock_screenshotEditor_mark({ n: item.n, kind: screenshotKindLabel(item.kind) })}
      <Button
        variant="ghost"
        size="compact"
        class={menuItem({ class: 'mark-chip' })}
        role="option"
        aria-label={label}
        aria-selected={selectedIds.includes(item.id)}
        active={selectedIds.includes(item.id)}
        tooltip={label}
        {disabled}
        tabindex={tabId === item.id ? 0 : -1}
        onfocus={() => (focusedId = item.id)}
        onclick={(event) => {
          focusedId = item.id;
          onSelect(item.id, event);
        }}
      >
        <Icon size={14} />
        <span class="mark-label">{label}</span>
      </Button>
    {/each}
  </div>
  {#if !items.length}
    <p class="empty">{m.dock_screenshotEditor_empty()}</p>
  {/if}
</div>

<style>
  .mark-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 4px;
    min-width: 0;
  }
  .rail-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 4px;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
  }
  .empty {
    margin: 0;
    padding: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: hsl(var(--muted-foreground));
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: stretch;
    min-width: 0;
    padding: 0;
  }
  .rail :global(.mark-chip) {
    width: 100%;
    justify-content: flex-start;
    padding: 6px 8px;
    gap: 8px;
    min-height: 32px;
  }
  .mark-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-size: 12px;
  }
</style>
