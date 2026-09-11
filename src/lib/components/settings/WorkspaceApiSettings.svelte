<script lang="ts">
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Workspace API Output Settings Component
   *
   * Reads/writes the daemon-owned `workspaceApi.*` settings via
   * settings.list / settings.update (PROTOCOL §5.12), following the
   * WebSocketApiSettings pattern:
   * - workspaceApi.maxOutputChars — max characters of one workspace_api tool
   *   result before the output is redirected to a file (0 = unlimited;
   *   min 1000 when non-zero, max 10,000,000).
   * - workspaceApi.toonOutput — TOON-encode workspace_api tool results.
   *
   * These settings are persisted by the daemon; local state here is transient
   * UI state only.
   */
  import { onMount } from 'svelte';
  import { notify } from '$lib/components/patterns/notify';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';

  const MAX_OUTPUT_CHARS_PATH = 'workspaceApi.maxOutputChars';
  const TOON_OUTPUT_PATH = 'workspaceApi.toonOutput';

  let loading = $state(true);
  let toonOutput = $state(true);

  // Max output chars editing state (persisted value vs input string)
  let persistedMaxOutputChars = $state<number>(100000);
  let editedMaxOutputChars = $state<string>('100000');
  let maxCharsSaving = $state(false);
  const maxOutputCharsValid = $derived.by(() => {
    const parsed = Number(editedMaxOutputChars);
    return Number.isInteger(parsed) && (parsed === 0 || (parsed >= 1000 && parsed <= 10_000_000));
  });

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      const maxChars = settings.find(
        (s: { path: string; value: unknown }) => s.path === MAX_OUTPUT_CHARS_PATH,
      );
      const toon = settings.find(
        (s: { path: string; value: unknown }) => s.path === TOON_OUTPUT_PATH,
      );
      if (typeof maxChars?.value === 'number') {
        persistedMaxOutputChars = maxChars.value;
        editedMaxOutputChars = String(maxChars.value);
      }
      toonOutput = toon?.value !== false;
    } catch (error) {
      notify.error(
        m.settings_workspaceApi_loadError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loading = false;
    }
  }

  async function handleToonToggle(checked: boolean) {
    const previousValue = toonOutput;
    toonOutput = checked;
    try {
      const result = await appClient.settings.update([{ path: TOON_OUTPUT_PATH, value: checked }]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === TOON_OUTPUT_PATH,
      );
      if (applied && applied.value !== checked) {
        notify.error(m.settings_workspaceApi_toonOutput_rollbackError());
        toonOutput = applied.value !== false;
        return;
      }
    } catch (error) {
      notify.error(
        m.settings_workspaceApi_toonOutput_error({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      toonOutput = previousValue;
    }
  }

  async function handleMaxCharsSave() {
    const newValue = Number(editedMaxOutputChars);
    if (
      !Number.isInteger(newValue) ||
      newValue < 0 ||
      (newValue !== 0 && newValue < 1000) ||
      newValue > 10_000_000
    ) {
      return; // invalid input, do nothing
    }

    try {
      maxCharsSaving = true;
      const result = await appClient.settings.update([
        { path: MAX_OUTPUT_CHARS_PATH, value: newValue },
      ]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === MAX_OUTPUT_CHARS_PATH,
      );
      if (applied && applied.value !== newValue) {
        const rolledBackValue =
          typeof applied.value === 'number' ? applied.value : persistedMaxOutputChars;
        notify.error(m.settings_workspaceApi_maxOutputChars_rollbackError());
        persistedMaxOutputChars = rolledBackValue;
        editedMaxOutputChars = String(rolledBackValue);
        return;
      }

      persistedMaxOutputChars = newValue;
      notify.success(m.settings_workspaceApi_maxOutputChars_saved());
    } catch (error) {
      notify.error(
        m.settings_workspaceApi_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedMaxOutputChars = String(persistedMaxOutputChars);
    } finally {
      maxCharsSaving = false;
    }
  }

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'workspace-api',
          title: m.settings_workspaceApi_maxOutputChars_label(),
          entries: [
            {
              kind: 'custom',
              id: 'workspace-api-max-output-chars',
              label: m.settings_workspaceApi_maxOutputChars_label(),
              description: m.settings_workspaceApi_maxOutputChars_description(),
              error: () =>
                maxOutputCharsValid ? undefined : m.settings_workspaceApi_maxOutputChars_invalid(),
              disabled: () => maxCharsSaving || loading,
            },
            {
              kind: 'switch',
              id: 'workspace-api-toon-output',
              label: m.settings_workspaceApi_toonOutput_label(),
              description: m.settings_workspaceApi_toonOutput_description(),
              get: () => toonOutput,
              set: handleToonToggle,
              disabled: () => loading,
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet maxOutputCharsControl({ labelId, descriptionId, errorId }: SettingsControlContext)}
  <div class="flex items-center gap-2">
    <Input
      type="number"
      min="0"
      max="10000000"
      bind:value={editedMaxOutputChars}
      disabled={maxCharsSaving || loading}
      aria-label={m.settings_workspaceApi_maxOutputChars_ariaLabel()}
      aria-labelledby={labelId}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      class="w-32"
    />
    {#if Number(editedMaxOutputChars) !== persistedMaxOutputChars}
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-auto px-0"
        onclick={handleMaxCharsSave}
        disabled={maxCharsSaving || !maxOutputCharsValid}
      >
        {maxCharsSaving
          ? m.settings_workspaceApi_maxOutputChars_saving()
          : m.settings_workspaceApi_maxOutputChars_save()}
      </Button>
    {/if}
  </div>
{/snippet}

<div class="rounded-xl bg-card px-4">
  <SettingsForm
    {schema}
    embedded
    custom={defineSettingsCustomControls({
      'workspace-api-max-output-chars': maxOutputCharsControl,
    })}
  />
</div>
