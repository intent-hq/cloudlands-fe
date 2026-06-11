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

import { AugmentApiClient, type GithubPullRequest } from '../augment-api.client';

type PullRequestParser = {
  parseYamlPullRequestList(yamlOutput: string): GithubPullRequest[];
};

type PullRequestClient = PullRequestParser & {
  callEndpoint: ReturnType<typeof vi.fn>;
  listGitHubPullRequests: AugmentApiClient['listGitHubPullRequests'];
};

const parser = Object.create(AugmentApiClient.prototype) as PullRequestParser;

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

  it('uses compact pull-list requests by default without live network', async () => {
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
      path: '/repos/augmentcode/intent/pulls?per_page=10',
      details: false,
    });
  });
});
