<script lang="ts">
  interface Props {
    value?: string;
    displayValue?: string;
    emptyLabel?: string;
    triggerSuffix?: string;
    triggerValueClass?: string;
  }

  let {
    value = '',
    displayValue,
    emptyLabel = 'Select a repository',
    triggerSuffix,
    triggerValueClass = '',
  }: Props = $props();
</script>

<button
  type="button"
  data-testid="repo-selector"
  data-trigger-suffix={triggerSuffix ?? ''}
  data-trigger-value-class={triggerValueClass}
>
  {value ? (displayValue ?? value) : emptyLabel}{#if triggerSuffix}
    ({triggerSuffix}){/if}
</button>
