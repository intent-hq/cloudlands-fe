import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/repository-context.json';
import {
  RepositoryContextSchema,
  RepositoryTargetSchema,
  ReviewTargetSchema,
  RepositoryConnectionScopeSchema,
  RepositoryContextRevisionSchema,
  RepositoryRootIdentitySchema,
  RepositorySavedChoiceSchema,
  RepositorySelectionSchema,
  RepositoryRootContextSchema,
  ExecutionScopeSchema,
  compareRepositoryContextRevisions,
  executionScopeKey,
  repositoryTargetKey,
  repositoryConnectionScopeKey,
  repositoryRootKey,
  reviewTargetKey,
  sameExecutionScope,
  sameRepositoryConnectionScope,
  RepositoryAvailabilitySchema,
  RepositoryCapabilitySchema,
  type RepositoryAvailability,
  type RepositoryCapability,
} from './repository-context';

const context = RepositoryContextSchema.parse(fixture);
const target = context.roots[0].targets[0].target;

describe('core repository-context serialization fixture', () => {
  it('keeps different forge accounts and unavailable targets separate in one inventory', () => {
    const availability: RepositoryAvailability = 'disabled';
    const capability: RepositoryCapability = { operation: 'push', state: 'unavailable' };
    const github = {
      provider: 'github',
      instanceBaseUrl: 'https://github.com',
      projectPath: 'team/other',
    };
    const wire = structuredClone(fixture);
    const root = wire.roots[0];
    const mixed = {
      ...wire,
      roots: [
        {
          ...root,
          targets: [
            ...root.targets,
            {
              target: github,
              connection: {
                connectionId: 'github-connection',
                accountId: 'account-other',
                connectionGeneration: '91',
              },
              availability,
              capabilities: [capability],
            },
          ],
        },
        {
          root: { workspaceId: 'workspace-1', kind: 'registered', gitRootId: 'root-no-remote' },
          remotes: [],
          targets: [],
          reviewSelection: {
            saved: { mode: 'explicit-remote', remoteName: 'lost' },
            noRemotes: true,
            outcome: {
              state: 'repository-unavailable',
              reason: 'no-remote',
              selectionRequired: true,
            },
          },
        },
      ],
    };
    expect(RepositoryContextSchema.parse(mixed)).toEqual(mixed);
    expect(RepositoryAvailabilitySchema.parse(availability)).toBe('disabled');
    expect(RepositoryCapabilitySchema.parse(capability)).toEqual(capability);
    expect(
      RepositoryCapabilitySchema.safeParse({ ...capability, operation: 'unregistered-operation' })
        .success,
    ).toBe(false);
  });

  it('preserves the complete agreed backend fixture without inventing defaults', () => {
    expect(context).toEqual(fixture);
    expect(RepositoryRootContextSchema.parse(fixture.roots[0])).toEqual(fixture.roots[0]);
  });

  it('keeps absence, unavailable capability, and disconnected connection explicit', () => {
    const root = structuredClone(fixture.roots[0]);
    const wire = {
      ...root,
      branch: undefined,
      headSha: undefined,
      targets: [
        {
          target,
          availability: 'disconnected',
          capabilities: [{ operation: 'read-review', state: 'unavailable' }],
        },
      ],
    };
    expect(RepositoryRootContextSchema.parse(wire)).toEqual(wire);
    expect(RepositoryRootContextSchema.parse(wire).targets[0].connection).toBeUndefined();
  });

  it('retains saved selection and no-remote without resolving a hosted default', () => {
    const saved = {
      mode: 'migrated-canonical',
      target,
      provenance: {
        source: 'workspace-metadata',
        recordId: 'record-1',
        resolverVersion: 'legacy-1',
        evidenceId: 'proof-1',
      },
    };
    expect(RepositorySavedChoiceSchema.parse(saved)).toEqual(saved);
    const selection = {
      saved,
      noRemotes: true,
      outcome: { state: 'repository-unavailable', reason: 'no-remote', selectionRequired: true },
    };
    expect(RepositorySelectionSchema.parse(selection)).toEqual(selection);
  });

  // Manually composed from intent-core repository_context.rs at 6272988100d1:
  // unknown_availability_does_not_invent_connection_or_capability and
  // unresolved_history_serializes_only_known_source_and_record_facts.
  it.each([
    { mode: 'unresolved-historical' },
    { mode: 'unresolved-historical', source: 'workspace-metadata', recordId: 'workspace-1' },
    { mode: 'unresolved-historical', source: 'registered-root-metadata', recordId: 'root-1' },
    { mode: 'unresolved-historical', source: 'workspace-metadata' },
    { mode: 'unresolved-historical', recordId: 'retained-record' },
    // Option<String> also serializes Some("") as a present empty string.
    { mode: 'unresolved-historical', recordId: '' },
  ])('preserves unknown availability and unresolved historical facts: %j', (saved) => {
    const wire = {
      ...fixture,
      roots: [
        {
          ...fixture.roots[0],
          targets: [
            {
              target,
              availability: 'unknown',
              capabilities: [{ operation: 'read-review', state: 'unknown' }],
            },
          ],
          reviewSelection: {
            saved,
            noRemotes: false,
            outcome: { state: 'selection-required', reason: 'unresolved-historical-choice' },
          },
        },
      ],
    };
    // Strict equality also requires unknown connection, project ID and optional
    // historical facts to stay absent, rather than adding undefined or defaults.
    expect(RepositoryContextSchema.parse(wire)).toStrictEqual(wire);
  });

  it.each([
    { mode: 'unresolved-historical' },
    { mode: 'unresolved-historical', source: 'registered-root-metadata', recordId: 'root-1' },
  ])('retains unresolved historical choice without remotes: %j', (saved) => {
    const wire = {
      ...fixture,
      roots: [
        {
          root: fixture.roots[0].root,
          remotes: [],
          targets: [],
          reviewSelection: {
            saved,
            noRemotes: true,
            outcome: {
              state: 'repository-unavailable',
              reason: 'no-remote',
              selectionRequired: true,
            },
          },
        },
      ],
    };
    expect(RepositoryContextSchema.parse(wire)).toStrictEqual(wire);
  });

  it.each([{ mode: 'automatic' }, { mode: 'explicit-remote', remoteName: 'upstream' }])(
    'preserves existing saved choice: %j',
    (saved) => {
      expect(RepositorySavedChoiceSchema.parse(saved)).toStrictEqual(saved);
    },
  );

  it('rejects invented historical facts and unrecognized states', () => {
    for (const metadata of [
      { source: 'current-remotes' },
      { source: null },
      { recordId: null },
      { recordId: 17 },
    ]) {
      expect(
        RepositorySavedChoiceSchema.safeParse({ mode: 'unresolved-historical', ...metadata })
          .success,
      ).toBe(false);
    }
    expect(RepositorySavedChoiceSchema.safeParse({ mode: 'historical' }).success).toBe(false);
    expect(RepositoryAvailabilitySchema.safeParse('assumed-connected').success).toBe(false);
    expect(
      RepositorySelectionSchema.safeParse({
        saved: { mode: 'automatic' },
        noRemotes: false,
        outcome: { state: 'selection-required', reason: 'assumed-history' },
      }).success,
    ).toBe(false);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity])(
    'rejects an inexact or invalid counter: %s',
    (sequence) => {
      expect(RepositoryContextRevisionSchema.safeParse({ epoch: 'boot', sequence }).success).toBe(
        false,
      );
      expect(
        ExecutionScopeSchema.safeParse({ ...context.scope, authorityGeneration: sequence }).success,
      ).toBe(false);
      expect(
        RepositoryConnectionScopeSchema.safeParse({
          connectionId: 'c',
          accountId: 'a',
          connectionGeneration: sequence,
        }).success,
      ).toBe(false);
    },
  );

  it('requires workspace-bound root identity and full qualified target fields', () => {
    expect(
      RepositoryRootIdentitySchema.safeParse({ kind: 'registered', gitRootId: 'root-1' }).success,
    ).toBe(false);
    expect(
      RepositoryTargetSchema.safeParse({ provider: 'gitlab', projectPath: 'team/sub/app' }).success,
    ).toBe(false);
    expect(
      ReviewTargetSchema.safeParse({ repository: target, kind: 'issue', number: 0 }).success,
    ).toBe(false);
  });
});

describe('qualified identity and revision helpers', () => {
  it('distinguishes provider, logical port/prefix, project case, resource kind and number', () => {
    const variants = [
      target,
      { ...target, provider: 'github' as const },
      { ...target, instanceBaseUrl: 'https://git.example/gitlab' },
      { ...target, instanceBaseUrl: 'https://git.example:8443/other' },
      { ...target, projectPath: 'Team/sub/app' },
    ];
    expect(new Set(variants.map(repositoryTargetKey)).size).toBe(variants.length);
    const keys = ['pull-request', 'merge-request', 'issue'].flatMap((kind) =>
      [17, 18].map((number) =>
        reviewTargetKey(ReviewTargetSchema.parse({ repository: target, kind, number })),
      ),
    );
    expect(new Set(keys).size).toBe(6);
    expect(repositoryRootKey({ workspaceId: 'w', kind: 'primary' })).not.toBe(
      repositoryRootKey({ workspaceId: 'w', kind: 'registered', gitRootId: 'primary' }),
    );
  });

  it('orders only within identical execution scope and epoch', () => {
    expect(compareRepositoryContextRevisions(context, context)).toBe(0);
    const next = { ...context, revision: { ...context.revision, sequence: '9007199254740994' } };
    expect(compareRepositoryContextRevisions(context, next)).toBe(-1);
    expect(compareRepositoryContextRevisions(next, context)).toBe(1);
    expect(
      compareRepositoryContextRevisions(context, {
        ...context,
        revision: { epoch: 'restarted', sequence: '0' },
      }),
    ).toBeNull();
    for (const scope of [
      { ...context.scope, daemonId: 'another-daemon' },
      { ...context.scope, authorityScopeId: 'another-caller' },
      { ...context.scope, authorityGeneration: '9007199254740996' },
    ]) {
      expect(sameExecutionScope(context.scope, scope)).toBe(false);
      expect(executionScopeKey(context.scope)).not.toBe(executionScopeKey(scope));
      expect(compareRepositoryContextRevisions(context, { ...context, scope })).toBeNull();
    }
  });

  it('does not conflate same-connection replacement accounts or generations', () => {
    const scope = { connectionId: 'c', accountId: 'a', connectionGeneration: '1' };
    expect(sameRepositoryConnectionScope(scope, { ...scope })).toBe(true);
    for (const other of [
      { ...scope, connectionId: 'd' },
      { ...scope, accountId: 'b' },
      { ...scope, connectionGeneration: '2' },
    ]) {
      expect(sameRepositoryConnectionScope(scope, other)).toBe(false);
      expect(repositoryConnectionScopeKey(scope)).not.toBe(repositoryConnectionScopeKey(other));
    }
  });
});
