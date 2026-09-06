<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronUp } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { ContextLink, DraftSource, WorkspaceDraftConfig } from '$shared/types';
  import type { ControllerState, DraftInput } from '../../controller';
  import CapabilityStrip from '../CapabilityStrip.svelte';
  import CoordinatorPanel from '../CoordinatorPanel.svelte';
  import type { CoordinatorPresentation, SourcePresentation } from '../types';
  import SourceCard, { type SourcePickerMode } from '../SourceCard.svelte';
  import OptionsSection from './OptionsSection.svelte';
  import ProjectSection from './ProjectSection.svelte';
  import SetupSummaryRow from './SetupSummaryRow.svelte';
  import StartingPointSection from './StartingPointSection.svelte';
  import { readinessState } from './setup-sections';
  import type { DaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-types';

  interface Props {
    source: DraftSource | null;
    intentText: string;
    contextLinks: ContextLink[];
    config: WorkspaceDraftConfig;
    capabilities: ControllerState['capabilities'];
    coordinator: CoordinatorPresentation & { state: NonNullable<CoordinatorPresentation['state']> };
    host?: DaemonHostRepairTarget;
    presentation?: SourcePresentation;
    expanded: boolean;
    disabled?: boolean;
    pickerOpen?: boolean;
    pickerMode?: SourcePickerMode;
    onExpandedChange?: (expanded: boolean) => void;
    onPickerOpenChange?: (open: boolean) => void;
    onOpenPicker?: (mode: SourcePickerMode) => void;
    onChooseNewFolder?: (name: string) => void;
    onSourceSelected?: (source: DraftSource) => void;
    onEdit?: (patch: Partial<DraftInput>) => void;
    onProviderSelected?: (providerId: string) => void;
    onRecheckCapabilities?: () => void;
  }

  let {
    source,
    intentText,
    contextLinks,
    config,
    capabilities,
    coordinator,
    host,
    presentation,
    expanded,
    disabled = false,
    pickerOpen = false,
    pickerMode = 'github',
    onExpandedChange,
    onPickerOpenChange,
    onOpenPicker,
    onChooseNewFolder,
    onSourceSelected,
    onEdit,
    onProviderSelected,
    onRecheckCapabilities,
  }: Props = $props();
  const readiness = $derived(readinessState(capabilities));
</script>

<section
  class="rounded-xl border border-border bg-background shadow-sm"
  data-testid="project-setup-panel"
>
  {#if expanded}
    <button
      type="button"
      class="flex w-full items-start gap-3 rounded-t-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-expanded="true"
      aria-controls="project-setup-content"
      onclick={() => onExpandedChange?.(false)}
    >
      <span class="min-w-0 flex-1">
        <span class="type-small block font-medium">{m.newWorkspace_setup_panel_title()}</span>
        <span class="type-caption block text-muted-foreground">
          {m.newWorkspace_setup_panel_description()}
        </span>
      </span>
      <Fa icon={faChevronUp} class="mt-1 size-3.5 shrink-0 text-muted-foreground" />
    </button>
    <div id="project-setup-content" class="border-t border-border px-4 py-4">
      <ProjectSection {source} {disabled} {onOpenPicker} onSelectSource={onSourceSelected} />
      {#if source && source.kind !== 'newFolder'}
        <StartingPointSection {source} {intentText} {contextLinks} {disabled} {onEdit} />
      {/if}
      {#if source}
        <OptionsSection {source} {config} {disabled} {onEdit} />
      {/if}
      <section class="border-t border-border pt-3" data-testid="readiness-section">
        <div class="mb-1 flex items-center justify-between gap-3">
          <h3 class="type-caption font-medium text-foreground">
            {m.newWorkspace_setup_readiness_title()}
          </h3>
          <span class="type-caption text-muted-foreground">
            {readiness === 'ready'
              ? m.newWorkspace_capabilities_ready_label()
              : readiness === 'attention'
                ? m.workspace_statusIcon_needsAttention_label()
                : m.newWorkspace_capabilities_pending_label()}
          </span>
        </div>
        <CoordinatorPanel presentation={coordinator} {onProviderSelected} />
        <CapabilityStrip {capabilities} {host} onRecheck={onRecheckCapabilities} />
      </section>
    </div>
  {:else}
    <SetupSummaryRow {source} {config} {capabilities} onExpand={() => onExpandedChange?.(true)} />
  {/if}

  <SourceCard
    {source}
    {presentation}
    {disabled}
    showSummary={false}
    {pickerOpen}
    {pickerMode}
    {onPickerOpenChange}
    {onChooseNewFolder}
    {onSourceSelected}
  />
</section>
