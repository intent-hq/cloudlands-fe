import { describe, expect, it } from 'vitest';
import { pickOpenAppTarget } from './open-app-target';

const local = (appIds: string[]) => ({ backendId: 'local', appIds });
const remote = (backendId: string, appIds: string[]) => ({ backendId, appIds });

describe('pickOpenAppTarget', () => {
  it('opens the local app when this computer has it, even with a remote window focused', () => {
    expect(
      pickOpenAppTarget('notes', [local(['notes']), remote('conn-a', ['notes'])], 'conn-a'),
    ).toEqual({ kind: 'machine', backendId: 'local' });
  });

  it('opens on the focused window machine when this computer does not have it', () => {
    expect(
      pickOpenAppTarget(
        'notes',
        [local([]), remote('conn-a', ['notes']), remote('conn-b', ['notes'])],
        'conn-b',
      ),
    ).toEqual({ kind: 'machine', backendId: 'conn-b' });
  });

  it('opens on the only machine that has it', () => {
    expect(
      pickOpenAppTarget('notes', [local(['timer']), remote('conn-a', ['notes'])], 'local'),
    ).toEqual({ kind: 'machine', backendId: 'conn-a' });
  });

  it('opens nothing when no read library has it', () => {
    expect(pickOpenAppTarget('notes', [local(['timer'])], null)).toEqual({ kind: 'missing' });
  });

  it('opens nothing when two other machines have it and none is focused', () => {
    expect(
      pickOpenAppTarget(
        'notes',
        [local([]), remote('conn-b', ['notes']), remote('conn-a', ['notes'])],
        'local',
      ),
    ).toEqual({ kind: 'ambiguous', backendIds: ['conn-a', 'conn-b'] });
  });
});
