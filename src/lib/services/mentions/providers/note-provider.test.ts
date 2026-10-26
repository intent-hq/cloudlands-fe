import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { MentionSystem } from '../mention-system';
import type { MentionCandidate } from '../types';
import { providerRegistry } from './index';

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

  it('matches body text word by word, in any order', async () => {
    mocks.notes.mockResolvedValue([
      { id: 'auth', title: 'Weekly', contentPreview: 'Notes on the authentication flow redesign.' },
    ]);
    const provider = providerRegistry.get('note')!;

    const hit = await provider.search('flow auth', { workspaceId: 'ws-1' });
    const miss = await provider.search('flow billing', { workspaceId: 'ws-1' });

    expect(hit.map((r) => r.id)).toEqual(['auth']);
    expect(miss.map((r) => r.id)).toEqual([]);
  });

  it('ignores surrounding whitespace in the query', async () => {
    mocks.notes.mockResolvedValue([
      { id: 'title-end', title: 'Andre meeting', contentPreview: 'Attendees: Andre.' },
      { id: 'body-end', title: 'Weekly notes', contentPreview: 'Items from the meeting.' },
    ]);

    const results = await providerRegistry.get('note')!.search('meeting ', { workspaceId: 'ws-1' });

    expect(results.map((r) => r.id)).toEqual(['title-end', 'body-end']);
  });

  it('gives a note without body text an empty description', async () => {
    mocks.notes.mockResolvedValue([{ id: 'bare', title: 'Meeting agenda' }]);

    const results = await system.search('meeting', { workspaceId: 'ws-1' });

    expect(results.find((r) => r.id === 'bare')?.description).toBe('');
  });

  it('does not carry query scores into the instant cached results', async () => {
    mocks.notes.mockResolvedValue([transcript]);
    await system.search('meeting', { workspaceId: 'ws-1' });

    const instant = system.searchSync('me', { workspaceId: 'ws-1' });

    // Notes rank before files by kind now, so assert the leaked score directly
    // rather than through its effect on note-versus-file order.
    const cached = instant.find((r) => r.id === 'transcript');
    expect(cached).toBeDefined();
    expect(cached?.score).toBeUndefined();
  });
});
