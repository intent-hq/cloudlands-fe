import { describe, expect, it } from 'vitest';
import fixture from '$shared/types/__fixtures__/native-review-v1.json';
import {
  NativeReviewExecutionSchema,
  type NativeReviewExecuteExtension,
  type NativeReviewExecution,
  type NativeReviewOutcome,
  type NativeReviewPublication,
} from '$shared/types/native-review';
import type { AcceptChangesResult } from '../types';
import { projectNativeReviewResult } from '../native-review-result';

type Response = AcceptChangesResult & NativeReviewExecuteExtension;

function execution(provider: 'github' | 'gitlab' = 'gitlab'): NativeReviewExecution {
  const value = NativeReviewExecutionSchema.parse(structuredClone(fixture.execute.reviewExecution));
  if (provider === 'github') {
    const repository = {
      provider: 'github' as const,
      instanceBaseUrl: 'https://github.com',
      projectPath: 'team/app',
    };
    value.preparation.source.repository = repository;
    value.preparation.target.repository = repository;
    for (const target of [value.preparation.source, value.preparation.target]) {
      if (target.connection) target.connection.connectionId = 'github-connection';
    }
    value.preparation.transport = {
      remoteName: 'origin',
      fetchUrls: ['https://github.com/team/app.git'],
      pushUrls: ['git@github.com:team/app.git'],
    };
    if (value.outcome.status !== 'reused') throw new Error('Expected canonical reused fixture');
    value.outcome.review.resource = { repository, kind: 'pull-request', number: 7 };
    value.outcome.review.url = 'https://github.com/team/app/pull/7';
    for (const identity of [value.outcome.review.source, value.outcome.review.target]) {
      if (identity) {
        identity.provider = 'github';
        identity.instanceBaseUrl = 'https://github.com';
      }
    }
  }
  return value;
}

function response(value = execution(), success = true): Response {
  return { success, steps: [], reviewExecution: value };
}

function commitResponse(provider: 'github' | 'gitlab' = 'gitlab'): Response {
  const value = execution(provider);
  value.requestId = 'request-commit';
  value.preparation.operationId = 'operation-commit';
  value.preparation.localHeadSha = 'local-A';
  value.gitReceipts = [{ stage: 'commit', commitHash: 'local-B' }];
  value.outcome = { status: 'not-attempted' };
  value.publication = { state: 'unknown', localHeadSha: 'local-B', remoteSourceSha: null };
  return {
    ...response(value),
    steps: [{ id: 'commit', name: 'Commit', status: 'completed' }],
    result: { commitHash: 'local-B' },
  };
}

describe.each(['github', 'gitlab'] as const)('native %s result presentation', (provider) => {
  it.each(['created', 'reused'] as const)(
    '%s uses actual provider metadata, retaining unpublished local work separately',
    (status) => {
      const value = execution(provider);
      if (value.outcome.status !== 'reused') throw new Error('Expected canonical reused fixture');
      value.outcome = { status, review: value.outcome.review };
      const wire = response(value);
      // Legacy aliases cannot replace the qualified provider observation.
      wire.result = { prNumber: 999, prHtmlUrl: 'https://old.example/pull/999', existingPR: false };

      const view = projectNativeReviewResult(wire);

      expect(view.kind).toBe('native');
      if (view.kind !== 'native') throw new Error('Expected native presentation');
      expect(view.formDisposition).toBe('complete');
      expect(view.requiresReconciliation).toBe(false);
      expect(view.review).toMatchObject({
        resource: { repository: { provider }, number: 7 },
        title: 'Existing provider title',
        body: 'Existing provider body',
        state: 'open',
        draft: true,
        createdAt: '2026-09-26T10:00:00Z',
        updatedAt: '2026-09-27T10:00:00Z',
      });
      expect(view.execution.outcome.status).toBe(status);
      expect(view.execution.publication).toEqual({
        state: 'local-ahead',
        localHeadSha: 'local-B',
        remoteSourceSha: 'remote-A',
      });
      expect(view.execution.gitReceipts).toEqual([]);
      expect(view.response.result).toEqual(wire.result);
    },
  );

  it('does not fill unknown state, draft, project identity or timestamps', () => {
    const value = execution(provider);
    if (value.outcome.status !== 'reused') throw new Error('Expected canonical reused fixture');
    Object.assign(value.outcome.review, {
      state: null,
      draft: null,
      source: null,
      target: null,
      createdAt: null,
      updatedAt: null,
      headSha: null,
    });

    const view = projectNativeReviewResult(response(value));

    if (view.kind !== 'native') throw new Error('Expected native presentation');
    expect(view.review).toMatchObject({
      state: null,
      draft: null,
      source: null,
      target: null,
      createdAt: null,
      updatedAt: null,
      headSha: null,
    });
    expect(view.formDisposition).toBe('complete');
  });

  it.each(['failed', 'uncertain'] as const)(
    'keeps a completed sidebar commit separate when creation is %s',
    (status) => {
      const commit = commitResponse(provider);
      const value = execution(provider);
      value.outcome =
        status === 'failed'
          ? { status, stage: 'create-pr', code: null, message: 'Creation refused' }
          : { status, stage: 'create-pr', message: 'Response lost' };
      const create = response(value, false);
      create.error = value.outcome.message;
      const history = Object.freeze([commit]);

      const view = projectNativeReviewResult(create, history);

      if (view.kind !== 'native') throw new Error('Expected native presentation');
      expect(view.formDisposition).toBe('retain');
      expect(view.requiresReconciliation).toBe(status === 'uncertain');
      expect(view.review).toBeNull();
      expect(view.history).toHaveLength(2);
      expect(view.history[0]).toBe(commit);
      expect(view.history[0]?.result?.commitHash).toBe('local-B');
      expect(view.history[0]?.reviewExecution?.requestId).toBe('request-commit');
      expect(view.history[0]?.reviewExecution?.gitReceipts).toEqual([
        { stage: 'commit', commitHash: 'local-B' },
      ]);
      expect(view.history[1]).toBe(create);
      expect(view.execution.requestId).toBe('request-create');
      expect(view.execution.gitReceipts).toEqual([]);
      expect(history).toHaveLength(1);
    },
  );
});

describe('native result evidence boundaries', () => {
  it('retains the creation form after a successful commit-only response', () => {
    const view = projectNativeReviewResult(commitResponse());

    if (view.kind !== 'native') throw new Error('Expected native presentation');
    expect(view.response.success).toBe(true);
    expect(view.formDisposition).toBe('retain');
    expect(view.review).toBeNull();
    expect(view.requiresReconciliation).toBe(false);
  });

  it.each<NativeReviewPublication>([
    { state: 'included', localHeadSha: 'local-B', remoteSourceSha: 'remote-C' },
    { state: 'local-ahead', localHeadSha: 'local-B', remoteSourceSha: 'remote-A' },
    { state: 'diverged', localHeadSha: 'local-B', remoteSourceSha: 'remote-C' },
    { state: 'remote-branch-missing', localHeadSha: null },
    { state: 'unknown', localHeadSha: 'local-B', remoteSourceSha: 'local-B' },
  ])(
    'does not infer publication from commit, push, review head or success: $state',
    (publication) => {
      const value = execution();
      value.gitReceipts = [
        { stage: 'commit', commitHash: 'local-B' },
        { stage: 'push', pushedSha: 'local-B' },
      ];
      value.publication = publication;

      const view = projectNativeReviewResult(response(value));

      if (view.kind !== 'native') throw new Error('Expected native presentation');
      expect(view.formDisposition).toBe('complete');
      expect(view.execution.publication).toEqual(publication);
      expect(view.execution.gitReceipts).toHaveLength(2);
    },
  );

  it.each<NativeReviewOutcome>([
    { status: 'failed', stage: 'push', code: null, message: 'Push refused' },
    { status: 'uncertain', stage: 'create-pr', message: 'Response lost' },
  ])('preserves own completed pipeline stages without inventing a review: $status', (outcome) => {
    const value = execution();
    value.gitReceipts = [{ stage: 'commit', commitHash: 'local-B' }];
    value.outcome = outcome;
    const wire = response(value, false);
    wire.result = { commitHash: 'local-B', prNumber: 7, prUrl: 'https://old.example/7' };
    wire.steps = [{ id: 'push', name: 'Push', status: 'failed', error: 'Push refused' }];

    const view = projectNativeReviewResult(wire);

    if (view.kind !== 'native') throw new Error('Expected native presentation');
    expect(view.formDisposition).toBe('retain');
    expect(view.review).toBeNull();
    expect(view.execution.gitReceipts).toEqual([{ stage: 'commit', commitHash: 'local-B' }]);
    expect(view.response.result?.commitHash).toBe('local-B');
    expect(view.response.steps[0]?.error).toBe('Push refused');
  });

  it('retains the form if the envelope failed even when actual review details were returned', () => {
    const view = projectNativeReviewResult(response(execution(), false));

    if (view.kind !== 'native') throw new Error('Expected native presentation');
    expect(view.review?.title).toBe('Existing provider title');
    expect(view.formDisposition).toBe('retain');
  });

  it('leaves an old-daemon result on the legacy path without manufacturing native evidence', () => {
    const wire: Response = {
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
      },
      futureField: { kept: true },
    };
    const before = structuredClone(wire);

    const view = projectNativeReviewResult(wire);

    expect(view.kind).toBe('legacy');
    expect(view.response).toBe(wire);
    expect(view.response).toEqual(before);
    expect(view).not.toHaveProperty('execution');
    expect(view).not.toHaveProperty('review');
    expect(view).not.toHaveProperty('formDisposition');
    expect(view).not.toHaveProperty('requiresReconciliation');
  });

  it('does not reuse a prior native outcome after a transport failure lacks an extension', () => {
    const commit = commitResponse();
    const lost: AcceptChangesResult = { success: false, steps: [], error: 'Response lost' };

    const view = projectNativeReviewResult(lost, [commit]);

    expect(view.kind).toBe('legacy');
    expect(view.response).toBe(lost);
    expect(view.history[0]?.result?.commitHash).toBe('local-B');
    expect(view.history[1]).toBe(lost);
    expect(view).not.toHaveProperty('execution');
    expect(view).not.toHaveProperty('formDisposition');
  });
});
