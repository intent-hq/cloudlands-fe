/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/specialists/specialists-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectSpecialists: () => readable([]) };
});
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectEffectiveDefaultProviderId: () => readable('auggie') };
});
vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectActiveProviderId: () => readable('auggie') };
});
vi.mock('$lib/client', () => ({
  appClient: { specialists: { list: vi.fn(async () => []) } },
}));
vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockOnboardingControl.svelte')).default,
}));
vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockOnboardingControl.svelte')).default,
}));
vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockRichTextarea.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockAttachmentPill.svelte')).default,
}));
const placementMocks = vi.hoisted(() => ({ isRemote: false }));
vi.mock('$lib/components/chat/input/attachment-placement', () => ({
  isRemoteBackend: () => placementMocks.isRemote,
  mintPlacementIdempotencyKey: () => undefined,
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));
vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  shell: { open: vi.fn(() => Promise.resolve()) },
}));
vi.mock('svelte-fa', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

import OnboardingPromptStep from './OnboardingPromptStep.svelte';

type Props = ComponentProps<typeof OnboardingPromptStep>;
const local = { type: 'local', repoPath: '/repo', branch: 'main', isValid: true } as const;

function props(overrides: Partial<Props> = {}): Props {
  return {
    onboardingInputValue: 'Build it',
    isOnboardingCreating: false,
    isOnboardingEnhancing: false,
    onboardingCreationError: null,
    onboardingCreationErrorCode: null,
    projectSelection: local,
    onboardingGithubRepoInfo: null,
    selectedPRBranch: '',
    onboardingSkipIsolation: false,
    setupScript: 'echo setup',
    showSetupScript: false,
    setupScriptName: 'Default',
    isCustomSetupScript: false,
    repoConfigScript: null,
    visibleSuggestions: [],
    focusedSuggestionIndex: -1,
    onSubmit: vi.fn(),
    onEnhancePrompt: vi.fn(),
    onContentChange: vi.fn(),
    onFocus: vi.fn(),
    onKeydown: vi.fn(),
    onPromptSelect: vi.fn(),
    onIssueSelect: vi.fn(),
    onBranchSet: vi.fn(),
    onProjectChange: vi.fn(),
    onShuffleSuggestions: vi.fn(),
    onSkipIsolationChange: vi.fn(),
    onBranchBehindChange: vi.fn(),
    onShowSetupScriptChange: vi.fn(),
    ...overrides,
  } as Props;
}

afterEach(cleanup);

/**
 * Owner `/workspace/new` (brief M1a/M4): the prompt step renders the real
 * shared error box with the git cause and category guidance; Continue from
 * last-fetched appears only for `base-refresh-failed`.
 */
describe('OnboardingPromptStep creation error box', () => {
  const buttonLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

  it('shows the category title, git cause, guidance, Try again and Continue for base-refresh-failed', async () => {
    const onContinueFromLastFetched = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(OnboardingPromptStep, {
      props: props({
        onSubmit,
        onboardingCreationError: "Couldn't update main from origin: Permission denied (publickey)",
        onboardingCreationErrorCode: 'base-refresh-failed',
        onboardingBaseRefreshFailure: {
          category: 'auth-required',
          detail: 'git@github.com: Permission denied (publickey).',
          baseRef: 'main',
          remote: 'origin',
        },
        onContinueFromLastFetched,
      }),
    });
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Couldn't sign in to origin");
    expect(alert.textContent).toContain('git@github.com: Permission denied (publickey).');
    expect(alert.textContent).toContain('no SSH key or agent that origin accepts');
    expect(buttonLabels(alert)).toEqual(
      expect.arrayContaining(['Try again', 'Continue from last-fetched main']),
    );
    const continueButton = within(alert).getByText('Continue from last-fetched main');
    await fireEvent.click(continueButton);
    expect(onContinueFromLastFetched).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the readable cause and Try again without Continue for any other error', () => {
    const { container } = render(OnboardingPromptStep, {
      props: props({
        onboardingCreationError: 'Internal error: git worktree add failed',
        onboardingCreationErrorCode: null,
        onContinueFromLastFetched: vi.fn(),
      }),
    });
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('Internal error: git worktree add failed');
    expect(buttonLabels(alert)).toContain('Try again');
    expect(buttonLabels(alert).some((label) => label.includes('Continue'))).toBe(false);
  });
});
