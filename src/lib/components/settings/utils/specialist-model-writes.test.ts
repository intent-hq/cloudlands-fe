import { describe, expect, it, vi } from 'vitest';
import type { FileSpecialist } from '$store/renderer/slices/specialists/specialists-slice';
import {
  applyModelIntent,
  builtInExport,
  createPendingWrites,
  intentMatches,
  modelSelectionWrite,
} from './specialist-model-writes';

const stored: FileSpecialist = {
  id: 'ui-designer',
  name: 'UI Designer',
  description: 'Designs',
  codingAgent: 'claude',
  model: 'old-model',
  roleReminder: 'Remind',
  modelOptions: [{ model: 'opus', hint: 'hard tasks' }],
  reasoningEffort: 'low',
  behaviorPrompt: 'Custom prompt',
  source: 'project',
  filePath: '/ws/.intent/specialists/ui-designer.md',
};

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('modelSelectionWrite', () => {
  it('applies the intent over the stored file, keeping every other field', () => {
    const owner = { workspaceId: 'ws-1', workspacePath: '/ws' };
    expect(
      modelSelectionWrite(
        stored,
        { codingAgent: 'codex', model: 'gpt', reasoningEffort: 'high' },
        owner,
      ),
    ).toEqual({
      kind: 'save',
      payload: {
        id: 'ui-designer',
        name: 'UI Designer',
        description: 'Designs',
        codingAgent: 'codex',
        model: 'gpt',
        roleReminder: 'Remind',
        modelOptions: [{ model: 'opus', hint: 'hard tasks' }],
        reasoningEffort: 'high',
        behaviorPrompt: 'Custom prompt',
        scope: 'project',
        workspaceId: 'ws-1',
        workspacePath: '/ws',
      },
    });
  });

  it('deletes for a deleted intent and tolerates the file being absent', () => {
    expect(
      modelSelectionWrite({ ...stored, source: 'user' }, { codingAgent: 'x', deleted: true }, {}),
    ).toEqual({
      kind: 'delete',
      ref: { id: 'ui-designer', scope: 'user', allowMissing: true },
    });
  });
});

describe('applyModelIntent', () => {
  const payload = {
    id: 'ui-designer',
    name: 'UI Designer',
    description: 'Designs',
    codingAgent: 'claude',
    model: 'old-model',
    reasoningEffort: 'low',
    behaviorPrompt: 'Edited prompt',
  };

  it('replaces only the model fields with the live pick', () => {
    expect(applyModelIntent(payload, { codingAgent: 'codex', model: 'gpt' })).toEqual({
      ...payload,
      codingAgent: 'codex',
      model: 'gpt',
      reasoningEffort: undefined,
    });
  });

  it('omits every model key while the override is being deleted', () => {
    expect(applyModelIntent(payload, { reasoningEffort: 'high', deleted: true })).toEqual({
      ...payload,
      codingAgent: undefined,
      model: undefined,
      reasoningEffort: undefined,
    });
  });

  it('leaves the payload alone without a pick', () => {
    expect(applyModelIntent(payload, undefined)).toBe(payload);
  });
});

describe('intentMatches', () => {
  it('compares only the fields the pick sets (omitted keys inherit on read)', () => {
    expect(intentMatches({ codingAgent: 'claude', model: 'old-model' }, stored)).toBe(true);
    expect(intentMatches({ model: 'gpt' }, stored)).toBe(false);
    expect(intentMatches({ reasoningEffort: 'high' }, stored)).toBe(false);
    expect(intentMatches({ model: 'gpt' }, undefined)).toBe(false);
  });

  it('matches a deletion only once the file is gone', () => {
    expect(intentMatches({ deleted: true }, stored)).toBe(false);
    expect(intentMatches({ deleted: true }, undefined)).toBe(true);
  });
});

describe('builtInExport', () => {
  it('describes the user override an export creates, falling back to the bundled prompt', () => {
    const specialist = {
      id: 'ui-designer',
      name: 'UI Designer',
      description: 'Designs',
      defaultBehaviorPrompt: 'Bundled prompt',
    };
    expect(builtInExport(specialist, '')).toEqual(
      expect.objectContaining({
        id: 'ui-designer',
        behaviorPrompt: 'Bundled prompt',
        source: 'user',
      }),
    );
  });
});

describe('createPendingWrites', () => {
  it('stays pending until every write for the id settles', async () => {
    const onSettled = vi.fn();
    const pending = createPendingWrites(onSettled);
    let first!: () => void;
    let second!: () => void;
    pending.track('a', new Promise<void>((resolve) => (first = resolve)));
    pending.track('a', new Promise<void>((resolve) => (second = resolve)));
    pending.track('b', Promise.resolve());

    first();
    await flush();
    expect(pending.has('a')).toBe(true);
    expect(pending.has('b')).toBe(false);
    expect(onSettled.mock.calls).toEqual([['b', false]]);

    second();
    await flush();
    expect(pending.has('a')).toBe(false);
    expect(onSettled.mock.calls).toEqual([
      ['b', false],
      ['a', false],
    ]);
  });

  it('reports a failure once the last write for the id settles', async () => {
    const onSettled = vi.fn();
    const pending = createPendingWrites(onSettled);
    let release!: () => void;
    pending.track('a', Promise.reject(new Error('write failed')));
    pending.track('a', new Promise<void>((resolve) => (release = resolve)));

    await flush();
    expect(onSettled).not.toHaveBeenCalled();
    release();
    await flush();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('a', true);
  });

  it('treats a non-promise dispatch result as settled', async () => {
    const pending = createPendingWrites(vi.fn());
    pending.track('a', undefined);
    await flush();
    expect(pending.has('a')).toBe(false);
  });
});
