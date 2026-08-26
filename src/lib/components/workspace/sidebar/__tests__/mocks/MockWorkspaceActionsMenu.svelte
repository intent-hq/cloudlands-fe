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
  }: {
    additionalActions?: Action[];
    onClose?: () => void;
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
