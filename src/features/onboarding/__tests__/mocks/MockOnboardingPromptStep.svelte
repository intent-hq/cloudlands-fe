<script lang="ts">
  /**
   * Minimal OnboardingPromptStep stand-in for OnboardingPage tests.
   * Surfaces the setup-script props the page passes down and exposes
   * `onProjectChange` on `window` so tests can drive repo selection
   * without rendering the real step.
   */
  let {
    onboardingInputValue = $bindable(''),
    onboardingSkipWorktree = $bindable(false),
    setupScript = $bindable(''),
    showSetupScript = $bindable(false),
    setupScriptName = $bindable('Custom'),
    isCustomSetupScript = $bindable(false),
    focusedSuggestionIndex = $bindable(-1),
    repoConfigScript = null,
    hideSetupScriptControl = false,
    onboardingGithubRepoInfo = null,
    selectedModel = undefined,
    modelWasOverridden = false,
    onModelChange,
    onProjectChange,
    onSubmit,
  }: {
    onboardingInputValue?: string;
    onboardingSkipWorktree?: boolean;
    setupScript?: string;
    showSetupScript?: boolean;
    setupScriptName?: string;
    isCustomSetupScript?: boolean;
    focusedSuggestionIndex?: number;
    repoConfigScript?: string | null;
    hideSetupScriptControl?: boolean;
    onboardingGithubRepoInfo?: { owner: string; repo: string } | null;
    selectedModel?: string | undefined;
    modelWasOverridden?: boolean;
    onModelChange?: (model: string) => void;
    onProjectChange?: (selection: unknown) => void;
    onSubmit?: () => void;
    [key: string]: unknown;
  } = $props();

  export function getRichTextarea() {
    return null;
  }

  $effect(() => {
    (window as unknown as Record<string, unknown>).__mockOnboardingPromptStep = {
      onProjectChange,
      onSubmit,
      onModelChange,
      setInputValue: (value: string) => {
        onboardingInputValue = value;
      },
      setSetupScript: (value: string) => {
        setupScript = value;
      },
    };
  });
</script>

<div data-testid="setup-script-name">{setupScriptName}</div>
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
<div hidden>{onboardingInputValue}{onboardingSkipWorktree}{showSetupScript}{focusedSuggestionIndex}</div>
