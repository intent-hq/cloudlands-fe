<script lang="ts">
  /**
   * Store host for {@link WorkspaceHomeBanner}; renders nothing without a home.
   * While the home's checkout and setup output is open it reads it from the
   * workspace's detail read (`workspace.get`), again on each home change
   * (nodes.md "Opening the home": rows and events carry no output).
   */
  import { writable } from 'svelte/store';
  import { appClient } from '$lib/client';
  import { createLogger } from '$lib/utils/client-logger';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
  import {
    selectCanMoveWorkspaceHome,
    selectHomeSetupFailureDismissed,
    selectHomeWaiting,
    selectWorkspaceHomeId,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import {
    homeSetupFailureDismissed,
    homeWaitRequested,
    moveHomeDialogOpened,
  } from '../workspace-home-slice';

  const logger = createLogger('WorkspaceHomeBannerHost');

  let { workspaceId }: { workspaceId: string } = $props();

  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const canMove$ = selectCanMoveWorkspaceHome(workspaceId$);
  const waiting$ = selectHomeWaiting(workspaceId$);
  const dismissed$ = selectHomeSetupFailureDismissed(workspaceId$);
  const homeId$ = selectWorkspaceHomeId(workspaceId$);

  let outputOpen = $state(false);
  let output = $state<{ text?: string; truncated: boolean }>({ truncated: false });

  const view = $derived(
    $view$?.banner === 'setupFailed' && $dismissed$ ? { ...$view$, banner: null } : $view$,
  );

  // A new workspace or a finished opening closes the log.
  $effect(() => {
    void workspaceId;
    outputOpen = false;
    output = { truncated: false };
  });
  $effect(() => {
    if (!view?.setup) outputOpen = false;
  });

  // Re-read on every home change while the log is open (each new view is a
  // new served home); the last answer wins.
  let reads = 0;
  $effect(() => {
    if (!outputOpen || !$view$) return;
    const read = ++reads;
    const id = workspaceId;
    void appClient.workspaces
      .get(id)
      .then((workspace) => {
        if (read !== reads) return;
        const setup = workspace?.home?.setup;
        output = { text: setup?.output, truncated: setup?.outputTruncated === true };
      })
      .catch((error: unknown) => {
        logger.warn('could not read the home setup output', { workspaceId: id, error });
      });
  });
</script>

<WorkspaceHomeBanner
  {view}
  canMove={$canMove$}
  waiting={$waiting$}
  onWait={() => appStore.dispatch(homeWaitRequested(workspaceId))}
  onMove={() => appStore.dispatch(moveHomeDialogOpened(workspaceId))}
  {outputOpen}
  output={output.text}
  outputTruncated={output.truncated}
  onToggleOutput={() => (outputOpen = !outputOpen)}
  onDismiss={() => {
    if ($homeId$) appStore.dispatch(homeSetupFailureDismissed($homeId$));
  }}
/>
