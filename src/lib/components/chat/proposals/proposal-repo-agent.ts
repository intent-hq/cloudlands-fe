import { resolveSubmitModelAndProvider } from '$lib/utils/effective-model-resolution';
import { agentSettingsRepoKey } from '$store/renderer/slices/workspace-initializer/utils/agent-settings-repo-key';
import type { WorkspaceInitializerAgentSettings } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

/** Repository a workspace suggestion card would create in. */
export interface ProposalRepoIdentity {
  repoType?: 'local' | 'github' | 'remote';
  repoPath?: string;
  clonePath?: string;
  githubUrl?: string;
}

/**
 * Keys under which New Workspace may have remembered an agent setup for the
 * card's repository, most specific first: the local checkout path (how a
 * workspace created from a local folder was remembered), then the GitHub repo.
 */
export function proposalRepoKeys(repo: ProposalRepoIdentity): string[] {
  const keys: string[] = [];
  const localPath = repo.clonePath || (repo.repoType === 'github' ? '' : repo.repoPath);
  if (repo.repoType !== 'remote' && localPath) {
    const key = agentSettingsRepoKey({ type: 'local', path: localPath });
    if (key) keys.push(key);
  }
  if (repo.githubUrl) {
    const key = agentSettingsRepoKey({ type: 'github', githubUrl: repo.githubUrl });
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export interface ProposalRepoAgentDefault {
  /** The initial agent to preselect (`null` = General). */
  specialist: string | null;
  settings: WorkspaceInitializerAgentSettings;
}

/**
 * The agent setup remembered for the card's repository, as the specialist to
 * preselect. Keys are tried in order, skipping a setup whose agent is no longer
 * available; `null` keeps the global New Workspace default.
 */
export function resolveProposalRepoAgentDefault({
  repoKeys,
  agentByRepo,
  specialists,
  orchestratorId,
}: {
  repoKeys: readonly string[];
  agentByRepo: Readonly<Record<string, WorkspaceInitializerAgentSettings>>;
  specialists: ReadonlyArray<{ id: string }>;
  orchestratorId: string | null;
}): ProposalRepoAgentDefault | null {
  for (const key of repoKeys) {
    const settings = agentByRepo[key];
    if (!settings) continue;
    if (settings.isTeamMode) {
      if (orchestratorId) return { specialist: orchestratorId, settings };
      continue;
    }
    const specialist = settings.selectedSpecialist ?? null;
    if (specialist === null || specialists.some((s) => s.id === specialist)) {
      return { specialist, settings };
    }
  }
  return null;
}

/** Initial-agent fields a remembered setup contributes, matching New Workspace's submit. */
export interface ProposalAgentSetup {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

export function proposalAgentSetup(
  settings: WorkspaceInitializerAgentSettings,
): ProposalAgentSetup {
  const setup: ProposalAgentSetup = {};
  const explicitModel =
    settings.modelWasOverridden && settings.selectedModel ? settings.selectedModel : undefined;
  if (settings.selectedProvider || explicitModel) {
    const { model, provider } = resolveSubmitModelAndProvider(
      explicitModel,
      settings.selectedProvider ?? '',
    );
    if (provider) setup.provider = provider;
    if (model) setup.model = model;
  }
  if (settings.selectedReasoningEffort !== undefined) {
    setup.reasoningEffort = settings.selectedReasoningEffort;
  }
  return setup;
}

/** Whether a remembered setup names a provider, a model, or a non-empty effort. */
export function hasAgentSetupFields(setup: ProposalAgentSetup): boolean {
  return Boolean(setup.provider || setup.model || setup.reasoningEffort);
}
