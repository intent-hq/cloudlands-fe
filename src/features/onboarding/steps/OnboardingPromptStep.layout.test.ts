/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
}));
vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
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
    expect(callbacks.onProjectChange).toHaveBeenCalledWith({ ...local, branch: 'master' });
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

  it.each([
    ['local', { ...local, branch: '' }],
    [
      'GitHub',
      {
        ...local,
        type: 'github' as const,
        repoPath: 'owner/repo',
        githubUrl: 'https://github.com/owner/repo',
        branch: '',
      },
    ],
  ])(
    'keeps an empty %s branch empty until detection and preserves it on remount',
    async (_, selection) => {
      const onProjectChange = vi.fn();
      const onSubmit = vi.fn();
      const first = render(OnboardingPromptStep, {
        props: props({ projectSelection: selection, onProjectChange, onSubmit }),
      });

      const trigger = within(rows(first.container)[0]).getByRole('button', {
        name: 'Select branch',
      });
      expect(trigger.textContent).toBe('Select branch');
      expect(
        (first.getByRole('button', { name: /Create workspace/ }) as HTMLButtonElement).disabled,
      ).toBe(true);

      await fireEvent.click(trigger);
      expect(onProjectChange).toHaveBeenCalledWith({ ...selection, branch: 'master' });

      first.unmount();
      const remounted = render(OnboardingPromptStep, {
        props: props({
          projectSelection: { ...selection, branch: 'master' },
          onProjectChange,
          onSubmit,
        }),
      });
      expect(within(rows(remounted.container)[0]).getByRole('button').textContent).toBe('master');
      const create = remounted.getByRole('button', {
        name: /Create workspace/,
      }) as HTMLButtonElement;
      expect(create.disabled).toBe(false);
      await fireEvent.click(create);
      expect(onSubmit).toHaveBeenCalledOnce();
    },
  );
});

describe('OnboardingPromptStep folder drop (path references, local daemon only)', () => {
  /** Drop with a DataTransferItem list carrying folder-detection entries. */
  function makeItemsDropEvent(entries: Array<{ file: File; isDirectory: boolean }>) {
    return {
      dataTransfer: {
        types: ['Files'],
        files: entries.map((e) => e.file),
        items: entries.map((e) => ({
          kind: 'file',
          getAsFile: () => e.file,
          webkitGetAsEntry: () => ({ isDirectory: e.isDirectory }),
        })),
      },
    };
  }

  function dropTarget(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('.rich-input-container')!;
  }

  function pills(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="attachment-pill"]'));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    placementMocks.isRemote = false;
  });

  it('local folder drop stages a folder pill carrying the absolute host path', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(OnboardingPromptStep, { props: props() });

    const folder = new File(['x'], 'my-folder', { type: '' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );
    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(1);
    });
    expect(pills(result.container)[0].dataset.name).toBe('my-folder');
    const { toast } = await import('svelte-sonner');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('remote drop containing a folder rejects the WHOLE drop with one error toast', async () => {
    placementMocks.isRemote = true;
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(OnboardingPromptStep, { props: props() });

    const folder = new File(['x'], 'my-folder', { type: '' });
    const file = new File(['y'], 'notes.txt', { type: 'text/plain' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([
        { file, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // Nothing attaches — not even the file in the same drop.
    expect(pills(result.container)).toHaveLength(0);
  });

  it('mixed local drop: folder becomes a pill, non-image file stages as today', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(OnboardingPromptStep, { props: props() });

    const folder = new File(['x'], 'my-folder', { type: '' });
    const file = new File(['y'], 'notes.txt', { type: 'text/plain' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([
        { file, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );

    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(2);
    });
    const names = pills(result.container).map((p) => p.dataset.name);
    expect(names).toContain('my-folder');
    expect(names).toContain('notes.txt');
  });

  it('re-dropping the same folder is a no-op (one pill, one staged item)', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(OnboardingPromptStep, { props: props() });

    const folder = new File(['x'], 'my-folder', { type: '' });
    const dropEvent = () => makeItemsDropEvent([{ file: folder, isDirectory: true }]);
    await fireEvent.drop(dropTarget(result.container), dropEvent());
    await fireEvent.drop(dropTarget(result.container), dropEvent());

    // One pill — a duplicate path-derived id would break keyed rendering
    // and make one remove drop both pills.
    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(1);
    });
    expect(pills(result.container)[0].dataset.name).toBe('my-folder');
  });

  it('skips the folder with an error toast when no absolute path is resolvable', async () => {
    // Missing/empty getPathForFile bridge (e.g. dev:web): a bare folder
    // name must never be staged as if it were an absolute host path.
    (window as any).electronAPI.getPathForFile = vi.fn(() => '');
    const result = render(OnboardingPromptStep, { props: props() });

    const folder = new File(['x'], 'my-folder', { type: '' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(pills(result.container)).toHaveLength(0);
  });
});
