<script lang="ts">
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Tool Output & Retention Settings Component
   *
   * Reads/writes the daemon-owned `workspaceApi.*` and tool-payload `agents.*`
   * settings via settings.list / settings.update (PROTOCOL §5.12), following
   * the WebSocketApiSettings pattern:
   * - workspaceApi.maxOutputChars — max characters of one workspace_api tool
   *   result before the output is redirected to a file (0 = unlimited;
   *   min 1000 when non-zero, max 10,000,000).
   * - workspaceApi.toonOutput — TOON-encode workspace_api tool results.
   * - agents.historyReplayToolContentChars — per-block cap for tool
   *   inputs/outputs when a session is rebuilt from history (500..100,000).
   * - agents.toolPayloadRetentionDays — age after which stored tool payloads
   *   are shrunk to the replay preview (0 = keep forever; max 3650).
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
  const REPLAY_CHARS_PATH = 'agents.historyReplayToolContentChars';
  const RETENTION_DAYS_PATH = 'agents.toolPayloadRetentionDays';

  let loading = $state(true);
  let toonOutput = $state(true);

  // Max output chars editing state (persisted value vs input string)
  let persistedMaxOutputChars = $state<number>(100000);
  let editedMaxOutputChars = $state<string>('100000');
  let maxCharsSaving = $state(false);
  const maxOutputCharsValid = $derived.by(() => {
    const parsed = parseIntegerInput(editedMaxOutputChars);
    return Number.isInteger(parsed) && (parsed === 0 || (parsed >= 1000 && parsed <= 10_000_000));
  });

  // Replay tool content chars editing state (persisted value vs input string)
  let persistedReplayChars = $state<number>(4000);
  let editedReplayChars = $state<string>('4000');
  let replayCharsSaving = $state(false);

  // Tool payload retention days editing state (persisted value vs input string)
  let persistedRetentionDays = $state<number>(0);
  let editedRetentionDays = $state<string>('0');
  let retentionDaysSaving = $state(false);

  onMount(async () => {
    await loadSettings();
  });

  // A number input bound with bind:value yields a number, or null when blank;
  // a blank/whitespace field must never be read as 0.
  function parseIntegerInput(raw: string | number | null): number {
    if (raw === null || String(raw).trim() === '') return Number.NaN;
    return Number(raw);
  }

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
      const replayChars = settings.find(
        (s: { path: string; value: unknown }) => s.path === REPLAY_CHARS_PATH,
      );
      const retentionDays = settings.find(
        (s: { path: string; value: unknown }) => s.path === RETENTION_DAYS_PATH,
      );
      if (typeof maxChars?.value === 'number') {
        persistedMaxOutputChars = maxChars.value;
        editedMaxOutputChars = String(maxChars.value);
      }
      if (typeof replayChars?.value === 'number') {
        persistedReplayChars = replayChars.value;
        editedReplayChars = String(replayChars.value);
      }
      if (typeof retentionDays?.value === 'number') {
        persistedRetentionDays = retentionDays.value;
        editedRetentionDays = String(retentionDays.value);
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

      // A missing entry means the daemon did not apply the change; treat it
      // like a rollback.
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === TOON_OUTPUT_PATH,
      );
      if (!applied || applied.value !== checked) {
        notify.error(m.settings_workspaceApi_toonOutput_rollbackError());
        toonOutput = applied ? applied.value !== false : !checked;
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
    const newValue = parseIntegerInput(editedMaxOutputChars);
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

      // A missing entry means the daemon did not apply the change; treat it
      // like a rollback.
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === MAX_OUTPUT_CHARS_PATH,
      );
      if (!applied || applied.value !== newValue) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedMaxOutputChars;
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

  async function handleReplayCharsSave() {
    const newValue = parseIntegerInput(editedReplayChars);
    if (!Number.isInteger(newValue) || newValue < 500 || newValue > 100_000) {
      return; // invalid input, do nothing
    }

    try {
      replayCharsSaving = true;
      const result = await appClient.settings.update([
        { path: REPLAY_CHARS_PATH, value: newValue },
      ]);

      // A missing entry means the daemon did not apply the change; treat it
      // like a rollback.
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === REPLAY_CHARS_PATH,
      );
      if (!applied || applied.value !== newValue) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedReplayChars;
        notify.error(m.settings_workspaceApi_replayChars_rollbackError());
        persistedReplayChars = rolledBackValue;
        editedReplayChars = String(rolledBackValue);
        return;
      }

      persistedReplayChars = newValue;
      notify.success(m.settings_workspaceApi_replayChars_saved());
    } catch (error) {
      notify.error(
        m.settings_workspaceApi_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedReplayChars = String(persistedReplayChars);
    } finally {
      replayCharsSaving = false;
    }
  }

  async function handleRetentionDaysSave() {
    const newValue = parseIntegerInput(editedRetentionDays);
    if (!Number.isInteger(newValue) || newValue < 0 || newValue > 3650) {
      return; // invalid input, do nothing
    }

    try {
      retentionDaysSaving = true;
      const result = await appClient.settings.update([
        { path: RETENTION_DAYS_PATH, value: newValue },
      ]);

      // A missing entry means the daemon did not apply the change; treat it
      // like a rollback.
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === RETENTION_DAYS_PATH,
      );
      if (!applied || applied.value !== newValue) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedRetentionDays;
        notify.error(m.settings_workspaceApi_retentionDays_rollbackError());
        persistedRetentionDays = rolledBackValue;
        editedRetentionDays = String(rolledBackValue);
        return;
      }

      persistedRetentionDays = newValue;
      notify.success(m.settings_workspaceApi_retentionDays_saved());
    } catch (error) {
      notify.error(
        m.settings_workspaceApi_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedRetentionDays = String(persistedRetentionDays);
    } finally {
      retentionDaysSaving = false;
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
              id: 'workspace-api-retentionDays',
              label: m.settings_workspaceApi_retentionDays_label(),
              description: m.settings_workspaceApi_retentionDays_description(),
              error: () =>
                Number.isInteger(parseIntegerInput(editedRetentionDays)) &&
                parseIntegerInput(editedRetentionDays) >= 0 &&
                parseIntegerInput(editedRetentionDays) <= 3650
                  ? undefined
                  : m.settings_workspaceApi_retentionDays_invalid(),
              disabled: () => retentionDaysSaving || loading,
            },

            {
              kind: 'custom',
              id: 'workspace-api-replayChars',
              label: m.settings_workspaceApi_replayChars_label(),
              description: m.settings_workspaceApi_replayChars_description(),
              error: () =>
                Number.isInteger(parseIntegerInput(editedReplayChars)) &&
                parseIntegerInput(editedReplayChars) >= 500 &&
                parseIntegerInput(editedReplayChars) <= 100000
                  ? undefined
                  : m.settings_workspaceApi_replayChars_invalid(),
              disabled: () => replayCharsSaving || loading,
            },

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
    {#if parseIntegerInput(editedMaxOutputChars) !== persistedMaxOutputChars}
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

{#snippet replayCharsControl({ descriptionId, errorId }: SettingsControlContext)}
  <div class="flex items-center gap-2">
    <Input
      type="number"
      min="500"
      max="100000"
      bind:value={editedReplayChars}
      disabled={replayCharsSaving || loading}
      aria-label={m.settings_workspaceApi_replayChars_ariaLabel()}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      class="w-32"
    />
    {#if parseIntegerInput(editedReplayChars) !== persistedReplayChars}
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-auto px-0"
        onclick={handleReplayCharsSave}
        disabled={replayCharsSaving ||
          !Number.isInteger(parseIntegerInput(editedReplayChars)) ||
          parseIntegerInput(editedReplayChars) < 500 ||
          parseIntegerInput(editedReplayChars) > 100000}
      >
        {replayCharsSaving
          ? m.settings_workspaceApi_maxOutputChars_saving()
          : m.settings_workspaceApi_maxOutputChars_save()}
      </Button>
    {/if}
  </div>
{/snippet}

{#snippet retentionDaysControl({ descriptionId, errorId }: SettingsControlContext)}
  <div class="flex items-center gap-2">
    <Input
      type="number"
      min="0"
      max="3650"
      bind:value={editedRetentionDays}
      disabled={retentionDaysSaving || loading}
      aria-label={m.settings_workspaceApi_retentionDays_ariaLabel()}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      class="w-32"
    />
    {#if parseIntegerInput(editedRetentionDays) !== persistedRetentionDays}
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-auto px-0"
        onclick={handleRetentionDaysSave}
        disabled={retentionDaysSaving ||
          !Number.isInteger(parseIntegerInput(editedRetentionDays)) ||
          parseIntegerInput(editedRetentionDays) < 0 ||
          parseIntegerInput(editedRetentionDays) > 3650}
      >
        {retentionDaysSaving
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
      'workspace-api-replayChars': replayCharsControl,
      'workspace-api-retentionDays': retentionDaysControl,
      'workspace-api-max-output-chars': maxOutputCharsControl,
    })}
  />
</div>
