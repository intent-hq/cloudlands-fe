<script lang="ts">
  /**
   * RTK Settings Component
   *
   * Allows users to enable/disable rtk command prefixing for agents.
   * The toggle is disabled when rtk is not installed on the system.
   *
   * The rtk.enabled flag is now daemon-backed (PROTOCOL §5.12) after Wave 1
   * merged intentd PR #190. The component reads/writes via settings.get/update
   * like other daemon-backed settings (e.g., AgentBackendSettings.svelte).
   */

  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
  import { onMount } from 'svelte';
  import { invoke } from '$shared/generated/ipc-client';
  import { appClient } from '$lib/client';

  import {
  addTerminal,
  openTerminalOverlay,
  toggleTerminalOverlay,
} from '$store/renderer/slices/terminals/terminals-slice';
  import { ROOT_WORKSPACE_ID } from '$lib/components/terminal/RootQuakeTerminalOverlay.svelte';
  import { store as appStore } from '$store/renderer/store';


  let rtkAvailable = $state(false);
  let rtkEnabled = $state(false);
  let loaded = $state(false);
  let checking = $state(false);

  const SETTING_PATH = 'rtk.enabled';

  onMount(async () => {
    try {
      // Read rtk.enabled from daemon settings catalog
      const entry = await appClient.settings.get(SETTING_PATH);
      rtkEnabled = typeof entry?.value === 'boolean' ? entry.value : false;

      // Check if rtk is installed
      const availResult = await invoke<any>(SYSTEM_CHANNELS.CHECK_RTK, undefined);
      rtkAvailable = availResult?.data?.available ?? false;
    } catch {
      // Silently fail
    } finally {
      loaded = true;
    }
  });

  async function recheckRtk() {
    if (checking) return;
    checking = true;
    try {
      const availResult = await invoke<any>(SYSTEM_CHANNELS.CHECK_RTK, undefined);
      rtkAvailable = availResult?.data?.available ?? false;
    } catch {
      // Silently fail
    } finally {
      checking = false;
    }
  }

  async function installRtk() {
    try {
      // Create a new terminal tab and open the overlay
      const termId = `terminal-${Date.now()}`;
      appStore.dispatch(addTerminal(ROOT_WORKSPACE_ID, termId, 'Install RTK'));
      appStore.dispatch(openTerminalOverlay(ROOT_WORKSPACE_ID, termId));

      // Wait briefly for the terminal to initialize, then write the command
      setTimeout(async () => {
        try {
          await invoke('terminal:professional:write', {
            terminalId: termId,
            data: 'brew install rtk\n',
          });
        } catch {
          // Terminal might not be ready yet - user can type manually
        }
      }, 1000);

      // Poll for rtk availability after install (brew install typically takes 10-30s)
      const pollIntervals = [10000, 20000, 30000];
      for (const delay of pollIntervals) {
        setTimeout(() => recheckRtk(), delay);
      }
    } catch {
      // Fallback: just open the terminal
      appStore.dispatch(toggleTerminalOverlay(ROOT_WORKSPACE_ID));
    }
  }

  async function handleToggle() {
    const newValue = !rtkEnabled;
    try {
      await appClient.settings.update([{ path: SETTING_PATH, value: newValue }]);
      rtkEnabled = newValue;
    } catch (error) {
      console.error('Failed to update rtk.enabled setting:', error);
      // Revert on error
    }
  }
</script>

{#if loaded}
  <div class="flex justify-between">
    <div>
      <p class="text-sm font-medium text-foreground">RTK command optimization</p>
      <p class="text-xs text-subtle">
        {#if rtkAvailable}
          Agents will prefix supported commands with rtk for compressed, LLM-friendly output.
        {:else}
          <span class="text-muted-foreground">rtk is not installed</span>
          <button
            type="button"
            class="text-primary hover:underline cursor-pointer text-xs ml-1"
            onclick={recheckRtk}
            disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button
          >
        {/if}
      </p>
    </div>
    <Toggle
      pressed={rtkEnabled}
      onclick={handleToggle}
      variant="indicator"
      size="xs"
      class="mb-auto"
      disabled={!rtkAvailable}
    />
  </div>
  {#if !rtkAvailable}
    <p class="text-xs text-muted-foreground mt-2">
      RTK compresses CLI output for faster, cheaper agent interactions. Install with
      <button
        type="button"
        class="text-primary hover:underline cursor-pointer font-mono"
        onclick={installRtk}>brew install rtk</button
      >
      or visit
      <a
        href="https://github.com/rtk-ai/rtk"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary hover:underline">github.com/rtk-ai/rtk</a
      >.
    </p>
  {/if}
{/if}
