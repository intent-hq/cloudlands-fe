<script lang="ts">
  interface Props {
    value?: string;
    displayValue?: string;
    emptyLabel?: string;
  }

  let { value = '', displayValue, emptyLabel = 'Select a repository' }: Props = $props();
</script>

<button type="button" data-testid="repo-selector">
  {value ? (displayValue ?? value) : emptyLabel}
</button>
