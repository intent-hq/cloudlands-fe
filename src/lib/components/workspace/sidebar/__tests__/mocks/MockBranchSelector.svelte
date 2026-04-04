<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let { value, disabled, onchange }: any = $props();
</script>

<div data-testid="branch-selector" data-value={value} data-disabled={disabled}>
  <span>{value}</span>
</div>

