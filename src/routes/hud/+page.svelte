<script lang="ts">
  /**
   * Fleet HUD — standalone chrome-less window shell.
   *
   * Minimal placeholder frame (full-viewport dark background, min 1280x720);
   * the mission-control panels are built separately. Opened from the sidebar
   * HUD button via WINDOW.OPEN_NEW. Windowed by default; the header control
   * enters native full-screen and the EXIT button (only shown while
   * full-screen, including OS-gesture transitions tracked over the
   * `window:fullscreen` event) leaves it.
   */

  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  let isFullScreen = $state(false);

  onMount(() => {
    // Seed from the window's actual state, then track enter/leave transitions
    // (button, green traffic-light, Cmd+Ctrl+F) via the main-process event.
    invoke<{ success: boolean; fullScreen: boolean }>(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN, {})
      .then((result) => {
        if (result?.success) isFullScreen = result.fullScreen;
      })
      .catch(() => {});

    const cleanup = listenSync<boolean>('window:fullscreen', (event) => {
      isFullScreen = !!event.payload;
    });
    return cleanup;
  });

  function setFullScreen(fullScreen: boolean) {
    invoke<{ success: boolean; fullScreen: boolean }>(IPC_CHANNELS.WINDOW.SET_FULL_SCREEN, {
      fullScreen,
    })
      .then((result) => {
        if (result?.success) isFullScreen = result.fullScreen;
      })
      .catch(() => {});
  }
</script>

<div
  class="hud-shell flex h-full w-full min-w-[1280px] min-h-[720px] flex-col text-neutral-200"
  data-testid="hud-shell"
>
  <header class="flex items-center gap-3 px-4 py-2 shrink-0">
    <h1 class="text-sm font-semibold tracking-widest uppercase text-neutral-400">
      {m.hud_shell_title()}
    </h1>
    <div class="flex-1"></div>
    {#if isFullScreen}
      <button
        class="hud-header-btn flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-300 hover:text-white transition-colors"
        onclick={() => setFullScreen(false)}
        aria-label={m.hud_shell_exitFullScreen_label()}
      >
        <Fa icon={faCompress} size={12} />
        {m.hud_shell_exitFullScreen_label()}
      </button>
    {:else}
      <button
        class="hud-header-btn flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-neutral-300 hover:text-white transition-colors"
        onclick={() => setFullScreen(true)}
        aria-label={m.hud_shell_enterFullScreen_label()}
      >
        <Fa icon={faExpand} size={12} />
        {m.hud_shell_enterFullScreen_label()}
      </button>
    {/if}
  </header>

  <!-- Placeholder canvas — mission-control panels are built by other tasks -->
  <main class="flex-1 min-h-0"></main>
</div>

<style>
  .hud-shell {
    /* Fleet HUD v3 mockup frame background */
    background: #101014;
  }
  .hud-header-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .hud-header-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
