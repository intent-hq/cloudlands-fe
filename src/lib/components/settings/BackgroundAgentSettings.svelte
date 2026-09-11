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
    setTypeOverride,
    type BackgroundAgentType,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
  import {
    selectBgDefaultModel,
    selectBgTypeOverrides,
    selectHasOverride,
  } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import {
    selectEffectiveDefaultProviderId,
    selectProviderCatalogLoaded,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { isEnhancePromptAvailable } from '$lib/client/live/live-prompt-enhancement';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const defaultModel = selectBgDefaultModel();
  const typeOverrides$ = selectBgTypeOverrides();
  const hasCommitOverride$ = selectHasOverride('commit');
  const hasPrOverride$ = selectHasOverride('pr');
  const hasFastOverride$ = selectHasOverride('fast');
  const effectiveProviderId$ = selectEffectiveDefaultProviderId();
  const catalogLoaded$ = selectProviderCatalogLoaded();

  // §5.31 gate mirror: `agent.enhancePrompt` (the `fast` consumer for prompt
  // enhancement and layout suggestions) stays auggie-only even though
  // `agent.completeOnce` (§5.32) is provider-neutral. Gated on catalog
  // hydration so auggie users don't see a flash of the note before the
  // effective provider resolves; once hydrated, shown iff genuinely
  // unavailable.
  const fastEnhanceUnavailable = $derived(
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pure predicate (string equality), not a data fetch; rule misfires on the '/client/' import source
    $catalogLoaded$ && !isEnhancePromptAvailable($effectiveProviderId$),
  );

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

{#snippet defaultControl()}
  <div class="w-72 shrink-0">
    <!-- Empty defaultModel means "provider default": the daemon/CLI default is
         used because background requests omit `model` on the wire. -->
    <ModelPicker
      selectedModel={$defaultModel || undefined}
      onModelChange={(model) => appStore.dispatch(setDefaultModel(model))}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionLabel={m.chat_modelPicker_providerDefault_label()}
      defaultOptionDescription={m.settings_backgroundAgent_providerDefault_description()}
      variant="default"
    />
  </div>
{/snippet}

{#snippet commitControl()}
  <div class="w-72 shrink-0">
    <ModelPicker
      selectedModel={$typeOverrides$.commit || undefined}
      onModelChange={(model) => handleOverrideChange('commit', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="default"
    />
  </div>
{/snippet}

{#snippet prControl()}
  <div class="w-72 shrink-0">
    <ModelPicker
      selectedModel={$typeOverrides$.pr || undefined}
      onModelChange={(model) => handleOverrideChange('pr', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="default"
    />
  </div>
{/snippet}

{#snippet fastControl()}
  <div class="w-72 shrink-0">
    <ModelPicker
      selectedModel={$typeOverrides$.fast || undefined}
      onModelChange={(model) => handleOverrideChange('fast', model)}
      showManageLink={false}
      showDefaultOption={true}
      defaultModelLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionLabel={m.settings_backgroundAgent_useDefaultOption()}
      defaultOptionDescription={m.settings_backgroundAgent_useDefault_description()}
      variant="default"
    />
  </div>
{/snippet}

<SettingsForm
  schema={defaultSchema}
  embedded
  custom={defineSettingsCustomControls({ 'background-agent-default': defaultControl })}
/>

<!-- Per-type Overrides -->
<div>
  <p class="type-body mb-1 font-medium! text-foreground">
    {m.settings_backgroundAgent_overrides_title()}
  </p>

  <div class="divide-y divide-border">
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
      embedded
      custom={defineSettingsCustomControls({
        'background-agent-commit': commitControl,
        'background-agent-pr': prControl,
        'background-agent-fast': fastControl,
      })}
      descriptions={{ 'background-agent-fast': fastDescription }}
    />
  </div>
</div>
