<script lang="ts">
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
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
  import { store as appStore } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
    settingsFormLoadRequested,
    settingsFormSaveRequested,
    settingsFormDraftChanged,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormEntries,
    selectSettingsFormOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
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

  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const form$ = selectSettingsForm(identity);
  const entries$ = selectSettingsFormEntries(identity);
  const maxCharsOperation$ = selectSettingsFormOperation(identity, MAX_OUTPUT_CHARS_PATH);
  const replayOperation$ = selectSettingsFormOperation(identity, REPLAY_CHARS_PATH);
  const retentionOperation$ = selectSettingsFormOperation(identity, RETENTION_DAYS_PATH);
  const loading = $derived(!$form$?.loaded);
  const toonOutput = $derived(
    ($form$?.drafts[TOON_OUTPUT_PATH] ?? $entries$[TOON_OUTPUT_PATH]?.value) !== false,
  );

  // Max output chars editing state (persisted value vs input string)
  const persistedMaxOutputChars = $derived(
    Number($entries$[MAX_OUTPUT_CHARS_PATH]?.value ?? 100000),
  );
  const editedMaxOutputChars = $derived(
    String($form$?.drafts[MAX_OUTPUT_CHARS_PATH] ?? persistedMaxOutputChars),
  );
  const maxCharsSaving = $derived($maxCharsOperation$?.status === 'pending');
  const maxOutputCharsValid = $derived.by(() => {
    const parsed = parseIntegerInput(editedMaxOutputChars);
    return Number.isInteger(parsed) && (parsed === 0 || (parsed >= 1000 && parsed <= 10_000_000));
  });

  // Replay tool content chars editing state (persisted value vs input string)
  const persistedReplayChars = $derived(Number($entries$[REPLAY_CHARS_PATH]?.value ?? 4000));
  const editedReplayChars = $derived(
    String($form$?.drafts[REPLAY_CHARS_PATH] ?? persistedReplayChars),
  );
  const replayCharsSaving = $derived($replayOperation$?.status === 'pending');

  // Tool payload retention days editing state (persisted value vs input string)
  const persistedRetentionDays = $derived(Number($entries$[RETENTION_DAYS_PATH]?.value ?? 0));
  const editedRetentionDays = $derived(
    String($form$?.drafts[RETENTION_DAYS_PATH] ?? persistedRetentionDays),
  );
  const retentionDaysSaving = $derived($retentionOperation$?.status === 'pending');

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'workspace-api'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, requestId: crypto.randomUUID(), resource: 'load' }),
    );
    return () => appStore.dispatch(settingsFormClosed(identity));
  });

  // A number input bound with bind:value yields a number, or null when blank;
  // a blank/whitespace field must never be read as 0.
  function parseIntegerInput(raw: string | number | null): number {
    if (raw === null || String(raw).trim() === '') return Number.NaN;
    return Number(raw);
  }

  function handleToonToggle(checked: boolean) {
    if (!selectSettingsForm.select(appStore.state, identity)?.loaded) return;
    appStore.dispatch(settingsFormDraftChanged(identity, TOON_OUTPUT_PATH, checked));
    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: TOON_OUTPUT_PATH, requestId: crypto.randomUUID() },
        [{ path: TOON_OUTPUT_PATH, value: checked }],
      ),
    );
  }

  function handleMaxCharsSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    if (!form?.loaded) return;
    const newValue = parseIntegerInput(
      String(
        form.drafts[MAX_OUTPUT_CHARS_PATH] ??
          selectSettingsFormEntries.select(appStore.state, identity)[MAX_OUTPUT_CHARS_PATH]
            ?.value ??
          '',
      ),
    );
    if (
      !Number.isInteger(newValue) ||
      newValue < 0 ||
      (newValue !== 0 && newValue < 1000) ||
      newValue > 10_000_000
    ) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: MAX_OUTPUT_CHARS_PATH, requestId: crypto.randomUUID() },
        [{ path: MAX_OUTPUT_CHARS_PATH, value: newValue }],
      ),
    );
  }

  function handleReplayCharsSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    if (!form?.loaded) return;
    const newValue = parseIntegerInput(
      String(
        form.drafts[REPLAY_CHARS_PATH] ??
          selectSettingsFormEntries.select(appStore.state, identity)[REPLAY_CHARS_PATH]?.value ??
          '',
      ),
    );
    if (!Number.isInteger(newValue) || newValue < 500 || newValue > 100_000) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: REPLAY_CHARS_PATH, requestId: crypto.randomUUID() },
        [{ path: REPLAY_CHARS_PATH, value: newValue }],
      ),
    );
  }

  function handleRetentionDaysSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    if (!form?.loaded) return;
    const newValue = parseIntegerInput(
      String(
        form.drafts[RETENTION_DAYS_PATH] ??
          selectSettingsFormEntries.select(appStore.state, identity)[RETENTION_DAYS_PATH]?.value ??
          '',
      ),
    );
    if (!Number.isInteger(newValue) || newValue < 0 || newValue > 3650) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: RETENTION_DAYS_PATH, requestId: crypto.randomUUID() },
        [{ path: RETENTION_DAYS_PATH, value: newValue }],
      ),
    );
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
      value={editedMaxOutputChars}
      oninput={(event) =>
        appStore.dispatch(
          settingsFormDraftChanged(identity, MAX_OUTPUT_CHARS_PATH, event.currentTarget.value),
        )}
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
      value={editedReplayChars}
      oninput={(event) =>
        appStore.dispatch(
          settingsFormDraftChanged(identity, REPLAY_CHARS_PATH, event.currentTarget.value),
        )}
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
      value={editedRetentionDays}
      oninput={(event) =>
        appStore.dispatch(
          settingsFormDraftChanged(identity, RETENTION_DAYS_PATH, event.currentTarget.value),
        )}
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

<div data-slot="settings-section-body" class="rounded-xl bg-card px-6 py-4">
  <SettingsForm
    {schema}
    embedded
    compact={false}
    custom={defineSettingsCustomControls({
      'workspace-api-replayChars': replayCharsControl,
      'workspace-api-retentionDays': retentionDaysControl,
      'workspace-api-max-output-chars': maxOutputCharsControl,
    })}
  />
</div>
