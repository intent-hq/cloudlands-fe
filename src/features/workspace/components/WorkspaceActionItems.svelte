<script lang="ts">
  import WorkspaceActionItems from './WorkspaceActionItems.svelte';
  import {
    resolveEditorIcon,
    resolveEditorFallbackIcon,
  } from '$lib/components/shared/icons/editor-icon';
  import type { IconWeight } from 'phosphor-svelte';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import * as Menu from '$lib/components/ui/menu';
  import { formatShortcut } from '$lib/utils/shortcuts';
  import type { MenuAction } from './WorkspaceActionsMenu.svelte';

  let {
    actions,
    menu,
    iconWeight,
    onClose,
    selection,
  }: {
    actions: MenuAction[];
    menu: boolean;
    iconWeight?: IconWeight;
    onClose?: () => void;
    selection?: 'single';
  } = $props();
  let expandedId: string | null = $state(null);
  function activate(action: MenuAction) {
    if (action.disabled) return;
    action.onClick();
    onClose?.();
  }
</script>

{#snippet label(action: MenuAction)}
  <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
    {#if action.editor}
      {@const EditorIcon = resolveEditorIcon(action.editor)}
      {#if action.editor.iconBase64}<img
          src="data:image/png;base64,{action.editor.iconBase64}"
          alt=""
          class="size-4"
        />
      {:else if EditorIcon}<EditorIcon size={16} />
      {:else}<Fa icon={resolveEditorFallbackIcon(action.editor.category)} size={16} />{/if}
    {:else if action.iconSnippet}{@render action.iconSnippet()}
    {:else if action.icon}<Fa
        icon={action.icon}
        weight={iconWeight}
        size={16}
        class="text-muted-foreground"
      />{/if}
  </span>
  <span class="min-w-0 flex-1 truncate text-left" title={action.label}>{action.label}</span>
  {#if action.shortcut}<span class="ml-4" aria-hidden="true"
      ><ShortcutChip>{formatShortcut(action.shortcut)}</ShortcutChip></span
    >{/if}
{/snippet}

{#each actions as action (action.id)}
  {#if action.dividerBefore}
    {#if menu}<Menu.Separator />{:else}<div class="my-1 h-px bg-border" role="separator"></div>{/if}
  {/if}
  {#if menu}
    {#if action.submenu}
      <Menu.Sub>
        <Menu.SubTrigger disabled={action.disabled}>{@render label(action)}</Menu.SubTrigger>
        <Menu.SubContent class="w-60">
          {#if action.selection === 'single'}
            <Menu.RadioGroup
              value={action.submenu.find((item) => item.checked)?.id ?? ''}
              aria-label={action.label}
            >
              <WorkspaceActionItems
                actions={action.submenu.filter((item) => item.checked !== undefined)}
                selection="single"
                {menu}
                {iconWeight}
                {onClose}
              />
            </Menu.RadioGroup>
            <WorkspaceActionItems
              actions={action.submenu.filter((item) => item.checked === undefined)}
              {menu}
              {iconWeight}
              {onClose}
            />
          {:else}
            <WorkspaceActionItems actions={action.submenu} {menu} {iconWeight} {onClose} />
          {/if}
        </Menu.SubContent>
      </Menu.Sub>
    {:else if selection === 'single' && action.checked !== undefined}
      <Menu.RadioItem
        value={action.id}
        disabled={action.disabled}
        closeOnSelect
        onSelect={() => activate(action)}
        data-action-id={action.id}
      >
        {@render label(action)}
      </Menu.RadioItem>
    {:else if action.checked !== undefined}
      <Menu.CheckboxItem
        checked={action.checked}
        disabled={action.disabled}
        closeOnSelect
        onSelect={() => activate(action)}
        data-action-id={action.id}
      >
        {@render label(action)}
      </Menu.CheckboxItem>
    {:else}
      <Menu.Item
        destructive={action.variant === 'destructive'}
        disabled={action.disabled}
        onSelect={() => activate(action)}
        data-action-id={action.id}
      >
        {@render label(action)}
      </Menu.Item>
    {/if}
  {:else if action.id === 'open-in' && action.submenu}
    <WorkspaceActionItems actions={action.submenu} {menu} {iconWeight} {onClose} />
  {:else}
    <Button
      variant="ghost"
      size="sm"
      class="w-full justify-start gap-2 {action.variant === 'destructive'
        ? 'text-danger hover:text-danger'
        : ''}"
      disabled={action.disabled}
      aria-expanded={action.submenu ? expandedId === action.id : undefined}
      onclick={() =>
        action.submenu
          ? (expandedId = expandedId === action.id ? null : action.id)
          : activate(action)}
    >
      {@render label(action)}
      {#if action.submenu}<Fa
          icon={expandedId === action.id ? faChevronDown : faChevronLeft}
          size={12}
        />
      {:else if action.checked !== undefined}<Menu.Indicator
          state={action.checked ? 'checked' : 'empty'}
        />{/if}
    </Button>
    {#if action.submenu && expandedId === action.id}
      <div class="pl-4">
        <WorkspaceActionItems actions={action.submenu} {menu} {iconWeight} {onClose} />
      </div>
    {/if}
  {/if}
{/each}
