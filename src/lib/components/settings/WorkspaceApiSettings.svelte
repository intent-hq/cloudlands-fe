<script lang="ts">
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
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { Input } from '$lib/components/ui/input';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

  const MAX_OUTPUT_CHARS_PATH = 'workspaceApi.maxOutputChars';
  const TOON_OUTPUT_PATH = 'workspaceApi.toonOutput';

  let loading = $state(true);
  let toonOutput = $state(true);

  // Max output chars editing state (persisted value vs input string)
  let persistedMaxOutputChars = $state<number>(100000);
  let editedMaxOutputChars = $state<string>('100000');
  let maxCharsSaving = $state(false);

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
      const result = await appClient.settings.update([
        { path: TOON_OUTPUT_PATH, value: checked },
      ]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === TOON_OUTPUT_PATH,
      );
      if (applied && applied.value !== checked) {
        toast.error(m.settings_workspaceApi_toonOutput_rollbackError());
        toonOutput = applied.value !== false;
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
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- Max output chars -->
  <section class="px-6 py-4">
    {#snippet maxCharsValidation()}
      {@const parsed = Number(editedMaxOutputChars)}
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
          {#if Number(editedMaxOutputChars) !== persistedMaxOutputChars}
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
