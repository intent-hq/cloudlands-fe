<script lang="ts">
  import '../app.css';
  import '@fontsource/ia-writer-mono/400.css';
  import '@fontsource/ia-writer-mono/400-italic.css';
  import '@fontsource/ia-writer-mono/700.css';
  import '@fontsource/ia-writer-mono/700-italic.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/400-italic.css';
  import '@fontsource/jetbrains-mono/500.css';
  import '@fontsource/jetbrains-mono/500-italic.css';
  import '@fontsource/jetbrains-mono/700.css';
  import '@fontsource/jetbrains-mono/700-italic.css';
  import '@fontsource/doto/700.css';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { wireSplashGate } from '$features/backend/splash-gate';
  import { store as appStore } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { selectResolvedLocale } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
    attachMouseHistoryNavigation,
    handleHistoryNavigateIpc,
  } from '$lib/utils/history-navigation';

  let { children }: { children?: Snippet } = $props();

  const disposeStore = startRootStoreLifecycle(
    appStore,
    { startSagas: () => [] },
    import.meta.hot?.data,
  );
  onDestroy(disposeStore);

  // The {#key} below remounts everything rendered by the app — product chrome,
  // modals, and HUD surfaces — so every mounted m.*() string re-renders when
  // the language preference changes (no reload needed).
  const resolvedLocale$ = selectResolvedLocale();

  onMount(() => {
    const setWindowBlurred = (blurred: boolean) => {
      document.documentElement.toggleAttribute('data-window-blurred', blurred);
    };
    const handleWindowBlur = () => setWindowBlurred(true);
    const handleWindowFocus = () => setWindowBlurred(false);

    setWindowBlurred(!document.hasFocus());
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // eslint-disable-next-line intent/no-component-async-data-fetch -- root DOM splash lifecycle wiring does not own domain state.
    const stopSplashGate = wireSplashGate(document.getElementById('splash'));
    document.getElementById('app-drag-region')?.remove();

    // eslint-disable-next-line intent/no-component-async-data-fetch -- upstream global input listener registration
    const cleanupMouseHistoryNavigation = attachMouseHistoryNavigation(window);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- upstream main-process navigation bridge
    const historyNavigateListenerId = window.electronAPI?.on?.(
      IPC_CHANNELS.APP.HISTORY_NAVIGATE,
      handleHistoryNavigateIpc,
    );

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.documentElement.removeAttribute('data-window-blurred');
      stopSplashGate();
      cleanupMouseHistoryNavigation();
      if (historyNavigateListenerId) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- paired listener cleanup
        window.electronAPI.offById(IPC_CHANNELS.APP.HISTORY_NAVIGATE, historyNavigateListenerId);
      }
    };
  });
</script>

{#key $resolvedLocale$}
  {@render children?.()}
{/key}
