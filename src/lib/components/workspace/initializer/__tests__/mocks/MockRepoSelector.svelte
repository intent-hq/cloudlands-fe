<script lang="ts">
  interface Props {
    value?: string;
    displayValue?: string;
    emptyLabel?: string;
    triggerSuffix?: string;
    triggerValueClass?: string;
    triggerClass?: string;
  }

  let {
    value = '',
    displayValue,
    emptyLabel = 'Select a repository',
    triggerSuffix,
    triggerValueClass = '',
    triggerClass = '',
  }: Props = $props();
</script>

<button
  type="button"
  class={triggerClass}
  data-testid="repo-selector"
  data-trigger-class={triggerClass}
  data-trigger-suffix={triggerSuffix ?? ''}
  data-trigger-value-class={triggerValueClass}
>
  {value ? (displayValue ?? value) : emptyLabel}{#if triggerSuffix}
    ({triggerSuffix}){/if}
</button>
