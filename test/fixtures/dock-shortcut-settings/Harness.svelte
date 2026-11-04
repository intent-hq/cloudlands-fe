<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import KeyboardShortcutsSettings from '$lib/components/settings/KeyboardShortcutsSettings.svelte';
  import KeyboardShortcutsCheatSheet from '$lib/components/layout/KeyboardShortcutsCheatSheet.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { userPreferencesPersistenceSaga } from '$store/renderer/slices/user-preferences/sagas/user-preferences-persistence-saga';
  import { openCheatSheet } from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
  import { hydrateShortcutOverrides } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { handleHomeSetAsideShortcut } from '$features/home/home-set-aside-shortcut';
  const stop = startRootStoreLifecycle(store, {
    startSagas: () => [store.runSaga(userPreferencesPersistenceSaga)],
  });
  onDestroy(stop);
  const workspaceActions: string[] = [];
  const keys: unknown[] = [];
  const recordKey = (event: KeyboardEvent) =>
    keys.push({
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      target: (event.target as HTMLElement)?.id,
      placeholder: (event.target as HTMLInputElement)?.placeholder,
      value: (event.target as HTMLInputElement)?.value,
    });
  window.addEventListener('keydown', recordKey, true);
  onDestroy(() => window.removeEventListener('keydown', recordKey, true));
  Object.assign(window, {
    shortcutFixture: {
      store,
      keys,
      workspaceActions,
      effective: getEffectiveShortcut,
      refresh: () => store.dispatch(hydrateShortcutOverrides({})),
    },
  });
</script>

<svelte:window
  onkeydown={(event) => handleHomeSetAsideShortcut(event, (id) => workspaceActions.push(id))}
/>
<Tooltip.Provider>
  <!-- i18n-ignore (isolated E2E fixture controls) -->
  <main class="p-6" aria-label="Shortcut fixture">
    <Button data-home-workspace="fixture-space">Workspace row</Button>
    <Button onclick={() => store.dispatch(openCheatSheet('global'))}>Open shortcut sheet</Button>
    <KeyboardShortcutsSettings />
    <KeyboardShortcutsCheatSheet />
  </main>
</Tooltip.Provider>
