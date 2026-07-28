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
    isRepoConfigLoading = false,
    onboardingGithubRepoInfo = null,
    onProjectChange,
  }: {
    onboardingInputValue?: string;
    onboardingSkipWorktree?: boolean;
    setupScript?: string;
    showSetupScript?: boolean;
    setupScriptName?: string;
    isCustomSetupScript?: boolean;
    focusedSuggestionIndex?: number;
    repoConfigScript?: string | null;
    isRepoConfigLoading?: boolean;
    onboardingGithubRepoInfo?: { owner: string; repo: string } | null;
    onProjectChange?: (selection: unknown) => void;
    [key: string]: unknown;
  } = $props();

  export function getRichTextarea() {
    return null;
  }

  $effect(() => {
    (window as unknown as Record<string, unknown>).__mockOnboardingPromptStep = {
      onProjectChange,
    };
  });
</script>

<div data-testid="setup-script-name">{setupScriptName}</div>
<div data-testid="setup-script">{setupScript}</div>
<div data-testid="repo-config-script">{repoConfigScript ?? ''}</div>
<div data-testid="is-custom-setup-script">{String(isCustomSetupScript)}</div>
<div data-testid="is-repo-config-loading">{String(isRepoConfigLoading)}</div>
<div data-testid="github-repo-info">
  {onboardingGithubRepoInfo
    ? `${onboardingGithubRepoInfo.owner}/${onboardingGithubRepoInfo.repo}`
    : ''}
</div>
<div hidden>{onboardingInputValue}{onboardingSkipWorktree}{showSetupScript}{focusedSuggestionIndex}</div>
