<script lang="ts">
  /**
   * Store host for {@link WorkspaceHomeBanner}; renders nothing without a home.
   * While the home's checkout and setup output is open it asks the saga to
   * read it from the workspace's detail read, again on each home change
   * (nodes.md "Opening the home": rows and events carry no output).
   */
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
  import {
    selectCanMoveWorkspaceHome,
    selectHomeSetupFailureKey,
    selectHomeSetupOutput,
    selectHomeWaiting,
    selectWorkspaceHomeBannerView,
  } from '../workspace-home-selectors';
  import {
    homeSetupFailureDismissed,
    homeSetupOutputRequested,
    homeWaitRequested,
    moveHomeDialogOpened,
  } from '../workspace-home-slice';

  let { workspaceId }: { workspaceId: string } = $props();

  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeBannerView(workspaceId$);
  const canMove$ = selectCanMoveWorkspaceHome(workspaceId$);
  const waiting$ = selectHomeWaiting(workspaceId$);
  const failureKey$ = selectHomeSetupFailureKey(workspaceId$);

  const output$ = selectHomeSetupOutput(workspaceId$);

  let outputOpen = $state(false);

  const view = $derived($view$);

  // A new workspace or a finished opening closes the log.
  $effect(() => {
    void workspaceId;
    outputOpen = false;
  });
  $effect(() => {
    if (!view?.setup) outputOpen = false;
  });

  // Read the output again on every home change while the log is open (each
  // served home is a new view).
  $effect(() => {
    if (!outputOpen || !$view$) return;
    appStore.dispatch(homeSetupOutputRequested(workspaceId));
  });
</script>

<WorkspaceHomeBanner
  {view}
  canMove={$canMove$}
  waiting={$waiting$}
  onWait={() => appStore.dispatch(homeWaitRequested(workspaceId))}
  onMove={() => appStore.dispatch(moveHomeDialogOpened(workspaceId))}
  {outputOpen}
  output={$output$?.text}
  outputTruncated={$output$?.truncated === true}
  onToggleOutput={() => (outputOpen = !outputOpen)}
  onDismiss={() => {
    if ($failureKey$) appStore.dispatch(homeSetupFailureDismissed($failureKey$));
  }}
/>
