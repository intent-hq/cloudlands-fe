/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import GitLabProjectPicker from '../GitLabProjectPicker.svelte';
import type { GitLabProjectPickerProps } from '../gitlab-picker-types';

const project = { projectPath: 'team/platform/api', name: 'API', namespace: 'team/platform' };
const other = { projectPath: 'team/mobile/api', name: 'API', namespace: 'team/mobile' };

function props(): GitLabProjectPickerProps {
  return {
    scopeKey: 'host-a/connection-a/lease-1',
    instanceBaseUrl: 'https://git.example.test:8443/Forge',
    query: '',
    page: { status: 'ready', items: [project], hasMore: true },
    copy: {
      searchLabel: 'Search GitLab projects',
      searchPlaceholder: 'Project name or namespace',
      listLabel: 'GitLab projects',
      loadingLabel: 'Loading GitLab projects',
      emptyLabel: 'No projects are available.',
      emptySearchLabel: 'No projects match this search.',
      loadMoreLabel: 'Load more projects',
      loadingMoreLabel: 'Loading more projects',
    },
    onSearch: vi.fn(),
    onMore: vi.fn(),
    onSelect: vi.fn(),
    onRecover: vi.fn(),
  };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('GitLab project presentation', () => {
  it('shows the complete instance and disambiguates projects with the same name', () => {
    const input = props();
    input.page = { status: 'ready', items: [project, other], hasMore: false };
    render(GitLabProjectPicker, input);

    expect(screen.getByText(input.instanceBaseUrl!)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'API team/platform/api' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'API team/mobile/api' })).toBeTruthy();
    expect(input.onSelect).not.toHaveBeenCalled();
  });

  it('selects a project from a later page with the original snapshot tag', async () => {
    const input = props();
    const view = render(GitLabProjectPicker, input);
    await fireEvent.click(screen.getByRole('button', { name: 'Load more projects' }));
    expect(input.onMore).toHaveBeenCalledWith(input.scopeKey);

    await view.rerender({ page: { status: 'ready', items: [project, other], hasMore: false } });
    await fireEvent.click(screen.getByRole('option', { name: 'API team/mobile/api' }));

    expect(input.onSelect).toHaveBeenCalledWith(other.projectPath, input.scopeKey);
    expect(screen.queryByRole('button', { name: 'Load more projects' })).toBeNull();
  });

  it('sends server search intent and preserves server result ordering', async () => {
    const input = props();
    input.page = { status: 'ready', items: [other, project], hasMore: false };
    render(GitLabProjectPicker, input);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'platform' } });

    expect(input.onSearch).toHaveBeenCalledWith('platform', input.scopeKey);
    // The state owner, not a second component filter, decides which results are current.
    expect(
      screen.getAllByRole('option').map((row) => row.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['API team/mobile/api', 'API team/platform/api']);
  });

  it('supports moving from search to results and selecting with the keyboard', async () => {
    const input = { ...props(), onSubmit: vi.fn(), submitLabel: 'Use GitLab link' };
    render(GitLabProjectPicker, input);
    const search = screen.getByRole('searchbox');
    search.focus();
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(input.onSubmit).not.toHaveBeenCalled();
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    const option = screen.getByRole('option');
    expect(document.activeElement).toBe(option);
    await fireEvent.keyDown(option, { key: 'Enter' });
    expect(input.onSelect).toHaveBeenCalledWith(project.projectPath, input.scopeKey);
    expect(input.onSubmit).not.toHaveBeenCalled();
  });

  it('offers explicit submission only when the consumer supplies both action and label', async () => {
    const view = render(GitLabProjectPicker, props());
    expect(screen.queryByRole('button', { name: 'Use GitLab link' })).toBeNull();
    await view.rerender({ submitLabel: 'Use GitLab link' });
    expect(screen.queryByRole('button', { name: 'Use GitLab link' })).toBeNull();
    await view.rerender({ submitLabel: undefined, onSubmit: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Use GitLab link' })).toBeNull();
    await view.rerender({ submitLabel: 'Use GitLab link' });
    expect(screen.getByRole('button', { name: 'Use GitLab link' })).toBeTruthy();
  });

  it('keeps typing as search and submits the current query and scope only on explicit activation', async () => {
    const input = { ...props(), onSubmit: vi.fn(), submitLabel: 'Use GitLab link' };
    const view = render(GitLabProjectPicker, input);
    const partial = 'https://git.example.test:8443/Forge/team/platform/api/-/merge_requests/';
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: partial } });
    expect(input.onSearch).toHaveBeenCalledWith(partial, input.scopeKey);
    expect(input.onSubmit).not.toHaveBeenCalled();

    const query = `${partial}42`;
    const scopeKey = 'host-b/connection-b/lease-2';
    await view.rerender({ query, scopeKey });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Use GitLab link' });
    expect(submit.type).toBe('button');
    await fireEvent.click(submit);

    expect(input.onSubmit).toHaveBeenCalledExactlyOnceWith(query, scopeKey);
    expect(input.onSelect).not.toHaveBeenCalled();
    expect(input.onMore).not.toHaveBeenCalled();
  });

  it.each([
    { query: '', page: props().page },
    { query: ' \t ', page: props().page },
    { query: 'https://git.example.test/team/api', page: { status: 'loading' as const } },
    {
      query: 'https://git.example.test/team/api',
      page: { status: 'ready' as const, items: [project], hasMore: true, loadingMore: true },
    },
  ])('disables explicit submission for empty queries or loading: %j', ({ query, page }) => {
    render(GitLabProjectPicker, {
      ...props(),
      query,
      page,
      onSubmit: vi.fn(),
      submitLabel: 'Use GitLab link',
    });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Use GitLab link' }).disabled,
    ).toBe(true);
  });

  it('withdraws explicit submission when the connection becomes unavailable', async () => {
    const view = render(GitLabProjectPicker, {
      ...props(),
      query: 'https://git.example.test/team/api',
      onSubmit: vi.fn(),
      submitLabel: 'Use GitLab link',
    });
    expect(screen.getByRole('button', { name: 'Use GitLab link' })).toBeTruthy();
    await view.rerender({
      page: { status: 'unavailable', message: 'The GitLab connection changed.' },
    });
    expect(screen.queryByRole('button', { name: 'Use GitLab link' })).toBeNull();
  });

  it('keeps the current page while loading more and prevents repeated page requests', () => {
    const input = props();
    input.page = { status: 'ready', items: [project], hasMore: true, loadingMore: true };
    render(GitLabProjectPicker, input);
    expect(screen.getByRole('option')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Loading more projects' }).disabled,
    ).toBe(true);
  });

  it.each([
    ['Connect GitLab to browse projects.', 'Connect GitLab'],
    ['You no longer have access to this project.', 'Reconnect GitLab'],
    ['The GitLab connection changed.', 'Refresh connection'],
    ['GitLab is limiting requests. Try again later.', 'Try again'],
    ['Enable GitLab in Labs to browse projects.', 'Open Labs'],
  ])('replaces private results with the unavailable state: %s', async (message, actionLabel) => {
    const input = props();
    const view = render(GitLabProjectPicker, input);
    expect(screen.getByRole('option')).toBeTruthy();
    await view.rerender({
      scopeKey: 'host-b/connection-b/lease-2',
      page: { status: 'unavailable', message, actionLabel },
    });

    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('No projects are available.')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: actionLabel }));
    expect(input.onRecover).toHaveBeenCalledWith('host-b/connection-b/lease-2');
  });

  it('distinguishes loading, an empty account and an empty search result', async () => {
    const view = render(GitLabProjectPicker, { ...props(), page: { status: 'loading' } });
    expect(screen.getByRole('status', { name: 'Loading GitLab projects' })).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
    await view.rerender({ page: { status: 'ready', items: [], hasMore: false } });
    expect(screen.getByText('No projects are available.')).toBeTruthy();
    await view.rerender({ query: 'missing' });
    expect(screen.getByText('No projects match this search.')).toBeTruthy();
  });
});
