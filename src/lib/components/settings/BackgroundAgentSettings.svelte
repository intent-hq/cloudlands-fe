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
  /* eslint-disable intent/no-component-async-data-fetch -- synchronous pure predicate (string equality), not a data fetch; rule misfires on the '/client/' import source */
  const fastEnhanceUnavailable = $derived(
    $catalogLoaded$ && !isEnhancePromptAvailable($effectiveProviderId$),
  );
  /* eslint-enable intent/no-component-async-data-fetch */

  // ModelPicker reports "use default" as '' — stored verbatim as a cleared override.
  function handleOverrideChange(type: BackgroundAgentType, model: string) {
    appStore.dispatch(setTypeOverride({ type, model }));
  }
</script>

<!-- Default Model -->
<div class="flex items-center justify-between gap-4 mb-6">
  <div class="flex-1 min-w-0">
    <p class="text-sm font-semibold text-foreground">
      {m.settings_backgroundAgent_defaultModel_label()}
    </p>
  </div>
  <div class="shrink-0 w-72">
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
</div>

<!-- Per-type Overrides -->
<div>
  <p class="text-sm font-semibold text-foreground mb-3">
    {m.settings_backgroundAgent_overrides_title()}
  </p>

  <div class="space-y-4">
    <!-- Commit message -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.commit.label}</span
          >
          {#if $hasCommitOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.commit.description}</p>
      </div>
      <div class="shrink-0 w-72">
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
    </div>

    <!-- PR description -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.pr.label}</span
          >
          {#if $hasPrOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.pr.description}</p>
      </div>
      <div class="shrink-0 w-72">
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
    </div>

    <!-- Quick tasks -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-foreground"
            >{BACKGROUND_AGENT_TYPE_INFO.fast.label}</span
          >
          {#if $hasFastOverride$}
            <span class="text-ui px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
              >{m.settings_backgroundAgent_customBadge()}</span
            >
          {/if}
        </div>
        <p class="text-xs text-subtle mt-0.5">{BACKGROUND_AGENT_TYPE_INFO.fast.description}</p>
        {#if fastEnhanceUnavailable}
          <p class="text-xs text-subtle mt-1" data-testid="fast-auggie-only-note">
            {m.settings_backgroundAgent_fastAuggieOnlyNote()}
          </p>
        {/if}
      </div>
      <div class="shrink-0 w-72">
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
    </div>
  </div>
</div>
