<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';

  function setupFixture(persist: boolean, delayHydration: boolean) {
    let finishHydration = () => {};
    const hydrationReady = delayHydration
      ? new Promise<void>((resolve) => {
          finishHydration = resolve;
        })
      : undefined;
    return { cleanup: setupRecentRepositoriesPreview(persist, hydrationReady), finishHydration };
  }

  export const preview = definePreview({
    id: 'recent-repositories',
    title: 'Recent repositories',
    defaultState: 'mixed-lengths',
    states: {
      'mixed-lengths': { props: {} },
      persisted: { props: { persist: true } },
      'late-hydration': { props: { persist: true, delayHydration: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectWorkspaceInitializerHydrated } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import RepoSelector, { type RepoChangeDetail } from './RepoSelector.svelte';

  let { persist = false, delayHydration = false }: { persist?: boolean; delayHydration?: boolean } =
    $props();
  // svelte-ignore state_referenced_locally -- one fixture lifecycle per preview mount
  const fixture = setupFixture(persist, delayHydration);
  onDestroy(fixture.cleanup);
  const hydrated$ = selectWorkspaceInitializerHydrated();
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
  {#if delayHydration}
    <Button onclick={fixture.finishHydration}>Complete fixture hydration</Button>
    <output data-testid="hydration-state">{$hydrated$}</output>
  {/if}
</section>
