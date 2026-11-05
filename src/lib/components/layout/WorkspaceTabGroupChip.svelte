<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
  import {
    workspaceTabGroupColorValue,
    workspaceTabGroupDisplayName,
  } from './workspace-tab-group-labels';

  interface Props {
    group: WorkspaceTabGroup;
    open: boolean;
    editing?: boolean;
    onToggle: () => void;
    onContextMenu: (event: MouseEvent | KeyboardEvent) => void;
    /** Called with the new name, or `null` when the rename is cancelled. */
    onRenameEnd: (name: string | null) => void;
  }

  let { group, open, editing = false, onToggle, onContextMenu, onRenameEnd }: Props = $props();

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
    onRenameEnd(draftName);
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      onRenameEnd(null);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    onContextMenu(event);
  }
</script>

<div
  class={cn('tab-group-chip', open ? 'is-open' : 'is-collapsed', editing && 'is-editing')}
  style:--tab-group-color={workspaceTabGroupColorValue(group.color)}
  data-workspace-tab-group={group.id}
  data-open={open}
>
  {#if editing}
    <span class="tab-group-dot" aria-hidden="true"></span>
    <Input
      class="tab-group-name-input type-caption font-medium!"
      size="compact"
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
      class="tab-group-trigger type-caption font-medium! outline-none!"
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

  /* Keyboard focus underlines the label, like workspace tabs, instead of
     drawing the default focus box around the chip. */
  .tab-group-chip :global(.tab-group-trigger:focus-visible :is(.tab-group-name, .tab-group-count)) {
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }

  /* An unnamed open chip shows only its dot, so the dot carries focus there. */
  .tab-group-chip :global(.tab-group-trigger:focus-visible .tab-group-dot) {
    box-shadow: 0 0 0 2px currentColor;
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

  @container style(--motion-reduced: 1) {
    .tab-group-chip {
      transition: none;
    }
  }
</style>
