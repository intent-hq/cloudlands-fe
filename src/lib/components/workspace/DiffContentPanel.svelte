<script lang="ts">
  /**
   * Diff Content Panel
   *
   * Displays diff view using PureDiff component
   */

  import { PureDiff } from '$lib/components/ui/diff';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import AgentAttributionBadge from '$lib/components/shared/AgentAttributionBadge.svelte';
  import ViewSettingsDropdown from '$lib/components/ui/ViewSettingsDropdown.svelte';
  import { faCodeBranch } from '@fortawesome/free-solid-svg-icons';
  import type { DiffContent } from '$features/workspace/workspace-content-diff-manager';
  import type { BreadcrumbItem } from '$lib/components/ui/content-header/types';
  import { selectDiffSideBySide, selectFoldUnchanged } from '$lib/store/slices/editor-settings/editor-settings-selectors';
  import { LOCKED_TOOLTIP } from '$lib/utils/agent-lock-utils';

  const diffSideBySide = selectDiffSideBySide();
  const foldUnchanged = selectFoldUnchanged();

  interface Props {
    diffContent: DiffContent;
    diffViewMode: 'inline' | 'side-by-side';
    isDirty: boolean;
    isSaving: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    canShowSideBySide: boolean;
    /** Optional breadcrumbs for category display */
    breadcrumbs?: BreadcrumbItem[];
    /** Whether this file is locked (agent auto-commit pending) */
    locked?: boolean;
    onViewModeChange: (mode: 'inline' | 'side-by-side') => void;
    onContentChange: (content: string) => void;
    onSave: (content: string) => void;
    onStage?: () => void;
    onUnstage?: () => void;
    onClose: () => void;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
  }

  let {
    diffContent,
    diffViewMode: _diffViewMode,
    isDirty: _isDirty,
    isSaving: _isSaving,
    canGoBack,
    canGoForward,
    canShowSideBySide: _canShowSideBySide,
    breadcrumbs = [{ label: 'Changes', icon: faCodeBranch }],
    locked = false,
    onViewModeChange: _onViewModeChange,
    onContentChange: _onContentChange,
    onSave: _onSave,
    onStage,
    onUnstage,
    onClose,
    onNavigateBack,
    onNavigateForward,
  }: Props = $props();
</script>

<PanelWrapper
  title={diffContent.fileName}
  {breadcrumbs}
  {onClose}
  showClose={true}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
>
  {#snippet actions()}
    <div class="flex items-center gap-1">
      {#if diffContent.agentAttribution}
        <AgentAttributionBadge
          attribution={diffContent.agentAttribution}
          size="sm"
          class="bg-background/90 backdrop-blur-sm border border-border"
        />
      {/if}

      {#if diffContent.isStaged && onUnstage}
        <button
          onclick={onUnstage}
          disabled={locked}
          title={locked ? LOCKED_TOOLTIP : 'Unstage this file'}
          class="px-2 py-1 text-xs rounded {locked
            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20'}"
        >
          Unstage
        </button>
      {:else if !diffContent.isStaged && onStage}
        <button
          onclick={onStage}
          disabled={locked}
          title={locked ? LOCKED_TOOLTIP : 'Stage this file'}
          class="px-2 py-1 text-xs rounded {locked
            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            : 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'}"
        >
          Stage
        </button>
      {/if}

      <ViewSettingsDropdown showFold showWrap={false} showSplit />
    </div>
  {/snippet}

  <div class="w-full h-full flex-1 overflow-auto">
    <PureDiff
      oldContent={diffContent.oldContent}
      newContent={diffContent.newContent}
      fileName={diffContent.fileName}
      viewMode={$diffSideBySide ? 'split' : 'unified'}
      expandUnchanged={!$foldUnchanged}
      showHeader={false}
    />
  </div>
</PanelWrapper>
