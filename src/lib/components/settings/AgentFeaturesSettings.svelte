<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Agent Features Settings Component
   *
   * Reads/writes the daemon-owned `agentFeatures.*` settings via
   * settings.list / settings.update (PROTOCOL §5.12), following the
   * WorkspaceApiSettings pattern. Ten booleans, all default true:
   * backgroundHooks, hostExec, scripts, terminalAccess, browserAutomation,
   * richChatBlocks, structuredQuestions, attentionRequests, stateSnapshot,
   * prMonitor.
   *
   * Toggles are captured at agent-session creation, so changes apply to
   * newly created sessions only — existing sessions keep the surface they
   * were created with. `stateSnapshot` is the documented exception: the
   * daemon reads it live per turn, so it also affects existing sessions.
   *
   * The PR-monitor toggle carries a companion numeric input directly
   * beneath it for `prMonitor.debounceSeconds` (§6.9, min 10 / max 86400;
   * disabled while the feature is off). `prMonitor.pollSeconds` deliberately
   * gets NO UI — it is config-file only.
   */
  import { onMount } from 'svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import { Input } from '$lib/components/ui/input';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

  // i18n-ignore (wire setting paths, not user-facing text)
  const FEATURE_PATHS = [
    'agentFeatures.backgroundHooks',
    'agentFeatures.hostExec',
    'agentFeatures.scripts',
    'agentFeatures.terminalAccess',
    'agentFeatures.browserAutomation',
    'agentFeatures.richChatBlocks',
    'agentFeatures.structuredQuestions',
    'agentFeatures.attentionRequests',
    'agentFeatures.stateSnapshot',
    'agentFeatures.prMonitor',
  ] as const;

  // i18n-ignore (wire setting path, not user-facing text)
  const DEBOUNCE_PATH = 'prMonitor.debounceSeconds';
  // Daemon-side registered bounds for prMonitor.debounceSeconds (§6.9).
  const MIN_DEBOUNCE_SECONDS = 10;
  const MAX_DEBOUNCE_SECONDS = 86400;

  type FeaturePath = (typeof FEATURE_PATHS)[number];

  const FEATURES: { path: FeaturePath; label: () => string; description: () => string }[] = [
    {
      path: 'agentFeatures.backgroundHooks',
      label: () => m.settings_agentFeatures_backgroundHooks_label(),
      description: () => m.settings_agentFeatures_backgroundHooks_description(),
    },
    {
      path: 'agentFeatures.hostExec',
      label: () => m.settings_agentFeatures_hostExec_label(),
      description: () => m.settings_agentFeatures_hostExec_description(),
    },
    {
      path: 'agentFeatures.scripts',
      label: () => m.settings_agentFeatures_scripts_label(),
      description: () => m.settings_agentFeatures_scripts_description(),
    },
    {
      path: 'agentFeatures.terminalAccess',
      label: () => m.settings_agentFeatures_terminalAccess_label(),
      description: () => m.settings_agentFeatures_terminalAccess_description(),
    },
    {
      path: 'agentFeatures.browserAutomation',
      label: () => m.settings_agentFeatures_browserAutomation_label(),
      description: () => m.settings_agentFeatures_browserAutomation_description(),
    },
    {
      path: 'agentFeatures.richChatBlocks',
      label: () => m.settings_agentFeatures_richChatBlocks_label(),
      description: () => m.settings_agentFeatures_richChatBlocks_description(),
    },
    {
      path: 'agentFeatures.structuredQuestions',
      label: () => m.settings_agentFeatures_structuredQuestions_label(),
      description: () => m.settings_agentFeatures_structuredQuestions_description(),
    },
    {
      path: 'agentFeatures.attentionRequests',
      label: () => m.settings_agentFeatures_attentionRequests_label(),
      description: () => m.settings_agentFeatures_attentionRequests_description(),
    },
    {
      path: 'agentFeatures.stateSnapshot',
      label: () => m.settings_agentFeatures_stateSnapshot_label(),
      description: () => m.settings_agentFeatures_stateSnapshot_description(),
    },
    {
      path: 'agentFeatures.prMonitor',
      label: () => m.settings_agentFeatures_prMonitor_label(),
      description: () => m.settings_agentFeatures_prMonitor_description(),
    },
  ];

  let loading = $state(true);
  // All features default to on (PROTOCOL §5.12: ten booleans, default true)
  let values = $state<Record<FeaturePath, boolean>>(
    Object.fromEntries(FEATURE_PATHS.map((path) => [path, true])) as Record<FeaturePath, boolean>,
  );

  // Debounce window (§6.9): persisted seconds + input mirror, min 10.
  let persistedDebounce = $state<number>(60);
  let editedDebounce = $state<string>('60');
  let debounceSaving = $state(false);

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      for (const path of FEATURE_PATHS) {
        const entry = settings.find((s: { path: string; value: unknown }) => s.path === path);
        values[path] = entry?.value !== false;
      }
      const debounce = settings.find(
        (s: { path: string; value: unknown }) => s.path === DEBOUNCE_PATH,
      );
      if (typeof debounce?.value === 'number') {
        persistedDebounce = debounce.value;
        editedDebounce = String(debounce.value);
      }
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_loadError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      loading = false;
    }
  }

  async function handleToggle(path: FeaturePath, checked: boolean) {
    try {
      const result = await appClient.settings.update([{ path, value: checked }]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find((r: { path: string; value: unknown }) => r.path === path);
      if (applied && applied.value !== checked) {
        toast.error(m.settings_agentFeatures_rollbackError());
        values[path] = applied.value !== false;
        return;
      }

      values[path] = checked;
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      values[path] = !checked;
    }
  }

  async function handleDebounceSave() {
    const newValue = Number(editedDebounce);
    if (
      !Number.isInteger(newValue) ||
      newValue < MIN_DEBOUNCE_SECONDS ||
      newValue > MAX_DEBOUNCE_SECONDS
    ) {
      return; // invalid input, do nothing
    }

    try {
      debounceSaving = true;
      const result = await appClient.settings.update([{ path: DEBOUNCE_PATH, value: newValue }]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === DEBOUNCE_PATH,
      );
      if (applied && applied.value !== newValue) {
        const rolledBackValue =
          typeof applied.value === 'number' ? applied.value : persistedDebounce;
        toast.error(m.settings_agentFeatures_rollbackError());
        persistedDebounce = rolledBackValue;
        editedDebounce = String(rolledBackValue);
        return;
      }

      persistedDebounce = newValue;
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedDebounce = String(persistedDebounce);
    } finally {
      debounceSaving = false;
    }
  }
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- New-sessions-only note -->
  <section class="px-6 py-4">
    <p class="text-xs text-amber-500/90">
      {m.settings_agentFeatures_newSessionsNote()}
    </p>
  </section>

  {#each FEATURES as feature (feature.path)}
    <section class="px-6 py-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-foreground">{feature.label()}</p>
          <p class="text-xs text-subtle mt-1">{feature.description()}</p>
        </div>
        <Toggle
          pressed={values[feature.path]}
          onclick={() => handleToggle(feature.path, !values[feature.path])}
          variant="indicator"
          size="xs"
          class="mb-auto"
          disabled={loading}
          ariaLabel={feature.label()}
        />
      </div>
      {#if feature.path === 'agentFeatures.prMonitor'}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const debounceNum = Number(editedDebounce)}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const isDebounceValid =
          Number.isInteger(debounceNum) &&
          debounceNum >= MIN_DEBOUNCE_SECONDS &&
          debounceNum <= MAX_DEBOUNCE_SECONDS}
        <div class="mt-3 flex items-center justify-between gap-3">
          <span class="text-sm text-muted-foreground"
            >{m.settings_agentFeatures_prMonitorDebounce_label()}</span
          >
          <div class="flex items-center gap-2">
            <div class="shrink-0 w-24">
              <Input
                type="number"
                min={MIN_DEBOUNCE_SECONDS}
                max={MAX_DEBOUNCE_SECONDS}
                bind:value={editedDebounce}
                disabled={loading || debounceSaving || !values['agentFeatures.prMonitor']}
                aria-label={m.settings_agentFeatures_prMonitorDebounce_ariaLabel()}
                class="h-9 text-sm"
              />
            </div>
            {#if Number(editedDebounce) !== persistedDebounce}
              <button
                type="button"
                onclick={handleDebounceSave}
                disabled={debounceSaving || !isDebounceValid || !values['agentFeatures.prMonitor']}
                class="px-3 py-1 text-xs font-medium text-foreground bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {debounceSaving
                  ? m.settings_agentFeatures_prMonitorDebounce_saving()
                  : m.settings_agentFeatures_prMonitorDebounce_save()}
              </button>
            {/if}
          </div>
        </div>
        {#if !isDebounceValid}
          <p class="text-xs text-amber-500/90 mt-1">
            {m.settings_agentFeatures_prMonitorDebounce_invalid()}
          </p>
        {/if}
      {/if}
    </section>
  {/each}
</div>
