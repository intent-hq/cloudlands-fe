<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Toast } from '$lib/components/ui/toast';
  import WorkspaceWarningDialogs from '$lib/components/modals/WorkspaceWarningDialogs.svelte';
  import HomePage from './HomePage.svelte';
  import { setupHomeMultiSelectFixtures } from '../../test/fixtures/home-multi-select';

  let { view = 'list', height = 720 }: { view?: 'list' | 'board'; height?: number } = $props();
  const dispose = untrack(() => setupHomeMultiSelectFixtures(view));
  onDestroy(dispose);
</script>

<div class="min-h-0 bg-background text-foreground" style:height="{height}px">
  <HomePage />
  <WorkspaceWarningDialogs />
  <Toast />
</div>
