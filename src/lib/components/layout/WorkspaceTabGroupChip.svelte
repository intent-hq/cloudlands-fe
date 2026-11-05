<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
  import { workspaceTabGroupDisplayName } from './workspace-tab-group-labels';

  interface Props {
    group: WorkspaceTabGroup;
    open: boolean;
    editing?: boolean;
    onToggle: () => void;
    onContextMenu: (event: MouseEvent | KeyboardEvent) => void;
    onRenameCommit: (name: string) => void;
    onRenameCancel: () => void;
  }

  let {
    group,
    open,
    editing = false,
    onToggle,
    onContextMenu,
    onRenameCommit,
    onRenameCancel,
  }: Props = $props();

  let draftName = $state('');
  let settled = false;
  const count = $derived(group.workspaceIds.length);

  function startEditing(node: HTMLInputElement) {
    draftName = group.name;
    settled = false;
    requestAnimationFrame(() => {
      node.focus();
      node.select();
    });
  }

  function commit() {
    if (settled) return;
    settled = true;
    onRenameCommit(draftName);
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      onRenameCancel();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    onContextMenu(event);
  }
</script>

<div
  class={cn('tab-group-chip', open ? 'is-open' : 'is-collapsed', editing && 'is-editing')}
  style:--tab-group-color={`var(--tab-group-${group.color})`}
  data-workspace-tab-group={group.id}
  data-open={open}
>
  {#if editing}
    <span class="tab-group-dot" aria-hidden="true"></span>
    <Input
      class="tab-group-name-input type-caption font-medium!"
      size="sm"
      noFocusStyle
      bind:value={draftName}
      placeholder={m.layout_workspaceTabGroup_name_placeholder()}
      aria-label={m.layout_workspaceTabGroup_name_ariaLabel()}
      onkeydown={handleEditKeydown}
      onblur={commit}
      {@attach startEditing}
      data-workspace-tab-group-name-input
    />
  {:else}
    <Button
      variant="plain"
      type="button"
      class="tab-group-trigger type-caption font-medium!"
      aria-expanded={open}
      aria-label={m.layout_workspaceTabGroup_chip_ariaLabel({
        name: workspaceTabGroupDisplayName(group),
        count,
      })}
      onclick={onToggle}
      oncontextmenu={onContextMenu}
      onkeydown={handleKeydown}
      data-workspace-tab-group-trigger
    >
      <span class="tab-group-dot" aria-hidden="true"></span>
      {#if group.name}
        <span class="tab-group-name">{group.name}</span>
      {/if}
      {#if !open}
        <span class="tab-group-count" aria-hidden="true">{count}</span>
      {/if}
    </Button>
  {/if}
</div>

<style>
  .tab-group-chip {
    display: flex;
    height: 22px;
    max-width: 160px;
    flex: none;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    transition:
      background-color var(--spring-moderate) var(--ease-spring-moderate),
      color var(--spring-moderate) var(--ease-spring-moderate);
  }

  .tab-group-chip.is-collapsed {
    background: hsl(var(--tab-group-color) / 0.16);
    color: hsl(var(--foreground));
  }

  .tab-group-chip.is-collapsed:hover {
    background: hsl(var(--tab-group-color) / 0.24);
  }

  .tab-group-chip.is-open {
    background: hsl(var(--tab-group-color));
    color: hsl(var(--background));
  }

  .tab-group-chip.is-editing {
    padding-left: 8px;
    padding-right: 2px;
  }

  .tab-group-chip :global(.tab-group-trigger) {
    display: flex;
    height: 100%;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border-radius: inherit;
    color: inherit;
  }

  .tab-group-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 999px;
    background: hsl(var(--tab-group-color));
  }

  .is-open .tab-group-dot {
    background: hsl(var(--background));
  }

  .tab-group-name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-group-count {
    flex: none;
    color: hsl(var(--muted-foreground));
    font-variant-numeric: tabular-nums;
  }

  .tab-group-chip :global(.tab-group-name-input) {
    width: 112px;
    height: 18px;
    padding: 0 4px;
    border: 0;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-group-chip {
      transition: none;
    }
  }
</style>
