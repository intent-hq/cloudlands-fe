<script lang="ts">
  /**
   * Agent Features Settings Component
   *
   * Reads/writes the daemon-owned `agentFeatures.*` settings via
   * settings.list / settings.update (PROTOCOL §5.12), following the
   * WorkspaceApiSettings pattern. Thirteen booleans with daemon defaults
   * (see agent-feature-definitions.ts): all default on, while explicit false
   * values remain off. Peer controls require a registered peerAgents entry;
   * an older daemon that omits it keeps those controls unavailable.
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
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingEntry,
  } from '$lib/components/patterns/settings';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
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

  // Coerce values to daemon defaults; peer-agent support is checked separately.
  function coerceValue(path: FeaturePath, value: unknown): boolean {
    return typeof value === 'boolean' ? value : FEATURE_DEFAULTS[path];
  }

  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const form$ = selectSettingsForm(identity);
  const entries$ = selectSettingsFormEntries(identity);
  const debounceOperation$ = selectSettingsFormOperation(identity, DEBOUNCE_PATH);
  const maxAgentsOperation$ = selectSettingsFormOperation(identity, MAX_AGENTS_PATH);
  const loading = $derived(!$form$?.loaded);
  const values = $derived(
    Object.fromEntries(
      FEATURE_PATHS.map((path) => [
        path,
        coerceValue(path, $form$?.drafts[path] ?? $entries$[path]?.value),
      ]),
    ) as Record<FeaturePath, boolean>,
  );
  // settings.list includes registered defaults even without a stored preference.
  const peerAgentsSupported = $derived($entries$['agentFeatures.peerAgents'] !== undefined);
  let peerAgentsEnabled = $derived(peerAgentsSupported && values['agentFeatures.peerAgents']);
  // Daemon-provided approximate token cost per toggle (§5.12 `tokenImpact`);
  // absent on older daemons or unannotated entries → no line rendered.
  const tokenImpacts = $derived(
    Object.fromEntries(FEATURE_PATHS.map((path) => [path, $entries$[path]?.tokenImpact])),
  );

  // Debounce window (§6.9): persisted seconds + input mirror, min 10.
  const persistedDebounce = $derived(Number($entries$[DEBOUNCE_PATH]?.value ?? 60));
  const editedDebounce = $derived(String($form$?.drafts[DEBOUNCE_PATH] ?? persistedDebounce));
  const debounceSaving = $derived($debounceOperation$?.status === 'pending');

  // Top-level agent cap: persisted count + input mirror, min 1.
  const persistedMaxAgents = $derived(
    Number($entries$[MAX_AGENTS_PATH]?.value ?? DEFAULT_MAX_TOP_LEVEL_AGENTS),
  );
  const editedMaxAgents = $derived(String($form$?.drafts[MAX_AGENTS_PATH] ?? persistedMaxAgents));
  const maxAgentsSaving = $derived($maxAgentsOperation$?.status === 'pending');

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'agent-features'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, requestId: crypto.randomUUID(), resource: 'load' }),
    );
    return () => appStore.dispatch(settingsFormClosed(identity));
  });

  function handleToggle(path: FeaturePath, checked: boolean) {
    const form = selectSettingsForm.select(appStore.state, identity);
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    if (!form?.loaded || (path === 'agentFeatures.peerAgents' && !entries[path])) return;
    appStore.dispatch(settingsFormDraftChanged(identity, path, checked));
    appStore.dispatch(
      settingsFormSaveRequested({ ...identity, resource: path, requestId: crypto.randomUUID() }, [
        { path, value: checked },
      ]),
    );
  }

  function handleDebounceSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    if (!form?.loaded) return;
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    const newValue = Number(form.drafts[DEBOUNCE_PATH] ?? entries[DEBOUNCE_PATH]?.value);
    if (
      !Number.isInteger(newValue) ||
      newValue < MIN_DEBOUNCE_SECONDS ||
      newValue > MAX_DEBOUNCE_SECONDS
    ) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: DEBOUNCE_PATH, requestId: crypto.randomUUID() },
        [{ path: DEBOUNCE_PATH, value: newValue }],
      ),
    );
  }

  function isValidDebounce(value: string): boolean {
    const debounce = Number(value);
    return (
      Number.isInteger(debounce) &&
      debounce >= MIN_DEBOUNCE_SECONDS &&
      debounce <= MAX_DEBOUNCE_SECONDS
    );
  }

  function handleMaxAgentsSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    if (
      !form?.loaded ||
      !entries['agentFeatures.peerAgents'] ||
      !coerceValue(
        'agentFeatures.peerAgents',
        form.drafts['agentFeatures.peerAgents'] ?? entries['agentFeatures.peerAgents'].value,
      )
    )
      return;
    const newValue = Number(form.drafts[MAX_AGENTS_PATH] ?? entries[MAX_AGENTS_PATH]?.value);
    if (!Number.isInteger(newValue) || newValue < MIN_MAX_TOP_LEVEL_AGENTS) {
      return; // invalid input, do nothing
    }

    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, resource: MAX_AGENTS_PATH, requestId: crypto.randomUUID() },
        [{ path: MAX_AGENTS_PATH, value: newValue }],
      ),
    );
  }

  const schema = $derived.by(() => {
    const entries: SettingEntry[] = [];
    for (const feature of FEATURES) {
      const currentValue =
        feature.path === 'agentFeatures.peerAgents' ? peerAgentsEnabled : values[feature.path];
      entries.push({
        kind: 'switch',
        id: feature.path,
        label: feature.label(),
        description: feature.description(),
        featureCode: feature.path,
        disabled: loading || (feature.path === 'agentFeatures.peerAgents' && !peerAgentsSupported),
        // i18n-ignore (daemon-provided wire text, PROTOCOL §5.12 tokenImpact)
        status: tokenImpacts[feature.path],
        statusTone: 'subtle',
        get: () => currentValue,
        set: (checked: boolean) => handleToggle(feature.path, checked),
      });
      if (feature.path === 'agentFeatures.prMonitor') {
        entries.push({
          kind: 'custom',
          id: 'pr-monitor-debounce',
          label: m.settings_agentFeatures_prMonitorDebounce_label(),
          disabled: loading || debounceSaving || !values['agentFeatures.prMonitor'],
          busy: debounceSaving,
        });
      }
      if (feature.path === 'agentFeatures.peerAgents') {
        entries.push({
          kind: 'custom',
          id: 'max-top-level-agents',
          label: m.settings_agentFeatures_maxTopLevelAgents_label(),
          disabled: loading || maxAgentsSaving || !peerAgentsEnabled,
          busy: maxAgentsSaving,
        });
      }
    }
    return defineSettings({
      sections: [
        {
          id: 'agent-features',
          title: m.settings_section_agentFeatures(),
          description: m.settings_agentFeatures_newSessionsNote(),
          entries,
        },
      ],
    });
  });
</script>

{#snippet debounceControl()}
  {@const valid = isValidDebounce(editedDebounce)}
  <div class="flex flex-col items-end gap-1">
    <div class="flex items-center gap-2">
      <Input
        type="number"
        min={MIN_DEBOUNCE_SECONDS}
        max={MAX_DEBOUNCE_SECONDS}
        value={editedDebounce}
        oninput={(event) =>
          appStore.dispatch(
            settingsFormDraftChanged(identity, DEBOUNCE_PATH, event.currentTarget.value),
          )}
        disabled={loading || debounceSaving || !values['agentFeatures.prMonitor']}
        aria-label={m.settings_agentFeatures_prMonitorDebounce_ariaLabel()}
        class="w-24"
      />
      {#if Number(editedDebounce) !== persistedDebounce}
        <Button
          variant="secondary"
          size="xs"
          onclick={handleDebounceSave}
          disabled={debounceSaving || !valid || !values['agentFeatures.prMonitor']}
        >
          {debounceSaving
            ? m.settings_agentFeatures_prMonitorDebounce_saving()
            : m.settings_agentFeatures_prMonitorDebounce_save()}
        </Button>
      {/if}
    </div>
    {#if !valid}<p class="type-caption text-warning-ink">
        {m.settings_agentFeatures_prMonitorDebounce_invalid()}
      </p>{/if}
  </div>
{/snippet}

{#snippet maxAgentsControl()}
  <!-- i18n-ignore (template expression, not user-facing text) -->
  {@const maxAgentsNum = Number(editedMaxAgents)}
  <!-- i18n-ignore (template expression, not user-facing text) -->
  {@const valid = Number.isInteger(maxAgentsNum) && maxAgentsNum >= MIN_MAX_TOP_LEVEL_AGENTS}
  <div class="flex flex-col items-end gap-1">
    <div class="flex items-center gap-2">
      <Input
        type="number"
        min={MIN_MAX_TOP_LEVEL_AGENTS}
        value={editedMaxAgents}
        oninput={(event) =>
          appStore.dispatch(
            settingsFormDraftChanged(identity, MAX_AGENTS_PATH, event.currentTarget.value),
          )}
        disabled={loading || maxAgentsSaving || !peerAgentsEnabled}
        aria-label={m.settings_agentFeatures_maxTopLevelAgents_ariaLabel()}
        class="w-24"
      />
      {#if Number(editedMaxAgents) !== persistedMaxAgents}
        <Button
          variant="secondary"
          size="xs"
          onclick={handleMaxAgentsSave}
          disabled={maxAgentsSaving || !valid || !peerAgentsEnabled}
        >
          {maxAgentsSaving
            ? m.settings_agentFeatures_maxTopLevelAgents_saving()
            : m.settings_agentFeatures_maxTopLevelAgents_save()}
        </Button>
      {/if}
    </div>
    {#if !valid}<p class="type-caption text-warning-ink">
        {m.settings_agentFeatures_maxTopLevelAgents_invalid()}
      </p>{/if}
  </div>
{/snippet}

<SettingsForm
  {schema}
  compact={false}
  custom={defineSettingsCustomControls({
    'pr-monitor-debounce': debounceControl,
    'max-top-level-agents': maxAgentsControl,
  })}
/>
