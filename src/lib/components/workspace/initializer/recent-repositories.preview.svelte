<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  function setupFixture() {
    return setupRecentRepositoriesPreview();
  }

  export const preview = definePreview({
    id: 'recent-repositories',
    title: 'Recent repositories',
    defaultState: 'mixed-lengths',
    states: { 'mixed-lengths': { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import RepoSelector, { type RepoChangeDetail } from './RepoSelector.svelte';

  onDestroy(setupFixture());
  let selection = $state<RepoChangeDetail | null>(null);
</script>

<section class="w-full min-w-0 p-4" data-testid="recent-repositories-fixture">
  <RepoSelector
    triggerAriaLabel="Choose fixture repository"
    onchange={(event) => (selection = event.detail)}
  />
  <output data-testid="repo-selection">{JSON.stringify(selection)}</output>
  <Button class="mt-4 w-full" data-testid="centered-action">Continue</Button>
</section>
