<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Agent Features Settings Component
   *
   * Reads/writes the daemon-owned `agentFeatures.*` settings via
   * settings.list / settings.update (PROTOCOL §5.12), following the
   * WorkspaceApiSettings pattern. Thirteen booleans, each coerced to its own
   * daemon default when absent (see agent-feature-definitions.ts): all
   * default on except `peerAgents`, the one opt-in toggle.
   *
   * Toggles are captured at agent-session creation, so changes apply to
   * newly created sessions only — existing sessions keep the surface they
   * were created with.
   *
   * The PR-monitor toggle carries a companion numeric input directly
   * beneath it for `prMonitor.debounceSeconds` (§6.9, min 10 / max 86400;
   * disabled while the feature is off). `prMonitor.pollSeconds` deliberately
   * gets NO UI — it is config-file only. The peer-agents toggle likewise
   * carries a companion numeric input for `agents.maxTopLevelAgents` (min 1,
   * no max, default 20; the runaway-spawn guard on the peer-spawn path,
   * disabled while the feature is off).
   */
  import { onMount } from 'svelte';
  import { Toggle } from '$lib/components/ui/toggle';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { toast } from '$lib/components/ui/toast';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

  import {
    FEATURE_DEFAULTS,
    FEATURE_PATHS,
    FEATURES,
    type FeaturePath,
  } from '$lib/components/settings/agent-feature-definitions';

  // i18n-ignore (wire setting path, not user-facing text)
  const DEBOUNCE_PATH = 'prMonitor.debounceSeconds';
  // Daemon-side registered bounds for prMonitor.debounceSeconds (§6.9).
  const MIN_DEBOUNCE_SECONDS = 10;
  const MAX_DEBOUNCE_SECONDS = 86400;

  // i18n-ignore (wire setting path, not user-facing text)
  const MAX_AGENTS_PATH = 'agents.maxTopLevelAgents';
  // Daemon-side registered bound for agents.maxTopLevelAgents (min 1, no max).
  const MIN_MAX_TOP_LEVEL_AGENTS = 1;
  const DEFAULT_MAX_TOP_LEVEL_AGENTS = 20;

  // An absent settings.list entry coerces to the feature's daemon default.
  function coerceValue(path: FeaturePath, value: unknown): boolean {
    return typeof value === 'boolean' ? value : FEATURE_DEFAULTS[path];
  }

  let loading = $state(true);
  // Seed from per-feature daemon defaults (PROTOCOL §5.12)
  let values = $state<Record<FeaturePath, boolean>>({ ...FEATURE_DEFAULTS });
  // Daemon-provided approximate token cost per toggle (§5.12 `tokenImpact`);
  // absent on older daemons or unannotated entries → no line rendered.
  let tokenImpacts = $state<Partial<Record<FeaturePath, string>>>({});

  // Debounce window (§6.9): persisted seconds + input mirror, min 10.
  let persistedDebounce = $state<number>(60);
  let editedDebounce = $state<string>('60');
  let debounceSaving = $state(false);

  // Top-level agent cap: persisted count + input mirror, min 1.
  let persistedMaxAgents = $state<number>(DEFAULT_MAX_TOP_LEVEL_AGENTS);
  let editedMaxAgents = $state<string>(String(DEFAULT_MAX_TOP_LEVEL_AGENTS));
  let maxAgentsSaving = $state(false);

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const settings = await appClient.settings.list();
      for (const path of FEATURE_PATHS) {
        const entry = settings.find((s: { path: string; value: unknown }) => s.path === path);
        values[path] = coerceValue(path, entry?.value);
        tokenImpacts[path] = typeof entry?.tokenImpact === 'string' ? entry.tokenImpact : undefined;
      }
      const debounce = settings.find(
        (s: { path: string; value: unknown }) => s.path === DEBOUNCE_PATH,
      );
      if (typeof debounce?.value === 'number') {
        persistedDebounce = debounce.value;
        editedDebounce = String(debounce.value);
      }
      const maxAgents = settings.find(
        (s: { path: string; value: unknown }) => s.path === MAX_AGENTS_PATH,
      );
      if (typeof maxAgents?.value === 'number') {
        persistedMaxAgents = maxAgents.value;
        editedMaxAgents = String(maxAgents.value);
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
        values[path] = coerceValue(path, applied.value);
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

  async function handleMaxAgentsSave() {
    const newValue = Number(editedMaxAgents);
    if (!Number.isInteger(newValue) || newValue < MIN_MAX_TOP_LEVEL_AGENTS) {
      return; // invalid input, do nothing
    }

    try {
      maxAgentsSaving = true;
      const result = await appClient.settings.update([{ path: MAX_AGENTS_PATH, value: newValue }]);

      // Check if the daemon rolled back the setting on failure
      const applied = result.find(
        (r: { path: string; value: unknown }) => r.path === MAX_AGENTS_PATH,
      );
      if (applied && applied.value !== newValue) {
        const rolledBackValue =
          typeof applied.value === 'number' ? applied.value : persistedMaxAgents;
        toast.error(m.settings_agentFeatures_rollbackError());
        persistedMaxAgents = rolledBackValue;
        editedMaxAgents = String(rolledBackValue);
        return;
      }

      persistedMaxAgents = newValue;
    } catch (error) {
      toast.error(
        m.settings_agentFeatures_saveError({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      editedMaxAgents = String(persistedMaxAgents);
    } finally {
      maxAgentsSaving = false;
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
          {#if tokenImpacts[feature.path]}
            <!-- i18n-ignore (daemon-provided wire text, PROTOCOL §5.12 tokenImpact) -->
            <p class="text-xs text-ghost mt-1">{tokenImpacts[feature.path]}</p>
          {/if}
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
      {#if feature.path === 'agentFeatures.peerAgents'}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const maxAgentsNum = Number(editedMaxAgents)}
        <!-- i18n-ignore (template expression, not user-facing text) -->
        {@const isMaxAgentsValid =
          Number.isInteger(maxAgentsNum) && maxAgentsNum >= MIN_MAX_TOP_LEVEL_AGENTS}
        <div class="mt-3 flex items-center justify-between gap-3">
          <span class="text-sm text-muted-foreground"
            >{m.settings_agentFeatures_maxTopLevelAgents_label()}</span
          >
          <div class="flex items-center gap-2">
            <div class="shrink-0 w-24">
              <Input
                type="number"
                min={MIN_MAX_TOP_LEVEL_AGENTS}
                bind:value={editedMaxAgents}
                disabled={loading || maxAgentsSaving || !values['agentFeatures.peerAgents']}
                aria-label={m.settings_agentFeatures_maxTopLevelAgents_ariaLabel()}
                class="h-9 text-sm"
              />
            </div>
            {#if Number(editedMaxAgents) !== persistedMaxAgents}
              <Button
                variant="secondary"
                size="xs"
                onclick={handleMaxAgentsSave}
                disabled={maxAgentsSaving ||
                  !isMaxAgentsValid ||
                  !values['agentFeatures.peerAgents']}
              >
                {maxAgentsSaving
                  ? m.settings_agentFeatures_maxTopLevelAgents_saving()
                  : m.settings_agentFeatures_maxTopLevelAgents_save()}
              </Button>
            {/if}
          </div>
        </div>
        {#if !isMaxAgentsValid}
          <p class="text-xs text-amber-500/90 mt-1">
            {m.settings_agentFeatures_maxTopLevelAgents_invalid()}
          </p>
        {/if}
      {/if}
    </section>
  {/each}
</div>
