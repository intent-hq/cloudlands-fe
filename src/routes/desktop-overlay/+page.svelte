<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DesktopControlOverlay from '$features/desktop/components/DesktopControlOverlay.svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import type { DesktopOverlayBridge } from '$shared/desktop-overlay';
  const bridge =
    typeof window !== 'undefined'
      ? (window as Window & { desktopOverlay?: DesktopOverlayBridge }).desktopOverlay
      : undefined;
  const kind =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('kind') === 'controls'
      ? 'controls'
      : 'glow';
  let pulse = $state(0);
  onMount(() => {
    // Electron's nativeTheme.themeSource reflects Intent's chosen appearance.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyScheme = () => document.documentElement.classList.toggle('dark', scheme.matches);
    applyScheme();
    scheme.addEventListener('change', applyScheme);
    const unsubscribe = bridge?.onPulse(() => {
      pulse += 1;
    });
    let cancelled = false;
    void tick().then(() => {
      if (!cancelled) bridge?.ready();
    });
    return () => {
      cancelled = true;
      scheme.removeEventListener('change', applyScheme);
      unsubscribe?.();
    };
  });
</script>

<Screen class="h-full bg-transparent">
  <DesktopControlOverlay
    {kind}
    {pulse}
    onStop={() => bridge?.stop()}
    onOpenAgent={() => bridge?.openAgent()}
    onInteractive={(interactive) => bridge?.setInteractive(interactive)}
  />
</Screen>

<style>
  :global(html),
  :global(body) {
    background: transparent !important;
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
