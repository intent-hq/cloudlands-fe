import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/native-review-v1.json';
import {
  NativeReviewInputSchema,
  NativeReviewCaptureSchema,
  NativeReviewTextCommandSchema,
  NativeReviewExecuteResultSchema,
  NativeReviewReconcileResultSchema,
  NativeReviewNoticeSchema,
} from './native-review-operation';
const root = { workspaceId: 'A', kind: 'primary' as const };
const input = {
  workspaceId: 'A',
  action: 'create-pr',
  review: { root, choice: { kind: 'saved' } },
};
describe('compiled native operation boundary', () => {
  it('keeps independent options, strict target and registered root without acquiring authority', () => {
    const request = {
      ...input,
      action: 'commit',
      options: { createPRAfterPush: true, pushAfterCommit: false },
      files: [],
      review: {
        root: { ...root, kind: 'registered', gitRootId: 'other' },
        choice: {
          kind: 'explicitTarget',
          target: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://host/gitlab',
            projectPath: 'team/repo',
          },
        },
      },
    };
    expect(NativeReviewInputSchema.parse(request)).toEqual(request);
  });
  it.each([
    { ...input, workspaceId: 'other' },
    { ...input, options: { pushAfterCommit: true } },
    { ...input, files: [] },
    { ...input, options: null },
    { ...input, backendId: 'B' },
    { ...input, review: null },
    { ...input, review: { ...input.review, operationId: 'forged' } },
    { ...input, review: { ...input.review, root: { ...root, gitRootId: 'widen' } } },
  ])('refuses widened or invalid preparation %j', (value) => {
    expect(NativeReviewInputSchema.safeParse(value).success).toBe(false);
  });
  it('allows only text in a command; stages, options and root were captured before confirmation', () => {
    expect(NativeReviewTextCommandSchema.parse({ prTitle: 'actual', prBody: null })).toEqual({
      prTitle: 'actual',
      prBody: null,
    });
    for (const field of [
      'root',
      'action',
      'review',
      'operationId',
      'files',
      'options',
      'backendId',
    ])
      expect(NativeReviewTextCommandSchema.safeParse({ [field]: 'override' }).success).toBe(false);
  });
  it('preserves the nonadmin omission without inferred facts or legacy aliases', () => {
    const preparation = structuredClone(fixture.prepare.reviewPreparation);
    Reflect.deleteProperty(preparation.source, 'connection');
    Reflect.deleteProperty(preparation.target, 'connection');
    const wire = {
      ...fixture.prepare,
      reviewPreparation: preparation,
      reviewOperation: {
        operationId: preparation.operationId,
        root: preparation.root,
        retirementSequence: '18446744073709551615',
        expiresAfterMs: 300000,
      },
    };
    expect(NativeReviewCaptureSchema.parse(wire)).toEqual(wire);
  });
  it('keeps reconcile facts separate from an actual execute envelope and preserves failed completed Git receipts', () => {
    const execution = structuredClone(fixture.execute.reviewExecution);
    const wire = {
      operationId: execution.preparation.operationId,
      root: execution.preparation.root,
      state: 'settled',
      reviewExecution: execution,
    };
    const reconciled = NativeReviewReconcileResultSchema.parse(wire);
    expect(reconciled).toEqual(wire);
    expect(reconciled).not.toHaveProperty('success');
    expect(NativeReviewExecuteResultSchema.safeParse(wire).success).toBe(false);
    const pending = { operationId: wire.operationId, root: wire.root, state: 'pending' };
    expect(NativeReviewReconcileResultSchema.parse(pending)).toEqual(pending);
    expect(
      NativeReviewReconcileResultSchema.safeParse({ ...pending, reviewExecution: execution })
        .success,
    ).toBe(false);
  });
  it.each([1, '01', '-1', '18446744073709551616'])(
    'refuses a noncanonical cursor %j',
    (sequence) => {
      expect(
        NativeReviewNoticeSchema.safeParse({
          operationIds: ['id'],
          sequence,
          allRetired: false,
          terminal: false,
        }).success,
      ).toBe(false);
    },
  );
});

// Manually authored from d317's strict presence-discriminated Core parser.
describe('marked staged commit companion input', () => {
  const marked = {
    ...input,
    action: 'commit',
    review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' } },
  };
  it('preserves the complete preconfirmation intent without adding options or facts', () => {
    expect(NativeReviewInputSchema.parse(marked)).toEqual(marked);
    const explicit = {
      ...marked,
      review: {
        ...marked.review,
        choice: {
          kind: 'explicitTarget',
          target: fixture.prepare.reviewPreparation.target.repository,
        },
      },
    };
    expect(NativeReviewInputSchema.parse(explicit)).toEqual(explicit);
  });
  it.each([
    { files: null },
    { files: [] },
    { options: null },
    { options: {} },
    { options: { stageUnstaged: false } },
    { action: 'push' },
    { action: 'create-pr' },
  ])('rejects a present stage override %j before dispatch', (extra) => {
    expect(NativeReviewInputSchema.safeParse({ ...marked, ...extra }).success).toBe(false);
  });
  it.each([
    { pushRemote: null },
    { pushRemote: 'origin' },
    { targetBranch: null },
    { targetBranch: '' },
    { companion: null },
    { companion: {} },
    { companion: { kind: 'create-pr', target: 'changed' } },
    {
      choice: {
        kind: 'afterCommit',
        operationId: 'aaaaaaaa-0000-4000-8000-000000000001',
        captureId: 'aaaaaaaa-0000-4000-8000-000000000002',
      },
    },
  ])('rejects widened or absent intended review metadata %j', (extra) => {
    expect(
      NativeReviewInputSchema.safeParse({ ...marked, review: { ...marked.review, ...extra } })
        .success,
    ).toBe(false);
  });
  it('keeps an ordinary unmarked commit and old custom session independent of companions', () => {
    const ordinary = {
      ...input,
      action: 'commit',
      files: null,
      options: { createPRAfterPush: true },
      review: { ...input.review, targetBranch: null, pushRemote: null },
    };
    expect(NativeReviewInputSchema.parse(ordinary)).toEqual(ordinary);
    const { targetBranch: _target, ...review } = marked.review;
    expect(NativeReviewInputSchema.safeParse({ ...marked, review }).success).toBe(false);
  });
});
