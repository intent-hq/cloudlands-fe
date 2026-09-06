<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource, WorkspaceDraftConfig } from '$shared/types/workspace-draft';
  import type { ControllerState } from '../../controller';
  import { selectOrchestratorSpecialist } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { projectDescription, projectName } from './project-section';
  import {
    defaultSetupScriptForSource,
    hasModifiedOptions,
    readinessState,
  } from './setup-sections';

  interface Props {
    source: DraftSource | null;
    config: WorkspaceDraftConfig;
    capabilities: ControllerState['capabilities'];
    onExpand?: () => void;
  }

  let { source, config, capabilities, onExpand }: Props = $props();
  const orchestrator$ = selectOrchestratorSpecialist();
  const activeProviderId$ = selectActiveProviderId();
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const readiness = $derived(readinessState(capabilities));
  const optionsModified = $derived(
    hasModifiedOptions(source, config, {
      setupScript: source ? defaultSetupScriptForSource(source) : undefined,
      specialist: $orchestrator$?.id,
      provider: $activeProviderId$ || $defaultProviderId$ || undefined,
    }),
  );
  const readinessLabel = $derived(
    readiness === 'ready'
      ? m.newWorkspace_capabilities_ready_label()
      : readiness === 'attention'
        ? m.workspace_statusIcon_needsAttention_label()
        : m.newWorkspace_capabilities_pending_label(),
  );
</script>

<button
  type="button"
  class="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  aria-expanded="false"
  aria-label={m.newWorkspace_setup_expand_ariaLabel()}
  onclick={onExpand}
>
  <span class="min-w-0 flex-1">
    <span class="type-caption block font-medium text-foreground">
      {source ? projectName(source) : m.newWorkspace_setup_noProject_label()}
    </span>
    <span class="type-caption block truncate text-muted-foreground">
      {source ? projectDescription(source) : m.newWorkspace_setup_noProject_description()}
    </span>
  </span>
  <span class="type-caption hidden min-w-0 truncate text-muted-foreground sm:block">
    {[
      source && (source.kind === 'local' || source.kind === 'github') ? source.branch : undefined,
      optionsModified ? m.settings_aiBehavior_modifiedBadge() : undefined,
      readinessLabel,
    ]
      .filter(Boolean)
      .join(' · ')}
  </span>
  <Fa icon={faChevronDown} class="size-3.5 shrink-0 text-muted-foreground" />
</button>
