/**
 * PullRequestCreator — PR creation routed through accept-changes.execute
 * (action "create-pr", PROTOCOL.md §5.18) with auto-fill from
 * accept-changes.prepare suggestions and real error surfacing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspace: Record<string, unknown> = {
    id: 'ws-1',
    title: 'My Workspace',
    branch: 'feat/x',
    baseRef: 'main',
  };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return {
    dispatch,
    workspace,
    selector,
    prepare: vi.fn(),
    execute: vi.fn(),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: mocks.selector(() => mocks.workspace),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  updateWorkspaceEntity: vi.fn((...args: unknown[]) => ({
    type: 'workspace/updateWorkspaceEntity',
    payload: args,
  })),
}));

vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { prepare: mocks.prepare, execute: mocks.execute },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

async function renderCreator() {
  const PullRequestCreator = (await import('../PullRequestCreator.svelte')).default;
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const result = render(PullRequestCreator, { props: { onClose, onCreated } });
  return { ...result, onCreated, onClose };
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

describe('PullRequestCreator', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.prepare.mockReset();
    mocks.execute.mockReset();
  });

  it('auto-fills from accept-changes.prepare suggestions and creates the PR via accept-changes.execute', async () => {
    mocks.prepare.mockResolvedValue({
      valid: true,
      warnings: [],
      errors: [],
      suggestedPRTitle: 'Suggested title',
      suggestedPRBody: 'Suggested body',
      filesCount: 1,
      additions: 1,
      deletions: 0,
      files: [],
    });
    mocks.execute.mockResolvedValue({
      success: true,
      steps: [{ id: 'create-pr', name: 'Create PR', status: 'completed' }],
      result: { prNumber: 7, prUrl: 'https://api/pr/7', prHtmlUrl: 'https://gh/pr/7' },
    });

    const { container, onCreated } = await renderCreator();
    await fireEvent.click(findButton(container, 'Auto-fill & Create')!);

    await waitFor(() => {
      expect(container.textContent).toContain('Pull request created successfully!');
    });

    expect(mocks.prepare).toHaveBeenCalledWith('ws-1', 'create-pr');
    expect(mocks.execute).toHaveBeenCalledWith('ws-1', 'create-pr', {
      prTitle: 'Suggested title',
      prBody: 'Suggested body',
      targetBranch: 'main',
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/updateWorkspaceEntity' }),
    );
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ number: 7, url: 'https://gh/pr/7', title: 'Suggested title' }),
    );
  });

  it('surfaces the real daemon error when execute reports an in-band failure', async () => {
    mocks.prepare.mockResolvedValue({
      valid: true,
      warnings: [],
      errors: [],
      suggestedPRTitle: 'Suggested title',
      suggestedPRBody: '',
      filesCount: 0,
      additions: 0,
      deletions: 0,
      files: [],
    });
    mocks.execute.mockResolvedValue({
      success: false,
      steps: [{ id: 'create-pr', name: 'Create PR', status: 'failed', error: 'boom' }],
      error: 'GitHub authentication required',
    });

    const { container, onCreated } = await renderCreator();
    await fireEvent.click(findButton(container, 'Auto-fill & Create')!);

    await waitFor(() => {
      expect(container.textContent).toContain('GitHub authentication required');
    });
    expect(container.textContent).not.toContain('Pull request created successfully!');
    expect(onCreated).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
