import { sendToWorkspaceWindows } from '$features/system/main/system.ipc';
import { Logger } from '$shared/logger';
import {
  APP_WORKSPACE_OPERATION_CHANNEL,
  type AppWorkspaceOperationRequest,
} from '$shared/app-workspace-operations';
import type { CreateWorkspaceRequest, Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type {
  BulkOperationProposal,
  Proposal,
  WorkspaceCreateProposal,
  WorkspaceCreateProposalFields,
} from '$shared/types/proposal';
import type { ToolCall } from './protocol';
import {
  emitProposalToChat,
  proposalToolResult,
  type ProposalEmitResult,
} from './ws-app-proposal-content';
import { getAllRepos } from '$features/workspace/main/repo-registry';

const logger = new Logger('WsAppWorkspacesApi');

type WorkspaceListFilter = {
  query?: string;
  search?: string;
  status?: string | string[];
  repositoryPath?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  tag?: string;
  tags?: string[];
  includeDeleted?: boolean;
};

type WorkspaceListSort =
  | string
  | {
      by?: 'title' | 'createdAt' | 'updatedAt' | 'lastActivity' | 'status' | 'repositoryName';
      order?: 'asc' | 'desc';
    };

interface WorkspaceManagerLike {
  listAllWorkspaces?(options?: {
    lite?: boolean;
  }): Promise<{ ok: boolean; data?: Workspace[]; error?: string }>;
  listWorkspaces?(): Promise<{ ok: boolean; data?: Workspace[]; error?: string }>;
  getWorkspace(id: string): Promise<Workspace | null>;
}

function requireWorkspaceManager(workspaceManager?: WorkspaceManagerLike): WorkspaceManagerLike {
  if (!workspaceManager) throw new Error('Workspace manager not available');
  return workspaceManager;
}

function summarizeWorkspace(workspace: Workspace) {
  return {
    id: workspace.id,
    title: workspace.title || 'Untitled',
    status: workspace.status,
    statusMessage: workspace.statusMessage,
    branch: workspace.branch,
    baseRef: workspace.baseRef,
    repositoryPath: workspace.repositoryPath,
    repositoryOwner: workspace.repositoryOwner,
    repositoryName: workspace.repositoryName,
    worktreePath: workspace.worktreePath,
    tags: workspace.tags ?? [],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lastActivity: workspace.lastActivity,
  };
}

async function listAllWorkspaces(manager: WorkspaceManagerLike): Promise<Workspace[]> {
  const result = manager.listAllWorkspaces
    ? await manager.listAllWorkspaces({ lite: true })
    : await manager.listWorkspaces?.();

  if (!result?.ok) throw new Error(result?.error || 'Failed to list workspaces');
  return Array.isArray(result.data) ? result.data : [];
}

function matchesFilter(workspace: Workspace, filter: WorkspaceListFilter = {}) {
  if (workspace.id === CHIEF_WORKSPACE_ID) return false;
  const status = String(workspace.status || '').toLowerCase();
  const requestedStatuses = Array.isArray(filter.status)
    ? filter.status
    : filter.status
      ? [filter.status]
      : [];

  if (!filter.includeDeleted && status === 'deleted' && requestedStatuses.length === 0)
    return false;
  if (
    requestedStatuses.length > 0 &&
    !requestedStatuses.map((s) => s.toLowerCase()).includes(status)
  )
    return false;
  if (filter.repositoryPath && workspace.repositoryPath !== filter.repositoryPath) return false;
  if (filter.repositoryOwner && workspace.repositoryOwner !== filter.repositoryOwner) return false;
  if (filter.repositoryName && workspace.repositoryName !== filter.repositoryName) return false;
  if (filter.tag && !(workspace.tags ?? []).includes(filter.tag)) return false;
  if (filter.tags?.length && !filter.tags.every((tag) => (workspace.tags ?? []).includes(tag)))
    return false;

  const query = (filter.query || filter.search || '').trim().toLowerCase();
  if (!query) return true;

  return [
    workspace.id,
    workspace.title,
    workspace.statusMessage,
    workspace.branch,
    workspace.repositoryPath,
    workspace.repositoryOwner,
    workspace.repositoryName,
  ].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(query),
  );
}

function sortWorkspaces(workspaces: Workspace[], sort?: WorkspaceListSort) {
  const by = typeof sort === 'string' ? sort.replace(/^-/, '') : (sort?.by ?? 'updatedAt');
  const order =
    typeof sort === 'string' && sort.startsWith('-')
      ? 'desc'
      : ((typeof sort === 'object' ? sort.order : undefined) ?? 'desc');
  const direction = order === 'asc' ? 1 : -1;

  return [...workspaces].sort((a, b) => {
    const left = String((a as any)[by] ?? '').toLowerCase();
    const right = String((b as any)[by] ?? '').toLowerCase();
    return left.localeCompare(right) * direction;
  });
}

function assertMutableWorkspaceId(id: string) {
  if (!id) throw new Error('workspace id is required');
  if (id === CHIEF_WORKSPACE_ID) throw new Error('The Chief virtual workspace cannot be modified');
}

function emitWorkspaceOperation(call: ToolCall, request: AppWorkspaceOperationRequest) {
  sendToWorkspaceWindows(CHIEF_WORKSPACE_ID, APP_WORKSPACE_OPERATION_CHANNEL, {
    ...request,
    agentId: call.context?.agentId,
    requestedAt: new Date().toISOString(),
  });
  return { ok: true, queued: true, operation: request.operation };
}

type ProposalEmitContext = {
  workspaceId: string;
  call: ToolCall;
};

function emitProposalForCall(
  context: ProposalEmitContext | undefined,
  proposal: Proposal,
): ProposalEmitResult {
  if (context) {
    return emitProposalToChat(context.workspaceId, context.call.context?.agentId, proposal);
  }
  return { ok: true };
}

function workspaceCreatePayloadParams(params: CreateWorkspaceRequest): CreateWorkspaceRequest {
  const payloadParams = { ...params };
  delete payloadParams.title;
  delete payloadParams.statusMessage;
  return payloadParams;
}

const GITHUB_OWNER_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function repositoryToGithubUrl(repository: string): string | undefined {
  const trimmed = repository.trim().replace(/\.git$/, '');
  if (GITHUB_OWNER_REPO_PATTERN.test(trimmed)) return `https://github.com/${trimmed}`;

  if (/^https?:\/\/github\.com\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const [owner, repo] = url.pathname.split('/').filter(Boolean);
      if (owner && repo) return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
    } catch {
      return undefined;
    }
  }

  if (/^git@github\.com:/i.test(trimmed)) {
    const [owner, repo] = trimmed.replace(/^git@github\.com:/i, '').split('/');
    if (owner && repo) return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
  }

  return undefined;
}

function repositoryToLocalPath(repository: string): string | undefined {
  const trimmed = repository.trim();
  if (!trimmed) return undefined;
  if (/^(~|\.\/|\/|[a-zA-Z]:[\\/])/.test(trimmed)) return trimmed;
  if (!trimmed.includes('/')) return trimmed;
  return undefined;
}

function repositoryOwnerNameToGithubUrl(owner?: string, name?: string): string | undefined {
  if (!owner || !name) return undefined;
  return `https://github.com/${owner}/${name.replace(/\.git$/, '')}`;
}

function parseGithubPrUrl(prUrl?: string):
  | {
      githubUrl: string;
      prNumber: number;
    }
  | undefined {
  if (!prUrl) return undefined;
  try {
    const url = new URL(prUrl.trim());
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return undefined;
    const [owner, repo, segment, number] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo || segment !== 'pull') return undefined;
    const prNumber = Number(number);
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0) return undefined;
    return { githubUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`, prNumber };
  } catch {
    return undefined;
  }
}

export function normalizeWorkspaceCreateFields(
  params: Record<string, unknown>,
): WorkspaceCreateProposalFields {
  const initialAgent = recordValue(params.initialAgent);
  const repository = stringValue(params.repository);
  const ownerNameGithubUrl = repositoryOwnerNameToGithubUrl(
    stringValue(params.repositoryOwner),
    stringValue(params.repositoryName),
  );
  // Callers commonly pass a PR URL directly as `githubUrl` (e.g. when proposing
  // a PR-review workspace). Strip the `/pull/<n>` suffix down to the repo URL
  // so the cloner doesn't try to fetch a non-existent ref like
  // `https://github.com/owner/repo/pull/123`.
  const githubUrlPr = parseGithubPrUrl(stringValue(params.githubUrl));
  const prUrlPr = parseGithubPrUrl(stringValue(params.prUrl));
  const parsedPr = githubUrlPr ?? prUrlPr;
  const githubUrl =
    githubUrlPr?.githubUrl ??
    stringValue(params.githubUrl) ??
    (repository ? repositoryToGithubUrl(repository) : undefined) ??
    ownerNameGithubUrl ??
    prUrlPr?.githubUrl;
  const repoPath =
    stringValue(params.repositoryPath) ??
    stringValue(params.repoPath) ??
    (repository && !githubUrl ? repositoryToLocalPath(repository) : undefined);

  return {
    initialPrompt:
      stringValue(initialAgent?.prompt) ??
      stringValue(params.initialMessage) ??
      stringValue(params.initialPrompt) ??
      stringValue(params.prompt),
    repoPath,
    repoType: githubUrl ? 'github' : params.environmentConfig ? 'remote' : 'local',
    githubUrl,
    prNumber: parsedPr?.prNumber,
    // workspace.service requires `clonePath` whenever `githubUrl` is set; the
    // cloner reuses an existing checkout when the directory already points at
    // the same remote, so falling back to `repoPath` matches what the
    // CompactWorkspaceInitializer flow does and lets MCP callers omit
    // `clonePath` when they only know the local repo path.
    clonePath:
      stringValue(params.clonePath) ?? (githubUrl && repoPath ? repoPath : undefined),
    branch: stringValue(params.branch) ?? stringValue(params.baseRef) ?? 'main',
    isNewRepo: typeof params.isNewRepo === 'boolean' ? params.isNewRepo : false,
    scope: stringValue(params.scope),
    specialist: stringValue(initialAgent?.specialist) ?? stringValue(params.specialist),
  };
}

function workspaceCreateParamsFromProposal(
  proposal: WorkspaceCreateProposal,
): Record<string, unknown> {
  const payloadParams = recordValue(proposal.payload.params);
  return payloadParams ?? proposal.payload;
}

type KnownRepoEntry = { path: string; owner?: string; name?: string };
export type KnownReposProvider = () => KnownRepoEntry[];

function parseGithubOwnerRepo(
  githubUrl: string | undefined,
): { owner: string; repo: string } | undefined {
  if (!githubUrl) return undefined;
  const stripped = githubUrl
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '');
  const [owner, repo] = stripped.split('/').filter(Boolean);
  if (!owner || !repo) return undefined;
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
}

function pathBasename(p: string): string {
  // Strip trailing slashes, then take the segment after the last `/`. Handles
  // both POSIX and Windows separators so it stays portable regardless of how
  // the registry stored the path.
  const cleaned = p.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

// Resolve a GitHub URL to a locally-cloned repository path by consulting the
// persistent known-repos registry. We skip the legacy `.clones/` cache so we
// only return user-visible local checkouts — matching what RepoSelector and
// LocalRepoTab surface in the regular new-workspace flow.
//
// Matching strategy (registry entries are heterogeneous: many were added from
// local-path workspace creates and have `owner` undefined or `name` set to a
// path-derived fallback like the folder name or `Unknown`):
//   1. Strict: `owner` + `name` both match — unambiguous, preferred.
//   2. Name-only: exactly one ownerless entry whose `name` matches the repo.
//   3. Path-basename: exactly one ownerless entry whose folder name matches
//      the repo — covers the case where `name` was set to `Unknown` or the
//      user-provided title diverged from the actual clone directory.
export function lookupKnownRepoLocalPath(
  githubUrl: string | undefined,
  knownRepos: KnownReposProvider = getAllRepos,
): string | undefined {
  const ownerRepo = parseGithubOwnerRepo(githubUrl);
  if (!ownerRepo) return undefined;
  let entries: KnownRepoEntry[];
  try {
    entries = knownRepos();
  } catch (err) {
    logger.info('lookupKnownRepoLocalPath: registry read failed', { err: String(err) });
    return undefined;
  }
  const nameMatches: KnownRepoEntry[] = [];
  const basenameMatches: KnownRepoEntry[] = [];
  for (const entry of entries) {
    if (!entry?.path || entry.path.includes('/.clones/')) continue;
    const entryOwner = entry.owner?.toLowerCase();
    const entryName = entry.name?.toLowerCase().replace(/\.git$/, '');
    const entryBasename = pathBasename(entry.path).toLowerCase().replace(/\.git$/, '');
    if (entryName === ownerRepo.repo) {
      if (entryOwner === ownerRepo.owner) return entry.path;
      if (!entryOwner) nameMatches.push(entry);
    } else if (entryBasename === ownerRepo.repo && !entryOwner) {
      basenameMatches.push(entry);
    }
  }
  if (nameMatches.length === 1) {
    logger.info('lookupKnownRepoLocalPath: matched by name (ownerless entry)', {
      githubUrl,
      path: nameMatches[0].path,
    });
    return nameMatches[0].path;
  }
  if (basenameMatches.length === 1) {
    logger.info('lookupKnownRepoLocalPath: matched by path basename (ownerless entry)', {
      githubUrl,
      path: basenameMatches[0].path,
    });
    return basenameMatches[0].path;
  }
  logger.info('lookupKnownRepoLocalPath: no unambiguous match', {
    githubUrl,
    entryCount: entries.length,
    nameMatchCount: nameMatches.length,
    basenameMatchCount: basenameMatches.length,
    sample: entries.slice(0, 5).map((e) => ({
      path: e?.path,
      name: e?.name,
      owner: e?.owner,
    })),
  });
  return undefined;
}

function hydrateWorkspaceCreateProposal(
  proposal: Proposal,
  knownRepos: KnownReposProvider = getAllRepos,
): Proposal {
  if (proposal.kind !== 'workspace-create') return proposal;
  const hydrated = normalizeWorkspaceCreateFields(workspaceCreateParamsFromProposal(proposal));

  // When the Chief sends only a GitHub URL for a repo the user has already
  // cloned, fill in both repoPath and clonePath from the known-repos registry.
  // workspace.service requires `clonePath` whenever `githubUrl` is set, and
  // gracefully reuses an existing checkout when clonePath matches the remote —
  // so this lets the user click Create without manually entering a destination.
  if (hydrated.githubUrl && !hydrated.repoPath) {
    const localPath = lookupKnownRepoLocalPath(hydrated.githubUrl, knownRepos);
    if (localPath) {
      hydrated.repoPath = localPath;
      if (!hydrated.clonePath) hydrated.clonePath = localPath;
    }
  }

  // Layer the caller's pre-hydration preview on top of `hydrated`, but only for
  // keys whose value is defined. `normalizeWorkspaceCreateFields` returns
  // explicit `undefined` values for optional path fields (shorthand
  // `{ repoPath }`, `clonePath: stringValue(params.clonePath)`), so a naive
  // spread of the original preview would clobber the registry-derived
  // `repoPath`/`clonePath` we just injected — the keys would silently drop out
  // of the JSON-serialized proposal payload. Stripping undefined preserves
  // explicit caller overrides (e.g. `repoType: 'local'`) without erasing
  // hydration results.
  return {
    ...proposal,
    preview: {
      ...proposal.preview,
      workspaceCreate: {
        ...hydrated,
        ...omitUndefined(proposal.preview.workspaceCreate ?? {}),
      },
    },
  };
}

function omitUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const value = obj[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function buildWsAppProposalApi(
  context?: ProposalEmitContext,
  knownRepos: KnownReposProvider = getAllRepos,
) {
  return {
    async show(proposal: Proposal) {
      if (!proposal?.kind || !proposal.preview?.title || !proposal.payload) {
        throw new Error('proposal with kind, payload, and preview.title is required');
      }
      const normalizedProposal = hydrateWorkspaceCreateProposal(proposal, knownRepos);
      const emitResult = emitProposalForCall(context, normalizedProposal);
      if (!emitResult.ok) {
        throw new Error(`Failed to emit proposal to chat: ${emitResult.error}`);
      }
      return proposalToolResult(normalizedProposal);
    },
  };
}

function createWorkspaceProposal(params: CreateWorkspaceRequest): WorkspaceCreateProposal {
  const payloadParams = workspaceCreatePayloadParams(params);
  const workspaceCreate = normalizeWorkspaceCreateFields(params as Record<string, unknown>);

  return {
    kind: 'workspace-create',
    payload: { operation: 'workspace.create', params: payloadParams as Record<string, unknown> },
    preview: {
      title: `Create workspace${params.title ? `: ${params.title}` : ''}`,
      summary: 'Review and adjust workspace creation details before creating a new space.',
      workspaceCreate,
    },
  };
}

function bulkWorkspaceProposal(
  operation: 'workspace.bulkArchive' | 'workspace.bulkDelete',
  workspaces: Workspace[],
  ids: string[],
): BulkOperationProposal {
  const isDelete = operation === 'workspace.bulkDelete';
  const verb = isDelete ? 'Delete' : 'Archive';
  return {
    kind: 'bulk-op',
    payload: { operation, ids },
    preview: {
      title: `${verb} ${ids.length} workspace${ids.length === 1 ? '' : 's'}`,
      summary: isDelete
        ? 'Review the selected workspaces before deleting them.'
        : 'Review the selected workspaces before archiving them.',
      applyLabel: verb,
      bulkItems: ids.map((id) => {
        const workspace = workspaces.find((item) => item.id === id);
        return {
          id,
          title: workspace?.title || id,
          summary: workspace?.repositoryName || workspace?.repositoryPath || workspace?.status,
          selected: true,
          metadata: workspace ? summarizeWorkspace(workspace) : undefined,
        };
      }),
      warnings: isDelete
        ? ['Deleting workspaces is destructive. Confirm the selected workspaces before applying.']
        : undefined,
    },
  };
}

export function buildWsAppWorkspacesApi(
  workspaceManager: WorkspaceManagerLike | undefined,
  call: ToolCall,
  workspaceId: string,
  knownRepos: KnownReposProvider = getAllRepos,
) {
  const proposal = buildWsAppProposalApi({ workspaceId, call }, knownRepos);

  return {
    async list(options: { filter?: WorkspaceListFilter; sort?: WorkspaceListSort } = {}) {
      logger.debug('ws.app.workspaces.list');
      const workspaces = await listAllWorkspaces(requireWorkspaceManager(workspaceManager));
      return sortWorkspaces(
        workspaces.filter((workspace) => matchesFilter(workspace, options.filter)),
        options.sort,
      ).map(summarizeWorkspace);
    },

    async get(id: string) {
      logger.debug('ws.app.workspaces.get', { id });
      const workspace = await requireWorkspaceManager(workspaceManager).getWorkspace(id);
      if (!workspace || workspace.id === CHIEF_WORKSPACE_ID)
        throw new Error(`Workspace not found: ${id}`);
      return summarizeWorkspace(workspace);
    },

    async archive(id: string) {
      logger.info('ws.app.workspaces.archive proposal', { id });
      assertMutableWorkspaceId(id);
      const workspaces = await listAllWorkspaces(requireWorkspaceManager(workspaceManager));
      return proposal.show(bulkWorkspaceProposal('workspace.bulkArchive', workspaces, [id]));
    },

    async delete(id: string) {
      logger.info('ws.app.workspaces.delete proposal', { id });
      assertMutableWorkspaceId(id);
      const workspaces = await listAllWorkspaces(requireWorkspaceManager(workspaceManager));
      return proposal.show(bulkWorkspaceProposal('workspace.bulkDelete', workspaces, [id]));
    },

    async open(id: string, options?: { openInNewWindow?: boolean }) {
      const openInNewWindow = options?.openInNewWindow === true;
      logger.info('ws.app.workspaces.open', { id, openInNewWindow });
      assertMutableWorkspaceId(id);
      return emitWorkspaceOperation(call, {
        operation: 'open',
        workspaceId: id,
        openInNewWindow,
      });
    },

    async create(params: CreateWorkspaceRequest) {
      logger.info('ws.app.workspaces.create proposal');
      return proposal.show(createWorkspaceProposal(params || {}));
    },

    async bulkArchive(ids: string[]) {
      logger.info('ws.app.workspaces.bulkArchive proposal', {
        count: Array.isArray(ids) ? ids.length : 0,
      });
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids must be a non-empty array');
      ids.forEach(assertMutableWorkspaceId);
      const workspaces = await listAllWorkspaces(requireWorkspaceManager(workspaceManager));
      return proposal.show(bulkWorkspaceProposal('workspace.bulkArchive', workspaces, ids));
    },

    async bulkDelete(ids: string[]) {
      logger.info('ws.app.workspaces.bulkDelete proposal', {
        count: Array.isArray(ids) ? ids.length : 0,
      });
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids must be a non-empty array');
      ids.forEach(assertMutableWorkspaceId);
      const workspaces = await listAllWorkspaces(requireWorkspaceManager(workspaceManager));
      return proposal.show(bulkWorkspaceProposal('workspace.bulkDelete', workspaces, ids));
    },
  };
}
