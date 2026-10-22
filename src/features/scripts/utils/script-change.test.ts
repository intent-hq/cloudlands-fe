import { describe, expect, it } from 'vitest';
import { scriptChangeSnapshot } from './script-change';

const row = {
  id: 'script',
  workspaceId: 'workspace',
  name: 'Test',
  command: 'true',
  mode: 'command',
  purpose: 'oneOff',
  source: 'user',
  createdAt: '2026-10-02T00:00:00Z',
  runtime: { status: 'starting', restartCount: 0 },
};

describe('complete script change validation', () => {
  it('accepts transitional runtime, additive fields and explicit false/zero/empty optionals', () => {
    const snapshot = {
      ...row,
      source: 'repository',
      category: 'custom-validation',
      autoStart: false,
      cwd: '',
      env: {},
      futureDefinition: 'kept',
      runtime: { ...row.runtime, exitCode: 0, previouslyRunning: false, futureRuntime: 'kept' },
    };
    expect(scriptChangeSnapshot(snapshot, 'workspace', 'script')).toEqual(snapshot);
  });
  it.each([
    'id',
    'workspaceId',
    'name',
    'command',
    'mode',
    'purpose',
    'source',
    'createdAt',
    'runtime',
  ])('rejects a partial snapshot missing %s', (field) => {
    const partial = { ...row };
    delete partial[field as keyof typeof partial];
    expect(scriptChangeSnapshot(partial, 'workspace', 'script')).toBeUndefined();
  });
  it.each([
    null,
    { ...row, id: 'other' },
    { ...row, workspaceId: 'other' },
    { ...row, archivedAt: null },
    { ...row, env: { KEY: null } },
    { ...row, lastRun: { outcome: 'failed' } },
    { ...row, runtime: { status: 'running' } },
    { ...row, runtime: { ...row.runtime, exitCode: null } },
    { ...row, runtime: { ...row.runtime, restartCount: -1 } },
  ])('rejects invalid or mismatched row %#', (value) => {
    expect(scriptChangeSnapshot(value, 'workspace', 'script')).toBeUndefined();
  });
});
