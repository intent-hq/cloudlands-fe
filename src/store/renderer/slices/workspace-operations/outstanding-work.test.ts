import { describe, expect, it } from 'vitest';
import { outstandingWork, type OutstandingWorkInput } from './outstanding-work';

const none: OutstandingWorkInput = {
  agentCount: 0,
  hookCount: 0,
  openPrCount: 0,
  localChanges: null,
  guests: { collaboratorCount: 0, openInviteCount: 0 },
};

const dirty = { roots: [], hasUnpushedCommits: true, hasUncommittedChanges: false };

describe('outstandingWork', () => {
  it.each(['archive', 'delete'] as const)('needs no confirmation for an idle %s', (kind) => {
    expect(outstandingWork(kind, none).needsConfirmation).toBe(false);
    expect(outstandingWork(kind, { ...none, guests: null }).needsConfirmation).toBe(false);
  });

  it('counts local changes for delete but not archive, which keeps them on disk', () => {
    const input = { ...none, localChanges: dirty };
    expect(outstandingWork('delete', input)).toMatchObject({
      localChanges: true,
      work: true,
      running: false,
      needsConfirmation: true,
    });
    expect(outstandingWork('archive', input)).toMatchObject({
      localChanges: false,
      work: false,
      needsConfirmation: false,
    });
  });

  it('ignores a clean local-changes result', () => {
    const clean = { ...dirty, hasUnpushedCommits: false };
    expect(outstandingWork('delete', { ...none, localChanges: clean }).needsConfirmation).toBe(
      false,
    );
  });

  it.each([
    ['agents', { agentCount: 1 }, true],
    ['hooks', { hookCount: 2 }, true],
    ['open PRs', { openPrCount: 1 }, false],
  ] as const)('confirms for %s alone', (_label, over, running) => {
    for (const kind of ['archive', 'delete'] as const) {
      expect(outstandingWork(kind, { ...none, ...over })).toMatchObject({
        running,
        work: true,
        guestsOnly: false,
        needsConfirmation: true,
      });
    }
  });

  it.each([
    ['collaborators', { collaboratorCount: 1, openInviteCount: 0 }],
    ['open invites', { collaboratorCount: 0, openInviteCount: 3 }],
  ])('confirms with guests-only copy for %s alone', (_label, guests) => {
    for (const kind of ['archive', 'delete'] as const) {
      expect(outstandingWork(kind, { ...none, guests })).toMatchObject({
        guests: true,
        guestsOnly: true,
        work: false,
        needsConfirmation: true,
      });
    }
  });

  it('is not guests-only when guests come with other work', () => {
    const result = outstandingWork('archive', {
      ...none,
      hookCount: 1,
      guests: { collaboratorCount: 1, openInviteCount: 0 },
    });
    expect(result).toMatchObject({ guests: true, guestsOnly: false, needsConfirmation: true });
  });
});
