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
  }: { state?: 'screen' | 'takeover' | 'empty' | 'error' | 'loading'; onRetry?: () => void } =
    $props();
</script>

{#snippet title()}<h1>Example screen</h1>{/snippet}
{#snippet description()}<p>Screen description</p>{/snippet}
{#snippet counter()}<span>2 of 3</span>{/snippet}
{#snippet body()}<p>Screen body</p>{/snippet}
{#snippet secondary()}<Button variant="outline">Cancel</Button>{/snippet}
{#snippet primary()}<Button>Continue</Button>{/snippet}
{#snippet details()}<p>Error details</p>{/snippet}

{#if state === 'takeover'}
  <TakeoverScreen {title} {description} {counter} {secondary} {primary}>
    {@render body()}
  </TakeoverScreen>
{:else if state === 'empty'}
  <EmptyState {title} {description} actions={primary} />
{:else if state === 'error'}
  <ErrorState message={title} retryLabel="Retry" {onRetry} {details} detailsLabel="Details" />
{:else if state === 'loading'}
  <LoadingState recipe="form" count={2} label="Loading screen" />
{:else}
  <Screen>
    <ScreenHeader {title} {description} />
    <ScreenBody>{@render body()}</ScreenBody>
    <ScreenFooter {secondary} {primary} />
  </Screen>
{/if}
