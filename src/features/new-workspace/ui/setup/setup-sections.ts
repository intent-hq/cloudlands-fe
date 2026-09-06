import type { DraftInput } from '../../controller';
import {
  getLastUsedSetupScript,
  getTemplateContent,
  SETUP_SCRIPT_TEMPLATES,
} from '$features/setup-scripts';
import type { ContextLink, DraftSource, WorkspaceDraftConfig } from '$shared/types';
import type { WorkspaceCreationRemoteSetup } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-types';

interface IssueSelection {
  identifier: string;
  url?: string;
}

export type ReadinessState = 'checking' | 'ready' | 'attention';

export interface WorkspaceOptionDefaults {
  setupScript?: string;
  specialist?: string | null;
  provider?: string;
}

export function sourceRepoKey(source: DraftSource): string {
  if (source.kind === 'github') return `${source.owner}/${source.name}`;
  if (source.kind === 'newFolder') return `${source.parentPath}/${source.name}`;
  return source.path;
}

export function sourceWithBranch(source: DraftSource, branch: string): DraftSource {
  if (source.kind === 'newFolder') return source;
  return { ...source, branch: branch || undefined };
}

export function sourceWithIsolation(
  source: DraftSource,
  isolation: 'worktree' | 'in-place',
): DraftSource {
  return source.kind === 'local' ? { ...source, isolation } : source;
}

export function configWith<K extends keyof WorkspaceDraftConfig>(
  config: WorkspaceDraftConfig,
  key: K,
  value: WorkspaceDraftConfig[K],
): WorkspaceDraftConfig {
  if (value !== undefined && value !== null && value !== '') return { ...config, [key]: value };
  const next = { ...config };
  delete next[key];
  return next;
}

export function issueSelectionPatch(
  input: Pick<DraftInput, 'intentText' | 'contextLinks'>,
  text: string,
  selection: IssueSelection,
): Pick<DraftInput, 'intentText' | 'contextLinks'> | null {
  if (!selection.url) return null;
  const match = selection.identifier.match(/^([^/]+)\/([^#]+)#([0-9]+)$/);
  if (!match) return null;
  const [, owner, repo, number] = match;
  const link: ContextLink = {
    kind: /\/pull\/[0-9]+(?:$|[?#])/.test(selection.url) ? 'pr' : 'issue',
    url: selection.url,
    owner,
    repo,
    number: Number(number),
  };
  const contextLinks = input.contextLinks.some(
    (item) => item.owner === owner && item.repo === repo && item.number === link.number,
  )
    ? input.contextLinks
    : [...input.contextLinks, link];
  return {
    contextLinks,
    intentText: input.intentText.trim() ? input.intentText : text,
  };
}

export function readinessState(
  capabilities: Record<'provider' | 'git' | 'node' | 'github', string>,
): ReadinessState {
  if (Object.values(capabilities).includes('missing')) return 'attention';
  if (capabilities.provider === 'ready') return 'ready';
  return 'checking';
}

export function hasModifiedOptions(
  source: DraftSource | null,
  config: WorkspaceDraftConfig,
  defaults: WorkspaceOptionDefaults = {},
): boolean {
  const setupScriptModified = Boolean(
    config.setupScript && config.setupScript.trim() !== defaults.setupScript?.trim(),
  );
  return (
    (source?.kind === 'local' && source.isolation === 'in-place') ||
    config.isTeamMode === false ||
    (config.specialist !== undefined && config.specialist !== defaults.specialist) ||
    (config.provider !== undefined && config.provider !== defaults.provider) ||
    Boolean(config.model) ||
    Boolean(config.reasoningEffort) ||
    setupScriptModified ||
    Boolean(config.isRemote) ||
    Boolean(config.remoteSetup)
  );
}

export function defaultSetupScriptForSource(source: DraftSource): string | undefined {
  const lastUsed = getLastUsedSetupScript(
    sourceRepoKey(source),
    source.kind === 'github' ? source.url : null,
  );
  const genericTemplate = SETUP_SCRIPT_TEMPLATES.find((template) => template.id === 'generic');
  return lastUsed?.content ?? (genericTemplate ? getTemplateContent(genericTemplate) : undefined);
}

export function isRemoteSetup(value: unknown): value is WorkspaceCreationRemoteSetup {
  if (!value || typeof value !== 'object') return false;
  const setup = value as Partial<WorkspaceCreationRemoteSetup>;
  return typeof setup.id === 'string' && typeof setup.name === 'string';
}
