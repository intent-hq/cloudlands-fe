<script lang="ts">
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
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { Input } from '$lib/components/ui/input';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

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
      toast.error(
        m.settings_workspaceApi_loadError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loading = false;
    }
  }

  async function handleToonToggle(checked: boolean) {
    try {
      const result = await appClient.settings.update([{ path: TOON_OUTPUT_PATH, value: checked }]);

      // A missing entry means the daemon did not apply the change; treat it
      // like a rollback.
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === TOON_OUTPUT_PATH,
      );
      if (!applied || applied.value !== checked) {
        toast.error(m.settings_workspaceApi_toonOutput_rollbackError());
        toonOutput = applied ? applied.value !== false : !checked;
        return;
      }

      toonOutput = checked;
    } catch (error) {
      toast.error(
        m.settings_workspaceApi_toonOutput_error({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      toonOutput = !checked;
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
        toast.error(m.settings_workspaceApi_maxOutputChars_rollbackError());
        persistedMaxOutputChars = rolledBackValue;
        editedMaxOutputChars = String(rolledBackValue);
        return;
      }

      persistedMaxOutputChars = newValue;
      toast.success(m.settings_workspaceApi_maxOutputChars_saved());
    } catch (error) {
      toast.error(
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
        toast.error(m.settings_workspaceApi_replayChars_rollbackError());
        persistedReplayChars = rolledBackValue;
        editedReplayChars = String(rolledBackValue);
        return;
      }

      persistedReplayChars = newValue;
      toast.success(m.settings_workspaceApi_replayChars_saved());
    } catch (error) {
      toast.error(
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
        toast.error(m.settings_workspaceApi_retentionDays_rollbackError());
        persistedRetentionDays = rolledBackValue;
        editedRetentionDays = String(rolledBackValue);
        return;
      }

      persistedRetentionDays = newValue;
      toast.success(m.settings_workspaceApi_retentionDays_saved());
    } catch (error) {
      toast.error(
        m.settings_workspaceApi_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedRetentionDays = String(persistedRetentionDays);
    } finally {
      retentionDaysSaving = false;
    }
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
          <p class="text-sm font-medium text-foreground">
            {m.settings_workspaceApi_maxOutputChars_label()}
          </p>
          <p class="text-xs text-subtle mt-1">
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
              class="h-9 text-sm"
            />
          </div>
          {#if parsed !== persistedMaxOutputChars}
            <button
              type="button"
              onclick={handleMaxCharsSave}
              disabled={maxCharsSaving || !isValid}
              class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {maxCharsSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="text-xs text-amber-500/90 mt-1">
          {m.settings_workspaceApi_maxOutputChars_invalid()}
        </p>
      {/if}
    {/snippet}
    {@render maxCharsValidation()}
  </section>

  <!-- Replay tool output characters -->
  <section class="px-6 py-4">
    {#snippet replayCharsValidation()}
      {@const parsed = parseIntegerInput(editedReplayChars)}
      <!-- i18n-ignore (template expression, not user-facing text) -->
      {@const isValid = Number.isInteger(parsed) && parsed >= 500 && parsed <= 100_000}
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-foreground">
            {m.settings_workspaceApi_replayChars_label()}
          </p>
          <p class="text-xs text-subtle mt-1">
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
              class="h-9 text-sm"
            />
          </div>
          {#if parsed !== persistedReplayChars}
            <button
              type="button"
              onclick={handleReplayCharsSave}
              disabled={replayCharsSaving || !isValid}
              class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {replayCharsSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="text-xs text-amber-500/90 mt-1">
          {m.settings_workspaceApi_replayChars_invalid()}
        </p>
      {/if}
    {/snippet}
    {@render replayCharsValidation()}
  </section>

  <!-- Tool payload retention (days) -->
  <section class="px-6 py-4">
    {#snippet retentionDaysValidation()}
      {@const parsed = parseIntegerInput(editedRetentionDays)}
      <!-- i18n-ignore (template expression, not user-facing text) -->
      {@const isValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650}
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-foreground">
            {m.settings_workspaceApi_retentionDays_label()}
          </p>
          <p class="text-xs text-subtle mt-1">
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
              class="h-9 text-sm"
            />
          </div>
          {#if parsed !== persistedRetentionDays}
            <button
              type="button"
              onclick={handleRetentionDaysSave}
              disabled={retentionDaysSaving || !isValid}
              class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {retentionDaysSaving
                ? m.settings_workspaceApi_maxOutputChars_saving()
                : m.settings_workspaceApi_maxOutputChars_save()}
            </button>
          {/if}
        </div>
      </div>
      {#if !isValid}
        <p class="text-xs text-amber-500/90 mt-1">
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
        <p class="text-sm font-medium text-foreground">
          {m.settings_workspaceApi_toonOutput_label()}
        </p>
        <p class="text-xs text-subtle mt-1">
          {m.settings_workspaceApi_toonOutput_description()}
        </p>
      </div>
      <Toggle
        pressed={toonOutput}
        onclick={() => handleToonToggle(!toonOutput)}
        variant="indicator"
        size="xs"
        class="mb-auto"
        disabled={loading}
        ariaLabel={m.settings_workspaceApi_toonOutput_label()}
      />
    </div>
  </section>
</div>
