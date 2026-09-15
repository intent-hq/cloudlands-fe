<script lang="ts">
  import SizeProvider from '../SizeProvider.svelte';
  import Button from './button.svelte';
</script>

{#snippet leadingIcon()}
  <svg data-testid="leading-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8h10" stroke="currentColor" stroke-width="1.5"></path>
  </svg>
{/snippet}

{#snippet trailingIcon()}
  <svg data-testid="trailing-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="m9 4 4 4-4 4" stroke="currentColor" stroke-width="1.5"></path>
  </svg>
{/snippet}

<SizeProvider size="compact">
  <Button aria-label="Contextual action">Contextual action</Button>
  <Button aria-label="Explicit action" size="lg">Explicit action</Button>
  <Button aria-label="Navigate" {leadingIcon} {trailingIcon}>Navigate</Button>
</SizeProvider>
<Button aria-label="Active action" variant="outline" active>Active action</Button>
<Button aria-label="Loading action" loading>Preserved loading label</Button>
