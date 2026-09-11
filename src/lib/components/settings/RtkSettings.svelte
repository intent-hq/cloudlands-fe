<script lang="ts">
  import { Button, Switch } from '$lib/components/patterns/settings/custom-controls';
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

  import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { invoke } from '$shared/generated/ipc-client';
  import { appClient } from '$lib/client';

  import {
    addTerminal,
    openTerminalOverlay,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { ROOT_WORKSPACE_ID } from '$lib/components/terminal/RootQuakeTerminalOverlay.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { notify } from '$lib/components/patterns/notify';

  let rtkAvailable = $state(false);
  let rtkEnabled = $state(false);
  let loaded = $state(false);
  let checking = $state(false);
  let settingsError = $state('');
  let updating = $state(false);

  const SETTING_PATH = 'rtk.enabled';

  onMount(async () => {
    // Read rtk.enabled from daemon settings catalog (LiveSettingsClient.get folds errors to null)
    const entry = await appClient.settings.get(SETTING_PATH);
    if (entry === null) {
      settingsError = m.settings_rtk_loadError();
      console.error('Failed to load RTK settings: daemon returned null');
    } else {
      rtkEnabled = typeof entry.value === 'boolean' ? entry.value : false;
      settingsError = '';
    }

    // Check if rtk is installed (separate failure domain)
    try {
      const availResult = await invoke<any>(SYSTEM_CHANNELS.CHECK_RTK, undefined);
      rtkAvailable = availResult?.data?.available ?? false;
    } catch (error) {
      console.error('Failed to check RTK availability:', error);
      // rtkAvailable stays false, toggle will be disabled
    }

    loaded = true;
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
      // Daemon-first create (`terminal.create`, PROTOCOL §5.13): key the tab
      // by the daemon-assigned id so hydration/writes address the real PTY.
      const result = await appClient.terminals.create({
        workspaceId: ROOT_WORKSPACE_ID,
        cols: 80,
        rows: 24,
      });
      if (!result.success || !result.id) {
        // Daemon-first invariant: never fabricate a tab without a PTY behind
        // it — surface the failure instead.
        console.error(
          // i18n-ignore -- developer-only diagnostic; the user sees the localized notification below
          'Failed to create install terminal:',
          result.success ? 'missing id' : result.error,
        );
        notify.error(m.terminal_adapter_openFailed_error());
        return;
      }
      const termId = result.id;
      appStore.dispatch(
        addTerminal(ROOT_WORKSPACE_ID, termId, m.settings_rtk_installTerminalTitle()),
      );
      appStore.dispatch(openTerminalOverlay(ROOT_WORKSPACE_ID, termId));

      // Wait briefly for the terminal to initialize, then write the command
      // via `terminal.write` (PROTOCOL §5.13) using the daemon-assigned id.
      setTimeout(async () => {
        try {
          await appClient.terminals.write(termId, 'brew install rtk\n');
        } catch {
          // Terminal might not be ready yet - user can type manually
        }
      }, 1000);

      // Poll for rtk availability after install (brew install typically takes 10-30s)
      const pollIntervals = [10000, 20000, 30000];
      for (const delay of pollIntervals) {
        setTimeout(() => recheckRtk(), delay);
      }
    } catch (error) {
      // Daemon-first invariant: no fabricated fallback tab — surface the
      // failure instead.
      // i18n-ignore -- developer-only diagnostic; the user sees the localized notification below
      console.error('Failed to create install terminal:', error);
      notify.error(m.terminal_adapter_openFailed_error());
    }
  }

  async function handleToggle(checked: boolean) {
    if (updating) return; // Guard against re-entrancy
    const previousValue = rtkEnabled;
    rtkEnabled = checked;
    updating = true;
    try {
      await appClient.settings.update([{ path: SETTING_PATH, value: checked }]);
      settingsError = '';
    } catch (error) {
      rtkEnabled = previousValue;
      settingsError = m.settings_rtk_saveError();
      console.error('Failed to update rtk.enabled setting:', error);
    } finally {
      updating = false;
    }
  }
</script>

{#if loaded}
  <div data-rtk-settings class="w-full min-w-0">
    {#if settingsError}
      <div class="text-xs text-danger mb-2">
        {settingsError}
      </div>
    {/if}
    <div class="flex min-w-0 items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{m.settings_rtk_label()}</p>
        <p class="text-xs text-subtle">
          {#if rtkAvailable}
            {m.settings_rtk_enabledDescription()}
          {:else}
            <span class="text-muted-foreground">{m.settings_rtk_notInstalled()}</span>
            <Button
              variant="ghost"
              type="button"
              class="text-primary-ink hover:underline cursor-pointer text-xs ml-1"
              onclick={recheckRtk}
              disabled={checking}
              >{checking ? m.settings_rtk_checking() : m.settings_rtk_checkAgain()}</Button
            >
          {/if}
        </p>
      </div>
      <Switch
        checked={rtkEnabled}
        onCheckedChange={handleToggle}
        size="xs"
        class="shrink-0"
        disabled={!rtkAvailable}
        ariaLabel={m.settings_rtk_label()}
      />
    </div>
    {#if !rtkAvailable}
      <p class="text-xs text-muted-foreground mt-2">
        {m.settings_rtk_installHint_before()}
        <Button
          variant="ghost"
          type="button"
          class="text-primary-ink hover:underline cursor-pointer font-mono"
          onclick={installRtk}><!-- i18n-ignore (shell command) -->brew install rtk</Button
        >
        {m.settings_rtk_installHint_orVisit()}
        <a
          href="https://github.com/rtk-ai/rtk"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary-ink hover:underline"
          ><!-- i18n-ignore (URL) -->github.com/rtk-ai/rtk</a
        >.
      </p>
    {/if}
  </div>
{/if}
