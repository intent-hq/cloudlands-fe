<script lang="ts">
  import Badge from './badge.svelte';

  let removed = $state(false);
</script>

{#snippet shield()}
  <svg aria-label="Shield icon" viewBox="0 0 12 12"
    ><path d="M6 1 10 3v3c0 2-2 4-4 5-2-1-4-3-4-5V3Z" /></svg
  >
{/snippet}

{#if !removed}
  <Badge
    data-testid="removable-badge"
    variant="success"
    dot
    leadingIcon={shield}
    removable
    removeLabel="Remove status"
    onRemove={() => (removed = true)}>Stable</Badge
  >
{/if}

<output aria-label="Badge removed">{removed}</output>
