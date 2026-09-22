<script lang="ts">
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
    selectSettingsUpdateOperations,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

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
  const LIST_KEY = 'agent-features:list';
  const updateKey = (path: string) => `agent-features:update:${path}`;

  const listOperation$ = selectSettingsListOperation(LIST_KEY);
  const updateOperations$ = selectSettingsUpdateOperations();

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

  let seenListVersion = selectSettingsListOperation.select(appStore.state, LIST_KEY).version;
  const seenUpdateVersions: Record<string, number> = Object.fromEntries(
    Object.entries(selectSettingsUpdateOperations.select(appStore.state)).map(
      ([key, operation]) => [key, operation.version],
    ),
  );

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
    } else if (operation.status === 'error') {
      notify.error(
        m.settings_agentFeatures_loadError({
          error: operation.error ?? '',
        }),
      );
    }
  });

  $effect(() => {
    const operations = $updateOperations$;
    for (const path of [...FEATURE_PATHS, DEBOUNCE_PATH, MAX_AGENTS_PATH]) {
      const key = updateKey(path);
      const operation = operations[key];
      if (!operation || operation.status === 'loading') continue;
      if (operation.version <= (seenUpdateVersions[key] ?? 0)) continue;
      seenUpdateVersions[key] = operation.version;
      if (FEATURE_PATHS.includes(path as FeaturePath)) {
        const featurePath = path as FeaturePath;
        if (operation.status === 'success' && operation.data) {
          const applied = operation.data.find((entry) => entry.path === path);
          if (applied && applied.value !== values[featurePath]) {
            notify.error(m.settings_agentFeatures_rollbackError());
            values[featurePath] = coerceValue(featurePath, applied.value);
          }
        } else if (operation.status === 'error') {
          notify.error(m.settings_agentFeatures_saveError({ error: operation.error ?? '' }));
          values[featurePath] = !values[featurePath];
        }
      } else if (path === DEBOUNCE_PATH) {
        debounceSaving = false;
        if (operation.status === 'success' && operation.data) {
          const applied = operation.data.find((entry) => entry.path === path);
          if (applied && applied.value !== Number(editedDebounce)) {
            const rollback = typeof applied.value === 'number' ? applied.value : persistedDebounce;
            notify.error(m.settings_agentFeatures_rollbackError());
            persistedDebounce = rollback;
            editedDebounce = String(rollback);
          } else persistedDebounce = Number(editedDebounce);
        } else if (operation.status === 'error') {
          notify.error(m.settings_agentFeatures_saveError({ error: operation.error ?? '' }));
          editedDebounce = String(persistedDebounce);
        }
      } else {
        maxAgentsSaving = false;
        if (operation.status === 'success' && operation.data) {
          const applied = operation.data.find((entry) => entry.path === path);
          if (applied && applied.value !== Number(editedMaxAgents)) {
            const rollback = typeof applied.value === 'number' ? applied.value : persistedMaxAgents;
            notify.error(m.settings_agentFeatures_rollbackError());
            persistedMaxAgents = rollback;
            editedMaxAgents = String(rollback);
          } else persistedMaxAgents = Number(editedMaxAgents);
        } else if (operation.status === 'error') {
          notify.error(m.settings_agentFeatures_saveError({ error: operation.error ?? '' }));
          editedMaxAgents = String(persistedMaxAgents);
        }
      }
    }
  });

  function handleToggle(path: FeaturePath, checked: boolean) {
    values[path] = checked;
    appStore.dispatch(updateSettingsRequested([{ path, value: checked }], updateKey(path)));
  }

  function handleDebounceSave() {
    const newValue = Number(editedDebounce);
    if (
      !Number.isInteger(newValue) ||
      newValue < MIN_DEBOUNCE_SECONDS ||
      newValue > MAX_DEBOUNCE_SECONDS
    ) {
      return; // invalid input, do nothing
    }

    debounceSaving = true;
    appStore.dispatch(
      updateSettingsRequested([{ path: DEBOUNCE_PATH, value: newValue }], updateKey(DEBOUNCE_PATH)),
    );
  }

  function handleMaxAgentsSave() {
    const newValue = Number(editedMaxAgents);
    if (!Number.isInteger(newValue) || newValue < MIN_MAX_TOP_LEVEL_AGENTS) {
      return; // invalid input, do nothing
    }

    maxAgentsSaving = true;
    appStore.dispatch(
      updateSettingsRequested(
        [{ path: MAX_AGENTS_PATH, value: newValue }],
        updateKey(MAX_AGENTS_PATH),
      ),
    );
  }
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- New-sessions-only note -->
  <section class="px-6 py-4">
    <p class="type-caption text-warning-ink">
      {m.settings_agentFeatures_newSessionsNote()}
    </p>
  </section>

  {#each FEATURES as feature (feature.path)}
    <section class="px-6 py-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="type-body font-medium text-foreground">{feature.label()}</p>
          <p class="type-caption text-subtle mt-1">{feature.description()}</p>
          {#if tokenImpacts[feature.path]}
            <!-- i18n-ignore (daemon-provided wire text, PROTOCOL §5.12 tokenImpact) -->
            <p class="type-caption text-ghost mt-1">{tokenImpacts[feature.path]}</p>
          {/if}
        </div>
        <Switch
          checked={values[feature.path]}
          onCheckedChange={(checked) => handleToggle(feature.path, checked)}
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
          <span class="type-body text-muted-foreground"
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
                class="h-9 type-body"
              />
            </div>
            {#if Number(editedDebounce) !== persistedDebounce}
              <Button
                variant="secondary"
                size="compact"
                type="button"
                onclick={handleDebounceSave}
                disabled={debounceSaving || !isDebounceValid || !values['agentFeatures.prMonitor']}
                class="type-caption"
              >
                {debounceSaving
                  ? m.settings_agentFeatures_prMonitorDebounce_saving()
                  : m.settings_agentFeatures_prMonitorDebounce_save()}
              </Button>
            {/if}
          </div>
        </div>
        {#if !isDebounceValid}
          <p class="type-caption text-warning-ink mt-1">
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
          <span class="type-body text-muted-foreground"
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
                class="h-9 type-body"
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
          <p class="type-caption text-warning-ink mt-1">
            {m.settings_agentFeatures_maxTopLevelAgents_invalid()}
          </p>
        {/if}
      {/if}
    </section>
  {/each}
</div>
