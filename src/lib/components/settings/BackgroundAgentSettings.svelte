<script lang="ts">
  /**
   * Quick Actions Settings Component
   *
   * Allows users to configure default models for quick actions
   * (commit message, PR description, quick tasks) with a general default
   * and per-type overrides.
   */

  import {
    BACKGROUND_AGENT_TYPE_INFO,
    setDefaultModel,
    setDefaultReasoningEffort,
    setTypeReasoningEffortOverride,
    setTypeOverride,
    type BackgroundAgentType,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import {
    selectBgDefaultModel,
    selectBgDefaultReasoningEffort,
    selectBgTypeReasoningEffortOverrides,
    selectBgTypeOverrides,
    selectHasOverride,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import {
    selectEffectiveDefaultProviderId,
    selectProviderCatalogLoaded,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectIsActiveProviderAvailable } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { isEnhancePromptAvailable } from '$lib/client/live/live-prompt-enhancement';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const defaultEffort$ = selectBgDefaultReasoningEffort();
  const effortOverrides$ = selectBgTypeReasoningEffortOverrides();
  const defaultModel = selectBgDefaultModel();
  const typeOverrides$ = selectBgTypeOverrides();
  const hasCommitOverride$ = selectHasOverride('commit');
  const hasPrOverride$ = selectHasOverride('pr');
  const hasFastOverride$ = selectHasOverride('fast');
  const effectiveProviderId$ = selectEffectiveDefaultProviderId();
  const catalogLoaded$ = selectProviderCatalogLoaded();
  const providerAvailable$ = selectIsActiveProviderAvailable();
  // agent.completeOnce uses ACP effort only for these routes (§5.32).
  // Auggie --print has no effort channel, even if ordinary models advertise it.
  const supportsQuickActionEffort = $derived(
    ['codex', 'claude-code', 'pi'].includes($effectiveProviderId$),
  );

  // §5.31 gate mirror: prompt enhancement and layout suggestions stays auggie-only even though
  // `agent.completeOnce` (§5.32) is provider-neutral. Gated on catalog
  // hydration so auggie users don't see a flash of the note before the
  // effective provider resolves; once hydrated, shown iff genuinely
  // unavailable.
  const fastEnhanceUnavailable = $derived(
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pure predicate (string equality), not a data fetch; rule misfires on the '/client/' import source
    $catalogLoaded$ && !isEnhancePromptAvailable($effectiveProviderId$),
  );

  function usesActiveProvider(model: string) {
    const providerId = splitLegacyCompoundId(model).providerId;
    return !providerId || providerId === $effectiveProviderId$;
  }

  function effortAvailable(model: string) {
    return usesActiveProvider(model) && supportsQuickActionEffort && $providerAvailable$;
  }

  function changeDefaultEffort(effort: string | null) {
    if (!effortAvailable($defaultModel)) return false;
    appStore.dispatch(setDefaultReasoningEffort(effort ?? ''));
  }

  function changeActionEffort(type: BackgroundAgentType, effort: string | null) {
    if (!effortAvailable($typeOverrides$[type] || $defaultModel)) return false;
    appStore.dispatch(setTypeReasoningEffortOverride({ type, effort: effort ?? '' }));
  }

  // ModelPicker reports "use default" as '' — stored verbatim as a cleared override.
  function handleOverrideChange(type: BackgroundAgentType, model: string) {
    appStore.dispatch(setTypeOverride({ type, model }));
  }

  const defaultSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'background-agent-default',
          title: m.settings_backgroundAgent_defaultModel_label(),
          entries: [
            {
              kind: 'custom',
              id: 'background-agent-default',
              label: m.settings_backgroundAgent_defaultModel_label(),
            },
          ],
        },
      ],
    }),
  );

  const overridesSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'background-agent-overrides',
          title: m.settings_backgroundAgent_overrides_title(),
          entries: [
            {
              kind: 'custom',
              id: 'background-agent-commit',
              label: BACKGROUND_AGENT_TYPE_INFO.commit.label,
              description: BACKGROUND_AGENT_TYPE_INFO.commit.description,
              status: () =>
                $hasCommitOverride$ ? m.settings_backgroundAgent_customBadge() : undefined,
              statusTone: 'subtle',
            },
            {
              kind: 'custom',
              id: 'background-agent-pr',
              label: BACKGROUND_AGENT_TYPE_INFO.pr.label,
              description: BACKGROUND_AGENT_TYPE_INFO.pr.description,
              status: () =>
                $hasPrOverride$ ? m.settings_backgroundAgent_customBadge() : undefined,
              statusTone: 'subtle',
            },
            {
              kind: 'custom',
              id: 'background-agent-fast',
              label: BACKGROUND_AGENT_TYPE_INFO.fast.label,
              status: () =>
                $hasFastOverride$ ? m.settings_backgroundAgent_customBadge() : undefined,
              statusTone: 'subtle',
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet effortNotice(model: string)}
  {#if $catalogLoaded$ && !usesActiveProvider(model)}
    <p
      class="mt-2 type-caption text-muted-foreground"
      data-testid="quick-action-effort-provider-note"
    >
      {m.settings_backgroundAgent_effortProviderNote()}
    </p>
  {:else if $catalogLoaded$ && $effectiveProviderId$ && !supportsQuickActionEffort}
    <p class="mt-2 type-caption text-muted-foreground" data-testid="quick-action-effort-route-note">
      {m.settings_backgroundAgent_effortRouteNote()}
    </p>
  {/if}
{/snippet}

{#snippet defaultControl()}
  <div class="flex w-full min-w-0 flex-col items-end">
    <!-- Empty defaultModel means "provider default": the daemon/CLI default is
         used because background requests omit `model` on the wire. -->
    <ModelPicker
      showReasoning={effortAvailable($defaultModel)}
      fallbackToCatalogDefault
      reasoningEffort={effortAvailable($defaultModel) ? $defaultEffort$ || null : null}
      onReasoningChange={changeDefaultEffort}
      selectedModel={$defaultModel || undefined}
      onModelChange={(model) => appStore.dispatch(setDefaultModel(model))}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionDescription={m.settings_backgroundAgent_providerDefault_description()}
      variant="outline"
      showProviderWarningNotice
      noticeClass="mt-2"
    />
    {@render effortNotice($defaultModel)}
  </div>
{/snippet}

{#snippet commitControl()}
  <div class="flex w-full min-w-0 flex-col items-end">
    <ModelPicker
      showReasoning={effortAvailable($typeOverrides$.commit || $defaultModel)}
      fallbackToCatalogDefault
      defaultModelId={$defaultModel || undefined}
      defaultReasoningEffort={effortAvailable($typeOverrides$.commit || $defaultModel)
        ? $defaultEffort$ || null
        : null}
      reasoningEffort={effortAvailable($typeOverrides$.commit || $defaultModel)
        ? $effortOverrides$.commit || null
        : null}
      onReasoningChange={(effort) => changeActionEffort('commit', effort)}
      selectedModel={$typeOverrides$.commit || undefined}
      onModelChange={(model) => handleOverrideChange('commit', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="outline"
      showProviderWarningNotice
      noticeClass="mt-2"
    />
    {@render effortNotice($typeOverrides$.commit || $defaultModel)}
  </div>
{/snippet}

{#snippet prControl()}
  <div class="flex w-full min-w-0 flex-col items-end">
    <ModelPicker
      showReasoning={effortAvailable($typeOverrides$.pr || $defaultModel)}
      fallbackToCatalogDefault
      defaultModelId={$defaultModel || undefined}
      defaultReasoningEffort={effortAvailable($typeOverrides$.pr || $defaultModel)
        ? $defaultEffort$ || null
        : null}
      reasoningEffort={effortAvailable($typeOverrides$.pr || $defaultModel)
        ? $effortOverrides$.pr || null
        : null}
      onReasoningChange={(effort) => changeActionEffort('pr', effort)}
      selectedModel={$typeOverrides$.pr || undefined}
      onModelChange={(model) => handleOverrideChange('pr', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="outline"
      showProviderWarningNotice
      noticeClass="mt-2"
    />
    {@render effortNotice($typeOverrides$.pr || $defaultModel)}
  </div>
{/snippet}

{#snippet fastControl()}
  <div class="flex w-full min-w-0 flex-col items-end">
    <ModelPicker
      showReasoning={effortAvailable($typeOverrides$.fast || $defaultModel)}
      fallbackToCatalogDefault
      defaultModelId={$defaultModel || undefined}
      defaultReasoningEffort={effortAvailable($typeOverrides$.fast || $defaultModel)
        ? $defaultEffort$ || null
        : null}
      reasoningEffort={effortAvailable($typeOverrides$.fast || $defaultModel)
        ? $effortOverrides$.fast || null
        : null}
      onReasoningChange={(effort) => changeActionEffort('fast', effort)}
      selectedModel={$typeOverrides$.fast || undefined}
      onModelChange={(model) => handleOverrideChange('fast', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="outline"
      showProviderWarningNotice
      noticeClass="mt-2"
    />
    {@render effortNotice($typeOverrides$.fast || $defaultModel)}
  </div>
{/snippet}

<SettingsForm
  schema={defaultSchema}
  embedded
  compact={false}
  custom={defineSettingsCustomControls({ 'background-agent-default': defaultControl })}
/>

<!-- Per-type Overrides -->
<div class="mt-4 border-t border-border pt-6" data-testid="model-action-overrides">
  {#snippet fastDescription()}
    <span class="block">{BACKGROUND_AGENT_TYPE_INFO.fast.description}</span>
    {#if fastEnhanceUnavailable}
      <span class="block" data-testid="fast-auggie-only-note">
        {m.settings_backgroundAgent_fastAuggieOnlyNote()}
      </span>
    {/if}
  {/snippet}
  <SettingsForm
    schema={overridesSchema}
    compact={false}
    custom={defineSettingsCustomControls({
      'background-agent-commit': commitControl,
      'background-agent-pr': prControl,
      'background-agent-fast': fastControl,
    })}
    descriptions={{ 'background-agent-fast': fastDescription }}
  />
</div>
