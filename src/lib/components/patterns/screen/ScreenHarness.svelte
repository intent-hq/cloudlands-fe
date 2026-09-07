<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';
  import Screen from './Screen.svelte';
  import ScreenBody from './ScreenBody.svelte';
  import ScreenFooter from './ScreenFooter.svelte';
  import ScreenHeader from './ScreenHeader.svelte';
  import TakeoverScreen from './TakeoverScreen.svelte';

  let {
    state = 'screen',
    onRetry = () => {},
    inset = false,
  }: {
    state?:
      | 'screen'
      | 'takeover'
      | 'empty'
      | 'error'
      | 'error-danger'
      | 'loading'
      | 'loading-list'
      | 'loading-card-grid'
      | 'loading-form';
    onRetry?: () => void;
    inset?: boolean;
  } = $props();

  const loadingRecipe = $derived(
    state === 'loading-list' ? 'list' : state === 'loading-card-grid' ? 'card-grid' : 'form',
  );
</script>

{#snippet title()}<h1>Example screen</h1>{/snippet}
{#snippet description()}<p>Screen description</p>{/snippet}
{#snippet counter()}<span>2 of 3</span>{/snippet}
{#snippet body()}<p>Screen body</p>{/snippet}
{#snippet secondary()}<Button variant="outline">Cancel</Button>{/snippet}
{#snippet primary()}<Button>Continue</Button>{/snippet}
{#snippet details()}<p>Error details</p>{/snippet}
{#snippet emptyMessage()}<p>Nothing here yet</p>{/snippet}
{#snippet errorMessage()}<p>We could not load this screen</p>{/snippet}

{#if state === 'takeover'}
  <TakeoverScreen {title} {description} {counter} {secondary} {primary}>
    {@render body()}
  </TakeoverScreen>
{:else if state === 'empty'}
  <EmptyState
    description={emptyMessage}
    actionLabel="Continue"
    onAction={() => undefined}
    {inset}
  />
{:else if state === 'error' || state === 'error-danger'}
  <ErrorState
    message={errorMessage}
    retryLabel="Retry"
    {onRetry}
    {details}
    detailsLabel="Details"
    severity={state === 'error-danger' ? 'danger' : 'routine'}
    {inset}
  />
{:else if state.startsWith('loading')}
  <LoadingState recipe={loadingRecipe} count={2} label="Loading screen" {inset} />
{:else}
  <Screen>
    <ScreenHeader {title} {description} />
    <ScreenBody>{@render body()}</ScreenBody>
    <ScreenFooter {secondary} {primary} />
  </Screen>
{/if}
