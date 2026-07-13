<script lang="ts">
  let { value, disabled, onchange }: any = $props();
</script>

<div data-testid="branch-selector" data-value={value} data-disabled={disabled}>
  <span>{value}</span>
  <button
    data-testid="branch-selector-change"
    type="button"
    onclick={() => onchange?.({ detail: { branch: 'develop' } })}
  >change</button>
</div>

