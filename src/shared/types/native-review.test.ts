import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/native-review-v1.json';
import {
  NativeReviewBranchIdentitySchema,
  NativeReviewBranchTargetSchema,
  NativeReviewDetailsSchema,
  NativeReviewExecuteExtensionSchema,
  NativeReviewExecutionSchema,
  NativeReviewGitReceiptSchema,
  NativeReviewOutcomeSchema,
  NativeReviewPreparationSchema,
  NativeReviewPrepareExtensionSchema,
  NativeReviewPublicationSchema,
  NativeReviewStageSchema,
  NativeReviewStateSchema,
  NativeReviewTransportSchema,
  type NativeReviewBranchIdentity,
  type NativeReviewBranchTarget,
  type NativeReviewDetails,
  type NativeReviewExecuteExtension,
  type NativeReviewExecution,
  type NativeReviewGitReceipt,
  type NativeReviewOutcome,
  type NativeReviewPreparation,
  type NativeReviewPrepareExtension,
  type NativeReviewPublication,
  type NativeReviewStage,
  type NativeReviewState,
  type NativeReviewTransport,
} from './native-review';

function execution(): NativeReviewExecution {
  return NativeReviewExecutionSchema.parse(structuredClone(fixture.execute.reviewExecution));
}

function preparation(): NativeReviewPreparation {
  return NativeReviewPreparationSchema.parse(structuredClone(fixture.prepare.reviewPreparation));
}

function review(): NativeReviewDetails {
  return NativeReviewDetailsSchema.parse(
    structuredClone(fixture.execute.reviewExecution.outcome.review),
  );
}

describe('native review canonical response extensions', () => {
  it('round-trips the immutable Rust prepare and execute fixture without adding legacy aliases', () => {
    const prepare: NativeReviewPrepareExtension = NativeReviewPrepareExtensionSchema.parse(
      fixture.prepare,
    );
    const execute: NativeReviewExecuteExtension = NativeReviewExecuteExtensionSchema.parse(
      fixture.execute,
    );

    expect(prepare).toEqual(fixture.prepare);
    expect(execute).toEqual(fixture.execute);
    expect(execute.result).not.toHaveProperty('prHtmlUrl');
    expect(execute.result).not.toHaveProperty('existingPR');
    expect(JSON.parse(JSON.stringify({ prepare, execute }))).toEqual(fixture);
  });

  it('preserves old prepare fields and caller options without inventing a preparation', () => {
    const { reviewPreparation: _extension, ...oldPrepare } = fixture.prepare;
    const wire = { ...oldPrepare, options: { pushAfterCommit: false, createPRAfterPush: false } };
    const parsed = NativeReviewPrepareExtensionSchema.parse(wire);

    expect(parsed).toEqual(wire);
    expect(parsed).not.toHaveProperty('reviewPreparation');
    expect(NativeReviewPrepareExtensionSchema.parse({})).toEqual({});
  });

  it.each([
    {
      success: true,
      steps: [{ id: 'commit', name: 'Commit', status: 'completed', message: 'Committed B' }],
      result: { commitHash: 'B', pushedSha: 'A' },
    },
    {
      success: false,
      steps: [
        { id: 'push', name: 'Push', status: 'failed', error: 'github authentication required' },
      ],
      result: { commitHash: 'B' },
      error: 'github authentication required',
    },
    {
      success: true,
      steps: [],
      result: {
        prNumber: 7,
        prUrl: 'api-url',
        prHtmlUrl: 'browser-url',
        existingPR: true,
        mergeCommitHash: 'M',
        autoRebased: true,
        newHeadSha: 'H',
        newBaseSha: 'T',
        futureField: { kept: true },
      },
    },
    { success: false, steps: [], error: 'Response lost' },
  ])('preserves an old execution envelope without manufacturing receipts: %j', (wire) => {
    const before = structuredClone(wire);
    const parsed = NativeReviewExecuteExtensionSchema.parse(wire);

    expect(parsed).toEqual(before);
    expect(wire).toEqual(before);
    expect(parsed).not.toHaveProperty('reviewExecution');
  });

  it('keeps a successful commit-only call separate from a failed create call', () => {
    const commit = execution();
    commit.requestId = 'request-commit';
    commit.preparation.operationId = 'operation-commit';
    commit.preparation.localHeadSha = 'local-A';
    commit.gitReceipts = [{ stage: 'commit', commitHash: 'local-B' }];
    commit.outcome = { status: 'not-attempted' };
    commit.publication = { state: 'unknown', localHeadSha: 'local-B', remoteSourceSha: null };
    const create = execution();
    create.outcome = {
      status: 'failed',
      stage: 'create-pr',
      code: null,
      message: 'Remote branch absent',
    };
    create.publication = { state: 'remote-branch-missing', localHeadSha: 'local-B' };
    const history = [
      { success: true, steps: [], result: { commitHash: 'local-B' }, reviewExecution: commit },
      { success: false, steps: [], error: 'Remote branch absent', reviewExecution: create },
    ].map((entry) => NativeReviewExecuteExtensionSchema.parse(entry));

    expect(history[0]?.success).toBe(true);
    expect(history[0]?.reviewExecution?.outcome.status).toBe('not-attempted');
    expect(history[0]?.reviewExecution?.gitReceipts).toEqual([
      { stage: 'commit', commitHash: 'local-B' },
    ]);
    expect(history[1]?.success).toBe(false);
    expect(history[1]?.reviewExecution?.gitReceipts).toEqual([]);
    expect(history[1]?.reviewExecution?.preparation.localHeadSha).toBe('local-B');
    expect(history[0]?.reviewExecution?.requestId).not.toBe(history[1]?.reviewExecution?.requestId);
    expect(history[0]?.reviewExecution?.preparation.operationId).not.toBe(
      history[1]?.reviewExecution?.preparation.operationId,
    );
  });

  it.each(['failed', 'uncertain'] as const)(
    'retains completed own stages on %s without false success or a review',
    (status) => {
      const gitReceipts: NativeReviewGitReceipt[] = [
        { stage: 'commit', commitHash: 'local-B' },
        { stage: 'push', pushedSha: 'local-B' },
      ];
      const outcome: NativeReviewOutcome =
        status === 'failed'
          ? { status, stage: 'create-pr', code: null, message: 'Create unavailable' }
          : { status, stage: 'create-pr', message: 'Response lost; reconcile first' };
      const receipt: NativeReviewExecution = {
        ...execution(),
        gitReceipts,
        outcome,
        publication: { state: 'unknown', localHeadSha: 'local-B', remoteSourceSha: null },
      };
      const wire = {
        success: false,
        steps: [
          { id: 'commit', name: 'Commit', status: 'completed' },
          { id: 'push', name: 'Push', status: 'completed' },
          { id: 'create-pr', name: 'Create PR', status: 'failed', error: outcome.message },
        ],
        result: { commitHash: 'local-B', pushedSha: 'local-B' },
        error: outcome.message,
        reviewExecution: receipt,
      };
      const parsed = NativeReviewExecuteExtensionSchema.parse(wire);

      expect(parsed).toEqual(wire);
      expect(parsed.success).toBe(false);
      expect(parsed.reviewExecution?.outcome).not.toHaveProperty('review');
      expect(parsed.result).not.toHaveProperty('prNumber');
      expect(parsed.reviewExecution?.gitReceipts).toEqual(gitReceipts);
      expect(parsed.reviewExecution?.publication.state).toBe('unknown');
    },
  );

  it('retains a failed push with only the completed commit receipt', () => {
    const value: NativeReviewExecution = {
      ...execution(),
      gitReceipts: [{ stage: 'commit', commitHash: 'local-B' }],
      outcome: {
        status: 'failed',
        stage: 'push',
        code: 'source-control-unauthorized',
        message: 'Permission denied',
      },
    };
    const parsed = NativeReviewExecutionSchema.parse(value);

    expect(parsed).toEqual(value);
    expect(parsed.gitReceipts).toHaveLength(1);
    expect(parsed.gitReceipts[0]).not.toHaveProperty('pushedSha');
  });
});

describe('native review metadata and publication', () => {
  it.each(['created', 'reused'] as const)(
    'preserves actual %s metadata and remote-A/local-B without claiming a push',
    (status) => {
      const actual = review();
      const value: NativeReviewExecution = { ...execution(), outcome: { status, review: actual } };
      const parsed = NativeReviewExecutionSchema.parse(value);

      expect(parsed).toEqual(value);
      expect(actual.title).not.toBe(fixture.prepare.suggestedPRTitle);
      expect(actual.body).not.toBe(fixture.prepare.suggestedPRBody);
      expect(actual.draft).toBe(true);
      expect(actual.headSha).toBe('remote-A');
      expect(actual.createdAt).toBe('2026-09-26T10:00:00Z');
      expect(actual.updatedAt).toBe('2026-09-27T10:00:00Z');
      expect(parsed.preparation.localHeadSha).toBe('local-B');
      expect(parsed.publication.state).toBe('local-ahead');
      expect(parsed.gitReceipts).toEqual([]);
    },
  );

  it('keeps missing and legacy-defaulted metadata explicitly unknown', () => {
    const actual: NativeReviewDetails = {
      ...review(),
      body: null,
      state: null,
      draft: null,
      sourceBranch: null,
      targetBranch: null,
      source: null,
      target: null,
      author: null,
      mergeable: null,
      mergeableState: null,
      headSha: null,
      createdAt: null,
      updatedAt: null,
    };

    expect(NativeReviewDetailsSchema.parse(actual)).toEqual(actual);
  });

  const states: NativeReviewState[] = ['open', 'locked', 'closed', 'merged'];
  it.each(states)('retains faithful provider state %s separately from draft', (state) => {
    expect(NativeReviewStateSchema.parse(state)).toBe(state);
    expect(NativeReviewDetailsSchema.parse({ ...review(), state, draft: null }).state).toBe(state);
  });

  it('preserves a confirmed false draft instead of replacing it with unknown', () => {
    expect(NativeReviewDetailsSchema.parse({ ...review(), draft: false }).draft).toBe(false);
  });

  it('retains different fork source and target identities with an unknown project path', () => {
    const source: NativeReviewBranchIdentity = {
      provider: 'gitlab',
      instanceBaseUrl: 'https://git.example:8443/gitlab',
      projectId: '18446744073709551615',
      projectPath: null,
      branch: 'feature',
    };
    const target: NativeReviewBranchIdentity = {
      ...source,
      projectId: '42',
      projectPath: 'team/app',
      branch: 'main',
    };
    const parsed = NativeReviewDetailsSchema.parse({ ...review(), source, target });

    expect(parsed.source).toEqual(source);
    expect(parsed.target).toEqual(target);
    expect(parsed.source?.projectId).not.toBe(parsed.target?.projectId);
  });

  it('keeps GitHub resource identity and absent confirmed branches without borrowing request targets', () => {
    const actual: NativeReviewDetails = {
      ...review(),
      resource: {
        repository: {
          provider: 'github',
          instanceBaseUrl: 'https://github.com',
          projectPath: 'team/app',
        },
        kind: 'pull-request',
        number: 7,
      },
      url: 'https://github.com/team/app/pull/7',
      source: null,
      target: null,
    };
    expect(NativeReviewDetailsSchema.parse(actual)).toEqual(actual);
  });

  it.each(['included', 'local-ahead', 'diverged'] as const)(
    'preserves supplied %s evidence without deducing ancestry from unequal SHAs',
    (state) => {
      const publication: NativeReviewPublication = {
        state,
        localHeadSha: 'local-B',
        remoteSourceSha: 'remote-A',
      };
      const value = { ...execution(), publication };

      expect(NativeReviewPublicationSchema.parse(publication)).toEqual(publication);
      expect(NativeReviewExecutionSchema.parse(value).publication).toEqual(publication);
    },
  );

  it('distinguishes an absent remote branch, unknown remote, and unborn local branch', () => {
    const values: NativeReviewPublication[] = [
      { state: 'remote-branch-missing', localHeadSha: 'local-B' },
      { state: 'unknown', localHeadSha: 'local-B', remoteSourceSha: null },
      { state: 'unknown', localHeadSha: null, remoteSourceSha: null },
    ];
    expect(values.map((value) => NativeReviewPublicationSchema.parse(value))).toEqual(values);
  });
});

describe('native captured identities and strict scalar decoding', () => {
  it('keeps source and target connections independent and full-range counters exact', () => {
    const value = preparation();
    const target: NativeReviewBranchTarget = {
      ...value.target,
      connection: {
        connectionId: 'target-connection',
        accountId: 'target-account',
        connectionGeneration: '9007199254740994',
      },
    };
    const parsed = NativeReviewPreparationSchema.parse({ ...value, target });

    expect(parsed.scope.authorityGeneration).toBe('9007199254740995');
    expect(parsed.contextRevision.sequence).toBe('9007199254740993');
    expect(parsed.source.connection?.connectionGeneration).toBe('18446744073709551615');
    expect(parsed.target.connection?.connectionGeneration).toBe('9007199254740994');
    expect(parsed.source.connection).not.toEqual(parsed.target.connection);
    expect(parsed.source.providerProjectId).toBe('18446744073709551615');
    expect(NativeReviewBranchTargetSchema.parse(target)).toEqual(target);
  });

  it.each([42, '01', '-1', '1e3', '18446744073709551616'])(
    'rejects noncanonical nested counters %j rather than coercing',
    (counter) => {
      const value = preparation();
      const connection = {
        connectionId: 'connection',
        accountId: 'account',
        connectionGeneration: counter,
      };
      const candidates = [
        { ...value, scope: { ...value.scope, authorityGeneration: counter } },
        { ...value, contextRevision: { ...value.contextRevision, sequence: counter } },
        { ...value, source: { ...value.source, connection } },
        { ...value, target: { ...value.target, connection } },
      ];
      for (const candidate of candidates) {
        expect(NativeReviewPreparationSchema.safeParse(candidate).success).toBe(false);
      }
    },
  );

  it('rejects numeric project IDs but preserves opaque strings and unknown selected IDs', () => {
    const selected = preparation().source;
    expect(
      NativeReviewBranchTargetSchema.safeParse({ ...selected, providerProjectId: 42 }).success,
    ).toBe(false);
    expect(
      NativeReviewBranchTargetSchema.parse({
        ...selected,
        providerProjectId: null,
        connection: null,
      }).providerProjectId,
    ).toBeNull();
    const identity = fixture.execute.reviewExecution.outcome.review.source;
    expect(NativeReviewBranchIdentitySchema.safeParse({ ...identity, projectId: 42 }).success).toBe(
      false,
    );
    expect(
      NativeReviewBranchIdentitySchema.parse({ ...identity, projectId: 'opaque-provider-id' })
        .projectId,
    ).toBe('opaque-provider-id');
  });

  it('retains every observed destination and distinguishes unknown transport from empty arrays', () => {
    const transport: NativeReviewTransport = {
      remoteName: 'origin',
      fetchUrls: ['https://git.example/selected.git'],
      pushUrls: ['ssh://git@git.example/selected.git', 'ssh://git@github.com/other/project.git'],
    };
    expect(NativeReviewTransportSchema.parse(transport)).toEqual(transport);
    expect(NativeReviewPreparationSchema.parse({ ...preparation(), transport }).transport).toEqual(
      transport,
    );
    expect(
      NativeReviewPreparationSchema.parse({ ...preparation(), transport: null }).transport,
    ).toBeNull();
    const empty = { remoteName: 'origin', fetchUrls: [], pushUrls: [] };
    expect(NativeReviewTransportSchema.parse(empty)).toEqual(empty);
    expect(
      NativeReviewTransportSchema.safeParse({
        remoteName: 'origin',
        fetchUrl: 'old',
        pushUrl: 'old',
      }).success,
    ).toBe(false);
  });

  it('retains an explicit registered root and unknown local HEAD', () => {
    const root = { workspaceId: 'workspace-other', kind: 'registered', gitRootId: 'root-original' };
    const value = { ...preparation(), root, localHeadSha: null };
    expect(NativeReviewPreparationSchema.parse(value)).toEqual(value);
  });

  const stages: NativeReviewStage[] = ['commit', 'push', 'create-pr'];
  it.each(stages)('keeps the existing %s stage spelling', (stage) => {
    expect(NativeReviewStageSchema.parse(stage)).toBe(stage);
  });

  it.each(['created', 'reused'])('requires actual provider details for a %s outcome', (status) => {
    expect(NativeReviewOutcomeSchema.safeParse({ status }).success).toBe(false);
    expect(
      NativeReviewOutcomeSchema.safeParse({ status, review: { title: 'Submitted guess' } }).success,
    ).toBe(false);
  });

  it('exposes no review through a non-review variant even if an unrelated field supplies one', () => {
    const uncertain = { status: 'uncertain', stage: 'create-pr', message: 'Response lost' };
    expect(NativeReviewOutcomeSchema.parse({ ...uncertain, review: review() })).toEqual(uncertain);
  });

  it('rejects malformed stage, outcome, state, publication and receipt fields', () => {
    expect(NativeReviewStageSchema.safeParse('create-mr').success).toBe(false);
    expect(
      NativeReviewOutcomeSchema.safeParse({ status: 'success', review: review() }).success,
    ).toBe(false);
    expect(NativeReviewStateSchema.safeParse('draft').success).toBe(false);
    expect(NativeReviewDetailsSchema.safeParse({ ...review(), draft: 'false' }).success).toBe(
      false,
    );
    expect(
      NativeReviewPublicationSchema.safeParse({
        state: 'included',
        localHeadSha: 'B',
        remoteSourceSha: null,
      }).success,
    ).toBe(false);
    expect(NativeReviewGitReceiptSchema.safeParse({ stage: 'commit' }).success).toBe(false);
    expect(
      NativeReviewGitReceiptSchema.safeParse({ stage: 'create-pr', commitHash: 'B' }).success,
    ).toBe(false);
  });
});

// Services omits account facts for a non-admin native Member. Authored from Core8f.
describe('omitted native connection observations', () => {
  it.each(['source', 'target'] as const)('preserves an omitted %s connection', (side) => {
    const value = structuredClone(fixture.prepare.reviewPreparation);
    Reflect.deleteProperty(value[side], 'connection');
    expect(NativeReviewPreparationSchema.parse(value)).toEqual(value);
    expect(NativeReviewPreparationSchema.parse(value)[side]).not.toHaveProperty('connection');
  });
});
