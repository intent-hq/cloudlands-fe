<script lang="ts">
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  interface Action {
    label: string;
    icon?: IconDefinition;
    dividerBefore?: boolean;
    onClick: () => void;
    disabled?: boolean;
    checked?: boolean;
    detail?: string;
    detailTone?: 'danger';
    submenu?: Action[];
  }

  let {
    additionalActions = [],
    onClose,
    onArchive,
    onDelete,
    showArchiveOption = false,
    showDeleteOption = true,
  }: {
    additionalActions?: Action[];
    onClose?: () => void;
    onArchive?: () => void;
    onDelete?: () => void;
    showArchiveOption?: boolean;
    showDeleteOption?: boolean;
    [key: string]: unknown;
  } = $props();
</script>

{#snippet item(action: Action)}
  <button
    type="button"
    disabled={action.disabled}
    data-checked={action.checked}
    data-detail={action.detail}
    data-detail-tone={action.detailTone}
    data-icon-name={action.icon?.iconName ?? ''}
    onclick={() => {
      action.onClick();
      onClose?.();
    }}
  >
    {action.label}
  </button>
{/snippet}

{#each additionalActions as action (action.label)}
  {#if action.dividerBefore}
    <div data-testid="menu-divider"></div>
  {/if}
  {@render item(action)}
  {#if action.submenu}
    <div role="group" aria-label={action.label}>
      {#each action.submenu as child (child.label)}
        {@render item(child)}
      {/each}
    </div>
  {/if}
{/each}

{#if showArchiveOption}
  <button
    type="button"
    onclick={() => {
      onArchive?.();
      onClose?.();
    }}
  >
    Archive Workspace
  </button>
{/if}

{#if showDeleteOption && onDelete}
  <button
    type="button"
    onclick={() => {
      onDelete();
      onClose?.();
    }}
  >
    Delete Workspace…
  </button>
{/if}
