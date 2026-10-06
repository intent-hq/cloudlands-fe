/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import GitLabBranchPicker from '../GitLabBranchPicker.svelte';
import type { GitLabBranchPickerProps } from '../gitlab-picker-types';

const main = { name: 'trunk', commitSha: 'a'.repeat(40), protected: true };
const selected = { name: 'feature/page-two', commitSha: 'b'.repeat(40), protected: false };

function props(): GitLabBranchPickerProps {
  return {
    scopeKey: 'connection-a/project-a/query-1',
    instanceBaseUrl: 'https://git.example.test:8443/Forge',
    projectPath: 'team/platform/api',
    query: '',
    page: { status: 'ready', items: [main], hasMore: true },
    placeholder: 'Choose a branch',
    protectedLabel: 'Protected',
    copy: {
      searchLabel: 'Search branches',
      searchPlaceholder: 'Branch name',
      listLabel: 'GitLab branches',
      loadingLabel: 'Loading branches',
      emptyLabel: 'This project has no branches.',
      emptySearchLabel: 'No branches match this search.',
      loadMoreLabel: 'Load more branches',
      loadingMoreLabel: 'Loading more branches',
    },
    onSearch: vi.fn(),
    onMore: vi.fn(),
    onSelect: vi.fn(),
    onRecover: vi.fn(),
    onOpenChange: vi.fn(),
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('GitLab branch presentation', () => {
  it('exposes loading on the closed trigger, then allows a real branch choice', async () => {
    const input = props();
    const view = render(GitLabBranchPicker, { ...input, page: { status: 'loading' } });
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status')).toBeTruthy();
    await view.rerender({ page: input.page });
    expect(trigger.getAttribute('aria-busy')).not.toBe('true');
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'trunk Protected' }));
    expect(input.onSelect).toHaveBeenCalledWith(
      { name: 'trunk', commitSha: main.commitSha },
      input.scopeKey,
    );
  });

  it('keeps a cached exact ref selectable without inventing protection metadata', async () => {
    const input = props();
    input.page = {
      status: 'ready',
      items: [{ name: selected.name, commitSha: selected.commitSha }],
      hasMore: false,
    };
    render(GitLabBranchPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    expect(screen.queryByText('Protected')).toBeNull();
    await fireEvent.click(screen.getByRole('option', { name: selected.name }));
    expect(input.onSelect).toHaveBeenCalledWith(
      { name: selected.name, commitSha: selected.commitSha },
      input.scopeKey,
    );
  });

  it('does not invent a default or select the first branch on opening', async () => {
    const input = props();
    render(GitLabBranchPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    expect(screen.getByRole('option', { name: 'trunk Protected' })).toBeTruthy();
    expect(input.onSelect).not.toHaveBeenCalled();
    expect(input.onOpenChange).toHaveBeenCalledWith(true, input.scopeKey);
  });

  it('returns the exact later-page branch commit and project snapshot on selection', async () => {
    const input = props();
    const view = render(GitLabBranchPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Load more branches' }));
    expect(input.onMore).toHaveBeenCalledWith(input.scopeKey);
    await view.rerender({ page: { status: 'ready', items: [main, selected], hasMore: false } });
    await fireEvent.click(screen.getByRole('option', { name: selected.name }));
    expect(input.onSelect).toHaveBeenCalledWith(
      { name: selected.name, commitSha: selected.commitSha },
      input.scopeKey,
    );
  });

  it('renders a restored explicit choice without replacing it with the first listed branch', async () => {
    const input = props();
    const view = render(GitLabBranchPicker, { ...input, selectedBranch: selected });
    expect(screen.getByRole('button', { name: selected.name })).toBeTruthy();
    await view.rerender({
      scopeKey: 'connection-a/project-b/query-1',
      projectPath: 'team/other/api',
      selectedBranch: undefined,
      page: { status: 'loading' },
    });
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
    await view.rerender({ ...input, selectedBranch: selected });
    expect(screen.getByRole('button', { name: selected.name })).toBeTruthy();
    expect(input.onSelect).not.toHaveBeenCalled();
  });

  it('allows an explicit branch choice while the independent default lookup is pending', async () => {
    const input = props();
    render(GitLabBranchPicker, { ...input, isLoading: true });
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'trunk Protected' }));
    expect(input.onSelect).toHaveBeenCalledWith(
      { name: 'trunk', commitSha: main.commitSha },
      input.scopeKey,
    );
  });

  it('shows branch search results without filtering away server-returned matches', async () => {
    const input = props();
    const view = render(GitLabBranchPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'feature' } });
    expect(input.onSearch).toHaveBeenCalledWith('feature', input.scopeKey);
    await view.rerender({
      query: 'feature',
      page: { status: 'ready', items: [selected], hasMore: false },
    });
    expect(screen.getByRole('option', { name: selected.name })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'trunk Protected' })).toBeNull();
  });

  it('removes private branch results after retirement and permits explicit recovery', async () => {
    const input = props();
    const view = render(GitLabBranchPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    expect(screen.getByRole('option')).toBeTruthy();
    await view.rerender({
      scopeKey: 'connection-b/project-a/query-1',
      page: {
        status: 'unavailable',
        message: 'You no longer have access to this project.',
        actionLabel: 'Reconnect GitLab',
      },
    });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more branches' })).toBeNull();
    expect(screen.queryByText('This project has no branches.')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Reconnect GitLab' }));
    expect(input.onRecover).toHaveBeenCalledWith('connection-b/project-a/query-1');
  });

  it('leaves an empty repository unselected', async () => {
    const input = props();
    render(GitLabBranchPicker, {
      ...input,
      page: { status: 'ready', items: [], hasMore: false },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose a branch' }));
    expect(screen.getByText('This project has no branches.')).toBeTruthy();
    expect(input.onSelect).not.toHaveBeenCalled();
  });
});
