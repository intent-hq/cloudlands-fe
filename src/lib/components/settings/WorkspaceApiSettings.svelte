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
  import { Button, Input, Switch } from '$lib/components/patterns/settings/custom-controls';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
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
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- Max output chars -->
  <section class="px-6 py-4">
    {#snippet maxCharsValidation()}
      {@const parsed = parseIntegerInput(editedMaxOutputChars)}
      <!-- i18n-ignore (template expression, not user-facing text) -->
      {@const isValid =
        Number.isInteger(parsed) && (parsed === 0 || (parsed >= 1000 && parsed <= 10_000_000))}
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="type-body font-medium text-foreground">
            {m.settings_workspaceApi_maxOutputChars_label()}
          </p>
          <p class="type-caption text-subtle mt-1">
            {m.settings_workspaceApi_maxOutputChars_description()}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="shrink-0 w-32">
            <Input
              type="number"
              min="0"
              max="10000000"
              bind:value={editedMaxOutputChars}
              disabled={maxCharsSaving || loading}
              aria-label={m.settings_workspaceApi_maxOutputChars_ariaLabel()}
              class="h-9 type-body"
            />
          </div>
          {#if parsed !== persistedMaxOutputChars}
            <Button
              variant="secondary"
              size="xs"
              onclick={handleMaxCharsSave}
              disabled={maxCharsSaving || !isValid}
            >
              {maxCharsSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </Button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="type-caption text-warning-ink mt-1">
          {m.settings_workspaceApi_maxOutputChars_invalid()}
        </p>
      {/if}
    {/snippet}
    {@render maxCharsValidation()}
  </section>

  <section class="px-6 py-4">
    {#snippet replayCharsValidation()}
      {@const parsed = parseIntegerInput(editedReplayChars)}
      <!-- i18n-ignore (template expression, not user-facing text) -->
      {@const isValid = Number.isInteger(parsed) && parsed >= 500 && parsed <= 100_000}
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="type-body font-medium text-foreground">
            {m.settings_workspaceApi_replayChars_label()}
          </p>
          <p class="type-caption text-subtle mt-1">
            {m.settings_workspaceApi_replayChars_description()}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="shrink-0 w-32">
            <Input
              type="number"
              min="500"
              max="100000"
              bind:value={editedReplayChars}
              disabled={replayCharsSaving || loading}
              aria-label={m.settings_workspaceApi_replayChars_ariaLabel()}
              class="h-9 type-body"
            />
          </div>
          {#if parsed !== persistedReplayChars}
            <Button
              variant="secondary"
              size="xs"
              onclick={handleReplayCharsSave}
              disabled={replayCharsSaving || !isValid}
            >
              {replayCharsSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </Button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="type-caption text-warning-ink mt-1">
          {m.settings_workspaceApi_replayChars_invalid()}
        </p>
      {/if}
    {/snippet}
    {@render replayCharsValidation()}
  </section>

  <section class="px-6 py-4">
    {#snippet retentionDaysValidation()}
      {@const parsed = parseIntegerInput(editedRetentionDays)}
      <!-- i18n-ignore (template expression, not user-facing text) -->
      {@const isValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650}
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="type-body font-medium text-foreground">
            {m.settings_workspaceApi_retentionDays_label()}
          </p>
          <p class="type-caption text-subtle mt-1">
            {m.settings_workspaceApi_retentionDays_description()}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="shrink-0 w-32">
            <Input
              type="number"
              min="0"
              max="3650"
              bind:value={editedRetentionDays}
              disabled={retentionDaysSaving || loading}
              aria-label={m.settings_workspaceApi_retentionDays_ariaLabel()}
              class="h-9 type-body"
            />
          </div>
          {#if parsed !== persistedRetentionDays}
            <Button
              variant="secondary"
              size="xs"
              onclick={handleRetentionDaysSave}
              disabled={retentionDaysSaving || !isValid}
            >
              {retentionDaysSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </Button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="type-caption text-warning-ink mt-1">
          {m.settings_workspaceApi_retentionDays_invalid()}
        </p>
      {/if}
    {/snippet}
    {@render retentionDaysValidation()}
  </section>

  <!-- TOON output toggle -->
  <section class="px-6 py-5">
    <div class="flex items-center justify-between">
      <div>
        <p class="type-body font-medium text-foreground">
          {m.settings_workspaceApi_toonOutput_label()}
        </p>
        <p class="type-caption text-subtle mt-1">
          {m.settings_workspaceApi_toonOutput_description()}
        </p>
      </div>
      <Switch
        checked={toonOutput}
        onCheckedChange={handleToonToggle}
        size="xs"
        class="mb-auto"
        disabled={loading}
        ariaLabel={m.settings_workspaceApi_toonOutput_label()}
      />
    </div>
  </section>
</div>
