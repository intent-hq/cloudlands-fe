<script lang="ts">
  /**
   * LayoutPresetDropdown - Dropdown for selecting layout presets
   *
   * Built-in presets:
   * - Planning: Orchestrator agent on left, spec on right
   * - Agents Row: Tiles agents in columns (up to 6)
   * - Changes: Tiles changed files (staged > unstaged > recent commit)
   */

  import {
  faChevronDown,
  faRobot,
  faFileLines,
  faCodeBranch,
  faColumns,
  faGripLines,
  faTableColumns,
  faCheck,
  faWandMagicSparkles,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { LayoutPresetId } from './PanelLayoutControls.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import ArrowLeftIcon from '$lib/components/icons/ArrowLeftIcon.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    workspaceId: string;
    currentPreset?: LayoutPresetId;
    onApplyPreset: (presetId: LayoutPresetId) => void;
    onOpenChange?: (open: boolean) => void;
    /** Optional custom trigger - if provided, replaces the default "Presets" button */
    children?: Snippet<[{ toggle: () => void; open: boolean }]>;
    /** AI prompt value (controlled externally) */
    promptValue?: string;
    /** Whether AI is currently generating */
    isGenerating?: boolean;
    /** Callback when prompt value changes */
    onPromptChange?: (value: string) => void;
    /** Callback when AI generation is requested */
    onGenerateLayout?: () => void;
    /** Callback when prompt keydown occurs */
    onPromptKeydown?: (e: KeyboardEvent) => void;
    /** Whether back navigation is available */
    canGoBack?: boolean;
    /** Whether forward navigation is available */
    canGoForward?: boolean;
    /** Callback for back navigation */
    onGoBack?: () => void;
    /** Callback for forward navigation */
    onGoForward?: () => void;
  }

  let {

    workspaceId: _workspaceId,
    currentPreset,
    onApplyPreset,
    onOpenChange,
    children,
    promptValue = '',
    isGenerating = false,
    onPromptChange,
    onGenerateLayout,
    onPromptKeydown,
    canGoBack = false,
    canGoForward = false,
    onGoBack,
    onGoForward,
  }: Props = $props();

  let dropdownOpen = $state(false);

  $effect(() => {
    onOpenChange?.(dropdownOpen);
  });

  // Built-in presets
  const presets = [
    {
      id: 'planning' as const,
      label: () => m.layout_presets_planning_label(),
      description: () => m.layout_presets_planning_description(),
      icon: faFileLines,
      iconClass: 'transform scale-90',
      group: 'content',
    },
    {
      id: 'agents-row' as const,
      label: () => m.layout_presets_agentsRow_label(),
      description: () => m.layout_presets_agentsRow_description(),
      icon: faRobot,
      iconClass: 'transform scale-125',
      group: 'content',
    },
    {
      id: 'changes' as const,
      label: () => m.layout_presets_changes_label(),
      description: () => m.layout_presets_changes_description(),
      icon: faCodeBranch,
      group: 'content',
    },
    {
      id: 'review' as const,
      label: () => m.layout_presets_review_label(),
      description: () => m.layout_presets_review_description(),
      icon: faCodeBranch,
      group: 'content',
    },
    { divider: true },
    {
      id: 'single' as const,
      label: () => m.layout_presets_single_label(),
      description: () => m.layout_presets_single_description(),
      icon: faGripLines,
      group: 'structure',
    },
    {
      id: 'split-horizontal' as const,
      label: () => m.layout_presets_sideBySide_label(),
      description: () => m.layout_presets_sideBySide_description(),
      icon: faColumns,
      group: 'structure',
    },
    {
      id: 'split-vertical' as const,
      label: () => m.layout_presets_stacked_label(),
      description: () => m.layout_presets_stacked_description(),
      icon: faTableColumns,
      iconClass: 'transform rotate-90',
      group: 'structure',
    },
    {
      id: 'three-column' as const,
      label: () => m.layout_presets_threeColumns_label(),
      description: () => m.layout_presets_threeColumns_description(),
      icon: faColumns,
      group: 'structure',
    },
  ];

  function handlePresetClick(presetId: LayoutPresetId, close: () => void) {
    onApplyPreset(presetId);
    close();
  }
</script>

<DropdownMenu align="end" side="bottom" bind:open={dropdownOpen} contentClass="px-0">
  {#snippet trigger({ toggle, open }: { toggle: () => void; open: boolean })}
    {#if children}
      {@render children({ toggle, open })}
    {:else}
      <Button
        variant="ghost"
        size="xs"
        onclick={toggle}
        class="gap-1 px-1.5 text-muted-foreground hover:text-foreground"
      >
        <span class="font-medium text-xs">{m.layout_presets_trigger_label()}</span>
        <Fa
          icon={faChevronDown}
          size="xs"
          class={cn('transition-transform', open && 'rotate-180')}
        />
      </Button>
    {/if}
  {/snippet}

  {#snippet content({ close }: { close: () => void })}
    <div class="w-48 max-w-48">
      <Header class="px-3 pt-1.5 pb-1" size={6}>{m.layout_presets_header()}</Header>

      <!-- Navigation buttons -->
      {#if onGoBack || onGoForward}
        <div
          class="flex items-center justify-between border-y border-border divide-x divide-border"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            class={cn(
              'relative flex-1 px-3 justify-start',
              canGoBack
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-ghost',
            )}
            onclick={onGoBack}
            disabled={!canGoBack}
          >
            <ArrowLeftIcon class="size-3" />
            <span
              class="absolute top-1/2 right-2 transform -translate-y-1/2 text-ui text-subtle"
              >⌘[</span
            >
          </Button>
          <div class="h-6 w-px bg-border"></div>
          <Button
            variant="ghost"
            size="icon-xs"
            class={cn(
              'relative flex-1 px-3 justify-end',
              canGoForward
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-ghost',
            )}
            onclick={onGoForward}
            disabled={!canGoForward}
          >
            <ArrowLeftIcon class="size-3 rotate-180" />
            <span
              class="absolute top-1/2 left-2 transform -translate-y-1/2 text-ui text-subtle"
              >⌘]</span
            >
          </Button>
        </div>
      {/if}
      {#each presets as preset, i (i)}
        {#if 'divider' in preset}
          <div class="h-px bg-border my-1"></div>
        {:else}
          <button
            class="w-full flex gap-2.5 px-3 py-1.5 text-left hover:bg-muted transition-colors rounded-sm cursor-pointer"
            onclick={() => handlePresetClick(preset.id, close)}
          >
            <Fa
              icon={preset.icon}
              class={cn('size-2.5 text-ghost', preset.iconClass || '')}
            />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium truncate">{preset.label()}</div>
              <div class="text-xs text-subtle truncate">{preset.description()}</div>
            </div>
            {#if currentPreset === preset.id}
              <Fa icon={faCheck} size="xs" class="text-primary shrink-0" />
            {/if}
          </button>
        {/if}
      {/each}

      <!-- AI Layout Input -->
      {#if onGenerateLayout}
        <div class="h-px bg-border my-1"></div>
        <div class="">
          <div class="flex items-center">
            <Input
              noFocusStyle
              value={promptValue}
              oninput={(e) => onPromptChange?.(e.currentTarget.value)}
              onkeydown={onPromptKeydown}
              type="text"
              placeholder={m.layout_presets_describeLayout_placeholder()}
              disabled={isGenerating}
              class={cn('flex-1 pl-3 pr-0! pt-0.5! pb-0.75! h-auto text-xs border-0 bg-transparent')}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              onclick={onGenerateLayout}
              disabled={!promptValue?.trim() || isGenerating}
              tooltip={m.layout_presets_generateLayout_tooltip()}
              tooltipSide="bottom"
            >
              {#if isGenerating}
                <Fa icon={faSpinner} size="xs" class="animate-spin" />
              {:else}
                <Fa icon={faWandMagicSparkles} size="xs" />
              {/if}
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
