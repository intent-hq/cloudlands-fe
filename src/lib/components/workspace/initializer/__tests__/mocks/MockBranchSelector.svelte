<script lang="ts">
  interface Props {
    value?: string;
    triggerClass?: string;
    showTriggerChevron?: boolean;
    triggerContentClass?: string;
    suggestedBranch?: string;
    disabled?: boolean;
  }

  let {
    value = '',
    triggerClass = '',
    showTriggerChevron = false,
    triggerContentClass = '',
    suggestedBranch,
    disabled = false,
  }: Props = $props();
</script>

<button
  type="button"
  class={triggerClass}
  data-testid="branch-selector"
  data-trigger-class={triggerClass}
  data-show-trigger-chevron={String(showTriggerChevron)}
  data-trigger-content-class={triggerContentClass}
  data-suggested-branch={suggestedBranch ?? ''}
  data-disabled={String(disabled)}
>
  {value}
</button>
