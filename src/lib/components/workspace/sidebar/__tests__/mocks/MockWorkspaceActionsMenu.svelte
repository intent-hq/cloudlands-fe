<script lang="ts">
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  interface Action {
    label: string;
    icon?: IconDefinition;
    onClick: () => void;
  }

  let {
    additionalActions = [],
    onClose,
    onArchive,
    showArchiveOption = false,
  }: {
    additionalActions?: Action[];
    onClose?: () => void;
    onArchive?: () => void;
    showArchiveOption?: boolean;
    [key: string]: unknown;
  } = $props();
</script>

{#each additionalActions as action (action.label)}
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
