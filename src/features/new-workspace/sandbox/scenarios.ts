import type { SetupResult, WorkspaceDraft } from '$shared/types/workspace-draft';
import { CONTROLLER_PHASES, type ControllerState, type ControllerPhase } from '../controller';
import type { NewWorkspacePresentation } from '../ui/types';
import {
  READY_CAPABILITIES,
  adoptingState,
  backendSwitchedState,
  bootState,
  conflictState,
  failedState,
  liveState,
  offlineState,
  placingAttachmentsState,
  promotingState,
  promotionAckLostState,
  restoredState,
  restoringState,
  sendingState,
  startingState,
} from './scenario-builders';

export const SCENARIO_FAMILIES = [
  'entry',
  'capability',
  'source',
  'transaction',
  'recovery',
] as const;

export type ScenarioFamily = (typeof SCENARIO_FAMILIES)[number];

export const SANDBOX_ACTIONS = ['advance', 'reject', 'reconnect', 'lose-ack'] as const;

export type SandboxAction = (typeof SANDBOX_ACTIONS)[number];

export interface ScenarioFixtures {
  draft: WorkspaceDraft;
  host: {
    git: { state: 'available' | 'missing' | 'unknown'; version?: string };
    node: { state: 'available' | 'missing' | 'unknown'; version?: string };
  };
  provider: { state: 'ready' | 'missing' | 'login-required' | 'unknown'; provider?: string };
  workspace: Record<string, unknown>;
  initialAgent: Record<string, unknown>;
  setupResult: SetupResult;
  attachmentPlacement: { placed: string[]; failed: string[] };
  sendResult: { messageId: string; queued: boolean };
}

export interface ScenarioScriptStep {
  channel: string;
  params?: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  family: ScenarioFamily;
  title: string;
  initialControllerState: ControllerState;
  fixtures: ScenarioFixtures;
  allowedActions: readonly SandboxAction[];
  expectedPhase: ControllerPhase;
  contract: {
    control: 'start' | 'provider' | 'source' | 'retry' | 'reconnect' | 'conflict' | 'none';
    width: 360 | 768 | 1280;
    allowsClonePercent?: boolean;
  };
  presentation?: NewWorkspacePresentation;
  script?: readonly ScenarioScriptStep[];
}

export const FIXED_IDS = {
  draft: '00000000-0000-4000-8000-000000000001',
  operation: '00000000-0000-4000-8000-000000000002',
  workspace: '00000000-0000-4000-8000-000000000003',
  agent: '00000000-0000-4000-8000-000000000004',
  message: '00000000-0000-4000-8000-000000000005',
} as const;

export const FIXED_TIMESTAMP = '2026-01-15T12:00:00.000Z';

export const DEFAULT_SCENARIO_FIXTURES: ScenarioFixtures = {
  draft: {
    id: FIXED_IDS.draft,
    ownerClientId: 'sandbox-client',
    revision: 1,
    phase: 'editing',
    intentText: '',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: FIXED_IDS.operation,
    delivery: { state: 'none' },
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  host: {
    git: { state: 'available', version: '2.51.0' },
    node: { state: 'available', version: '22.18.0' },
  },
  provider: { state: 'ready', provider: 'sandbox' },
  workspace: {
    id: FIXED_IDS.workspace,
    title: 'Untitled',
    status: 'active',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  initialAgent: { id: FIXED_IDS.agent, name: 'Coordinator', status: 'idle' },
  setupResult: {
    state: 'succeeded',
    exitCode: 0,
    startedAt: FIXED_TIMESTAMP,
    finishedAt: FIXED_TIMESTAMP,
  },
  attachmentPlacement: { placed: [], failed: [] },
  sendResult: { messageId: FIXED_IDS.message, queued: false },
};

const RETAINED_TEXT = 'Retained draft text for browser verification';
const ATTACHMENT_ONE = { id: 'attachment-one', name: 'diagram.png' };
const ATTACHMENT_TWO = { id: 'attachment-two', name: 'notes.txt' };

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return { ...DEFAULT_SCENARIO_FIXTURES.draft, ...overrides };
}

function fixtures(
  scenarioDraft: WorkspaceDraft,
  overrides: Partial<Omit<ScenarioFixtures, 'draft'>> = {},
): ScenarioFixtures {
  return { ...DEFAULT_SCENARIO_FIXTURES, ...overrides, draft: scenarioDraft };
}

function providerPresentation(
  state: 'connect-provider' | 'login-required' | 'test-failed',
  overrides: Partial<NonNullable<NewWorkspacePresentation['coordinator']>> = {},
): NewWorkspacePresentation {
  return {
    requiredCapabilities: ['provider'],
    coordinator: {
      state,
      provider: {
        id: 'auggie',
        name: 'Augment Auggie',
        available: true,
        authenticated: state === 'connect-provider' ? undefined : false,
        statusLoading: false,
        authDetails: undefined,
        docsUrl: 'https://docs.augmentcode.com/',
        installCommand: 'auggie',
        loginCommandHint: 'auggie login',
        hasNpxFallback: false,
      },
      ...(state === 'login-required'
        ? {
            deviceFlow: {
              userCode: 'SANDBOX-CODE',
              verificationUri: 'https://github.com/login/device',
            },
          }
        : {}),
      ...overrides,
    },
  };
}

const FAMILY_WIDTH: Record<ScenarioFamily, 360 | 768 | 1280> = {
  entry: 360,
  capability: 768,
  source: 1280,
  transaction: 768,
  recovery: 360,
};

function scenario(
  id: string,
  family: ScenarioFamily,
  title: string,
  scenarioDraft: WorkspaceDraft,
  initialControllerState: ControllerState,
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    id,
    family,
    title,
    initialControllerState,
    fixtures: fixtures(scenarioDraft),
    allowedActions: [],
    expectedPhase: initialControllerState.phase,
    contract: { control: 'none', width: FAMILY_WIDTH[family] },
    ...overrides,
  };
}

const emptyDraft = draft();
const textDraft = draft({ intentText: RETAINED_TEXT });
const attachmentDraft = draft({
  intentText: RETAINED_TEXT,
  attachments: [ATTACHMENT_ONE, ATTACHMENT_TWO],
});
const localDraft = draft({
  intentText: RETAINED_TEXT,
  source: { kind: 'local', path: '/sandbox/project', isolation: 'worktree' },
});
const publicRepoDraft = draft({
  intentText: RETAINED_TEXT,
  source: {
    kind: 'github',
    url: 'https://github.com/intent-hq/intent',
    owner: 'intent-hq',
    name: 'intent',
  },
});
const invalidFolderDraft = draft({
  intentText: RETAINED_TEXT,
  source: { kind: 'newFolder', parentPath: '/sandbox/projects', name: '../outside' },
});

export const REQUIRED_SCENARIO_IDS = [
  'entry-pristine',
  'entry-restored-text',
  'entry-restored-attachments',
  'entry-restore-failed',
  'entry-existing-workspace-boot',
  'capability-checking',
  'capability-no-provider',
  'capability-login-required',
  'capability-test-failed',
  'capability-native-ready-no-node',
  'capability-npx-blocked',
  'capability-wrong-remote-host',
  'capability-git-missing-mac',
  'capability-git-missing-windows',
  'capability-git-missing-linux',
  'source-unresolved-link',
  'source-local-repo',
  'source-non-git-folder',
  'source-new-folder-invalid',
  'source-public-repo',
  'source-private-auth',
  'source-authenticated-no-access',
  'source-branch-loading',
  'source-branch-error',
  'source-branch-behind',
  'source-remote-folder-drop-rejected',
  'transaction-preparing',
  'transaction-clone-progress',
  'transaction-clone-timeout-after-success',
  'transaction-setup-running',
  'transaction-setup-failed',
  'transaction-setup-unknown',
  'transaction-created-awaiting-attachments',
  'transaction-partial-placement',
  'transaction-send-failed',
  'transaction-send-ack-unknown',
  'transaction-ready',
  'transaction-live',
  'recovery-daemon-offline',
  'recovery-reconnect',
  'recovery-backend-switched',
  'recovery-draft-conflict',
  'recovery-promotion-ack-lost',
  'recovery-restart-pending-send',
  'recovery-two-tabs-two-drafts',
] as const;

export const NEW_WORKSPACE_SCENARIOS: readonly Scenario[] = [
  scenario('entry-pristine', 'entry', 'Pristine draft', emptyDraft, restoredState(emptyDraft), {
    contract: { control: 'start', width: 360 },
  }),
  scenario('entry-restored-text', 'entry', 'Restored text', textDraft, restoredState(textDraft), {
    contract: { control: 'start', width: 768 },
  }),
  scenario(
    'entry-restored-attachments',
    'entry',
    'Restored attachments',
    attachmentDraft,
    restoredState(attachmentDraft),
    { contract: { control: 'start', width: 1280 } },
  ),
  scenario(
    'entry-restore-failed',
    'entry',
    'Restore failed',
    textDraft,
    failedState(restoringState(textDraft), 'restore', 'Draft restore failed'),
    { allowedActions: ['reconnect'], contract: { control: 'retry', width: 360 } },
  ),
  scenario(
    'entry-existing-workspace-boot',
    'entry',
    'Existing workspace boot',
    textDraft,
    bootState(textDraft),
  ),

  scenario(
    'capability-checking',
    'capability',
    'Capability checks pending',
    textDraft,
    restoredState(textDraft, {
      provider: 'pending',
      git: 'pending',
      node: 'pending',
      github: 'pending',
    }),
    { contract: { control: 'start', width: 768 } },
  ),
  scenario(
    'capability-no-provider',
    'capability',
    'Provider connection required',
    textDraft,
    restoredState(textDraft, { ...READY_CAPABILITIES, provider: 'missing' }),
    {
      fixtures: fixtures(textDraft, { provider: { state: 'missing' } }),
      presentation: providerPresentation('connect-provider'),
      contract: { control: 'provider', width: 768 },
    },
  ),
  scenario(
    'capability-login-required',
    'capability',
    'Provider login required',
    textDraft,
    restoredState(textDraft, { ...READY_CAPABILITIES, provider: 'missing' }),
    {
      fixtures: fixtures(textDraft, { provider: { state: 'login-required', provider: 'auggie' } }),
      presentation: providerPresentation('login-required'),
      contract: { control: 'provider', width: 768 },
    },
  ),
  scenario(
    'capability-test-failed',
    'capability',
    'Provider test failed',
    textDraft,
    restoredState(textDraft, { ...READY_CAPABILITIES, provider: 'missing' }),
    {
      presentation: providerPresentation('test-failed', { detail: 'Provider test failed safely' }),
      contract: { control: 'provider', width: 768 },
    },
  ),
  scenario(
    'capability-native-ready-no-node',
    'capability',
    'Native provider ready without Node',
    textDraft,
    restoredState(textDraft, { ...READY_CAPABILITIES, node: 'missing' }),
    {
      fixtures: fixtures(textDraft, {
        host: { ...DEFAULT_SCENARIO_FIXTURES.host, node: { state: 'missing' } },
      }),
      contract: { control: 'start', width: 768 },
    },
  ),
  scenario(
    'capability-npx-blocked',
    'capability',
    'NPX provider blocked',
    textDraft,
    restoredState(textDraft, { ...READY_CAPABILITIES, provider: 'missing', node: 'missing' }),
    {
      presentation: providerPresentation('test-failed', {
        npxStatus: { resolvedPath: null, version: null, versionOk: false },
      }),
      contract: { control: 'provider', width: 768 },
    },
  ),
  ...[
    ['capability-wrong-remote-host', 'Remote build host', 'remote-builder'],
    ['capability-git-missing-mac', 'Git missing on macOS', 'Mac'],
    ['capability-git-missing-windows', 'Git missing on Windows', 'Windows'],
    ['capability-git-missing-linux', 'Git missing on Linux', 'Linux'],
  ].map(([id, title, hostName]) =>
    scenario(
      id,
      'capability',
      title,
      localDraft,
      restoredState(localDraft, { ...READY_CAPABILITIES, git: 'missing' }),
      {
        fixtures: fixtures(localDraft, {
          host: { ...DEFAULT_SCENARIO_FIXTURES.host, git: { state: 'missing' } },
        }),
        presentation: { hostName, requiredCapabilities: ['git'] },
        contract: { control: 'none', width: 768 },
      },
    ),
  ),

  scenario(
    'source-unresolved-link',
    'source',
    'Unresolved link',
    textDraft,
    restoredState(textDraft),
    {
      presentation: { source: { unresolvedLink: 'https://example.test/ambiguous' } },
      contract: { control: 'source', width: 1280 },
    },
  ),
  scenario(
    'source-local-repo',
    'source',
    'Local repository',
    localDraft,
    restoredState(localDraft),
    {
      contract: { control: 'start', width: 1280 },
    },
  ),
  scenario(
    'source-non-git-folder',
    'source',
    'Non-Git local folder',
    localDraft,
    restoredState(localDraft),
    {
      presentation: { source: { localKind: 'non-git' } },
      contract: { control: 'start', width: 1280 },
    },
  ),
  scenario(
    'source-new-folder-invalid',
    'source',
    'Invalid new folder name',
    invalidFolderDraft,
    restoredState(invalidFolderDraft),
    { contract: { control: 'source', width: 1280 } },
  ),
  scenario(
    'source-public-repo',
    'source',
    'Public repository',
    publicRepoDraft,
    restoredState(publicRepoDraft),
    {
      presentation: { source: { githubAccess: 'public' } },
      contract: { control: 'start', width: 1280 },
    },
  ),
  scenario(
    'source-private-auth',
    'source',
    'Private repository authentication',
    publicRepoDraft,
    restoredState(publicRepoDraft, { ...READY_CAPABILITIES, github: 'missing' }),
    {
      presentation: { source: { githubAccess: 'private' }, requiredCapabilities: ['github'] },
      contract: { control: 'none', width: 1280 },
    },
  ),
  scenario(
    'source-authenticated-no-access',
    'source',
    'Authenticated without repository access',
    publicRepoDraft,
    restoredState(publicRepoDraft, { ...READY_CAPABILITIES, github: 'missing' }),
    {
      presentation: { source: { githubAccess: 'no-access' }, requiredCapabilities: ['github'] },
      contract: { control: 'source', width: 1280 },
    },
  ),
  scenario(
    'source-branch-loading',
    'source',
    'Branch list loading',
    publicRepoDraft,
    startingState(publicRepoDraft, 'github'),
  ),
  ...[
    ['source-branch-error', 'Branch lookup failed', 'Unable to load repository branches'],
    ['source-branch-behind', 'Selected branch behind', 'Selected branch needs an update'],
    [
      'source-remote-folder-drop-rejected',
      'Remote folder drop rejected',
      'Local folders cannot be dropped onto a remote host',
    ],
  ].map(([id, title, error]) =>
    scenario(
      id,
      'source',
      title,
      publicRepoDraft,
      failedState(restoredState(publicRepoDraft), 'prerequisites', error),
      {
        contract: { control: 'retry', width: 1280 },
      },
    ),
  ),

  scenario(
    'transaction-preparing',
    'transaction',
    'Preparing promotion',
    textDraft,
    promotingState(textDraft),
    {
      allowedActions: ['advance', 'reject', 'lose-ack'],
      script: [
        { channel: 'workspaceDraft.promote', params: { id: FIXED_IDS.draft, expectedRevision: 1 } },
      ],
    },
  ),
  scenario(
    'transaction-clone-progress',
    'transaction',
    'Observed clone progress',
    publicRepoDraft,
    startingState(publicRepoDraft, 'git'),
    {
      presentation: { progress: { clone: { phase: 'receiving objects', percent: 47 } } },
      contract: { control: 'none', width: 768, allowsClonePercent: true },
      allowedActions: ['advance', 'reject'],
      script: [{ channel: `git:clone:${FIXED_IDS.operation}` }],
    },
  ),
  scenario(
    'transaction-clone-timeout-after-success',
    'transaction',
    'Clone timeout after server success',
    publicRepoDraft,
    failedState(startingState(publicRepoDraft, 'git'), 'prerequisites', 'Clone result timed out'),
    { contract: { control: 'retry', width: 768 } },
  ),
  scenario(
    'transaction-setup-running',
    'transaction',
    'Setup running',
    textDraft,
    adoptingState(textDraft),
    {
      fixtures: fixtures(textDraft, {
        setupResult: { state: 'running', startedAt: FIXED_TIMESTAMP },
      }),
      presentation: { progress: { setup: { state: 'running', startedAt: FIXED_TIMESTAMP } } },
    },
  ),
  scenario(
    'transaction-setup-failed',
    'transaction',
    'Setup failed',
    textDraft,
    failedState(adoptingState(textDraft), 'adopt', 'Setup command exited with status 1'),
    {
      fixtures: fixtures(textDraft, {
        setupResult: { state: 'failed', exitCode: 1, error: 'status 1' },
      }),
      contract: { control: 'retry', width: 768 },
    },
  ),
  scenario(
    'transaction-setup-unknown',
    'transaction',
    'Setup result unknown',
    textDraft,
    adoptingState(textDraft),
    {
      fixtures: fixtures(textDraft, {
        setupResult: { state: 'unknown', error: 'Reconnect to retry' },
      }),
      presentation: { progress: { setup: { state: 'unknown', error: 'Reconnect to retry' } } },
    },
  ),
  scenario(
    'transaction-created-awaiting-attachments',
    'transaction',
    'Created workspace awaiting attachments',
    attachmentDraft,
    placingAttachmentsState(attachmentDraft, ['attachment-one', 'attachment-two']),
    {
      allowedActions: ['advance', 'reject'],
      script: [{ channel: 'attachment.place' }],
    },
  ),
  scenario(
    'transaction-partial-placement',
    'transaction',
    'Partial attachment placement',
    attachmentDraft,
    failedState(
      placingAttachmentsState(attachmentDraft, ['attachment-two']),
      'attachments',
      'notes.txt could not be placed',
    ),
    {
      fixtures: fixtures(attachmentDraft, {
        attachmentPlacement: { placed: ['attachment-one'], failed: ['attachment-two'] },
      }),
      contract: { control: 'retry', width: 768 },
    },
  ),
  scenario(
    'transaction-send-failed',
    'transaction',
    'First message failed',
    textDraft,
    failedState(sendingState(textDraft, 'issued'), 'send', 'First message failed'),
    { contract: { control: 'retry', width: 768 } },
  ),
  scenario(
    'transaction-send-ack-unknown',
    'transaction',
    'First message acknowledgement unknown',
    textDraft,
    sendingState(textDraft, 'unknown'),
    {
      allowedActions: ['reconnect'],
      contract: { control: 'none', width: 768 },
    },
  ),
  scenario(
    'transaction-ready',
    'transaction',
    'Workspace ready for adoption',
    textDraft,
    adoptingState(textDraft),
  ),
  scenario('transaction-live', 'transaction', 'Live workspace', textDraft, liveState(textDraft)),

  scenario(
    'recovery-daemon-offline',
    'recovery',
    'Daemon offline',
    textDraft,
    offlineState(restoredState(textDraft)),
    {
      allowedActions: ['reconnect'],
      contract: { control: 'reconnect', width: 360 },
    },
  ),
  scenario(
    'recovery-reconnect',
    'recovery',
    'Reconnect in progress',
    textDraft,
    restoringState(textDraft),
  ),
  scenario(
    'recovery-backend-switched',
    'recovery',
    'Backend switched with retained input',
    textDraft,
    backendSwitchedState(textDraft),
  ),
  scenario(
    'recovery-draft-conflict',
    'recovery',
    'Draft revision conflict',
    textDraft,
    conflictState(textDraft, draft({ ...textDraft, revision: 2, intentText: 'Remote draft text' })),
    { contract: { control: 'conflict', width: 360 } },
  ),
  scenario(
    'recovery-promotion-ack-lost',
    'recovery',
    'Promotion acknowledgement lost',
    textDraft,
    promotionAckLostState(textDraft),
    {
      allowedActions: ['reconnect', 'lose-ack'],
      script: [
        { channel: 'workspaceDraft.promote', params: { id: FIXED_IDS.draft, expectedRevision: 1 } },
      ],
    },
  ),
  scenario(
    'recovery-restart-pending-send',
    'recovery',
    'Restart with pending send',
    draft({ ...textDraft, delivery: { state: 'pending', messageId: FIXED_IDS.message } }),
    sendingState(textDraft, 'reconciling'),
    { allowedActions: ['reconnect'] },
  ),
  scenario(
    'recovery-two-tabs-two-drafts',
    'recovery',
    'Two tabs with independent drafts',
    draft({ ...textDraft, id: '00000000-0000-4000-8000-000000000006' }),
    restoredState(draft({ ...textDraft, id: '00000000-0000-4000-8000-000000000006' })),
    { contract: { control: 'start', width: 360 } },
  ),
] as const;

export function validateScenarioRegistry(scenarios: readonly Scenario[]): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();
  for (const item of scenarios) {
    if (!item.id.trim()) failures.push('Scenario id must not be empty.');
    if (ids.has(item.id)) failures.push(`Duplicate scenario id: ${item.id}`);
    ids.add(item.id);
  }
  for (const family of SCENARIO_FAMILIES) {
    if (!scenarios.some((item) => item.family === family)) {
      failures.push(`Missing scenario family: ${family}`);
    }
  }
  for (const phase of CONTROLLER_PHASES) {
    if (!scenarios.some((item) => item.initialControllerState.phase === phase)) {
      failures.push(`Missing controller phase: ${phase}`);
    }
  }
  for (const item of scenarios) {
    if (item.expectedPhase !== item.initialControllerState.phase) {
      failures.push(`Scenario phase mismatch: ${item.id}`);
    }
  }
  return failures;
}

export function getScenario(id: string | null | undefined): Scenario | undefined {
  return NEW_WORKSPACE_SCENARIOS.find((item) => item.id === id);
}
