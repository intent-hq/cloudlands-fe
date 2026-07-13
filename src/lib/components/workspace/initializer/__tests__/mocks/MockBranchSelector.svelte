<script lang="ts">
  interface Props {
    value?: string;
    showTriggerChevron?: boolean;
    triggerContentClass?: string;
  }

  let { value = '', showTriggerChevron = false, triggerContentClass = '' }: Props = $props();
</script>

<button
  type="button"
  data-testid="branch-selector"
  data-show-trigger-chevron={String(showTriggerChevron)}
  data-trigger-content-class={triggerContentClass}
>
  {value}
</button>
