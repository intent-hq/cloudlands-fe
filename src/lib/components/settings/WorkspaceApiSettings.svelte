<script lang="ts">
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
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { store as appStore } from '$store/renderer/store';
  import {
    listSettingsRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsListOperation,
    selectSettingsUpdateOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

  const MAX_OUTPUT_CHARS_PATH = 'workspaceApi.maxOutputChars';
  const TOON_OUTPUT_PATH = 'workspaceApi.toonOutput';
  const REPLAY_CHARS_PATH = 'agents.historyReplayToolContentChars';
  const RETENTION_DAYS_PATH = 'agents.toolPayloadRetentionDays';
  const LIST_KEY = 'workspace-api:list';
  const TOON_UPDATE_KEY = 'workspace-api:toon';
  const MAX_CHARS_UPDATE_KEY = 'workspace-api:max-chars';
  const REPLAY_CHARS_UPDATE_KEY = 'workspace-api:replay-chars';
  const RETENTION_DAYS_UPDATE_KEY = 'workspace-api:retention-days';

  const listOperation$ = selectSettingsListOperation(LIST_KEY);
  const toonUpdate$ = selectSettingsUpdateOperation(TOON_UPDATE_KEY);
  const maxCharsUpdate$ = selectSettingsUpdateOperation(MAX_CHARS_UPDATE_KEY);
  const replayCharsUpdate$ = selectSettingsUpdateOperation(REPLAY_CHARS_UPDATE_KEY);
  const retentionDaysUpdate$ = selectSettingsUpdateOperation(RETENTION_DAYS_UPDATE_KEY);

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
  let persistedReplayChars = $state<number>(4000);
  let editedReplayChars = $state<string>('4000');
  let replayCharsSaving = $state(false);
  let persistedRetentionDays = $state<number>(0);
  let editedRetentionDays = $state<string>('0');
  let retentionDaysSaving = $state(false);

  let seenListVersion = selectSettingsListOperation.select(appStore.state, LIST_KEY).version;
  let seenToonVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    TOON_UPDATE_KEY,
  ).version;
  let seenMaxCharsVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    MAX_CHARS_UPDATE_KEY,
  ).version;
  let seenReplayCharsVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    REPLAY_CHARS_UPDATE_KEY,
  ).version;
  let seenRetentionDaysVersion = selectSettingsUpdateOperation.select(
    appStore.state,
    RETENTION_DAYS_UPDATE_KEY,
  ).version;

  function parseIntegerInput(raw: string | number | null): number {
    if (raw === null || String(raw).trim() === '') return Number.NaN;
    return Number(raw);
  }

  onMount(() => {
    appStore.dispatch(listSettingsRequested(LIST_KEY));
  });

  $effect(() => {
    const operation = $listOperation$;
    loading = operation.status === 'idle' || operation.status === 'loading';
    if (operation.version <= seenListVersion || operation.status === 'loading') return;
    seenListVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      const settings = operation.data;
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
      toonOutput = toon?.value !== false;
      if (typeof replayChars?.value === 'number') {
        persistedReplayChars = replayChars.value;
        editedReplayChars = String(replayChars.value);
      }
      if (typeof retentionDays?.value === 'number') {
        persistedRetentionDays = retentionDays.value;
        editedRetentionDays = String(retentionDays.value);
      }
    } else if (operation.status === 'error') {
      notify.error(
        m.settings_workspaceApi_loadError({
          error: operation.error ?? m.settings_workspaceApi_loadError({ error: '' }),
        }),
      );
    }
  });

  $effect(() => {
    const operation = $toonUpdate$;
    if (operation.version <= seenToonVersion || operation.status === 'loading') return;
    seenToonVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      const applied = operation.data.find(
        (r: { path: string; value: unknown }) => r.path === TOON_OUTPUT_PATH,
      );
      if (!applied || applied.value !== toonOutput) {
        notify.error(m.settings_workspaceApi_toonOutput_rollbackError());
        toonOutput = applied ? applied.value !== false : !toonOutput;
      }
    } else if (operation.status === 'error') {
      notify.error(
        m.settings_workspaceApi_toonOutput_error({
          error: operation.error ?? '',
        }),
      );
      toonOutput = !toonOutput;
    }
  });

  function handleToonToggle(checked: boolean) {
    toonOutput = checked;
    appStore.dispatch(
      updateSettingsRequested([{ path: TOON_OUTPUT_PATH, value: checked }], TOON_UPDATE_KEY),
    );
  }

  $effect(() => {
    const operation = $maxCharsUpdate$;
    maxCharsSaving = operation.status === 'loading';
    if (operation.version <= seenMaxCharsVersion || operation.status === 'loading') return;
    seenMaxCharsVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      const applied = operation.data.find((r) => r.path === MAX_OUTPUT_CHARS_PATH);
      const requested = parseIntegerInput(editedMaxOutputChars);
      if (!applied || applied.value !== requested) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedMaxOutputChars;
        notify.error(m.settings_workspaceApi_maxOutputChars_rollbackError());
        persistedMaxOutputChars = rolledBackValue;
        editedMaxOutputChars = String(rolledBackValue);
      } else {
        persistedMaxOutputChars = requested;
        notify.success(m.settings_workspaceApi_maxOutputChars_saved());
      }
    } else if (operation.status === 'error') {
      notify.error(m.settings_workspaceApi_saveError({ error: operation.error ?? '' }));
      editedMaxOutputChars = String(persistedMaxOutputChars);
    }
  });

  function handleMaxCharsSave() {
    const newValue = parseIntegerInput(editedMaxOutputChars);
    if (
      !Number.isInteger(newValue) ||
      newValue < 0 ||
      (newValue !== 0 && newValue < 1000) ||
      newValue > 10_000_000
    ) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      updateSettingsRequested(
        [{ path: MAX_OUTPUT_CHARS_PATH, value: newValue }],
        MAX_CHARS_UPDATE_KEY,
      ),
    );
  }

  $effect(() => {
    const operation = $replayCharsUpdate$;
    replayCharsSaving = operation.status === 'loading';
    if (operation.version <= seenReplayCharsVersion || operation.status === 'loading') return;
    seenReplayCharsVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      const applied = operation.data.find((r) => r.path === REPLAY_CHARS_PATH);
      const requested = parseIntegerInput(editedReplayChars);
      if (!applied || applied.value !== requested) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedReplayChars;
        notify.error(m.settings_workspaceApi_replayChars_rollbackError());
        persistedReplayChars = rolledBackValue;
        editedReplayChars = String(rolledBackValue);
      } else {
        persistedReplayChars = requested;
        notify.success(m.settings_workspaceApi_replayChars_saved());
      }
    } else if (operation.status === 'error') {
      notify.error(m.settings_workspaceApi_saveError({ error: operation.error ?? '' }));
      editedReplayChars = String(persistedReplayChars);
    }
  });

  function handleReplayCharsSave() {
    const newValue = parseIntegerInput(editedReplayChars);
    if (!Number.isInteger(newValue) || newValue < 500 || newValue > 100_000) return;
    appStore.dispatch(
      updateSettingsRequested(
        [{ path: REPLAY_CHARS_PATH, value: newValue }],
        REPLAY_CHARS_UPDATE_KEY,
      ),
    );
  }

  $effect(() => {
    const operation = $retentionDaysUpdate$;
    retentionDaysSaving = operation.status === 'loading';
    if (operation.version <= seenRetentionDaysVersion || operation.status === 'loading') return;
    seenRetentionDaysVersion = operation.version;
    if (operation.status === 'success' && operation.data) {
      const applied = operation.data.find((r) => r.path === RETENTION_DAYS_PATH);
      const requested = parseIntegerInput(editedRetentionDays);
      if (!applied || applied.value !== requested) {
        const rolledBackValue =
          typeof applied?.value === 'number' ? applied.value : persistedRetentionDays;
        notify.error(m.settings_workspaceApi_retentionDays_rollbackError());
        persistedRetentionDays = rolledBackValue;
        editedRetentionDays = String(rolledBackValue);
      } else {
        persistedRetentionDays = requested;
        notify.success(m.settings_workspaceApi_retentionDays_saved());
      }
    } else if (operation.status === 'error') {
      notify.error(m.settings_workspaceApi_saveError({ error: operation.error ?? '' }));
      editedRetentionDays = String(persistedRetentionDays);
    }
  });

  function handleRetentionDaysSave() {
    const newValue = parseIntegerInput(editedRetentionDays);
    if (!Number.isInteger(newValue) || newValue < 0 || newValue > 3650) return;
    appStore.dispatch(
      updateSettingsRequested(
        [{ path: RETENTION_DAYS_PATH, value: newValue }],
        RETENTION_DAYS_UPDATE_KEY,
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
                parseIntegerInput(editedReplayChars) <= 100_000
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
