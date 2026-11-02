<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Toast } from '$lib/components/ui/toast';
  import HomePage from './HomePage.svelte';
  import { setupHomeSetAsideFixtures } from '../../test/fixtures/home-set-aside';

  let { view = 'list', height = 720 }: { view?: 'list' | 'board'; height?: number } = $props();
  const dispose = untrack(() => setupHomeSetAsideFixtures(view));
  onDestroy(dispose);
</script>

<div
  class="min-h-0 bg-background text-foreground"
  style:height="{height}px"
  data-home-set-aside-review
>
  <HomePage />
  <Toast />
</div>
