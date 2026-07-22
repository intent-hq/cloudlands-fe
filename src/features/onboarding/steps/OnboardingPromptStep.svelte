<script lang="ts">
  /**
   * OnboardingPromptStep — Step 3 of the onboarding flow.
   *
   * Contains the rich text prompt input, suggestion pills, branch picker,
   * setup script disclosure, PR branch suggestion, error state, and the
   * "Create workspace" button.
   */
  import {
  fly,
  slide,
} from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
  faArrowRight,
  faPaperclip,
  faMagicWandSparkles,
  faArrowsRotate,
  faCodeBranch,
} from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import SetupScriptModal from '$lib/components/modals/SetupScriptModal.svelte';
  import IssueSuggestions from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import WorkspaceCreationError from '$features/onboarding/steps/WorkspaceCreationError.svelte';
  import type { ProjectSelection } from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import type { IssueSelectionData } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';

  import {
  checkClonePreflight,
  clearClonePreflight,
} from '$store/renderer/slices/clone-preflight/clone-preflight-slice';
  import {
  selectClonePreflightStatus,
  selectClonePreflightError,
  selectClonePreflightUrl,
} from '$store/renderer/slices/clone-preflight/clone-preflight-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    // Input state
    onboardingInputValue: string;
    isOnboardingCreating: boolean;
    isOnboardingEnhancing: boolean;
    onboardingCreationError: string | null;

    // Project context
    projectSelection: ProjectSelection | null;
    onboardingGithubRepoInfo: { owner: string; repo: string } | null;

    // Branch state
    selectedPRBranch: string;
    onboardingSkipWorktree: boolean;

    // Setup script
    setupScript: string;
    showSetupScript: boolean;
    setupScriptName: string;
    isCustomSetupScript: boolean;
    /** Repo-committed `.intent/config.json` script, forwarded to SetupScriptModal. */
    repoConfigScript: string | null;

    // Suggestions
    visibleSuggestions: string[];
    focusedSuggestionIndex: number;

    // Handlers
    onSubmit: () => void;
    onEnhancePrompt: () => void;

    onContentChange: () => void;
    onFocus: () => void;
    onKeydown: (e: KeyboardEvent) => void;
    onPromptSelect: (prompt: string) => void;
    onIssueSelect: (text: string, metadata?: IssueSelectionData) => void;
    onBranchSet: (branch: string) => void;
    onProjectChange: (selection: ProjectSelection) => void;
    onShuffleSuggestions: () => void;
    onSkipWorktreeChange: (val: boolean) => void;
    onBranchBehindChange: (behind: number) => void;
    onShowSetupScriptChange: (show: boolean) => void;
  }

  let {
    onboardingInputValue = $bindable(),
    isOnboardingCreating,
    isOnboardingEnhancing,
    onboardingCreationError,
    projectSelection,
    onboardingGithubRepoInfo,
    selectedPRBranch,
    onboardingSkipWorktree = $bindable(),

    setupScript = $bindable(),
    showSetupScript = $bindable(),
    setupScriptName = $bindable(),
    isCustomSetupScript = $bindable(),
    repoConfigScript,
    visibleSuggestions,
    focusedSuggestionIndex = $bindable(),
    onSubmit,
    onEnhancePrompt,

    onContentChange,
    onFocus,
    onKeydown,
    onPromptSelect,
    onIssueSelect,
    onBranchSet,
    onProjectChange,
    onShuffleSuggestions,
    onSkipWorktreeChange,
    onBranchBehindChange,
    onShowSetupScriptChange,
  }: Props = $props();

  // Refs managed by this component
  let onboardingRichTextarea: RichTextarea | null = $state(null);
  let onboardingFileInput: HTMLInputElement | null = $state(null);
  let richTextareaWrapper: HTMLDivElement | null = $state(null);

  // Preflight check for GitHub URLs. The saga debounces, so we can dispatch
  // on every change to `projectSelection.githubUrl` without worrying about
  // flooding the network. A failed preflight surfaces inline BEFORE the user
  // clicks Create, using the same `WorkspaceCreationError` component used
  // for post-submit errors so the guidance is consistent.
  const preflightStatus$ = selectClonePreflightStatus();
  const preflightError$ = selectClonePreflightError();
  const preflightUrl$ = selectClonePreflightUrl();

  // Track the last preflight URL to avoid redundant dispatches that could
  // contribute to effect cascades (effect_update_depth_exceeded).
  let lastPreflightKey: string | null = null;
  $effect(() => {
    const key = projectSelection?.type === 'github' && projectSelection.githubUrl
      ? `github:${projectSelection.githubUrl}`
      : 'clear';

    if (key === lastPreflightKey) return;
    lastPreflightKey = key;

    if (key !== 'clear') {
      appStore.dispatch(checkClonePreflight(projectSelection!.githubUrl!));
    } else {
      appStore.dispatch(clearClonePreflight());
    }
  });

  // Only surface a preflight error that matches the URL the user is actively
  // selecting — otherwise a stale error from a previous URL can linger after
  // the user fixes the URL.
  const activePreflightError = $derived.by<string | null>(() => {
    if (projectSelection?.type !== 'github' || !projectSelection.githubUrl) return null;
    if ($preflightStatus$ !== 'error') return null;
    if ($preflightUrl$ !== projectSelection.githubUrl.trim()) return null;
    return $preflightError$;
  });

  // Expose the RichTextarea ref so the parent can call methods on it
  export function getRichTextarea(): RichTextarea | null {
    return onboardingRichTextarea;
  }

  /** Open the file input dialog. */
  function handleFileSelect() {
    onboardingFileInput?.click();
  }

  /** Handle selected files — insert images into RichTextarea. */
  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File "${file.name}" is too large (max 10MB)`);
        continue;
      }
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          onboardingRichTextarea?.insertImage(dataUrl, file.name);
        };
        reader.readAsDataURL(file);
      }
    }
    target.value = '';
  }

  /**
   * Intercept suggestion keyboard navigation in the capture phase so it runs
   * BEFORE ProseMirror's handleKeyDown (which would otherwise insert a newline
   * on Enter before our bubble-phase handler can preventDefault).
   */
  function handleSuggestionKeydownCapture(e: KeyboardEvent) {
    if (onboardingInputValue.trim()) return;
    const suggestions = visibleSuggestions.slice(0, 4);
    const maxIndex = suggestions.length + 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex =
        focusedSuggestionIndex < maxIndex - 1 ? focusedSuggestionIndex + 1 : -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex =
        focusedSuggestionIndex > -1 ? focusedSuggestionIndex - 1 : maxIndex - 1;
    } else if (e.key === 'Enter' && focusedSuggestionIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      if (focusedSuggestionIndex < suggestions.length) {
        onPromptSelect(suggestions[focusedSuggestionIndex]);
        focusedSuggestionIndex = -1;
      } else {
        const shuffleIdx = focusedSuggestionIndex;
        onShuffleSuggestions();
        focusedSuggestionIndex = shuffleIdx;
      }
    } else if (e.key === 'Escape' && focusedSuggestionIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex = -1;
    }
  }

  // Attach suggestion keydown in capture phase so it fires before ProseMirror
  $effect(() => {
    const el = richTextareaWrapper;
    if (!el) return;
    el.addEventListener('keydown', handleSuggestionKeydownCapture, true);
    return () => el.removeEventListener('keydown', handleSuggestionKeydownCapture, true);
  });
</script>

<div class="max-w-5xl mx-auto space-y-3">
  {#if isOnboardingCreating}
    <div
      class="onboarding-creating-state space-y-4"
      in:fly={{ y: 12, duration: 350, easing: cubicOut }}
    >
      <div class="rounded-xl bg-muted/20 border border-border/30 px-4 py-3">
        <p class="text-sm text-foreground leading-relaxed">
          {onboardingInputValue}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div class="relative flex items-center justify-center w-4 h-4 shrink-0">
          <div
            class="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin"
          ></div>
        </div>
        <span class="text-sm text-muted-foreground">Setting up your workspace…</span>
      </div>
    </div>
  {:else}
    <!-- Normal editing state -->
    <div class="relative w-full z-0">
      <input
        bind:this={onboardingFileInput}
        type="file"
        multiple
        class="hidden"
        onchange={handleFileChange}
      />
      <div
        class="relative rich-input-container flex flex-col bg-background rounded-xl border border-border shadow-xs transition-colors overflow-hidden"
      >
        <div
          class="w-full relative overflow-hidden rounded-t-xl"
          bind:this={richTextareaWrapper}
        >
          <RichTextarea
            bind:this={onboardingRichTextarea}
            bind:value={onboardingInputValue}
            repoPath={projectSelection?.repoPath || undefined}
            onsubmit={onSubmit}
            onchange={onContentChange}
            onfocus={onFocus}
            onkeydown={onKeydown}
            minHeight={180}
            maxHeight={350}
            autoFocus={true}
            class="bg-transparent border-none"
          />
          {#if !onboardingInputValue.trim()}
            <div
              class="absolute left-0 right-0 top-[52px] px-4 pointer-events-none"
            >
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="flex flex-col gap-0.75 pointer-events-auto"
                role="listbox"
                aria-label="Prompt suggestions"
              >
                {#each visibleSuggestions.slice(0, 4) as suggestion, i (suggestion)}
                  <button
                    type="button"
                    role="option"
                    id="suggestion-{i}"
                    aria-selected={focusedSuggestionIndex === i}
                    class="text-left text-sm transition-colors cursor-pointer truncate flex items-center gap-1.5
                      {focusedSuggestionIndex === i
                      ? 'text-foreground'
                      : 'text-muted-foreground/50 hover:text-muted-foreground/70'}"
                    onclick={() => onPromptSelect(suggestion)}
                    in:fly={{
                      x: -6,
                      duration: 200,
                      delay: 30 * i,
                      easing: cubicOut,
                    }}
                  >
                    <Fa
                      icon={faArrowRight}
                      size={12}
                      class={focusedSuggestionIndex === i
                        ? 'opacity-100'
                        : 'opacity-60'}
                    />
                    {suggestion}
                  </button>
                {/each}
                <button
                  type="button"
                  role="option"
                  id="suggestion-shuffle"
                  aria-selected={focusedSuggestionIndex ===
                    visibleSuggestions.slice(0, 4).length}
                  class="text-left text-xs transition-colors cursor-pointer mt-0.75 inline-flex items-center gap-1.5
                    {focusedSuggestionIndex ===
                  visibleSuggestions.slice(0, 4).length
                    ? 'text-foreground'
                    : 'text-muted-foreground/30 hover:text-muted-foreground/70'}"
                  onclick={onShuffleSuggestions}
                >
                  <Fa icon={faArrowsRotate} size={12} />
                  <span></span>
                </button>
              </div>
            </div>
          {/if}
          {#if isOnboardingEnhancing}
            <div
              class="absolute inset-0 pointer-events-none overflow-hidden rounded-t-xl"
            >
              <div
                class="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-pulse"
              ></div>
            </div>
          {/if}
        </div>

        <div
          class="flex items-center gap-2 px-2.5 pt-1 pb-2.5 overflow-x-auto relative"
        >
          <IssueSuggestions
            onSelect={(text, metadata) => {
              onIssueSelect(text, metadata);
              if (metadata?.metadata?.sourceBranch) {
                onBranchSet(metadata.metadata.sourceBranch);
              }
            }}
            repositoryOwner={onboardingGithubRepoInfo?.owner}
            repositoryName={onboardingGithubRepoInfo?.repo}
          />

          <div class="absolute top-2 right-2.5 flex items-center">
            <Button
              type="button"
              onclick={onEnhancePrompt}
              size="icon-xs"
              variant="ghost-light"
              disabled={!onboardingInputValue.trim() && !isOnboardingEnhancing}
              tooltip="Enhance prompt  ⌘E"
            >
              {#if isOnboardingEnhancing}
                <div class="animate-spin">
                  <Fa icon={faArrowsRotate} size="xs" />
                </div>
              {:else}
                <Fa icon={faMagicWandSparkles} size="xs" />
              {/if}
            </Button>

            <Button
              type="button"
              onclick={handleFileSelect}
              size="icon-xs"
              variant="ghost-light"
              tooltip="Add files"
            >
              <Fa icon={faPaperclip} size="xs" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div class="w-full">
      <!-- Branch picker -->
      {#if projectSelection?.type === 'local' && projectSelection?.repoPath}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="flex items-center gap-0.5 text-sm cursor-pointer"
          in:fly={{ y: 10, duration: 200, easing: cubicOut }}
          onclick={(e) => {
            const trigger = e.currentTarget.querySelector('button');
            if (
              trigger &&
              e.target !== trigger &&
              !trigger.contains(e.target as Node)
            ) {
              trigger.click();
            }
          }}
        >
          <span class="text-muted-foreground">Branch off of</span>
          <BranchSelector
            variant="ghost"
            triggerClass="pl-1 pr-1.5 font-medium bg-card/50 py-1.25 rounded-md border border-border/30"
            value={projectSelection?.branch || 'main'}
            repoPath={projectSelection.repoPath}
            repoType="local"
            hasTriggerIcon={false}
            showUncommittedIndicator={true}
            skipWorktree={onboardingSkipWorktree}
            onSkipWorktreeChange={onSkipWorktreeChange}
            onBranchStatusChange={(status) => {
              onBranchBehindChange(status.behind);
            }}
            onchange={(event) => {
              if (projectSelection) {
                onProjectChange({
                  ...projectSelection,
                  branch: event.detail.branch,
                });
              }
            }}
          />
        </div>
      {:else if projectSelection?.type === 'github' && projectSelection?.githubUrl}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="flex items-center gap-0.5 text-sm cursor-pointer"
          in:fly={{ y: 10, duration: 200, easing: cubicOut }}
          onclick={(e) => {
            const trigger = e.currentTarget.querySelector('button');
            if (
              trigger &&
              e.target !== trigger &&
              !trigger.contains(e.target as Node)
            ) {
              trigger.click();
            }
          }}
        >
          <span class="text-muted-foreground">Branch off</span>
          <BranchSelector
            variant="ghost"
            triggerClass="pl-1 pr-1.5 font-medium bg-card/50 py-1.25 rounded-md border border-border/30"
            value={projectSelection?.branch || 'main'}
            repoPath={projectSelection.repoPath || ''}
            repoType="github"
            githubUrl={projectSelection.githubUrl}
            hasTriggerIcon={false}
            skipWorktree={onboardingSkipWorktree}
            onSkipWorktreeChange={onSkipWorktreeChange}
            onBranchStatusChange={(status) => {
              onBranchBehindChange(status.behind);
            }}
            onchange={(event) => {
              if (projectSelection) {
                onProjectChange({
                  ...projectSelection,
                  branch: event.detail.branch,
                });
              }
            }}
          />
        </div>
      {/if}

      <!-- Setup script disclosure -->
      {#if projectSelection?.repoPath && projectSelection?.type !== 'new'}
        <div
          class="flex items-center gap-0.5 text-sm"
          in:fly={{ y: 10, duration: 200, easing: cubicOut }}
        >
          <button
            type="button"
            class="flex items-center whitespace-nowrap text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onclick={() => onShowSetupScriptChange(!showSetupScript)}
          >
            <span>Set up environment with</span>
            <span class="bg-card/50 px-1.5 py-0.5 font-medium"
              >{setupScriptName}</span
            >
            <span class="text-muted-foreground">script</span>
          </button>
        </div>
        <SetupScriptModal
          bind:open={showSetupScript}
          repoPath={projectSelection.repoPath}
          {repoConfigScript}
          bind:value={setupScript}
          bind:scriptName={setupScriptName}
          bind:isCustomScript={isCustomSetupScript}
          onClose={() => onShowSetupScriptChange(false)}
        />
      {/if}
    </div>

    <!-- Use PR branch suggestion -->
    {#if selectedPRBranch && projectSelection?.branch !== selectedPRBranch && projectSelection?.type !== 'new'}
      <div class="mt-1">
        <button
          class="flex items-center gap-2 mt-1 mb-1 px-1 text-sm text-primary hover:text-primary/80 cursor-pointer"
          transition:slide={{ axis: 'y', duration: 150 }}
          onclick={() => {
            if (projectSelection) {
              onProjectChange({
                ...projectSelection,
                branch: selectedPRBranch,
              });
            }
          }}
        >
          <Fa icon={faCodeBranch} size="sm" class="shrink-0" />
          <span>Use PR branch <strong>{selectedPRBranch}</strong></span>
        </button>
      </div>
    {/if}

    <!-- Error state: prefer the post-submit error (user clicked Create and
         it actually failed). If the user hasn't submitted yet but the
         preflight check has found a problem, surface that instead so they
         can fix it before clicking Create. -->
    {#if onboardingCreationError}
      <WorkspaceCreationError message={onboardingCreationError} onRetry={onSubmit} />
    {:else if activePreflightError}
      <WorkspaceCreationError message={activePreflightError} variant="warning" />
    {/if}

    <!-- Create button -->
    <div class="flex items-center gap-3 pt-2">
      <Button
        class="group/button"
        size="xl"
        variant={!onboardingInputValue.trim() ? 'outline' : 'default'}
        disabled={!onboardingInputValue.trim()}
        onclick={onSubmit}
      >
        Create workspace
        {#if onboardingInputValue.trim()}
          <span class="mx-1 opacity-50" in:slide={{ axis: 'x', duration: 200 }}>
            ⌘↵</span
          >
        {/if}
        <Fa
          icon={faArrowRight}
          size={15}
          class="transform -translate-x-0.75 transition-all group-hover/button:translate-x-0 ml-1 opacity-50"
        />
      </Button>
    </div>
  {/if}
</div>