<script lang="ts">
  import { Input } from '$lib/components/ui/input';

  let { embedded = false, isActive = true } = $props<{
    embedded?: boolean;
    isActive?: boolean;
  }>();
  let draft = $state('');
</script>

<div data-testid={embedded ? 'intent-content' : 'workspace-content'} data-active={isActive}>
  <Input aria-label={embedded ? 'Chat draft' : 'Workspace search'} bind:value={draft} />
</div>
