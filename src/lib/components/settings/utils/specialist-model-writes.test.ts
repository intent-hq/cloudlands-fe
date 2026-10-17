import { describe, expect, it, vi } from 'vitest';
import type { FileSpecialist } from '$store/renderer/slices/specialists/specialists-slice';
import { builtInExport, createPendingWrites, modelSelectionWrite } from './specialist-model-writes';

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
  it('applies the pin and effort over the stored file, keeping every other field', () => {
    const owner = { workspaceId: 'ws-1', workspacePath: '/ws' };
    expect(
      modelSelectionWrite(stored, { codingAgent: 'codex', model: 'gpt' }, 'high', false, owner),
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

  it('deletes a redundant override and tolerates it being absent', () => {
    expect(modelSelectionWrite({ ...stored, source: 'user' }, {}, undefined, true, {})).toEqual({
      kind: 'delete',
      ref: { id: 'ui-designer', scope: 'user', allowMissing: true },
    });
  });
});

describe('builtInExport', () => {
  const specialist = {
    id: 'ui-designer',
    name: 'UI Designer',
    description: 'Designs',
    defaultBehaviorPrompt: 'Bundled prompt',
  };

  it('describes the user override a pick creates, falling back to the bundled prompt', () => {
    expect(builtInExport(specialist, '', { codingAgent: 'codex', model: 'gpt' }, 'high')).toEqual(
      expect.objectContaining({
        id: 'ui-designer',
        codingAgent: 'codex',
        model: 'gpt',
        reasoningEffort: 'high',
        behaviorPrompt: 'Bundled prompt',
        source: 'user',
      }),
    );
  });
});

describe('createPendingWrites', () => {
  it('stays pending until every write for the id settles', async () => {
    const onFailedSettle = vi.fn();
    const pending = createPendingWrites(onFailedSettle);
    let first!: () => void;
    let second!: () => void;
    pending.track('a', new Promise<void>((resolve) => (first = resolve)));
    pending.track('a', new Promise<void>((resolve) => (second = resolve)));
    pending.track('b', Promise.resolve());

    first();
    await flush();
    expect(pending.has('a')).toBe(true);
    expect(pending.has('b')).toBe(false);

    second();
    await flush();
    expect(pending.has('a')).toBe(false);
    expect(onFailedSettle).not.toHaveBeenCalled();
  });

  it('reports a failure once the last write for the id settles', async () => {
    const onFailedSettle = vi.fn();
    const pending = createPendingWrites(onFailedSettle);
    let release!: () => void;
    pending.track('a', Promise.reject(new Error('write failed')));
    pending.track('a', new Promise<void>((resolve) => (release = resolve)));

    await flush();
    expect(onFailedSettle).not.toHaveBeenCalled();
    release();
    await flush();
    expect(onFailedSettle).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('treats a non-promise dispatch result as settled', async () => {
    const pending = createPendingWrites(vi.fn());
    pending.track('a', undefined);
    await flush();
    expect(pending.has('a')).toBe(false);
  });
});
