<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  function setupFixture(persist: boolean) {
    return setupRecentRepositoriesPreview(persist);
  }

  export const preview = definePreview({
    id: 'recent-repositories',
    title: 'Recent repositories',
    defaultState: 'mixed-lengths',
    states: { 'mixed-lengths': { props: {} }, persisted: { props: { persist: true } } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import RepoSelector, { type RepoChangeDetail } from './RepoSelector.svelte';

  let { persist = false }: { persist?: boolean } = $props();
  // svelte-ignore state_referenced_locally -- one fixture lifecycle per preview mount
  onDestroy(setupFixture(persist));
  let sourceRefresh = $state(0);
  let selection = $state<RepoChangeDetail | null>(null);
</script>

<section class="w-full min-w-0 p-4" data-testid="recent-repositories-fixture">
  {#key sourceRefresh}
    <RepoSelector
      triggerAriaLabel="Choose fixture repository"
      onchange={(event) => (selection = event.detail)}
    />
  {/key}
  <output data-testid="repo-selection">{JSON.stringify(selection)}</output>
  <Button class="mt-4 w-full" data-testid="centered-action">Continue</Button>
  <Button class="mt-2" onclick={() => sourceRefresh++}>Refresh fixture sources</Button>
</section>
