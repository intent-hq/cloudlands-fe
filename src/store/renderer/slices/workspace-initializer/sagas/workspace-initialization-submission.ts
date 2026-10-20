import { call, put, type SagaGenerator } from 'typed-redux-saga';

import type { ContextItem } from '$lib/components/chat/input/context-api';
import { buildContextLinks } from '$lib/components/workspace/initializer/context-links';
import {
  hasStagedFileItems,
  heldImageBlocks,
} from '$lib/components/workspace/initializer/staged-attachments';
import { shouldPullSourceRepositoryBeforeCreate } from '$lib/components/workspace/initializer/workspace-create-pull-policy';
import { resolveSubmitModelAndProvider } from '$lib/utils/effective-model-resolution';
import {
  parseGitHubUrl,
  validateBranchName,
  validateInitialPrompt,
  validateRepoPath,
} from '$lib/utils/workspace-validation';
import { commitOnboardingDefaultModel } from '$features/onboarding/utils/commit-onboarding-default-model';
import {
  extractLinearIssue,
  extractSentryIssue,
  parseContextMentions,
  parseFileMentions,
  type ContextReference,
} from '$features/onboarding/utils/parse-context-references';
import { resolveOnboardingModel } from '$features/onboarding/utils/resolve-onboarding-model';
import {
  REPO_CONFIG_SCRIPT_NAME,
  resolveSetupScriptParam,
} from '$features/setup-scripts/repo-config';
import { createAgentTypeId } from '$shared/types/agent.types';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '../../../store';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  selectEffectiveBehaviorPrompt,
  selectOrchestratorSpecialist,
  selectSpecialists,
} from '../../specialists/specialists-selectors';
import type {
  CompactWorkspaceInitializationSubmission,
  OnboardingWorkspaceInitializationSubmission,
  WorkspaceInitializationOutcome,
  WorkspaceInitializationPrepared,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResume,
  WorkspaceInitializationResumeInput,
  WorkspaceInitializationSetupScriptRecord,
  WorkspaceInitializationStagedItem,
} from '../workspace-initializer-types';

type Json = NonNullable<WorkspaceInitializationRequest['heldMessage']>['contextReferences'][number];

export interface PreparedWorkspaceInitialization {
  request: WorkspaceInitializationRequest;
  prepared: WorkspaceInitializationPrepared;
}

const isImageItem = (item: WorkspaceInitializationStagedItem) =>
  Boolean(item.imageData && item.imageMimeType);

function folderReferences(items: WorkspaceInitializationStagedItem[]): Json[] {
  return items
    .filter((item) => item.type === 'folder' && item.path)
    .map((item) => ({ type: 'file', path: item.path as string, title: item.label }));
}

function compactContextContent(
  mention: CompactWorkspaceInitializationSubmission['contextMentions'][number],
  metadata: Record<string, any>,
): string {
  const parts: string[] = [];
  parts.push(`[${mention.identifier}] ${mention.title}`);
  if (mention.url) parts.push(`URL: ${mention.url}`);
  if (mention.description) parts.push(`\nDescription:\n${mention.description}`);
  if (metadata.state) parts.push(`Status: ${metadata.state}`);
  if (metadata.teamName) parts.push(`Team: ${metadata.teamName}`);
  if (metadata.priority !== undefined) {
    // i18n-ignore (agent-facing context content, kept in English)
    const priorityLabels = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
    parts.push(`Priority: ${priorityLabels[metadata.priority] || metadata.priority}`);
  }
  if (metadata.assignee) parts.push(`Assignee: ${metadata.assignee}`);
  return parts.join('\n');
}

function setupScriptRecord(
  submission:
    CompactWorkspaceInitializationSubmission | OnboardingWorkspaceInitializationSubmission,
  repoPath: string | null,
  githubUrl: string | undefined,
  fallbackName: string,
): WorkspaceInitializationSetupScriptRecord | undefined {
  const { setupScript, setupScriptName, setupScriptNameSource } = submission;
  if (!repoPath || !setupScript.trim()) return undefined;
  const isUneditedRepoConfigScript =
    setupScriptNameSource === 'repo-config' &&
    setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
    submission.repoConfigScriptRepo === repoPath &&
    setupScript.trim() === (submission.repoConfigScript ?? '').trim();
  if (isUneditedRepoConfigScript) return undefined;
  return {
    repoPath,
    githubUrl,
    name: setupScriptName || fallbackName,
    content: setupScript,
    nameSource: setupScriptName ? setupScriptNameSource : 'named',
  };
}

/** Request retained after a post-create failure; a retry resumes it instead of re-creating. */
export function buildWorkspaceInitializationResume(
  id: string,
  request: WorkspaceInitializationRequest,
  outcome: Pick<
    WorkspaceInitializationOutcome,
    'workspaceId' | 'agentId' | 'workspacePath' | 'stagedItems' | 'retryImageBlocks'
  > & { workspaceId: string },
): WorkspaceInitializationResume {
  return {
    id,
    request: {
      ...request,
      createRequest: undefined,
      pull: undefined,
      setupScriptRecord: undefined,
      resume: {
        workspaceId: outcome.workspaceId,
        agentId: outcome.agentId,
        workspacePath: outcome.workspacePath,
      },
      stagedItems: outcome.stagedItems ?? request.stagedItems,
      heldMessage: request.heldMessage
        ? {
            ...request.heldMessage,
            imageBlocks: outcome.retryImageBlocks ?? request.heldMessage.imageBlocks,
          }
        : undefined,
    },
  };
}

/** Resume request carrying the pills as they stand at retry. */
export function buildWorkspaceInitializationRetry(
  resume: WorkspaceInitializationResume,
  input: WorkspaceInitializationResumeInput,
): WorkspaceInitializationRequest {
  return {
    ...resume.request,
    admission: input.admission,
    stagedItems: input.stagedItems,
    heldMessage: resume.request.heldMessage
      ? {
          ...resume.request.heldMessage,
          imageBlocks: heldImageBlocks(input.stagedItems as ContextItem[]),
        }
      : undefined,
  };
}

export function* prepareCompactWorkspaceInitialization(
  s: CompactWorkspaceInitializationSubmission,
  isCurrent: () => boolean,
): SagaGenerator<PreparedWorkspaceInitialization | null> {
  const repositoryCheckout = s.repositoryCheckout;
  if (!repositoryCheckout && !s.isNewRepo && s.repoType !== 'remote') {
    const branchValidation = validateBranchName(s.branch);
    if (!branchValidation.valid) throw new Error(branchValidation.error);
  }
  const promptValidation = validateInitialPrompt(s.prompt);
  if (!promptValidation.valid) throw new Error(promptValidation.error);

  // GitHub picks validate the URL; remote paths live on the remote server.
  if (s.repoType === 'github' && s.githubUrl) {
    const repoValidation = yield* call(validateRepoPath, s.githubUrl, false);
    if (!isCurrent()) return null;
    if (!repoValidation.valid) throw new Error(repoValidation.error);
  } else if (!repositoryCheckout && s.repoType !== 'remote') {
    const repoValidation = yield* call(validateRepoPath, s.repoPath, s.isNewRepo);
    if (!isCurrent()) return null;
    if (!repoValidation.valid) throw new Error(repoValidation.error);
  }

  // A PR mention checks out the PR head as `branch` and diffs against its target (PROTOCOL §5.1).
  const prBranchActive = !repositoryCheckout && !!s.selectedPRBranch && !s.isNewRepo;
  const baseBranch = repositoryCheckout?.branch ?? (s.isNewRepo ? 'main' : s.branch);
  const remoteSetup = !repositoryCheckout && s.remoteSetup ? s.remoteSetup : null;
  const environmentConfig = remoteSetup
    ? {
        type: 'remote' as const,
        ssh: {
          host: remoteSetup.host,
          port: remoteSetup.port || 22,
          user: remoteSetup.username,
          password: remoteSetup.password,
          key_path: remoteSetup.keyPath,
          use_agent: remoteSetup.useAgent,
          transport: remoteSetup.transport,
          ws_url: remoteSetup.wsUrl,
        },
        workspace_path: remoteSetup.workspacePath,
      }
    : undefined;

  const state = appStore.state;
  const { selectedSpecialist, selectedModel, modelWasOverridden, selectedReasoningEffort } =
    s.agent;
  let agentName: string = m.workspace_fileChanges_agent_label();
  let specialistId: string | undefined;
  if (selectedSpecialist) {
    const specialist = selectSpecialists.select(state).find((sp) => sp.id === selectedSpecialist);
    agentName = specialist?.name ?? m.workspace_fileChanges_agent_label();
    specialistId = selectedSpecialist;
  }

  const contextReferences: Json[] = remoteSetup ? [remoteSetup as unknown as Json] : [];
  if (s.checkoutContextUrl)
    contextReferences.push({
      type: 'url',
      provider: 'gitlab',
      url: s.checkoutContextUrl,
      title: s.checkoutContextUrl,
      content: s.checkoutContextUrl,
    });
  for (const mention of s.contextMentions) {
    let parsedMetadata: Record<string, any> = {};
    if (mention.metadata) {
      try {
        parsedMetadata = JSON.parse(mention.metadata);
      } catch {
        // Ignore parse errors
      }
    }
    contextReferences.push({
      type: mention.itemType,
      provider: mention.provider,
      identifier: mention.identifier,
      title: mention.title,
      url: mention.url,
      content: compactContextContent(mention, parsedMetadata),
      metadata: parsedMetadata,
    } as Json);
  }
  contextReferences.push(...(parseFileMentions(s.fileMentions) as unknown as Json[]));
  contextReferences.push(...s.runtimeReferences);
  contextReferences.push(...folderReferences(s.stagedItems));

  const imageBlocks = s.stagedItems.filter(isImageItem).map((item) => ({
    type: 'image' as const,
    data: item.imageData as string,
    mimeType: item.imageMimeType as string,
  }));

  const resolvedBehaviorPrompt = selectedSpecialist
    ? selectEffectiveBehaviorPrompt.select(state, selectedSpecialist)
    : undefined;
  // Model resolution is daemon-owned (PROTOCOL §5.11): submit `model` only for an explicit pick.
  const { model: resolvedModel, provider: submitProvider } = resolveSubmitModelAndProvider(
    modelWasOverridden && selectedModel ? selectedModel : undefined,
    s.agent.selectedProvider ?? '',
  );
  // Staged files and images hold the first message until placement (create → place → send).
  const hasStagedFiles =
    hasStagedFileItems(s.stagedItems as ContextItem[]) || imageBlocks.length > 0;
  const prompt = s.prompt.trim();
  const initialAgent = {
    // General uses the daemon placeholder so naming does not depend on UI locale.
    ...(specialistId !== undefined ? { name: agentName } : {}),
    nameExplicitlySet: false,
    rememberSpecialist: true,
    model: resolvedModel,
    ...(selectedReasoningEffort !== undefined ? { reasoningEffort: selectedReasoningEffort } : {}),
    specialist: specialistId,
    behaviorPrompt: resolvedBehaviorPrompt,
    prompt: hasStagedFiles ? undefined : prompt || undefined,
    agentType: createAgentTypeId('workspace'),
    provider: submitProvider,
    contextReferences:
      !hasStagedFiles && contextReferences.length > 0 ? contextReferences : undefined,
    imageBlocks: !hasStagedFiles && imageBlocks.length > 0 ? imageBlocks : undefined,
    metadata: {
      source: 'compact-initializer',
      isInitialAgent: true,
      specialist: specialistId ?? undefined,
      provider: submitProvider,
      workMode: s.agent.isTeamMode ? 'team' : 'single',
      createdAt: new Date().toISOString(),
    },
  };

  const isGithubPick = s.repoType === 'github' && !!s.githubUrl;
  if (s.repoConfigUnavailable)
    throw new Error(m.workspace_setupScript_configUnavailable_description());
  // The shown script runs as-is, except the unedited repo-config script (PROTOCOL §5.1).
  const setupScriptParam = resolveSetupScriptParam({
    setupScript: s.setupScript,
    setupScriptName: s.setupScriptName,
    setupScriptNameSource: s.setupScriptNameSource,
    explicitChoice: s.setupScriptExplicit || (s.repoType === 'gitlab' && s.repoConfigError),
    repoPath: s.setupScriptProbeKey,
    repoConfigScript: s.repoConfigScript,
    repoConfigScriptRepo: s.repoConfigScriptRepo,
  });
  const requestContextLinks = buildContextLinks(
    s.contextMentions,
    s.checkoutContextUrl && repositoryCheckout && s.checkoutInstanceBaseUrl
      ? {
          url: s.checkoutContextUrl,
          instanceBaseUrl: s.checkoutInstanceBaseUrl,
          projectPath: repositoryCheckout.projectPath,
        }
      : undefined,
  );
  const createRequest = {
    title: s.prefillTitle || '',
    ...(repositoryCheckout
      ? { repositoryCheckout }
      : {
          repositoryPath: isGithubPick
            ? undefined
            : String(remoteSetup?.workspacePath || s.repoPath),
          githubUrl: s.repoType === 'github' && s.githubUrl ? s.githubUrl : undefined,
          branch: prBranchActive ? s.selectedPRBranch : undefined,
          baseRef: prBranchActive ? s.selectedPRTargetBranch || undefined : String(baseBranch),
          environmentConfig,
          isNewRepo: Boolean(s.isNewRepo),
          skipIsolation: s.skipIsolation || undefined,
        }),
    contextLinks: requestContextLinks,
    setupScript: setupScriptParam,
    scope: s.scope || undefined,
    initialAgent,
  };
  const ghInfo = isGithubPick ? parseGitHubUrl(s.githubUrl) : null;
  const request: WorkspaceInitializationRequest = {
    entrypoint: 'compact',
    admission: s.admission,
    createRequest: createRequest as WorkspaceInitializationRequest['createRequest'],
    pull: shouldPullSourceRepositoryBeforeCreate({
      branchBehind: s.branchBehind,
      isLocalRepository: s.repoType === 'local',
      isNewRepository: s.isNewRepo,
      skipIsolation: s.skipIsolation,
      pullEnabled: s.pullEnabled,
    })
      ? { repositoryPath: s.repoPath, branch: s.branch }
      : undefined,
    agentTitle: agentName,
    coordinator:
      specialistId !== undefined && specialistId === selectOrchestratorSpecialist.select(state)?.id,
    stagedItems: s.stagedItems,
    heldMessage: hasStagedFiles ? { content: prompt, imageBlocks, contextReferences } : undefined,
    lastSubmittedAgent: s.agent,
    rememberAgentRepoKey: s.rememberAgentRepoKey,
    rememberBranch:
      !repositoryCheckout && s.formPersistence && s.repoPath && baseBranch && !s.isNewRepo
        ? { repoPath: s.repoPath, branch: baseBranch }
        : undefined,
    selectedPrNumber: !repositoryCheckout && s.selectedPrNumber ? s.selectedPrNumber : undefined,
    recentGitHubRepository: ghInfo
      ? {
          repository: `${ghInfo.owner}/${ghInfo.repo}`,
          name: ghInfo.repo,
          owner: ghInfo.owner,
          githubUrl: `https://github.com/${ghInfo.owner}/${ghInfo.repo}`,
        }
      : undefined,
    setupScriptRecord: setupScriptRecord(
      s,
      s.setupScriptRepoKey,
      s.repoType === 'github' ? s.githubUrl : undefined,
      m.workspace_setupScriptEditor_customScript_name(),
    ),
    completion: {
      draft: s.draft,
      // A newly created repository now exists, so the next form opens it as an existing repo.
      lastSelectedRepo:
        s.formPersistence && s.repoPath && (s.repoType === 'local' || s.repoType === 'github')
          ? {
              path: s.repoPath,
              type: s.repoType,
              ...(s.githubUrl ? { githubUrl: s.githubUrl } : {}),
              isValidPath: s.isNewRepo ? true : s.isValidPath,
              ...(s.scope ? { scope: s.scope } : {}),
            }
          : undefined,
    },
  };
  return { request, prepared: { pull: Boolean(request.pull) } };
}

export function* prepareOnboardingWorkspaceInitialization(
  s: OnboardingWorkspaceInitializationSubmission,
  isCurrent: () => boolean,
): SagaGenerator<PreparedWorkspaceInitialization | null> {
  const reduxState = appStore.state;
  const { provider, model, behaviorPrompt, specialistId, specialistName } = yield* call(
    resolveOnboardingModel,
    reduxState,
    s.modelWasOverridden && s.selectedModel
      ? { model: s.selectedModel, provider: s.selectedProvider }
      : undefined,
  );
  if (!isCurrent()) return null;
  const agentName = specialistName ?? m.workspace_fileChanges_agent_label();
  if (!s.modelWasOverridden) {
    const commits: Parameters<Parameters<typeof commitOnboardingDefaultModel>[0]['dispatch']>[0][] =
      [];
    commitOnboardingDefaultModel({
      provider,
      effectiveDefaultModel:
        s.defaultModelPreview?.provider === provider ? s.defaultModelPreview.model : undefined,
      activeProviderId: selectActiveProviderId.select(reduxState) ?? '',
      dispatch: (action) => commits.push(action),
    });
    for (const action of commits) yield* put(action);
  }
  const { project, treatAsNewRepo, effectiveBranch, prompt } = s;
  const fileItems = s.stagedItems.filter((item) => !isImageItem(item));
  const contextReferences: ContextReference[] = [
    ...parseContextMentions(s.contextMentions),
    ...parseFileMentions(s.fileMentions),
    ...(s.runtimeReferences as unknown as ContextReference[]),
    ...(folderReferences(fileItems) as unknown as ContextReference[]),
  ];
  const imageBlocks = heldImageBlocks(s.stagedItems as ContextItem[]);
  const setupScriptParam = resolveSetupScriptParam({
    setupScript: s.setupScript,
    setupScriptName: s.setupScriptName,
    setupScriptNameSource: s.setupScriptNameSource,
    repoPath: project.repoPath,
    repoConfigScript: s.repoConfigScript,
    repoConfigScriptRepo: s.repoConfigScriptRepo,
  });
  const isGithubPick = project.type === 'github' && !!project.githubUrl;
  const hasStagedFiles = hasStagedFileItems(fileItems as ContextItem[]) || imageBlocks.length > 0;
  const request: WorkspaceInitializationRequest = {
    entrypoint: 'onboarding',
    admission: s.admission,
    pull: shouldPullSourceRepositoryBeforeCreate({
      branchBehind: s.branchBehind,
      isLocalRepository: project.type === 'local',
      isNewRepository: treatAsNewRepo,
      skipIsolation: s.skipIsolation,
      pullEnabled: s.pullEnabled,
    })
      ? { repositoryPath: project.repoPath, branch: project.branch }
      : undefined,
    createRequest: {
      title: '',
      repositoryPath: isGithubPick ? undefined : project.repoPath,
      githubUrl: project.githubUrl,
      baseRef: treatAsNewRepo ? 'main' : effectiveBranch,
      isNewRepo: treatAsNewRepo,
      skipIsolation: s.skipIsolation || undefined,
      scope: project.scope || undefined,
      setupScript: setupScriptParam,
      contextLinks: buildContextLinks(s.contextMentions),
      linearIssue: extractLinearIssue(contextReferences),
      sentryIssue: extractSentryIssue(contextReferences),
      initialAgent: {
        name: agentName,
        model,
        prompt: hasStagedFiles ? undefined : prompt,
        agentType: createAgentTypeId('workspace'),
        specialist: specialistId ?? undefined,
        behaviorPrompt,
        provider,
        contextReferences:
          !hasStagedFiles && contextReferences.length > 0 ? contextReferences : undefined,
        imageBlocks: !hasStagedFiles && imageBlocks.length > 0 ? imageBlocks : undefined,
        metadata: {
          source: 'onboarding',
          isInitialAgent: true,
          specialist: specialistId ?? undefined,
        },
      },
    } as WorkspaceInitializationRequest['createRequest'],
    agentTitle: agentName,
    coordinator: specialistId !== null,
    stagedItems: s.stagedItems,
    heldMessage: hasStagedFiles
      ? { content: prompt, imageBlocks, contextReferences: contextReferences as unknown as Json[] }
      : undefined,
    lastSubmittedAgent: {
      selectedSpecialist: specialistId,
      isTeamMode: false,
      selectedModel: s.selectedModel,
      modelWasOverridden: s.modelWasOverridden,
      selectedReasoningEffort: undefined,
      selectedProvider: s.selectedProvider,
    },
    rememberBranch:
      !treatAsNewRepo && project.repoPath && effectiveBranch.trim()
        ? { repoPath: project.repoPath, branch: effectiveBranch }
        : undefined,
    selectedPrNumber: s.selectedPrNumber ?? undefined,
    setupScriptRecord: setupScriptRecord(
      s,
      project.repoPath,
      project.type === 'github' ? project.githubUrl : undefined,
      m.onboarding_page_customScript_label(),
    ),
    completion: { draft: s.draft },
  };
  return {
    request,
    prepared: { pull: Boolean(request.pull), specialistId, specialistName },
  };
}
