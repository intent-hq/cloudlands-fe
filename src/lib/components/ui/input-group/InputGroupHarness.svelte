<script lang="ts">
  import { Button } from '../button';
  import { Input } from '../input';
  import InputGroup from './input-group.svelte';
</script>

{#snippet leading()}<span aria-hidden="true">@</span>{/snippet}
{#snippet trailing()}<Button variant="ghost" size="xs">Apply</Button>{/snippet}

<InputGroup {leading} {trailing} error="Choose a valid handle">
  <Input aria-label="Handle" aria-invalid="true" />
</InputGroup>
