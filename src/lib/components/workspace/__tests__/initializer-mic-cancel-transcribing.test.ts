/**
 * @vitest-environment jsdom
 *
 * The workspace-prompt mic button's cancel-while-transcribing affordance
 * (CompactWorkspaceInitializer): while `voice.transcribe` is in flight the
 * spinner button must be clickable (not disabled) with the cancel
 * tooltip/aria-label, and clicking it must abandon the in-flight
 * transcription session so a late result is discarded.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    hardwareConsole: { pttRecording: false, voiceTranscribing: true },
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({ hardwareConsole: mocks.hardwareConsole }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable(() => []),
  selectSelectedModel: () => mocks.readable(() => undefined),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable(() => 'auggie'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.readable(() => []), {
    select: vi.fn(() => []),
  }),
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
}));

vi.mock('$store/renderer/slices/setup-scripts/setup-scripts-selectors', () => ({
  selectLastUsedScriptForRepo: { select: vi.fn(() => undefined) },
}));

vi.mock('$features/setup-scripts', () => ({
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom' })),
  fetchRepoConfigSetupScript: vi.fn(async () => null),
  fetchGitHubRepoConfigSetupScript: vi.fn(async () => null),
  probeRepoConfigSetupScript: vi.fn(),
  repoIdentityKey: vi.fn((identity: { path: string | null }) => identity.path),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    dispose: vi.fn(),
  })),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { pull: vi.fn(async () => ({ success: true })) }, drafts: {} },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/client/live/live-prompt-enhancement')>();
  return {
    ...actual,
    enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
    isEnhancePromptAvailable: vi.fn(() => true),
  };
});

vi.mock('$lib/utils/workspace-validation', () => ({
  getGitErrorMessage: (message: string) => message,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: vi.fn(async () => ({ success: false })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: vi.fn(), update: vi.fn() },
}));

vi.mock('$lib/components/workspace/initializer/new-workspace-draft', () => ({
  restoreNewWorkspaceDraft: vi.fn(async () => ({ status: 'none' })),
  createNewWorkspaceDraftSaver: vi.fn(() => ({ schedule: vi.fn(), flush: vi.fn() })),
  clearNewWorkspaceDraft: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'system:check-git') {
      return { success: true, data: { available: true, version: '2.44.0' } };
    }
    return { success: true, data: null };
  }),
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('./mocks/MockRichTextarea.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

// The Button's `tooltip` prop wraps its trigger in TooltipShortcut (which
// renders through Tooltip's `trigger` snippet, not `children`) — mock it to
// render its children so the wrapped mic button reaches the DOM.
vi.mock('$lib/components/ui/tooltip/TooltipShortcut.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/workspace/initializer/InitialAgentPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('./mocks/MockRepoAndBranchPicker.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { m } from '$shared/paraglide/messages.js';
import { enhancePrompt } from '$lib/client/live/live-prompt-enhancement';
import {
  beginTranscriptionSession,
  hasActiveTranscriptionSession,
  resetTranscriptionCancellation,
} from '$features/hardware-console/voice/transcription-cancellation';
import { warmImport } from '../../../../test/warm-import';

function renderInitializer() {
  return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
}

/** The transcribing mic button (the mocked Fa exposes data-icon="spinner"). */
function transcribingMicButton(): HTMLButtonElement | null {
  const button = document.body.querySelector('[data-testid="initializer-mic-button"]');
  return (button as HTMLButtonElement | null) ?? null;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockRepoAndBranchPicker.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));

describe('CompactWorkspaceInitializer mic cancel-while-transcribing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.hardwareConsole.voiceTranscribing = true;
  });

  afterEach(() => {
    cleanup();
    resetTranscriptionCancellation();
    sessionStorage.clear();
  });

  it('renders an enabled cancel control with the cancel tooltip/aria-label while transcribing', () => {
    renderInitializer();
    const button = transcribingMicButton();
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    expect(button!.getAttribute('aria-label')).toBe(
      m.chat_richInput_micCancelTranscribing_label(),
    );
  });

  it('clicking the cancel control abandons the in-flight transcription session', async () => {
    const onCancel = vi.fn();
    beginTranscriptionSession(onCancel);

    renderInitializer();
    await fireEvent.click(transcribingMicButton()!);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(hasActiveTranscriptionSession()).toBe(false);
  });

  it('renders the idle mic button (not the cancel control) when not transcribing', () => {
    mocks.hardwareConsole.voiceTranscribing = false;
    renderInitializer();
    const button = transcribingMicButton();
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-label')).toBe(m.chat_richInput_micStart_label());
  });
});

describe('CompactWorkspaceInitializer input lock while enhancing', () => {
  /** The mocked RichTextarea exposes its `disabled` prop via data-disabled. */
  function promptBox(): HTMLElement {
    return document.body.querySelector('[data-testid="mock-rich-textarea"]') as HTMLElement;
  }

  // Locate affordances via the mocked Fa's data-icon (real fa icon names).
  function enhanceButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="wand-magic-sparkles"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  function stopEnhanceButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="stop"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  function createButton(): HTMLButtonElement | null {
    return (
      Array.from(document.body.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(m.workspace_compactInitializer_createWorkspace_label()),
      ) ?? null
    );
  }

  /** Render expanded with a non-empty prompt so the enhance button is enabled. */
  async function renderWithPrompt() {
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: true },
    });
    component.applyStarterPrompt({ prompt: 'build a todo app', repoName: 'todo-app' } as never);
    await waitFor(() => expect(promptBox().textContent).toContain('build a todo app'));
    return component;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.hardwareConsole.voiceTranscribing = false;
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('disables the prompt input and Create button while enhancing and restores them on success', async () => {
    let resolveEnhance!: (value: { enhanced: string }) => void;
    vi.mocked(enhancePrompt).mockImplementation(
      () => new Promise((resolve) => { resolveEnhance = resolve; }) as never,
    );
    await renderWithPrompt();

    expect(promptBox().getAttribute('data-disabled')).toBe('false');
    await waitFor(() => expect(createButton()!.disabled).toBe(false));

    await fireEvent.click(enhanceButton()!);

    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('true'));
    expect(createButton()!.disabled).toBe(true);

    resolveEnhance({ enhanced: 'a much better prompt' });

    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('false'));
    expect(createButton()!.disabled).toBe(false);
  });

  it('restores editability when enhancement fails', async () => {
    let rejectEnhance!: (error: unknown) => void;
    vi.mocked(enhancePrompt).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectEnhance = reject; }) as never,
    );
    await renderWithPrompt();

    await fireEvent.click(enhanceButton()!);
    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('true'));

    rejectEnhance(new Error('enhance failed'));

    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('false'));
    await waitFor(() => expect(createButton()!.disabled).toBe(false));
  });

  it('keeps the cancel-enhance button clickable and restores editability on cancel', async () => {
    vi.mocked(enhancePrompt).mockImplementation(() => new Promise(() => {}) as never);
    await renderWithPrompt();

    await fireEvent.click(enhanceButton()!);
    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('true'));

    const stopButton = stopEnhanceButton();
    expect(stopButton).not.toBeNull();
    expect(stopButton!.disabled).toBe(false);

    await fireEvent.click(stopButton!);

    await waitFor(() => expect(promptBox().getAttribute('data-disabled')).toBe('false'));
    await waitFor(() => expect(createButton()!.disabled).toBe(false));
  });
});
