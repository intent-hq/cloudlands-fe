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
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
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
vi.mock('$features/onboarding/steps/WorkspaceCreationError.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
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

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('.onboarding-metadata-row'));

function expectClasses(element: HTMLElement, ...classes: string[]) {
  expect(Array.from(element.classList)).toEqual(expect.arrayContaining(classes));
}

function expectRowContract(row: HTMLElement) {
  expectClasses(row, 'min-h-8', 'min-w-0', 'flex-wrap', 'gap-x-1.5', 'gap-y-1');
}

afterEach(cleanup);

describe('OnboardingPromptStep rendered metadata layout', () => {
  it.each([
    ['local', local, 'Branch off of'],
    [
      'GitHub',
      { ...local, type: 'github', repoPath: 'owner/repo', githubUrl: 'https://github.com/o/r' },
      'Branch off',
    ],
  ])('aligns the %s branch, setup, and model rows', (_name, projectSelection, branchLabel) => {
    const result = render(OnboardingPromptStep, { props: props({ projectSelection }) });
    const metadata = result.container.querySelector<HTMLElement>('.onboarding-metadata-stack')!;
    const renderedRows = rows(result.container);

    expectClasses(metadata, 'gap-2', 'min-w-0');
    expect(renderedRows).toHaveLength(3);
    renderedRows.forEach(expectRowContract);
    expect(renderedRows[0].textContent).toContain(branchLabel);
    expect(renderedRows[1].textContent).toContain('Set up environment with');
    expect(renderedRows[2].textContent).toContain('Using');
  });

  it('renders only the model row for a new project and omits a hidden setup row', async () => {
    const result = render(OnboardingPromptStep, {
      props: props({ projectSelection: { ...local, type: 'new', projectName: 'new-project' } }),
    });
    expect(rows(result.container)).toHaveLength(1);
    expect(rows(result.container)[0].textContent).toContain('Using');

    await result.rerender(props({ hideSetupScriptControl: true }));
    expect(rows(result.container)).toHaveLength(2);
    expect(result.queryByRole('button', { name: /Set up environment with/ })).toBeNull();
  });

  it('wraps narrow controls and preserves setup, branch, model, and create behavior', async () => {
    const callbacks = {
      onProjectChange: vi.fn(),
      onModelChange: vi.fn(),
      onShowSetupScriptChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    const initial = props(callbacks);
    const result = render(OnboardingPromptStep, { props: initial });
    result.container.style.width = '240px';
    const renderedRows = rows(result.container);

    const branch = within(renderedRows[0]).getByRole('button', { name: 'Select branch' });
    const setup = within(renderedRows[1]).getByRole('button', {
      name: /Set up environment with Default script/,
    });
    const model = within(renderedRows[2]).getByRole('button', { name: 'Select model' });
    expectClasses(branch, 'max-w-full');
    expectClasses(setup, 'min-w-0', 'max-w-full', 'flex-wrap');
    expectClasses(within(setup).getByText('Default'), 'max-w-full', 'break-words');
    expectClasses(model, 'max-w-full');

    await fireEvent.click(renderedRows[0]);
    expect(callbacks.onProjectChange).toHaveBeenCalledWith({ ...local, branch: 'changed-branch' });
    await fireEvent.click(setup);
    expect(callbacks.onShowSetupScriptChange).toHaveBeenCalledWith(true);
    await fireEvent.click(model);
    expect(callbacks.onModelChange).toHaveBeenCalledWith('mock:model');

    const action = result.container.querySelector<HTMLElement>('.onboarding-create-action')!;
    const create = within(action).getByRole('button', { name: /Create workspace/ });
    expectClasses(action, 'pt-2');
    expect((create as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(create);
    expect(callbacks.onSubmit).toHaveBeenCalledOnce();
    await result.rerender({ ...initial, onboardingInputValue: '' });
    expect(
      (result.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
