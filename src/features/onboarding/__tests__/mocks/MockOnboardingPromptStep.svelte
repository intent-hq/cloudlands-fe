<script lang="ts">
  /**
   * Minimal OnboardingPromptStep stand-in for OnboardingPage tests.
   * Surfaces the setup-script props the page passes down and exposes
   * `onProjectChange` on `window` so tests can drive repo selection
   * without rendering the real step.
   */
  let {
    onboardingInputValue = $bindable(''),
    isOnboardingCreating = false,
    onboardingSkipWorktree = $bindable(false),
    onboardingSkipIsolation = $bindable(false),
    setupScript = $bindable(''),
    showSetupScript = $bindable(false),
    setupScriptName = $bindable('Custom'),
    setupScriptNameSource = $bindable('custom'),
    isCustomSetupScript = $bindable(false),
    focusedSuggestionIndex = $bindable(-1),
    stagedContextItems = $bindable([]),
    imageContextItems = $bindable([]),
    repoConfigScript = null,
    hideSetupScriptControl = false,
    onboardingGithubRepoInfo = null,
    selectedModel = undefined,
    modelWasOverridden = false,
    onModelChange,
    onProjectChange,
    onSubmit,
    onSkipIsolationChange,
    onBranchBehindChange,
  }: {
    onboardingInputValue?: string;
    isOnboardingCreating?: boolean;
    onboardingSkipWorktree?: boolean;
    onboardingSkipIsolation?: boolean;
    setupScript?: string;
    showSetupScript?: boolean;
    setupScriptName?: string;
    setupScriptNameSource?: string;
    isCustomSetupScript?: boolean;
    focusedSuggestionIndex?: number;
    stagedContextItems?: unknown[];
    imageContextItems?: unknown[];
    repoConfigScript?: string | null;
    hideSetupScriptControl?: boolean;
    onboardingGithubRepoInfo?: { owner: string; repo: string } | null;
    selectedModel?: string | undefined;
    modelWasOverridden?: boolean;
    onModelChange?: (model: string) => void;
    onProjectChange?: (selection: unknown) => void;
    onSubmit?: () => void;
    onSkipIsolationChange?: (value: boolean) => void;
    onBranchBehindChange?: (behind: number) => void;
    [key: string]: unknown;
  } = $props();

  // Optional editor stand-in (set via setEditorMentions below). Like the
  // real step, the editor is only reachable while the form is mounted:
  // isOnboardingCreating swaps it for the setup card, so reads after the
  // flip return null — exactly the unmount race of intent-hq/intent#4050.
  let editorStub = $state<{
    getMentions: () => unknown[];
    getContextMentions: () => unknown[];
  } | null>(null);

  export function getRichTextarea() {
    if (!editorStub || isOnboardingCreating) return null;
    return editorStub;
  }

  // Test-settable stand-in for the real step's effective default-model
  // snapshot (the daemon resolvedModel preview + its provider context).
  let effectiveDefaultModel = $state<{ model: string | undefined; provider: string }>({
    model: undefined,
    provider: '',
  });

  export function getEffectiveDefaultModel() {
    return effectiveDefaultModel;
  }

  $effect(() => {
    (window as unknown as Record<string, unknown>).__mockOnboardingPromptStep = {
      onProjectChange,
      onSubmit,
      onModelChange,
      setSkipIsolation: (value: boolean) => {
        onboardingSkipIsolation = value;
        onSkipIsolationChange?.(value);
      },
      setBranchBehind: (behind: number) => onBranchBehindChange?.(behind),
      setEffectiveDefaultModel: (value: { model: string | undefined; provider: string }) => {
        effectiveDefaultModel = value;
      },
      setInputValue: (value: string) => {
        onboardingInputValue = value;
      },
      setImageContextItems: (items: unknown[]) => {
        imageContextItems = items;
      },
      setEditorMentions: (mentions: unknown[], contextMentions: unknown[]) => {
        editorStub = {
          getMentions: () => mentions,
          getContextMentions: () => contextMentions,
        };
      },
      setStagedContextItems: (items: unknown[]) => {
        stagedContextItems = items;
      },
      setSetupScript: (value: string) => {
        setupScript = value;
      },
      // Simulate the SetupScriptModal's Done: commit an edited script the way
      // the real modal does (isCustomScript binding).
      commitSetupScript: (value: string, isCustom = true) => {
        setupScript = value;
        isCustomSetupScript = isCustom;
      },
    };
  });
</script>

<div data-testid="setup-script-name">{setupScriptName}</div>
<div data-testid="setup-script-name-source">{setupScriptNameSource}</div>
<div data-testid="setup-script">{setupScript}</div>
<div data-testid="repo-config-script">{repoConfigScript ?? ''}</div>
<div data-testid="is-custom-setup-script">{String(isCustomSetupScript)}</div>
<div data-testid="hide-setup-script-control">{String(hideSetupScriptControl)}</div>
<div data-testid="github-repo-info">
  {onboardingGithubRepoInfo
    ? `${onboardingGithubRepoInfo.owner}/${onboardingGithubRepoInfo.repo}`
    : ''}
</div>
<div data-testid="selected-model">{selectedModel ?? ''}</div>
<div data-testid="model-was-overridden">{String(modelWasOverridden)}</div>
<div hidden>
  {onboardingInputValue}{onboardingSkipWorktree}{onboardingSkipIsolation}{showSetupScript}{focusedSuggestionIndex}
</div>
