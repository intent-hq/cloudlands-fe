<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
  import { setupSelectedRepositoryForm } from './selected-repository-form.test-fixtures';
  let { provider }: { provider: 'github' | 'gitlab' } = $props();
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only fixture installs mock clients and starts production sagas; it makes no live data reads.
  onDestroy(setupSelectedRepositoryForm(untrack(() => provider)));
</script>

<div
  class="w-full min-w-0 bg-background p-4 text-foreground"
  data-testid="selected-repository-form"
>
  <CompactWorkspaceInitializer isExpanded autoFocus={false} />
</div>
