import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { MentionSystem } from '../mention-system';
import type { MentionCandidate } from '../types';

const mocks = vi.hoisted(() => ({ request: vi.fn(), notes: vi.fn(), workspaces: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', () => ({
  appClient: { notes: { list: mocks.notes }, workspaces: { list: mocks.workspaces } },
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({})),
  listenSync: vi.fn(() => () => {}),
}));

type SlimNote = { id: string; title: string; contentPreview: string };

// Every letter of "meeting" appears in order, but never as the word itself.
const SCATTERED =
  'Set up the main repo, extend the timeline, keep everything in a single log and get going.';

function scatteredNotes(count: number): SlimNote[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `scattered-${i}`,
    title: `Create repo scaffold ${i}`,
    contentPreview: SCATTERED,
  }));
}

const transcript: SlimNote = {
  id: 'transcript',
  title: 'Meeting Transcript Andre (ASG) Oct 22',
  contentPreview: 'Attendees: Andre, Clement.',
};

const bodyMatch: SlimNote = {
  id: 'body-match',
  title: 'Weekly notes',
  contentPreview: 'Action items from the Meeting with the design team.',
};

const noteIds = (results: MentionCandidate[]) =>
  results.filter((r) => r.type === 'note').map((r) => r.id);

describe('note mention search', () => {
  let dispose: () => void;
  let cancelNotesReadSaga: (() => void) | undefined;
  let system: MentionSystem;

  beforeEach(() => {
    dispose = store.init();
    cancelNotesReadSaga = store.runSaga(notesReadSaga);
    admitLegacyPrincipal();
    system = new MentionSystem({ debounceMs: 0 });
    mocks.request.mockReset().mockResolvedValue({ files: [], terminals: [], scripts: [] });
    mocks.notes.mockReset().mockResolvedValue([]);
    mocks.workspaces.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cancelNotesReadSaga?.();
    cancelNotesReadSaga = undefined;
    system.destroy();
    dispose();
  });

  it('finds a title match listed after more than ten loose body matches', async () => {
    mocks.notes.mockResolvedValue([...scatteredNotes(12), transcript]);

    const ids = noteIds(await system.search('meeting', { workspaceId: 'ws-1' }));

    expect(ids[0]).toBe('transcript');
  });

  it('keeps a whole-word body match, ranked below title matches', async () => {
    mocks.notes.mockResolvedValue([bodyMatch, transcript]);

    const ids = noteIds(await system.search('meeting', { workspaceId: 'ws-1' }));

    expect(ids).toEqual(['transcript', 'body-match']);
  });

  it('does not match notes whose body only contains the query letters scattered', async () => {
    mocks.notes.mockResolvedValue([...scatteredNotes(3), transcript]);

    const ids = noteIds(await system.search('meeting', { workspaceId: 'ws-1' }));

    expect(ids).toEqual(['transcript']);
  });

  it('returns the first ten notes in list order for an empty query', async () => {
    mocks.notes.mockResolvedValue([...scatteredNotes(12), transcript]);

    const ids = noteIds(await system.search('', { workspaceId: 'ws-1' }));

    expect(ids).toEqual(scatteredNotes(10).map((n) => n.id));
  });
});
