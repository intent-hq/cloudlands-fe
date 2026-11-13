<script lang="ts">
  /**
   * Quick Actions Settings Component
   *
   * One model picker per quick action (commit message, PR description),
   * scoped to the active provider. "Provider default" is the CLI default.
   */

  import {
    BACKGROUND_AGENT_TYPE_INFO,
    editQuickAction,
    type BackgroundAgentType,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import {
    selectBgDefaultModel,
    selectBgDefaultReasoningEffort,
    selectBgTypeReasoningEffortOverrides,
    selectBgTypeOverrides,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import {
    selectEffectiveDefaultProviderId,
    selectProviderCatalogLoaded,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectIsActiveProviderAvailable } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { providerRefBaseId } from '$shared/provider-profiles';

  const defaultEffort$ = selectBgDefaultReasoningEffort();
  const effortOverrides$ = selectBgTypeReasoningEffortOverrides();
  const defaultModel$ = selectBgDefaultModel();
  const typeOverrides$ = selectBgTypeOverrides();
  const effectiveProviderId$ = selectEffectiveDefaultProviderId();
  const catalogLoaded$ = selectProviderCatalogLoaded();
  const providerAvailable$ = selectIsActiveProviderAvailable();
  // agent.completeOnce uses ACP effort only for these routes (§5.32).
  // Auggie --print has no effort channel, even if ordinary models advertise it.
  // A named profile (§5.54) runs its base provider's route.
  const supportsQuickActionEffort = $derived(
    ['codex', 'claude-code', 'pi'].includes(providerRefBaseId($effectiveProviderId$)),
  );

  // A legacy shared default still applies until the first edit retires it.
  const modelFor = (type: BackgroundAgentType) => $typeOverrides$[type] || $defaultModel$;
  const effortFor = (type: BackgroundAgentType) =>
    $effortOverrides$[type] || $defaultEffort$ || null;

  function usesActiveProvider(model: string) {
    const providerId = splitLegacyCompoundId(model).providerId;
    return !providerId || providerId === $effectiveProviderId$;
  }

  function effortAvailable(model: string) {
    return usesActiveProvider(model) && supportsQuickActionEffort && $providerAvailable$;
  }

  function changeEffort(type: BackgroundAgentType, effort: string | null) {
    if (!effortAvailable(modelFor(type))) return false;
    appStore.dispatch(editQuickAction({ type, effort: effort ?? '' }));
  }

  // These settings belong to the active provider's snapshot. Never reinterpret
  // a foreign pick under that provider or persist a legacy compound row value.
  // ModelPicker reports "provider default" as '' without a structured pick.
  function changeModel(
    type: BackgroundAgentType,
    model: string,
    pick?: { providerId: string; modelId: string },
  ) {
    if (
      model !== '' &&
      (!pick ||
        pick.providerId !== $effectiveProviderId$ ||
        !pick.modelId ||
        pick.modelId.includes(':'))
    )
      return;
    appStore.dispatch(editQuickAction({ type, model: model === '' ? '' : pick!.modelId }));
  }

  const actions = ['commit', 'pr'] as const;

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'quick-actions',
          title: m.settings_section_quickActions(),
          entries: actions.map((type) => ({
            kind: 'custom' as const,
            id: `background-agent-${type}`,
            label: BACKGROUND_AGENT_TYPE_INFO[type].label,
            description: BACKGROUND_AGENT_TYPE_INFO[type].description,
          })),
        },
      ],
    }),
  );
</script>

{#snippet actionControl(type: BackgroundAgentType)}
  {@const model = modelFor(type)}
  <div class="flex w-full min-w-0 flex-col items-end">
    <!-- Empty means "provider default": requests omit `model` on the wire. -->
    <ModelPicker
      allowProviderSwitch={false}
      showReasoning={effortAvailable(model)}
      fallbackToCatalogDefault
      reasoningEffort={effortAvailable(model) ? effortFor(type) : null}
      onReasoningChange={(effort) => changeEffort(type, effort)}
      selectedModel={model || undefined}
      onModelChange={(next, pick) => changeModel(type, next ?? '', pick)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionDescription={m.settings_backgroundAgent_providerDefault_description()}
      variant="outline"
    />
    {#if $catalogLoaded$ && !usesActiveProvider(model)}
      <p
        class="mt-2 type-caption text-muted-foreground"
        data-testid="quick-action-effort-provider-note"
      >
        {m.settings_backgroundAgent_effortProviderNote()}
      </p>
    {:else if $catalogLoaded$ && $effectiveProviderId$ && !supportsQuickActionEffort}
      <p
        class="mt-2 type-caption text-muted-foreground"
        data-testid="quick-action-effort-route-note"
      >
        {m.settings_backgroundAgent_effortRouteNote()}
      </p>
    {/if}
  </div>
{/snippet}

{#snippet commitControl()}
  {@render actionControl('commit')}
{/snippet}

{#snippet prControl()}
  {@render actionControl('pr')}
{/snippet}

<SettingsForm
  {schema}
  embedded
  compact={false}
  custom={defineSettingsCustomControls({
    'background-agent-commit': commitControl,
    'background-agent-pr': prControl,
  })}
/>
