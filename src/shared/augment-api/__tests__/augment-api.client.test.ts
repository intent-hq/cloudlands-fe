import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
}));

vi.mock('../../logger', () => ({
  Logger: class MockLogger {
    debug = loggerMock.debug;
    info = loggerMock.info;
    warn = loggerMock.warn;
    error = loggerMock.error;
  },
}));

import { AugmentApiClient, type GithubIssue, type GithubPullRequest } from '../augment-api.client';

type PullRequestParser = {
  parseYamlPullRequestList(yamlOutput: string): GithubPullRequest[];
};

type SearchParser = {
  parseYamlSearchResults(yamlOutput: string): GithubPullRequest[];
  parseYamlIssueSearchResults(yamlOutput: string, owner: string, repo: string): GithubIssue[];
};

type PullRequestClient = PullRequestParser & {
  callEndpoint: ReturnType<typeof vi.fn>;
  listGitHubPullRequests: AugmentApiClient['listGitHubPullRequests'];
};

type GitHubSearchClient = PullRequestClient & {
  searchGitHubPullRequests: AugmentApiClient['searchGitHubPullRequests'];
  searchGitHubIssues: AugmentApiClient['searchGitHubIssues'];
};

const parser = Object.create(AugmentApiClient.prototype) as PullRequestParser & SearchParser;

beforeEach(() => {
  vi.clearAllMocks();
});

function prYaml(number: number, title = `PR ${number}`): string {
  return `- number: ${number}
  title: ${title}
  body: Body ${number}
  state: open
  html_url: https://github.com/augmentcode/intent/pull/${number}
  created_at: 2026-06-0${number}T00:00:00Z
  updated_at: 2026-06-0${number}T01:00:00Z
  user:
    login: user-${number}
    avatar_url: https://example.com/avatar-${number}.png
    html_url: https://github.com/user-${number}
  head:
    ref: feature-${number}
    sha: head-sha-${number}
  base:
    ref: main
    sha: base-sha-${number}
  merged: false
  draft: false`;
}

function realShapedPrYaml(number: number): string {
  return `- _links:
    comments:
      href: https://api.github.com/repos/augmentcode/intent/issues/${number}/comments
    html:
      href: https://github.com/augmentcode/intent/pull/${number}
  active_lock_reason: null
  base:
    label: augmentcode:main
    ref: main
    repo:
      allow_auto_merge: false
      allow_forking: true
      description: Intent desktop app
      full_name: augmentcode/intent
    sha: base-sha-${number}
  body: |-
    This body stands in for a very large real PR body that can push the
    github-api YAML response toward the remote-tool truncation limit.
  head:
    label: augmentcode:feature-${number}
    ref: feature-${number}
    repo:
      allow_auto_merge: false
      allow_forking: true
      full_name: augmentcode/intent
    sha: head-sha-${number}
  html_url: https://github.com/augmentcode/intent/pull/${number}
  number: ${number}
  state: open
  title: Real shaped PR ${number}
  user:
    login: user-${number}`;
}

function searchPrYamlItem(number: number): string {
  return `  - number: ${number}
    title: Search PR ${number}
    body: Body ${number}
    state: open
    html_url: https://github.com/augmentcode/intent/pull/${number}
    created_at: 2026-06-0${number}T00:00:00Z
    updated_at: 2026-06-0${number}T01:00:00Z
    user:
      login: user-${number}`;
}

function searchIssueYamlItem(number: number): string {
  return `  - number: ${number}
    title: Search issue ${number}
    body: Body ${number}
    state: open
    html_url: https://github.com/augmentcode/intent/issues/${number}
    created_at: 2026-06-0${number}T00:00:00Z
    updated_at: 2026-06-0${number}T01:00:00Z
    user:
      login: user-${number}
    comments: ${number}`;
}

function getToolInput(
  client: GitHubSearchClient,
  callIndex = 0,
): { path: string; details: boolean } {
  const request = client.callEndpoint.mock.calls[callIndex][1] as { tool_input_json: string };
  return JSON.parse(request.tool_input_json) as { path: string; details: boolean };
}

function searchResultsYaml(items: string[], totalCount = items.length): string {
  return `total_count: ${totalCount}
items:
${items.join('\n')}`;
}

function mockListPageResponses(
  client: PullRequestClient,
  total: number,
  truncateAfter?: number,
): void {
  client.callEndpoint = vi.fn().mockImplementation(async (_endpoint: string, request: unknown) => {
    const toolInput = JSON.parse((request as { tool_input_json: string }).tool_input_json) as {
      path: string;
    };
    const url = new URL(`https://example.test${toolInput.path}`);
    const page = Number(url.searchParams.get('page') ?? '1');
    const perPage = Number(url.searchParams.get('per_page') ?? '30');
    const start = (page - 1) * perPage + 1;
    const items = Array.from(
      { length: Math.max(0, Math.min(perPage, total - start + 1)) },
      (_, i) => prYaml(start + i),
    );
    const visibleItems = truncateAfter === undefined ? items : items.slice(0, truncateAfter);
    return {
      tool_output: `${visibleItems.join('\n')}${
        truncateAfter !== undefined && items.length > truncateAfter
          ? '\n⚠️ Output truncated (227,507 bytes)'
          : ''
      }`,
      tool_result_message: 'ok',
      status: 1,
    };
  });
}

function mockSearchPageResponses(
  client: GitHubSearchClient,
  total: number,
  truncateAfter?: number,
): void {
  client.callEndpoint = vi.fn().mockImplementation(async (_endpoint: string, request: unknown) => {
    const toolInput = JSON.parse((request as { tool_input_json: string }).tool_input_json) as {
      path: string;
    };
    const url = new URL(`https://example.test${toolInput.path}`);
    const page = Number(url.searchParams.get('page') ?? '1');
    const perPage = Number(url.searchParams.get('per_page') ?? '30');
    const start = (page - 1) * perPage + 1;
    const items = Array.from(
      { length: Math.max(0, Math.min(perPage, total - start + 1)) },
      (_, i) => searchPrYamlItem(start + i),
    );
    const visibleItems = truncateAfter === undefined ? items : items.slice(0, truncateAfter);
    return {
      tool_output: `${searchResultsYaml(visibleItems, total)}${
        truncateAfter !== undefined && items.length > truncateAfter
          ? '\n⚠️ Output truncated (227,507 bytes)'
          : ''
      }`,
      tool_result_message: 'ok',
      status: 1,
    };
  });
}

describe('AugmentApiClient pull request YAML parsing', () => {
  it('parses valid untruncated YAML list output', () => {
    const prs = parser.parseYamlPullRequestList([prYaml(1), prYaml(2)].join('\n'));

    expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
    expect(prs[0]).toMatchObject({
      title: 'PR 1',
      state: 'open',
      head_ref: 'feature-1',
      base_ref: 'main',
      user: { login: 'user-1' },
    });
  });

  it('recovers complete PRs before a remote-tool truncation marker', () => {
    const prs = parser.parseYamlPullRequestList(
      `${[prYaml(1), prYaml(2)].join('\n')}
⚠️ Output truncated (227,507 bytes)`,
    );

    expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
  });

  it('recovers a real-shaped PR item that starts with links and is truncated after stable list fields', () => {
    const prs = parser.parseYamlPullRequestList(`${realShapedPrYaml(42)}
⚠️ Output truncated (227,507 bytes)`);

    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 42,
      title: 'Real shaped PR 42',
      state: 'open',
      html_url: 'https://github.com/augmentcode/intent/pull/42',
      user: { login: 'user-42' },
      head_ref: 'feature-42',
      base_ref: 'main',
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('recovers stable fields from a real-shaped PR item cut inside later nested YAML', () => {
    const prs = parser.parseYamlPullRequestList(`${realShapedPrYaml(44)}
  labels:
    - name: "cut off
⚠️ Output truncated (227,507 bytes)`);

    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 44,
      title: 'Real shaped PR 44',
      state: 'open',
      html_url: 'https://github.com/augmentcode/intent/pull/44',
      user: { login: 'user-44' },
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('recovers a complete real-shaped PR item before a truncation marker', () => {
    const prs = parser.parseYamlPullRequestList(`${realShapedPrYaml(43)}
  created_at: 2026-06-08T00:00:00Z
  updated_at: 2026-06-08T01:00:00Z
⚠️ Output truncated (227,507 bytes)`);

    expect(prs.map((pr) => pr.number)).toEqual([43]);
    expect(prs[0].created_at).toBe('2026-06-08T00:00:00.000Z');
    expect(prs[0].updated_at).toBe('2026-06-08T01:00:00.000Z');
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('drops a final PR item cut off in the middle', () => {
    const prs = parser.parseYamlPullRequestList(`${[prYaml(1), prYaml(2)].join('\n')}
- number: 3
  title: Cut off PR
  state: open
  user:`);

    expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
  });

  it('does not fabricate a PR when no complete item is present', () => {
    const prs = parser.parseYamlPullRequestList(`- number: 1
  title: Cut off PR
  user:`);

    expect(prs).toEqual([]);
  });

  it('uses compact paginated pull-list requests by default without live network', async () => {
    const client = Object.create(AugmentApiClient.prototype) as PullRequestClient;
    client.callEndpoint = vi.fn().mockResolvedValue({
      tool_output: '[]',
      tool_result_message: 'ok',
      status: 1,
    });

    await client.listGitHubPullRequests('augmentcode', 'intent');

    expect(client.callEndpoint).toHaveBeenCalledWith(
      'agents/run-remote-tool',
      expect.objectContaining({
        tool_name: 'github-api',
        tool_id: 8,
      }),
    );
    const request = client.callEndpoint.mock.calls[0][1] as { tool_input_json: string };
    const toolInput = JSON.parse(request.tool_input_json) as { path: string; details: boolean };
    expect(toolInput).toMatchObject({
      method: 'GET',
      details: false,
    });
    const url = new URL(`https://example.test${toolInput.path}`);
    expect(url.pathname).toBe('/repos/augmentcode/intent/pulls');
    expect(url.searchParams.get('per_page')).toBe('3');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('accumulates distinct list PRs across truncated small pages up to the requested count', async () => {
    const client = Object.create(AugmentApiClient.prototype) as PullRequestClient;
    mockListPageResponses(client, 30, 2);

    const prs = await client.listGitHubPullRequests('augmentcode', 'intent', { per_page: 20 });

    expect(prs).toHaveLength(20);
    expect(new Set(prs.map((pr) => pr.number)).size).toBe(20);
    expect(client.callEndpoint).toHaveBeenCalledTimes(10);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'GitHub PR page truncated during pagination; kept complete items',
      expect.objectContaining({ operation: 'list', page: 1, parsed: 2, pageSize: 3 }),
    );
  });

  it('stops list pagination when an untruncated page returns fewer than requested', async () => {
    const client = Object.create(AugmentApiClient.prototype) as PullRequestClient;
    mockListPageResponses(client, 4);

    const prs = await client.listGitHubPullRequests('augmentcode', 'intent', { per_page: 20 });

    expect(prs.map((pr) => pr.number)).toEqual([1, 2, 3, 4]);
    expect(client.callEndpoint).toHaveBeenCalledTimes(2);
  });

  it('enforces the list pagination call cap for always-truncated responses', async () => {
    const client = Object.create(AugmentApiClient.prototype) as PullRequestClient;
    client.callEndpoint = vi.fn().mockResolvedValue({
      tool_output: `${prYaml(1)}\n⚠️ Output truncated (227,507 bytes)`,
      tool_result_message: 'ok',
      status: 1,
    });

    const prs = await client.listGitHubPullRequests('augmentcode', 'intent', { per_page: 20 });

    expect(prs.map((pr) => pr.number)).toEqual([1]);
    expect(client.callEndpoint).toHaveBeenCalledTimes(10);
    expect(loggerMock.info).toHaveBeenCalledWith(
      'Paginated GitHub PR fetch complete',
      expect.objectContaining({ operation: 'list', pagesFetched: 10, hitCallCap: true }),
    );
  });

  it('routes unfiltered open PR search through the hardened list path', async () => {
    const client = Object.create(AugmentApiClient.prototype) as GitHubSearchClient;
    client.callEndpoint = vi.fn();
    client.listGitHubPullRequests = vi.fn().mockResolvedValue([]);

    await client.searchGitHubPullRequests('augmentcode', 'intent', { per_page: 50 });

    expect(client.listGitHubPullRequests).toHaveBeenCalledWith('augmentcode', 'intent', {
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    });
    expect(client.callEndpoint).not.toHaveBeenCalled();
  });

  it('uses compact clamped search requests for filtered PR searches', async () => {
    const client = Object.create(AugmentApiClient.prototype) as GitHubSearchClient;
    client.callEndpoint = vi.fn().mockResolvedValue({
      tool_output: 'total_count: 0\nitems: []',
      tool_result_message: 'ok',
      status: 1,
    });
    client.listGitHubPullRequests = vi.fn().mockResolvedValue([]);

    await client.searchGitHubPullRequests('augmentcode', 'intent', {
      filter: 'assigned',
      per_page: 50,
    });

    const toolInput = getToolInput(client);
    const url = new URL(`https://example.test${toolInput.path}`);
    expect(toolInput.details).toBe(false);
    expect(url.searchParams.get('per_page')).toBe('3');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('q')).toContain('assignee:@me');
  });

  it('accumulates filtered PR search results across truncated small pages', async () => {
    const client = Object.create(AugmentApiClient.prototype) as GitHubSearchClient;
    mockSearchPageResponses(client, 30, 2);
    client.listGitHubPullRequests = vi.fn().mockResolvedValue([]);

    const prs = await client.searchGitHubPullRequests('augmentcode', 'intent', {
      filter: 'assigned',
      per_page: 20,
    });

    expect(prs).toHaveLength(20);
    expect(new Set(prs.map((pr) => pr.number)).size).toBe(20);
    expect(client.callEndpoint).toHaveBeenCalledTimes(10);
    const firstToolInput = getToolInput(client);
    const firstUrl = new URL(`https://example.test${firstToolInput.path}`);
    expect(firstUrl.searchParams.get('q')).toContain('assignee:@me');
  });

  it('dedupes shifted search pages by PR number while preserving first-seen order', async () => {
    const client = Object.create(AugmentApiClient.prototype) as GitHubSearchClient;
    client.callEndpoint = vi
      .fn()
      .mockResolvedValueOnce({
        tool_output: searchResultsYaml([1, 2, 3].map(searchPrYamlItem), 6),
        tool_result_message: 'ok',
        status: 1,
      })
      .mockResolvedValueOnce({
        tool_output: searchResultsYaml([3, 4, 5].map(searchPrYamlItem), 6),
        tool_result_message: 'ok',
        status: 1,
      });
    client.listGitHubPullRequests = vi.fn().mockResolvedValue([]);

    const prs = await client.searchGitHubPullRequests('augmentcode', 'intent', {
      filter: 'created',
      per_page: 5,
    });

    expect(prs.map((pr) => pr.number)).toEqual([1, 2, 3, 4, 5]);
    expect(client.callEndpoint).toHaveBeenCalledTimes(2);
  });

  it('uses compact default-sized search requests for issues', async () => {
    const client = Object.create(AugmentApiClient.prototype) as GitHubSearchClient;
    client.callEndpoint = vi.fn().mockResolvedValue({
      tool_output: 'total_count: 0\nitems: []',
      tool_result_message: 'ok',
      status: 1,
    });
    client.listGitHubPullRequests = vi.fn().mockResolvedValue([]);

    await client.searchGitHubIssues('augmentcode', 'intent');

    const toolInput = getToolInput(client);
    const url = new URL(`https://example.test${toolInput.path}`);
    expect(toolInput.details).toBe(false);
    expect(url.searchParams.get('per_page')).toBe('10');
    expect(url.searchParams.get('q')).toContain('is:issue');
  });

  it('recovers complete PR search items before a truncated final item', () => {
    const prs = parser.parseYamlSearchResults(`total_count: 3
items:
${[searchPrYamlItem(1), searchPrYamlItem(2)].join('\n')}
  - number: 3
    title: Cut off PR
⚠️ Output truncated (227,507 bytes)`);

    expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'GitHub PR search results truncated; recovered complete items',
      expect.objectContaining({ parsed: 2, expected: 3, droppedTrailingIncomplete: true }),
    );
  });

  it('recovers complete issue search items before a truncated final item', () => {
    const issues = parser.parseYamlIssueSearchResults(
      `total_count: 3
items:
${[searchIssueYamlItem(1), searchIssueYamlItem(2)].join('\n')}
  - number: 3
    title: Cut off issue
⚠️ Output truncated (227,507 bytes)`,
      'augmentcode',
      'intent',
    );

    expect(issues.map((issue) => issue.number)).toEqual([1, 2]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'GitHub issue search results truncated; recovered complete items',
      expect.objectContaining({ parsed: 2, expected: 3, droppedTrailingIncomplete: true }),
    );
  });
});
