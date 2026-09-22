<script lang="ts">
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import type { ComponentProps } from 'svelte';
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeArchiveWarning,
    closeDeleteWarning,
    confirmArchiveWorkspace,
    confirmDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import {
    selectActiveHookNamesForArchive,
    selectActiveHookNamesForDelete,
    selectGuestsForArchive,
    selectGuestsForDelete,
    selectLocalChangesForArchive,
    selectLocalChangesForDelete,
    selectOpenPrsForArchive,
    selectOpenPrsForDelete,
    selectRunningAgentsForArchive,
    selectRunningAgentsForDelete,
    selectShowArchiveWarning,
    selectShowDeleteWarning,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-selectors';

  let { staticData }: { staticData?: ComponentProps<typeof DeleteWarningDialog> } = $props();

  const showDeleteWarning$ = untrack(() =>
    staticData ? readable(undefined) : selectShowDeleteWarning(),
  );
  const runningAgentsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectRunningAgentsForDelete(),
  );
  const activeHookNamesForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectActiveHookNamesForDelete(),
  );
  const openPrsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectOpenPrsForDelete(),
  );
  const localChangesForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectLocalChangesForDelete(),
  );
  const guestsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectGuestsForDelete(),
  );
  const showArchiveWarning$ = untrack(() =>
    staticData ? readable(undefined) : selectShowArchiveWarning(),
  );
  const runningAgentsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectRunningAgentsForArchive(),
  );
  const activeHookNamesForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectActiveHookNamesForArchive(),
  );
  const openPrsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectOpenPrsForArchive(),
  );
  const localChangesForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectLocalChangesForArchive(),
  );
  const guestsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectGuestsForArchive(),
  );
</script>

{#if staticData}
  <DeleteWarningDialog {...staticData} static />
{:else}
  <!-- Redux-owned delete warning host (global for all workspace delete entrypoints) -->
  <DeleteWarningDialog
    open={$showDeleteWarning$}
    agents={$runningAgentsForDelete$}
    hookNames={$activeHookNamesForDelete$}
    openPrs={$openPrsForDelete$}
    localChanges={$localChangesForDelete$}
    guests={$guestsForDelete$}
    onDeleteAnyway={() => appStore.dispatch(confirmDeleteWorkspace())}
    onCancel={() => appStore.dispatch(closeDeleteWarning())}
  />

  <!-- Redux-owned archive warning host (global for all workspace archive entrypoints) -->
  <DeleteWarningDialog
    open={$showArchiveWarning$}
    mode="archive"
    agents={$runningAgentsForArchive$}
    hookNames={$activeHookNamesForArchive$}
    openPrs={$openPrsForArchive$}
    localChanges={$localChangesForArchive$}
    guests={$guestsForArchive$}
    onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
    onCancel={() => appStore.dispatch(closeArchiveWarning())}
  />
{/if}
