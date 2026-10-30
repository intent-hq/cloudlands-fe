import { describe, expect, it } from 'vitest';
import { createCollection, getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  dockConversationReducer as reduce,
  openDockConversationRequested,
  closeDockConversationRequested,
  dockConversationLoaded,
  dockConversationDraftChanged,
  dockConversationDraftRestored,
  dockConversationDraftAdmitted,
  dockEvidenceCleared,
  dockEvidenceDictationChanged,
  dockEvidenceDictationFinished,
  dockEvidenceImageCaptured,
  dockEvidenceInsertionCommitted,
  dockEvidenceInsertionQueued,
  dockEvidenceMarkAdded,
  dockEvidenceRestored,
  dockEvidenceMarkRejected,
  dockEvidenceAnnotationChanged,
  dockEvidenceAnnotationUndone,
  dockNativeSpeechLevel,
  dockNativeSpeechPatched,
  dockNativeSpeechSessionChanged,
  dockNativeSpeechStopSettled,
} from './dock-conversation-slice';
import { dockEvidenceFingerprint, type DockEvidenceImage } from '$shared/dock-evidence';

// Failure inventory: held A discovery must not replace B; late restore must not
// replace typing; old send admission must not clear a newer edit; close retains
// target-scoped drafts. Wire admission/reconciliation is covered by the browser
// fixture through the real configured store and fake external backend.
describe('companion conversation ownership', () => {
  it('rejects stale discovery after a workspace switch', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    const generation = state.generation;
    state = reduce(state, openDockConversationRequested('B'));
    state = reduce(state, dockConversationLoaded(generation, 'A', 'Agent A', [], 'a'));
    expect(state.workspaceId).toBe('B');
    expect(state.agentId).toBeNull();
  });

  it('keeps typing over a late restored draft and retains it after close', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    state = reduce(
      state,
      dockConversationLoaded(
        state.generation,
        'A',
        'A',
        [{ id: 'a', name: 'A', isMain: true }],
        'a',
      ),
    );
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'new words'));
    state = reduce(state, dockConversationDraftRestored('A', 'a', 'old words', false));
    state = reduce(state, closeDockConversationRequested());
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('new words');
  });

  it('clears only the exact admitted draft revision', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'first'));
    const revision = getItem(state.drafts, JSON.stringify(['A', 'a']))!.revision;
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'second'));
    state = reduce(state, dockConversationDraftAdmitted('A', 'a', revision));
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('second');
    state = reduce(state, dockConversationDraftAdmitted('A', 'a', revision + 1));
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('');
  });

  it('clears only the evidence content an admitted send owned and never restores over live evidence', () => {
    const pair = JSON.stringify(['A', 'a']);
    const shot = (id: string): DockEvidenceImage => ({
      id,
      contextItemId: `item-${id}`,
      width: 100,
      height: 80,
      displayScale: 2,
      capturedAt: '2026-10-29T18:12:04Z',
      source: 'capture',
    });
    let state = reduce(undefined, dockEvidenceImageCaptured('A', 'a', shot('one')));
    const sent = getItem(state.evidence, pair)!;
    state = reduce(
      state,
      dockEvidenceMarkAdded('A', 'a', {
        id: 'later',
        imageId: 'one',
        tool: 'box',
        geometry: { kind: 'rect', x: 1, y: 1, w: 5, h: 5 },
        bounds: { x: 1, y: 1, w: 5, h: 5 },
        element: null,
        createdAt: 1,
      }),
    );
    // A mark made after the click changes the content: the admitted send cannot clear it.
    state = reduce(state, dockEvidenceCleared('A', 'a', dockEvidenceFingerprint(sent)));
    expect(getItem(state.evidence, pair)?.marks).toHaveLength(1);
    state = reduce(state, dockEvidenceRestored('A', 'a', sent));
    expect(getItem(state.evidence, pair)?.marks).toHaveLength(1);
    const current = getItem(state.evidence, pair)!;
    state = reduce(state, dockEvidenceCleared('A', 'a', dockEvidenceFingerprint(current)));
    expect(getItem(state.evidence, pair)?.images).toEqual([]);
    state = reduce(state, dockEvidenceRestored('A', 'a', current));
    expect(getItem(state.evidence, pair)?.marks.map((m) => m.id)).toEqual(['later']);
  });

  it('drops speech queued from the sent session when its evidence clears, keeping a newer dictation', () => {
    const pair = JSON.stringify(['A', 'a']);
    let state = reduce(
      undefined,
      dockEvidenceImageCaptured('A', 'a', {
        id: 'one',
        contextItemId: 'item-one',
        width: 100,
        height: 80,
        displayScale: 2,
        capturedAt: '2026-10-29T18:12:04Z',
        source: 'capture',
      }),
    );
    const text = (id: string) => ({ id, parts: [{ kind: 'text' as const, text: id }] });
    state = reduce(state, dockEvidenceInsertionQueued('A', 'a', text('old-speech:0')));
    state = reduce(
      state,
      dockEvidenceDictationChanged('A', 'a', {
        id: 'new-speech',
        startedAt: 0,
        status: 'listening',
      }),
    );
    state = reduce(state, dockEvidenceInsertionQueued('A', 'a', text('new-speech:0')));
    const sent = getItem(state.evidence, pair)!;
    state = reduce(state, dockEvidenceCleared('A', 'a', dockEvidenceFingerprint(sent)));
    // A late word of the sent session would refill the emptied box: it is gone.
    expect(getItem(state.evidence, pair)?.insertions.map((row) => row.id)).toEqual([
      'new-speech:0',
    ]);
  });

  it('clears the annotate redo stack on a new mark and when the session changes', () => {
    const pair = JSON.stringify(['A', 'a']);
    const box = (id: string) => ({
      id,
      imageId: 'one',
      tool: 'box' as const,
      geometry: { kind: 'rect' as const, x: 1, y: 1, w: 5, h: 5 },
      bounds: { x: 1, y: 1, w: 5, h: 5 },
      element: null,
      createdAt: 1,
    });
    const start = () => {
      let state = reduce(
        undefined,
        dockEvidenceImageCaptured('A', 'a', {
          id: 'one',
          contextItemId: 'item-one',
          width: 100,
          height: 80,
          displayScale: 2,
          capturedAt: '2026-10-29T18:12:04Z',
          source: 'annotate',
        }),
      );
      state = reduce(
        state,
        dockEvidenceAnnotationChanged('A', 'a', { id: 's1', mode: 'live', imageId: 'one' }),
      );
      state = reduce(state, dockEvidenceMarkAdded('A', 'a', box('m1')));
      state = reduce(state, dockEvidenceMarkAdded('A', 'a', box('m2')));
      return reduce(state, dockEvidenceAnnotationUndone('A', 'a', null));
    };
    let state = start();
    expect(getItem(state.evidence, pair)?.annotationHistory?.redo).toHaveLength(1);
    state = reduce(state, dockEvidenceMarkAdded('A', 'a', box('m3')));
    expect(getItem(state.evidence, pair)?.annotationHistory ?? null).toBeNull();
    // Done (the image is attached) or another session ends the history too.
    state = reduce(
      start(),
      dockEvidenceAnnotationChanged('A', 'a', { id: 's1', mode: 'live', imageId: null }),
    );
    expect(getItem(state.evidence, pair)?.annotationHistory ?? null).toBeNull();
  });

  it('ends only the named dictation and queues its transcript once', () => {
    const pair = JSON.stringify(['A', 'a']);
    let state = reduce(
      undefined,
      dockEvidenceDictationChanged('A', 'a', { id: 'd2', startedAt: 0, status: 'transcribing' }),
    );
    const insertion = { id: 'speech', parts: [{ kind: 'text' as const, text: 'hello' }] };
    state = reduce(state, dockEvidenceDictationFinished('A', 'a', 'd1', insertion));
    expect(getItem(state.evidence, pair)?.dictation?.id).toBe('d2');
    expect(getItem(state.evidence, pair)?.insertions).toEqual([]);
    state = reduce(state, dockEvidenceDictationFinished('A', 'a', 'd2', insertion));
    state = reduce(state, dockEvidenceDictationFinished('A', 'a', 'd2', insertion));
    expect(getItem(state.evidence, pair)?.dictation).toBeNull();
    expect(getItem(state.evidence, pair)?.insertions).toEqual([insertion]);
  });

  it('commits a head insertion exactly once and never overwrites newer typing', () => {
    const pair = JSON.stringify(['A', 'a']);
    let state = reduce(undefined, dockConversationDraftChanged('A', 'a', 'typed'));
    const mirrored = getItem(state.drafts, pair)!.revision;
    state = reduce(
      state,
      dockEvidenceInsertionQueued('A', 'a', {
        id: 'first',
        parts: [{ kind: 'text', text: ' and spoken' }],
      }),
    );
    state = reduce(
      state,
      dockEvidenceInsertionQueued('A', 'a', { id: 'second', parts: [{ kind: 'text', text: '!' }] }),
    );
    // Only the head may commit.
    state = reduce(state, dockEvidenceInsertionCommitted('A', 'a', 'second', 'typed!', mirrored));
    expect(getItem(state.drafts, pair)?.text).toBe('typed');
    state = reduce(
      state,
      dockEvidenceInsertionCommitted('A', 'a', 'first', 'typed and spoken', mirrored),
    );
    expect(getItem(state.drafts, pair)?.text).toBe('typed and spoken');
    expect(getItem(state.evidence, pair)?.insertions.map((row) => row.id)).toEqual(['second']);
    // A duplicate (e.g. after remount) is a no-op.
    state = reduce(
      state,
      dockEvidenceInsertionCommitted('A', 'a', 'first', 'typed and spoken', mirrored + 1),
    );
    expect(getItem(state.drafts, pair)?.revision).toBe(mirrored + 1);
    // Typing after the mirrored revision wins over a late commit.
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'typed and spoken, newer'));
    state = reduce(
      state,
      dockEvidenceInsertionCommitted('A', 'a', 'second', 'typed and spoken!', mirrored + 1),
    );
    expect(getItem(state.drafts, pair)?.text).toBe('typed and spoken, newer');
    expect(getItem(state.evidence, pair)?.insertions.map((row) => row.id)).toEqual(['second']);
  });
});

describe('native speech mirror', () => {
  const capability = {
    available: true,
    engine: 'analyzer' as const,
    speech: 'authorized' as const,
    microphone: 'authorized' as const,
    locale: 'en-US',
    onDevice: true,
  };

  it('starts empty and binds patches, levels and stop outcomes to the installed pair only', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    expect(state.nativeSpeech).toEqual({
      pairId: null,
      capability: null,
      activeId: null,
      pending: false,
      error: null,
      levels: [],
      stops: createCollection('requestId'),
    });
    // Nothing installed: every mirror update is ignored.
    expect(reduce(state, dockNativeSpeechPatched('pair-a', { activeId: 's' }))).toBe(state);
    state = reduce(state, dockNativeSpeechSessionChanged('pair-a', capability));
    expect(state.nativeSpeech).toMatchObject({ pairId: 'pair-a', capability });
    expect(reduce(state, dockNativeSpeechPatched('pair-b', { activeId: 's' }))).toBe(state);
    // Levels exist only while a session is active, clamped and bounded.
    expect(reduce(state, dockNativeSpeechLevel('pair-a', 0.5))).toBe(state);
    state = reduce(state, dockNativeSpeechPatched('pair-a', { activeId: 's1', pending: true }));
    state = reduce(state, dockNativeSpeechLevel('pair-a', 2));
    state = reduce(state, dockNativeSpeechLevel('pair-a', Number.NaN));
    expect(state.nativeSpeech.levels).toEqual([1]);
    for (let index = 0; index < 120; index += 1)
      state = reduce(state, dockNativeSpeechLevel('pair-a', 0.25));
    expect(state.nativeSpeech.levels).toHaveLength(96);
    // Concurrent requests settle independently; a later one never overwrites an earlier one.
    state = reduce(state, dockNativeSpeechStopSettled('pair-a', 'req-1', false));
    state = reduce(state, dockNativeSpeechStopSettled('pair-a', 'req-2', true));
    expect(getItems(state.nativeSpeech.stops)).toEqual([
      { requestId: 'req-1', ok: false },
      { requestId: 'req-2', ok: true },
    ]);
    for (let index = 0; index < 20; index += 1)
      state = reduce(state, dockNativeSpeechStopSettled('pair-a', `bulk-${index}`, true));
    expect(getItems(state.nativeSpeech.stops)).toHaveLength(16);
    // Ending the session drops the meter; retiring resets the whole mirror.
    state = reduce(state, dockNativeSpeechPatched('pair-a', { activeId: null, pending: false }));
    expect(state.nativeSpeech.levels).toEqual([]);
    state = reduce(state, dockNativeSpeechSessionChanged(null, capability));
    expect(state.nativeSpeech).toMatchObject({ pairId: null, capability: null, stops: createCollection('requestId') });
  });

  it('retires only the explicitly rejected mark reference from queued narration', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    state = reduce(
      state,
      dockEvidenceInsertionQueued('A', 'a', {
        id: 'speech',
        parts: [
          { kind: 'text', text: 'here ' },
          { kind: 'mark', markId: 'refused' },
        ],
      }),
    );
    const pair = JSON.stringify(['A', 'a']);
    expect(getItem(state.evidence, pair)?.insertions[0].parts).toHaveLength(2);
    state = reduce(state, dockEvidenceMarkRejected('A', 'a', 'refused'));
    expect(getItem(state.evidence, pair)?.insertions[0].parts).toEqual([
      { kind: 'text', text: 'here ' },
    ]);
    expect(getItem(state.evidence, pair)?.retiredMarkIds).toEqual(['refused']);
  });
});
