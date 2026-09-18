<script lang="ts">
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  interface Action {
    label: string;
    icon?: IconDefinition;
    dividerBefore?: boolean;
    onClick: () => void;
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

{#each additionalActions as action (action.label)}
  {#if action.dividerBefore}
    <div data-testid="menu-divider"></div>
  {/if}
  <button
    type="button"
    data-icon-name={action.icon?.iconName ?? ''}
    onclick={() => {
      action.onClick();
      onClose?.();
    }}
  >
    {action.label}
  </button>
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
