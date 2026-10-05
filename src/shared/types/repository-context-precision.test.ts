import { describe, expect, it } from 'vitest';
import {
  ExecutionScopeSchema,
  RepositoryConnectionScopeSchema,
  RepositoryContextRevisionSchema,
  compareRepositoryContextRevisions,
  executionScopeKey,
  repositoryConnectionScopeKey,
} from './repository-context';

const execution = { daemonId: 'daemon-A', authorityScopeId: 'caller-1' };
const connection = { connectionId: 'forge-A', accountId: 'account-1' };

describe('core v2 decimal u64 counter contract', () => {
  it.each(['0', '9', '10', '9007199254740993', '18446744073709551615'])(
    'round-trips %s exactly in all three new counter fields',
    (counter) => {
      const scope = ExecutionScopeSchema.parse({ ...execution, authorityGeneration: counter });
      const account = RepositoryConnectionScopeSchema.parse({
        ...connection,
        connectionGeneration: counter,
      });
      const revision = RepositoryContextRevisionSchema.parse({ epoch: 'boot', sequence: counter });
      expect(JSON.parse(JSON.stringify({ scope, account, revision }))).toEqual({
        scope: { ...execution, authorityGeneration: counter },
        account: { ...connection, connectionGeneration: counter },
        revision: { epoch: 'boot', sequence: counter },
      });
    },
  );

  it.each([
    0,
    1,
    9007199254740992,
    -1,
    0.5,
    '',
    '00',
    '01',
    '+1',
    '-1',
    ' 1',
    '1 ',
    '1e3',
    '1.5',
    '18446744073709551616',
    '999999999999999999999',
  ])('rejects noncanonical or overflowing counter %j', (counter) => {
    expect(
      ExecutionScopeSchema.safeParse({ ...execution, authorityGeneration: counter }).success,
    ).toBe(false);
    expect(
      RepositoryConnectionScopeSchema.safeParse({ ...connection, connectionGeneration: counter })
        .success,
    ).toBe(false);
    expect(
      RepositoryContextRevisionSchema.safeParse({ epoch: 'boot', sequence: counter }).success,
    ).toBe(false);
  });

  it.each([
    ['9', '10'],
    ['9007199254740992', '9007199254740993'],
    ['18446744073709551614', '18446744073709551615'],
  ])(
    'orders %s before %s without Number conversion or lexical counter ordering',
    (earlier, later) => {
      const scope = ExecutionScopeSchema.parse({
        ...execution,
        authorityGeneration: '9007199254740995',
      });
      const left = {
        scope,
        revision: RepositoryContextRevisionSchema.parse({ epoch: 'boot', sequence: earlier }),
      };
      const right = {
        scope,
        revision: RepositoryContextRevisionSchema.parse({ epoch: 'boot', sequence: later }),
      };
      expect(compareRepositoryContextRevisions(left, right)).toBe(-1);
      expect(compareRepositoryContextRevisions(right, left)).toBe(1);
      expect(compareRepositoryContextRevisions(left, left)).toBe(0);
    },
  );

  it('keeps adjacent large execution and connection generations distinct', () => {
    const a = ExecutionScopeSchema.parse({ ...execution, authorityGeneration: '9007199254740992' });
    const b = ExecutionScopeSchema.parse({ ...execution, authorityGeneration: '9007199254740993' });
    const ca = RepositoryConnectionScopeSchema.parse({
      ...connection,
      connectionGeneration: '9007199254740992',
    });
    const cb = RepositoryConnectionScopeSchema.parse({
      ...connection,
      connectionGeneration: '9007199254740993',
    });
    expect(executionScopeKey(a)).not.toBe(executionScopeKey(b));
    expect(repositoryConnectionScopeKey(ca)).not.toBe(repositoryConnectionScopeKey(cb));
    const revision = RepositoryContextRevisionSchema.parse({ epoch: 'boot', sequence: '1' });
    expect(
      compareRepositoryContextRevisions({ scope: a, revision }, { scope: b, revision }),
    ).toBeNull();
  });
});
