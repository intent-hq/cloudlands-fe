import { describe, expect, it, vi } from 'vitest';

const { mockSendToWorkspaceWindows } = vi.hoisted(() => ({
  mockSendToWorkspaceWindows: vi.fn(),
}));

vi.mock('$features/system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mockSendToWorkspaceWindows,
}));

vi.mock('$features/agent/main/specialists.service', () => ({
  refreshSpecialistsFromFiles: vi.fn().mockResolvedValue(undefined),
  getAllEffectiveSpecialists: vi.fn(() => [
    {
      id: 'implementor',
      name: 'Implementor',
      description: 'Executes implementation tasks',
      codingAgent: 'auggie',
      model: 'opus4.7',
      behaviorPrompt: 'Implement the assigned task.',
      isCustomized: false,
      roleReminder: 'Stay scoped.',
    },
  ]),
  getEffectiveSpecialist: vi.fn((id: string) =>
    id === 'implementor'
      ? {
          id: 'implementor',
          name: 'Implementor',
          description: 'Executes implementation tasks',
          codingAgent: 'auggie',
          model: 'opus4.7',
          behaviorPrompt: 'Implement the assigned task.',
          isCustomized: false,
          roleReminder: 'Stay scoped.',
        }
      : null,
  ),
}));

import { createWorkspaceMCPServer } from '../index';
import { WorkspaceJsApiTool } from '../workspace-js-api-tool';
import { PROPOSAL_RESOURCE_MIME_TYPE } from '$shared/types/proposal-resource';
import { getAppUiTargets } from '$shared/app-ui-targets';
import {
  buildWsAppProposalApi,
  lookupKnownRepoLocalPath,
  normalizeWorkspaceCreateFields,
} from '../ws-app-workspaces-api';
import type { Proposal } from '$shared/types/proposal';

const MCP_SPEC_CONTENT_TYPES = new Set(['text', 'image', 'audio', 'resource_link', 'resource']);

function expectOnlyMcpSpecValidContentItems(result: any) {
  const types = result.content.map((item: any) => item.type);
  expect(types.every((type: string) => MCP_SPEC_CONTENT_TYPES.has(type))).toBe(true);
  expect(types).not.toContain('proposal');
}

function proposalFromResource(result: any) {
  const resourceBlock = result.content.find(
    (item: any) =>
      item.type === 'resource' && item.resource?.mimeType === PROPOSAL_RESOURCE_MIME_TYPE,
  );
  expect(resourceBlock).toBeTruthy();
  return JSON.parse(resourceBlock.resource.text);
}

describe('WorkspaceJsApiTool integration', () => {
  const workspaces = [
    {
      id: 'workspace-2',
      title: 'Beta Workspace',
      branch: 'beta',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: 'Active',
      repositoryName: 'repo-b',
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'workspace-1',
      title: 'Alpha Workspace',
      branch: 'alpha',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: 'Archived',
      repositoryName: 'repo-a',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('registers only workspace_api on the MCP server', async () => {
    const server = await createWorkspaceMCPServer('/tmp/test-workspace', 'workspace-1', {
      getWorkspace: vi.fn().mockResolvedValue(null),
    });

    expect(server.getTools().map((tool) => tool.name)).toEqual(['workspace_api']);
  });

  it('executes ws.workspace.info() through the composed API surface', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.workspace.info()',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('"id": "workspace-1"');
    expect((result.content[0] as any).text).toContain('"path": "/tmp/test-workspace"');
  });

  it('documents the consolidated API groups', () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');
    const definition = tool.getDefinition();

    expect(definition.description).toContain('ws.note.read(id)');
    expect(definition.description).toContain('statusMessage');
    expect(definition.description).toContain('ws.workspace.setStatusMessage(message)');
    expect(definition.description).toContain('does not change lifecycle `status` or task statuses');
    expect(definition.description).toContain('Use `taskNoteId` for delegation');
    expect(definition.description).toContain('tasks.filter(t => t.taskNoteId).map(t => t.taskNoteId)');
    expect(definition.description).toContain('ws.agent.delegate({');
    expect(definition.description).toContain('ws.pr.status()');
    expect(definition.description).toContain('ws.app.ui.navigate(route');
    expect(definition.description).toContain('ws.app.ui.targets()');
    expect(definition.description).toContain('ws.app.workspaces.list');
    expect(definition.description).toContain('ws.app.workspaces.archive(id) → ProposalCard');
    expect(definition.description).toContain('ws.app.workspaces.delete(id) → ProposalCard');
    expect(definition.description).toContain('ws.app.workspaces.open(id, { openInNewWindow? }?)');
    expect(definition.description).toContain('ws.app.specialists.list()');
    expect(definition.description).toContain('ws.app.specialists.propose({');
    expect(definition.description).toContain('ws.app.settings.list({');
  });

  it('exposes app UI targets through ws.app.ui.targets()', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.ui.targets()',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;
    const targets = JSON.parse(text);
    expect(targets).toEqual(getAppUiTargets());
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'appearance',
          tab: 'fonts-colors',
          hashAliases: ['appearance', 'theme'],
          scrollSelector: '#theme',
          highlightSelector: '[data-highlight-id="theme"]',
        }),
        expect.objectContaining({ id: 'color-theme', tab: 'fonts-colors' }),
        expect.objectContaining({ id: 'note-font', tab: 'fonts-colors' }),
        expect.objectContaining({ id: 'agent-chat-font', tab: 'fonts-colors' }),
        expect.objectContaining({ id: 'code-font', tab: 'fonts-colors' }),
        expect.objectContaining({ id: 'general', tab: 'general' }),
        expect.objectContaining({ id: 'workspace-card', dynamic: true }),
        expect.objectContaining({ id: 'specialist-entry', dynamic: true }),
      ]),
    );
  });

  it('mounts ws.app.workspaces only for the Chief workspace', async () => {
    const manager = {
      listAllWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: workspaces }),
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    };
    const chiefTool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', manager);
    const normalTool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1', manager);

    const chiefResult = await chiefTool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.workspaces.list({ sort: { by: "title", order: "asc" } })',
      },
      context: {},
    } as any);
    const normalResult = await normalTool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.list()' },
      context: {},
    } as any);

    expect(chiefResult.isError).toBe(false);
    const text = (chiefResult.content[0] as any).text;
    expect(text).toContain('Alpha Workspace');
    expect(text.indexOf('Alpha Workspace')).toBeLessThan(text.indexOf('Beta Workspace'));
    expect(manager.listAllWorkspaces).toHaveBeenCalledWith({ lite: true });
    expect(normalResult.isError).toBe(true);
  });

  it('re-reads ws.app.workspaces.list data from the manager on each call', async () => {
    const manager = {
      listAllWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: [workspaces[0]] })
        .mockResolvedValueOnce({
          ok: true,
          data: [{ ...workspaces[0], title: 'Fresh Workspace Title' }],
        }),
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    };
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', manager);

    const firstResult = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.list()' },
      context: {},
    } as any);
    const secondResult = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.list()' },
      context: {},
    } as any);

    expect(firstResult.isError).toBe(false);
    expect((firstResult.content[0] as any).text).toContain('Beta Workspace');
    expect(secondResult.isError).toBe(false);
    expect((secondResult.content[0] as any).text).toContain('Fresh Workspace Title');
    expect(manager.listAllWorkspaces).toHaveBeenCalledTimes(2);
    expect(manager.listAllWorkspaces).toHaveBeenNthCalledWith(1, { lite: true });
    expect(manager.listAllWorkspaces).toHaveBeenNthCalledWith(2, { lite: true });
  });

  it('does not mount ws.app outside the Chief workspace', async () => {
    const normalTool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await normalTool.execute({
      name: 'workspace_api',
      arguments: { code: 'return typeof ws.app' },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('undefined');
  });

  it('returns a 1-item bulk-op confirmation proposal for ws.app.workspaces.archive(id)', async () => {
    mockSendToWorkspaceWindows.mockClear();
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      listAllWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: workspaces }),
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.archive("workspace-1")' },
      context: { agentId: 'agent-1' },
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    const proposal = proposalFromResource(result);
    expect(proposal.kind).toBe('bulk-op');
    expect(proposal.payload.operation).toBe('workspace.bulkArchive');
    expect(proposal.payload.ids).toEqual(['workspace-1']);
    expect(proposal.preview.title).toBe('Archive 1 workspace');
    expect(proposal.preview.applyLabel).toBe('Archive');
    expect(proposal.preview.bulkItems).toHaveLength(1);
    expect(proposal.preview.bulkItems[0]).toMatchObject({
      id: 'workspace-1',
      title: 'Alpha Workspace',
      selected: true,
    });
    expect(mockSendToWorkspaceWindows).not.toHaveBeenCalledWith(
      expect.anything(),
      'app:workspace-operation-requested',
      expect.objectContaining({ operation: 'archive' }),
    );
  });

  it('returns a 1-item bulk-op confirmation proposal for ws.app.workspaces.delete(id)', async () => {
    mockSendToWorkspaceWindows.mockClear();
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      listAllWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: workspaces }),
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.delete("workspace-1")' },
      context: { agentId: 'agent-1' },
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    const proposal = proposalFromResource(result);
    expect(proposal.kind).toBe('bulk-op');
    expect(proposal.payload.operation).toBe('workspace.bulkDelete');
    expect(proposal.payload.ids).toEqual(['workspace-1']);
    expect(proposal.preview.title).toBe('Delete 1 workspace');
    expect(proposal.preview.applyLabel).toBe('Delete');
    expect(proposal.preview.warnings).toEqual([
      'Deleting workspaces is destructive. Confirm the selected workspaces before applying.',
    ]);
    expect(mockSendToWorkspaceWindows).not.toHaveBeenCalledWith(
      expect.anything(),
      'app:workspace-operation-requested',
      expect.objectContaining({ operation: 'delete' }),
    );
  });

  it('queues ws.app.workspaces.open with openInNewWindow=false by default', async () => {
    mockSendToWorkspaceWindows.mockClear();
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.open("workspace-1")' },
      context: { agentId: 'agent-1' },
    } as any);

    expect(result.isError).toBe(false);
    expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
      '__chief__',
      'app:workspace-operation-requested',
      expect.objectContaining({
        operation: 'open',
        workspaceId: 'workspace-1',
        openInNewWindow: false,
        agentId: 'agent-1',
      }),
    );
  });

  it('queues ws.app.workspaces.open with openInNewWindow=true when requested', async () => {
    mockSendToWorkspaceWindows.mockClear();
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.workspaces.open("workspace-1", { openInNewWindow: true })',
      },
      context: { agentId: 'agent-1' },
    } as any);

    expect(result.isError).toBe(false);
    expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
      '__chief__',
      'app:workspace-operation-requested',
      expect.objectContaining({
        operation: 'open',
        workspaceId: 'workspace-1',
        openInNewWindow: true,
      }),
    );
  });

  it('ignores non-true values for openInNewWindow on ws.app.workspaces.open', async () => {
    mockSendToWorkspaceWindows.mockClear();
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.workspaces.open("workspace-1", { openInNewWindow: "yes" })',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
      '__chief__',
      'app:workspace-operation-requested',
      expect.objectContaining({ operation: 'open', openInNewWindow: false }),
    );
  });

  it('returns proposal content for workspace creation instead of creating directly', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__', {
      getWorkspace: vi.fn().mockResolvedValue(workspaces[0]),
    });

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.workspaces.create({ title: "New Space" })' },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    expect(proposalFromResource(result).kind).toBe('workspace-create');
    expect(JSON.stringify(result.content)).toContain('workspace.create');
  });

  it('normalizes existing workspace-create request fields for proposal previews', () => {
    const fields = normalizeWorkspaceCreateFields({
      repositoryPath: '/repo/x',
      githubUrl: 'https://github.com/augmentcode/intent',
      branch: 'feature/x',
      clonePath: '/tmp/intent',
      isNewRepo: true,
      scope: 'src',
      initialAgent: {
        agentId: 'agent-1',
        prompt: 'Build the feature',
        specialist: 'implementor',
      },
    });

    expect(fields).toMatchObject({
      initialPrompt: 'Build the feature',
      repoPath: '/repo/x',
      repoType: 'github',
      githubUrl: 'https://github.com/augmentcode/intent',
      branch: 'feature/x',
      clonePath: '/tmp/intent',
      isNewRepo: true,
      scope: 'src',
      specialist: 'implementor',
    });
  });

  it('normalizes Chief-style workspace-create params with GitHub repository shorthand', () => {
    const fields = normalizeWorkspaceCreateFields({
      repository: 'augmentcode/intent',
      initialMessage: 'Review PR #647',
      specialist: 'implementor',
    });

    expect(fields).toMatchObject({
      initialPrompt: 'Review PR #647',
      repoType: 'github',
      githubUrl: 'https://github.com/augmentcode/intent',
      branch: 'main',
      isNewRepo: false,
      specialist: 'implementor',
    });
  });

  it('normalizes Chief-style workspace-create params with separate GitHub owner and repository name', () => {
    const fields = normalizeWorkspaceCreateFields({
      repositoryOwner: 'augmentcode',
      repositoryName: 'intent',
      initialMessage: 'Review PR #648',
      specialist: 'pr-reviewer',
    });

    expect(fields).toMatchObject({
      initialPrompt: 'Review PR #648',
      repoType: 'github',
      githubUrl: 'https://github.com/augmentcode/intent',
      branch: 'main',
      specialist: 'pr-reviewer',
    });
  });

  it('normalizes Chief-style workspace-create params with GitHub PR URL context', () => {
    const fields = normalizeWorkspaceCreateFields({
      prUrl: 'https://github.com/augmentcode/intent/pull/648',
    });

    expect(fields).toMatchObject({
      repoType: 'github',
      githubUrl: 'https://github.com/augmentcode/intent',
      prNumber: 648,
      branch: 'main',
    });
  });

  it('preserves workspace-create repository precedence across Chief key shapes', () => {
    expect(
      normalizeWorkspaceCreateFields({
        githubUrl: 'https://github.com/explicit/repo',
        repository: 'augmentcode/repository-shorthand',
        repositoryOwner: 'augmentcode',
        repositoryName: 'owner-name',
        prUrl: 'https://github.com/augmentcode/pr-url/pull/648',
      }),
    ).toMatchObject({ githubUrl: 'https://github.com/explicit/repo', prNumber: 648 });

    expect(
      normalizeWorkspaceCreateFields({
        repository: 'augmentcode/repository-shorthand',
        repositoryOwner: 'augmentcode',
        repositoryName: 'owner-name',
        prUrl: 'https://github.com/augmentcode/pr-url/pull/648',
      }),
    ).toMatchObject({ githubUrl: 'https://github.com/augmentcode/repository-shorthand' });

    expect(
      normalizeWorkspaceCreateFields({
        repositoryOwner: 'augmentcode',
        repositoryName: 'owner-name',
        prUrl: 'https://github.com/augmentcode/pr-url/pull/648',
      }),
    ).toMatchObject({ githubUrl: 'https://github.com/augmentcode/owner-name' });
  });

  it('normalizes mixed workspace-create params with local repository fallback defaults', () => {
    expect(
      normalizeWorkspaceCreateFields({
        repository: 'intent',
        prompt: 'Start here',
        baseRef: 'develop',
      }),
    ).toMatchObject({
      initialPrompt: 'Start here',
      repoPath: 'intent',
      repoType: 'local',
      branch: 'develop',
      isNewRepo: false,
    });
    expect(normalizeWorkspaceCreateFields({})).toMatchObject({
      repoType: 'local',
      branch: 'main',
      isNewRepo: false,
    });
  });

  it('accepts `initialPrompt` directly on the params (Chief-of-Staff PR-review shape)', () => {
    // Regression: callers writing `ws.app.workspaces.create({ initialPrompt })`
    // used to have the prompt dropped because the normalizer only looked at
    // `initialAgent.prompt`, `initialMessage`, and `prompt`.
    expect(
      normalizeWorkspaceCreateFields({
        initialPrompt: 'Review PR #651 end-to-end',
      }),
    ).toMatchObject({ initialPrompt: 'Review PR #651 end-to-end' });
  });

  it('parses a PR URL passed as `githubUrl` into the repo URL and PR number', () => {
    // Regression: callers commonly paste a PR URL into the `githubUrl` field.
    // Without this, the workspace would try to clone
    // `https://github.com/owner/repo/pull/651` literally.
    expect(
      normalizeWorkspaceCreateFields({
        githubUrl: 'https://github.com/augmentcode/intent/pull/651',
      }),
    ).toMatchObject({
      githubUrl: 'https://github.com/augmentcode/intent',
      prNumber: 651,
      repoType: 'github',
    });
  });

  it('defaults clonePath to repoPath when both githubUrl and repoPath are provided', () => {
    // Regression: without this default, the workspace.service create fails
    // with "A destination folder is required when cloning from a GitHub URL."
    // when callers supply a local repositoryPath alongside the GitHub URL.
    expect(
      normalizeWorkspaceCreateFields({
        repositoryPath: '/Users/me/repos/intent',
        githubUrl: 'https://github.com/augmentcode/intent',
      }),
    ).toMatchObject({
      repoPath: '/Users/me/repos/intent',
      clonePath: '/Users/me/repos/intent',
      githubUrl: 'https://github.com/augmentcode/intent',
    });
  });

  it('normalizes the full PR-review workspace shape Chief-of-Staff sends', () => {
    // Regression for the user-reported flow:
    //   ws.app.workspaces.create({
    //     title, repositoryPath, branch, githubUrl: '<pr-url>', specialist,
    //     initialPrompt,
    //   })
    // Previously: `initialPrompt` was dropped, `clonePath` was undefined
    // (causing the destination-folder error), and `githubUrl` was kept as the
    // PR URL (which would fail to clone).
    expect(
      normalizeWorkspaceCreateFields({
        title: 'Review PR #651: Chief of Staff',
        repositoryPath: '/Users/me/repos/intent',
        branch: 'add-chief-of-staff-assistant',
        githubUrl: 'https://github.com/augmentcode/intent/pull/651',
        specialist: 'pr-reviewer',
        initialPrompt: 'Review PR #651 end-to-end.',
      }),
    ).toMatchObject({
      initialPrompt: 'Review PR #651 end-to-end.',
      repoPath: '/Users/me/repos/intent',
      clonePath: '/Users/me/repos/intent',
      repoType: 'github',
      githubUrl: 'https://github.com/augmentcode/intent',
      prNumber: 651,
      branch: 'add-chief-of-staff-assistant',
      specialist: 'pr-reviewer',
    });
  });

  it('hydrates workspace-create proposal.show previews without overwriting caller fields', async () => {
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: {
          repository: 'augmentcode/intent',
          initialMessage: 'Create a workspace for Intent',
          specialist: 'implementor',
        },
      },
      preview: {
        title: 'Create Intent workspace',
        workspaceCreate: {
          repoType: 'local',
          specialist: 'reviewer',
        },
      },
    };

    const result = await buildWsAppProposalApi().show(proposal);
    const hydrated = result.proposal;

    expect(hydrated.preview.workspaceCreate).toMatchObject({
      initialPrompt: 'Create a workspace for Intent',
      repoType: 'local',
      githubUrl: 'https://github.com/augmentcode/intent',
      branch: 'main',
      specialist: 'reviewer',
    });
    expect(proposal.preview.workspaceCreate).toEqual({ repoType: 'local', specialist: 'reviewer' });
  });

  describe('lookupKnownRepoLocalPath', () => {
    const repos = [
      { path: '/Users/me/code/intent', owner: 'augmentcode', name: 'intent' },
      { path: '/Users/me/.clones/foo', owner: 'augmentcode', name: 'cached' },
      { path: '/Users/me/code/other', owner: 'someone', name: 'other' },
    ];

    it('returns the local path for a github URL whose owner/name is in the registry', () => {
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => repos),
      ).toBe('/Users/me/code/intent');
    });

    it('matches case-insensitively and ignores trailing .git', () => {
      expect(
        lookupKnownRepoLocalPath('https://github.com/AugmentCode/Intent.git', () => repos),
      ).toBe('/Users/me/code/intent');
    });

    it('skips the legacy .clones cache directory', () => {
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/cached', () => repos),
      ).toBeUndefined();
    });

    it('returns undefined for unknown repos, malformed URLs, and registry errors', () => {
      expect(
        lookupKnownRepoLocalPath('https://github.com/unknown/repo', () => repos),
      ).toBeUndefined();
      expect(lookupKnownRepoLocalPath('not a url', () => repos)).toBeUndefined();
      expect(lookupKnownRepoLocalPath(undefined, () => repos)).toBeUndefined();
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => {
          throw new Error('registry not ready');
        }),
      ).toBeUndefined();
    });

    it('falls back to a name-only match when the entry has no owner populated', () => {
      // Realistic case: many registry entries were added from local-path-only
      // workspace creates, so `owner` is undefined on disk even though the
      // local clone really is `augmentcode/intent`.
      const ownerlessRepos = [
        { path: '/Users/me/code/intent', name: 'intent' },
        { path: '/Users/me/code/other', name: 'other' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => ownerlessRepos),
      ).toBe('/Users/me/code/intent');
    });

    it('does not name-fallback when multiple ownerless entries share the same name', () => {
      // Ambiguous: two ownerless clones both named `intent` could belong to
      // different orgs, so we must not guess.
      const ambiguousRepos = [
        { path: '/Users/me/code/intent', name: 'intent' },
        { path: '/Users/me/forks/intent', name: 'intent' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => ambiguousRepos),
      ).toBeUndefined();
    });

    it('prefers a strict owner+name match over a name-only fallback', () => {
      const mixedRepos = [
        { path: '/Users/me/forks/intent', name: 'intent' },
        { path: '/Users/me/code/intent', owner: 'augmentcode', name: 'intent' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => mixedRepos),
      ).toBe('/Users/me/code/intent');
    });

    it('still falls back when other entries with different names are present', () => {
      // The unowned `intent` entry is the only ownerless name-match, so the
      // unrelated `someone/other` entry should not block it.
      const repos = [
        { path: '/Users/me/code/intent', name: 'intent' },
        { path: '/Users/me/code/other', owner: 'someone', name: 'other' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => repos),
      ).toBe('/Users/me/code/intent');
    });

    it('falls back to the path basename when the entry name is a generic placeholder', () => {
      // Workspaces created from a local path with no explicit repositoryName
      // end up with `name: 'Unknown'` in the registry, but the basename of the
      // path still reliably identifies the repo.
      const repos = [
        { path: '/Users/me/code/intent', name: 'Unknown' },
        { path: '/Users/me/code/elsewhere', name: 'Unknown' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => repos),
      ).toBe('/Users/me/code/intent');
    });

    it('does not basename-fallback when multiple ownerless paths share the same basename', () => {
      const repos = [
        { path: '/Users/me/code/intent', name: 'Unknown' },
        { path: '/Users/me/forks/intent', name: 'Unknown' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => repos),
      ).toBeUndefined();
    });

    it('prefers a name-only match over a path-basename match', () => {
      // Both kinds of fallback can hit at once; the name field is the more
      // explicit signal so it wins when present.
      const repos = [
        { path: '/Users/me/explicit-name/dir', name: 'intent' },
        { path: '/Users/me/code/intent', name: 'Unknown' },
      ];
      expect(
        lookupKnownRepoLocalPath('https://github.com/augmentcode/intent', () => repos),
      ).toBe('/Users/me/explicit-name/dir');
    });
  });

  it('hydrates a GitHub-URL proposal with the local repoPath and clonePath from the known-repos registry', async () => {
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: { repository: 'augmentcode/intent' },
      },
      preview: { title: 'Create Intent workspace' },
    };

    const result = await buildWsAppProposalApi(undefined, () => [
      { path: '/Users/me/code/intent', owner: 'augmentcode', name: 'intent' },
    ]).show(proposal);

    expect(result.proposal.preview.workspaceCreate).toMatchObject({
      githubUrl: 'https://github.com/augmentcode/intent',
      repoPath: '/Users/me/code/intent',
      clonePath: '/Users/me/code/intent',
      repoType: 'github',
    });
  });

  it('does not overwrite a caller-provided repoPath when the registry also has the repo', async () => {
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: {
          repository: 'augmentcode/intent',
          repositoryPath: '/explicit/path',
        },
      },
      preview: { title: 'Create Intent workspace' },
    };

    const result = await buildWsAppProposalApi(undefined, () => [
      { path: '/Users/me/code/intent', owner: 'augmentcode', name: 'intent' },
    ]).show(proposal);

    // Caller-provided repoPath wins over the registry match. clonePath
    // defaults to the same path so workspace.service does not reject the
    // create with "A destination folder is required when cloning from a
    // GitHub URL." The cloner reuses an existing checkout when the directory
    // already points at the same remote.
    expect(result.proposal.preview.workspaceCreate).toMatchObject({
      repoPath: '/explicit/path',
      clonePath: '/explicit/path',
    });
  });

  it('leaves repoPath and clonePath empty when the registry has no matching repo', async () => {
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: { repository: 'unknown/repo' },
      },
      preview: { title: 'Create unknown workspace' },
    };

    const result = await buildWsAppProposalApi(undefined, () => []).show(proposal);

    expect(result.proposal.preview.workspaceCreate?.repoPath).toBeUndefined();
    expect(result.proposal.preview.workspaceCreate?.clonePath).toBeUndefined();
    expect(result.proposal.preview.workspaceCreate).toMatchObject({
      githubUrl: 'https://github.com/unknown/repo',
    });
  });

  // Regression: the pre-hydration `preview.workspaceCreate` is built by
  // `createWorkspaceProposal` via `normalizeWorkspaceCreateFields`, which
  // returns explicit `undefined` for `repoPath`/`clonePath` when the caller
  // didn't supply them. A naive `{ ...hydrated, ...preview.workspaceCreate }`
  // spread silently clobbers the registry-derived paths because spreading
  // includes explicit-undefined keys. The hydrator must strip those undefineds
  // before re-spreading so the lookup result survives — otherwise the Chief's
  // PR proposal arrives at the UI without `repoPath`, the user gets "No
  // branches found", and clicking Create errors with "A destination folder is
  // required when cloning from a GitHub URL."
  it('does not let undefined keys in the pre-hydration preview clobber hydrated repoPath/clonePath', async () => {
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: {
          prUrl: 'https://github.com/augmentcode/intent/pull/652',
          repositoryOwner: 'augmentcode',
          repositoryName: 'intent',
          specialist: 'pr-reviewer',
          initialMessage: 'Review PR #652',
        },
      },
      preview: {
        title: 'Create workspace',
        workspaceCreate: {
          initialPrompt: 'Review PR #652',
          repoPath: undefined,
          clonePath: undefined,
          githubUrl: 'https://github.com/augmentcode/intent',
          repoType: 'github',
          prNumber: 652,
          branch: 'main',
          isNewRepo: false,
          specialist: 'pr-reviewer',
        },
      },
    };

    const result = await buildWsAppProposalApi(undefined, () => [
      { path: '/Users/me/code/intent', owner: 'augmentcode', name: 'intent' },
    ]).show(proposal);

    expect(result.proposal.preview.workspaceCreate).toMatchObject({
      repoPath: '/Users/me/code/intent',
      clonePath: '/Users/me/code/intent',
      githubUrl: 'https://github.com/augmentcode/intent',
      prNumber: 652,
      repoType: 'github',
      specialist: 'pr-reviewer',
    });

    // And the JSON-serialized form (what gets returned to the MCP caller)
    // must carry the path fields, not silently drop them.
    const serialized = JSON.parse(JSON.stringify(result.proposal));
    expect(serialized.preview.workspaceCreate.repoPath).toBe('/Users/me/code/intent');
    expect(serialized.preview.workspaceCreate.clonePath).toBe('/Users/me/code/intent');
  });

  it('returns MCP-valid proposal resource content for ws.app.proposal.show', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.proposal.show({ kind: "settings-change", payload: { changes: [] }, preview: { title: "Manual settings proposal" } })',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    expect(proposalFromResource(result).preview.title).toBe('Manual settings proposal');
  });

  it('executes ws.app.specialists list/get through the composed API surface', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return { list: await ws.app.specialists.list(), item: await ws.app.specialists.get("implementor") }',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('"id": "implementor"');
    expect((result.content[0] as any).text).toContain('"prompt": "Implement the assigned task."');
  });

  it('returns specialist proposals as renderable proposal content blocks', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.specialists.propose({ action: "create", name: "Review Buddy", description: "Reviews changes", model: "auggie:opus4.7", prompt: "Review carefully." })',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    const proposal = proposalFromResource(result);
    expect(proposal.kind).toBe('specialist-edit');
    expect(proposal.preview.fields.map((field: any) => field.key)).toEqual([
      'name',
      'description',
      'model',
      'prompt',
    ]);
  });

  it('lists app settings schema entries through ws.app.settings', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.settings.list({ includeValues: false })' },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;
    expect(text).toContain('"path": "theme.preference"');
    expect(text).toContain('"path": "mcp.servers"');
    expect(text).toContain('"path": "keybindings.shortcuts"');
  });

  it('gets static app setting values through ws.app.settings', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.app.settings.get("keybindings.shortcuts")' },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    const text = (result.content[0] as any).text;
    expect(text).toContain('"path": "keybindings.shortcuts"');
    expect(text).toContain('Built-in shortcuts');
  });

  it('returns settings proposals as renderable proposal content blocks', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.settings.propose([{ path: "theme.preference", value: "dark" }])',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    const proposal = proposalFromResource(result);
    expect(proposal.kind).toBe('settings-change');
    expect(proposal.preview.title).toBe('Theme preference: Dark');
    expect(proposal.preview.summary).toBe('Switch the theme preference to Dark.');
    expect(proposal.preview.applyLabel).toBe('Apply');
    expect(proposal.preview.fields[0]).toMatchObject({
      key: 'theme.preference',
      label: 'Theme preference',
      after: 'Dark',
    });
    expect(proposal.preview.diff).toBeUndefined();
    expect(proposal.preview.warnings).toBeUndefined();
  });

  it('allows nullable settings proposals and previews the null label', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.settings.propose([{ path: "theme.activePresetId", value: null }])',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expectOnlyMcpSpecValidContentItems(result);
    const proposal = proposalFromResource(result);
    expect(proposal.preview.title).toBe('Theme preset: Default');
    expect(proposal.preview.fields[0]).toMatchObject({
      key: 'theme.activePresetId',
      label: 'Theme preset',
      after: 'Default',
    });
    expect(proposal.payload.changes[0].value).toBeNull();
  });

  it('rejects null for non-nullable enum settings proposals', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.settings.propose([{ path: "theme.preference", value: null }])',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain(
      'theme.preference must be one of: light, dark, system',
    );
  });

  it('returns multi-setting proposal titles without JSON diffs or internal warnings', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', '__chief__');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.app.settings.propose([{ path: "theme.preference", value: "dark" }, { path: "theme.activePresetId", value: "dracula" }])',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    const proposal = proposalFromResource(result);
    expect(proposal.preview.title).toBe('Update 2 settings');
    expect(proposal.preview.summary).toBe('Theme preference, Theme preset');
    expect(proposal.preview.diff).toBeUndefined();
    expect(proposal.preview.warnings).toBeUndefined();
  });

  it('documents Promise.allSettled as an option', () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');
    const definition = tool.getDefinition();

    expect(definition.description).toContain('Promise.allSettled');
  });

  it('returns a clear error for syntax errors in user code', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'const x = {' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('SyntaxError');
    expect(text).toContain('unclosed');
  });

  it('returns a clear error when accessing a non-existent namespace', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.database.query("SELECT 1")' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('query');
    expect(text).toContain('undefined');
  });

  it('returns a clear error for undefined variable references', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return foo + bar' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('foo is not defined');
  });
});
