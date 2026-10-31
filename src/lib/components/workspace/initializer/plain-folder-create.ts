/**
 * Plain-folder (git-optional) workspace creation, Labs (PROTOCOL §5.1
 * "Plain-folder workspaces"). Pure rules shared by the New Workspace dialog
 * and the onboarding project step: the "Initialize as git repository" toggle
 * default, the remembered choice, and the `workspace.create` request shape.
 */
import type { CreateWorkspaceRequest, Workspace } from '$shared/types';
import { protocolVersionAtLeast, type ProtocolVersion } from '$shared/protocol-version';

/** First daemon protocol that accepts `workspace.create { plainFolder: true }`. */
const PLAIN_FOLDER_MIN_PROTOCOL = { major: 15, minor: 3 } as const;

/** Remembered last explicit toggle choice (`true` = initialize as git). */
export const INITIALIZE_GIT_CHOICE_STORAGE_KEY = 'workspace-create:initializeGit';

/** Default parent for a new plain folder; suits non-developers better than ~/Developer. */
const PLAIN_FOLDER_DEFAULT_PARENT = '~/Documents'; // i18n-ignore (filesystem path)

/** Git default parent the onboarding "New project" tab falls back to today. */
const GIT_PROJECT_DEFAULT_PARENT = '~/Developer'; // i18n-ignore (filesystem path)

/** A daemon without `workspace.create` `plainFolder` would ignore the option and fall back to a legacy non-git create. */
export function supportsPlainFolderCreate(version: ProtocolVersion | null | undefined): boolean {
  return protocolVersionAtLeast(
    version,
    PLAIN_FOLDER_MIN_PROTOCOL.major,
    PLAIN_FOLDER_MIN_PROTOCOL.minor,
  );
}

/** Any existing workspace that is not a plain folder counts as a git workspace. */
export function hasGitWorkspace(workspaces: readonly Pick<Workspace, 'plainFolder'>[]): boolean {
  return workspaces.some((workspace) => workspace.plainFolder !== true);
}

export interface InitializeGitDefaultInput {
  /** Last explicit toggle choice, or null when the user never chose. */
  rememberedChoice: boolean | null;
  /** The workspace list has loaded, so `hasGitWorkspace` is trustworthy. */
  workspacesLoaded: boolean;
  hasGitWorkspace: boolean;
  /** Daemon-resolved GitHub auth (secrets store, GITHUB_TOKEN/GH_TOKEN or `gh` login). */
  githubConnected: boolean;
  /** A GitHub status read has completed (success or failure). */
  githubSettled: boolean;
  /** The GitHub status read failed, so the connection is unknown. */
  githubFailed: boolean;
  gitlabConnected: boolean;
  gitlabSettled: boolean;
  gitlabFailed: boolean;
}

/**
 * Toggle default, or `null` while it cannot be decided yet (the toggle stays
 * hidden and the create behaves as today). Callers latch the first non-null
 * value so the toggle never flips while visible.
 *
 * Order: remembered choice; on for any git workspace or connected forge, and
 * on when a forge status read failed (upgrade safety — existing users never
 * silently flip to plain folders); otherwise off, but only once both forge
 * statuses and the workspace list have loaded. There is no timeout: a slow
 * status read keeps the toggle hidden until it settles.
 */
export function resolveInitializeGitDefault(input: InitializeGitDefaultInput): boolean | null {
  if (input.rememberedChoice !== null) return input.rememberedChoice;
  if (input.hasGitWorkspace || input.githubConnected || input.gitlabConnected) return true;
  if (input.githubFailed || input.gitlabFailed) return true;
  if (!input.workspacesLoaded || !input.githubSettled || !input.gitlabSettled) return null;
  return false;
}

export function readRememberedInitializeGit(
  storage: Pick<Storage, 'getItem'> | null,
): boolean | null {
  try {
    const raw = storage?.getItem(INITIALIZE_GIT_CHOICE_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Storage unavailable — no remembered choice.
  }
  return null;
}

export function writeRememberedInitializeGit(
  storage: Pick<Storage, 'setItem'> | null,
  value: boolean,
): void {
  try {
    storage?.setItem(INITIALIZE_GIT_CHOICE_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable — the choice is not remembered.
  }
}

/**
 * Default parent for a new project. A user-chosen parent is kept; the
 * built-in git fallback (`~/Developer`, also the store default) becomes
 * `~/Documents` for a plain folder.
 */
export function newProjectDefaultParent(
  savedParent: string | null | undefined,
  plain: boolean,
): string {
  if (savedParent && savedParent !== GIT_PROJECT_DEFAULT_PARENT) return savedParent;
  return plain ? PLAIN_FOLDER_DEFAULT_PARENT : GIT_PROJECT_DEFAULT_PARENT;
}

/** Paths compare without trailing separators. */
function samePath(a: string, b: string): boolean {
  const trim = (path: string) => path.replace(/[\\/]+$/, '');
  return trim(a) === trim(b);
}

/** Other workspaces already working in this folder (warned about, not blocked). */
export function workspacesUsingFolder<
  T extends Pick<Workspace, 'repositoryPath' | 'worktreePath' | 'path'>,
>(workspaces: readonly T[], folder: string): T[] {
  if (!folder) return [];
  return workspaces.filter((workspace) =>
    [workspace.repositoryPath, workspace.worktreePath, workspace.path].some(
      (path) => typeof path === 'string' && path.length > 0 && samePath(path, folder),
    ),
  );
}

export type PlainFolderCreateBase = Pick<
  CreateWorkspaceRequest,
  'title' | 'initialAgent' | 'contextLinks' | 'linearIssue' | 'sentryIssue'
> & { repositoryPath: string };

/**
 * `workspace.create` for a plain folder. Only the allowed fields are copied:
 * git-only options (`githubUrl`, `repositoryCheckout`, `clonePath`,
 * `isNewRepo`, `baseRef`, `branch`, `worktreePath`, `isRemote`), setup
 * scripts, scope and pr-kind context links are never sent.
 */
export function buildPlainFolderCreateRequest(base: PlainFolderCreateBase): CreateWorkspaceRequest {
  const contextLinks = base.contextLinks?.filter((link) => link.kind !== 'pr');
  return {
    title: base.title ?? '',
    repositoryPath: base.repositoryPath,
    plainFolder: true,
    ...(contextLinks && contextLinks.length > 0 ? { contextLinks } : {}),
    ...(base.linearIssue ? { linearIssue: base.linearIssue } : {}),
    ...(base.sentryIssue ? { sentryIssue: base.sentryIssue } : {}),
    ...(base.initialAgent ? { initialAgent: base.initialAgent } : {}),
  };
}

export interface PlainFolderTargetStatus {
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  isSubdirectoryOfGitRepo?: boolean;
}

/**
 * Plain-folder kind for a create target with "Initialize as git repository"
 * off, or null to keep today's git flow. A missing target reports no
 * repository, so `parentInGitRepo` (null while unknown) decides whether the
 * new folder would sit inside one — the daemon would reject that plain create.
 */
export function classifyPlainFolderTarget(
  status: PlainFolderTargetStatus | null | undefined,
  parentInGitRepo: boolean | null,
): 'existing' | 'new' | null {
  if (!status || status.isGitRepo || status.isSubdirectoryOfGitRepo) return null;
  if (!status.exists) return parentInGitRepo === false ? 'new' : null;
  return status.isDirectory ? 'existing' : null;
}
