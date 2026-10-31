import { describe, expect, it } from 'vitest';
import {
  ackDockInsertion,
  addDockMark,
  applyDockCapture,
  applyDockReferenceEdit,
  buildDockEvidenceMetadata,
  dockCaptureDisabled,
  dockEvidenceFingerprint,
  emptyDockEvidence,
  enqueueDockInsertion,
  readyDockInsertions,
  rejectDockMark,
  fromDockDraftEvidence,
  isDockAttachmentPath,
  patchDockEvidence,
  setDockClip,
  undoDockAnnotationMark,
  redoDockAnnotationMark,
  undoableDockMark,
  redoableDockMark,
  parkedDockSessionImage,
  dockClipReferenceId,
  removeDockImage,
  reusableDockImage,
  sanitizeDockMark,
  screenReferences,
  toDockDraftEvidence,
  undoDockMark,
  validDockWireTokens,
  DOCK_EVIDENCE_CONTEXT_HEADER,
  DOCK_EVIDENCE_LIMITS,
  DOCK_WIRE_PEN_POINTS,
  buildDockEvidenceContext,
  type DockComposerEvidence,
  type DockEvidenceImage,
  type DockMark,
} from './dock-evidence';

const labels = { pick: 'Pick', box: 'Box', pen: 'Pen', arrow: 'Arrow' };

function image(id: string): DockEvidenceImage {
  return {
    id,
    contextItemId: `item-${id}`,
    width: 2880,
    height: 1800,
    displayScale: 2,
    capturedAt: '2026-10-29T18:12:04Z',
    source: 'capture',
  };
}
function box(id: string, imageId: string, x = 100): DockMark {
  return {
    id,
    imageId,
    tool: 'box',
    geometry: { kind: 'rect', x, y: 40, w: 148, h: 40 },
    bounds: { x, y: 40, w: 148, h: 40 },
    element: null,
    createdAt: 1,
  };
}
function capture(evidence: DockComposerEvidence, ...ids: string[]) {
  return ids.reduce((value, id) => applyDockCapture(value, image(id)).evidence, evidence);
}
function mark(evidence: DockComposerEvidence, ...marks: DockMark[]) {
  return marks.reduce((value, row) => addDockMark(value, row).evidence, evidence);
}

describe('dock screen evidence', () => {
  it('derives message numbers from creation order and renumbers when an image is removed', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(evidence, box('m1', 'a'), box('m2', 'b'), box('m3', 'a', 300));
    expect(screenReferences(evidence, labels).map((ref) => [ref.id, ref.number])).toEqual([
      ['m1', 1],
      ['m2', 2],
      ['m3', 3],
    ]);
    evidence = enqueueDockInsertion(evidence, {
      id: 'speech',
      parts: [
        { kind: 'text', text: 'this ' },
        { kind: 'mark', markId: 'm1' },
        { kind: 'mark', markId: 'm2' },
      ],
    });
    evidence = removeDockImage(evidence, 'a');
    // Removing an image drops its marks everywhere, including pending chips.
    expect(screenReferences(evidence, labels)).toEqual([{ id: 'm2', number: 1, label: 'Box' }]);
    expect(evidence.insertions[0].parts).toEqual([
      { kind: 'text', text: 'this ' },
      { kind: 'mark', markId: 'm2' },
    ]);
    expect(undoDockMark(evidence).insertions[0].parts).toEqual([{ kind: 'text', text: 'this ' }]);
  });

  it('holds narration naming an undelivered gesture id until it is accepted or explicitly rejected', () => {
    let evidence = mark(capture(emptyDockEvidence('pair'), 'a'), box('m1', 'a'));
    evidence = enqueueDockInsertion(evidence, {
      id: 'early',
      parts: [
        { kind: 'text', text: 'here ' },
        { kind: 'mark', markId: 'late-accepted' },
      ],
    });
    evidence = enqueueDockInsertion(evidence, {
      id: 'refused',
      parts: [
        { kind: 'text', text: 'and there ' },
        { kind: 'mark', markId: 'refused-5th' },
        { kind: 'mark', markId: 'm1' },
      ],
    });
    // Neither is dropped while its mark is in flight, and nothing is editor-ready yet.
    expect(evidence.insertions.map((row) => row.id)).toEqual(['early', 'refused']);
    expect(readyDockInsertions(evidence)).toEqual([]);
    // The accepted delivery resolves the first; the second still waits in order.
    evidence = mark(evidence, box('late-accepted', 'a', 200));
    expect(readyDockInsertions(evidence).map((row) => row.id)).toEqual(['early']);
    // Only the explicitly rejected reference is removed; spoken words and other chips stay.
    evidence = rejectDockMark(evidence, 'refused-5th');
    expect(evidence.insertions[1].parts).toEqual([
      { kind: 'text', text: 'and there ' },
      { kind: 'mark', markId: 'm1' },
    ]);
    expect(readyDockInsertions(evidence).map((row) => row.id)).toEqual(['early', 'refused']);
    // A commit arriving after the rejection never resurrects the refused chip.
    evidence = enqueueDockInsertion(evidence, {
      id: 'after',
      parts: [
        { kind: 'mark', markId: 'refused-5th' },
        { kind: 'text', text: ' done' },
      ],
    });
    expect(evidence.insertions.at(-1)!.parts).toEqual([{ kind: 'text', text: ' done' }]);
    // An accepted mark can never be rejected.
    expect(rejectDockMark(evidence, 'm1')).toBe(evidence);
    // A removed mark settles late narration the same way.
    evidence = undoDockMark(evidence);
    evidence = enqueueDockInsertion(evidence, {
      id: 'removed',
      parts: [
        { kind: 'text', text: 'x' },
        { kind: 'mark', markId: 'late-accepted' },
      ],
    });
    expect(evidence.insertions.at(-1)!.parts).toEqual([{ kind: 'text', text: 'x' }]);
  });

  it('labels chips from the element name, else the caller-localized tool name', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a');
    evidence = mark(evidence, {
      ...box('m1', 'a'),
      tool: 'pick',
      element: { role: 'button', name: 'Get started', path: null, source: null },
    });
    evidence = mark(evidence, {
      ...box('m2', 'a'),
      tool: 'arrow',
      geometry: { kind: 'arrow', from: { x: 1, y: 1 }, to: { x: 9, y: 9 } },
    });
    expect(screenReferences(evidence, { ...labels, arrow: 'Flèche' }).map((r) => r.label)).toEqual([
      'Get started',
      'Flèche',
    ]);
  });

  it('replaces the oldest unmarked fifth capture and refuses once every image is marked', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b', 'c', 'd');
    evidence = mark(evidence, box('m1', 'a'), box('m2', 'c'));
    const fifth = applyDockCapture(evidence, image('e'));
    expect(fifth.outcome).toBe('replaced');
    if (fifth.outcome !== 'replaced') throw new Error('expected replacement');
    expect(fifth.replaced.id).toBe('b');
    expect(fifth.evidence.images.map((row) => row.id)).toEqual(['a', 'c', 'd', 'e']);
    evidence = mark(fifth.evidence, box('m3', 'd'), box('m4', 'e'));
    expect(dockCaptureDisabled(evidence)).toBe(true);
    expect(applyDockCapture(evidence, image('f'))).toEqual({ outcome: 'limit', evidence });
    expect(applyDockCapture(evidence, { ...image('g'), width: Number.NaN }).outcome).toBe(
      'invalid',
    );
  });

  it('clamps marks to their image and bounds free-form fields', () => {
    const target = image('a');
    const pen = sanitizeDockMark(
      {
        ...box('m1', 'a'),
        tool: 'pen',
        geometry: {
          kind: 'path',
          points: Array.from({ length: 2000 }, (_, i) => ({ x: i * 10, y: -5 })),
        },
        element: { role: 'link', name: 'x'.repeat(5000), path: 'p', source: null },
      },
      target,
    );
    if (pen?.geometry.kind !== 'path') throw new Error('expected a path');
    expect(pen.geometry.points.length).toBeLessThanOrEqual(DOCK_EVIDENCE_LIMITS.penPoints);
    expect(pen.geometry.points.at(-1)).toEqual({ x: 2880, y: 0 });
    expect(pen.bounds).toEqual({ x: 0, y: 0, w: 2880, h: 0 });
    expect(pen.element?.name).toHaveLength(DOCK_EVIDENCE_LIMITS.elementText);
    const flipped = sanitizeDockMark(
      { ...box('m2', 'a'), geometry: { kind: 'rect', x: 3000, y: 100, w: -400, h: 50 } },
      target,
    );
    expect(flipped?.geometry).toEqual({ kind: 'rect', x: 2600, y: 100, w: 280, h: 50 });
    expect(sanitizeDockMark(box('m3', 'other'), target)).toBeNull();
    expect(addDockMark(capture(emptyDockEvidence('p'), 'a'), box('m4', 'missing')).accepted).toBe(
      false,
    );
  });

  it('accepts only wire tokens that name existing marks', () => {
    const evidence = mark(capture(emptyDockEvidence('pair'), 'a'), box('m1', 'a'), box('m2', 'a'));
    expect(validDockWireTokens('this [[mark:1]] and [[mark:2]]', evidence)).toBe(true);
    expect(validDockWireTokens('no references', undefined)).toBe(true);
    expect(validDockWireTokens('stale [[mark:3]]', evidence)).toBe(false);
    expect(validDockWireTokens('[[mark:0]]', evidence)).toBe(false);
  });

  it('projects user-space metadata in tile order with message numbers and each clip with its own times', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(
      evidence,
      { ...box('m1', 'b'), clipMs: 1200, clipId: 'clip-b' },
      { ...box('m2', 'a', 1812.6), clipMs: 9400, clipId: 'clip-a' },
    );
    const clip = (id: string, status: 'ready' | 'recording', durationMs: number) => ({
      id,
      status,
      startedAt: 0,
      durationMs,
      hasMicAudio: id === 'clip-a',
      contextItemId: `${id}-item`,
    });
    evidence = setDockClip(evidence, 'clip-a', clip('clip-a', 'ready', 14200));
    evidence = setDockClip(evidence, 'clip-b', clip('clip-b', 'ready', 3000));
    // A recording still in progress is not sent.
    evidence = setDockClip(evidence, 'clip-c', clip('clip-c', 'recording', 0));
    expect(
      buildDockEvidenceMetadata(evidence, {
        workspaceId: 'right-dock',
        agentId: 'main',
        appUrl: 'intent://local/workspace/right-dock',
        clipAttachmentIds: { 'clip-a': 'attachment-a', 'clip-b': 'attachment-b' },
      }),
    ).toEqual({
      type: 'dock_screen_evidence',
      version: 1,
      images: [
        {
          index: 0,
          id: 'a',
          attachment_id: null,
          raw: null,
          width: 2880,
          height: 1800,
          display_scale: 2,
          captured_at: '2026-10-29T18:12:04Z',
          marks: [
            {
              n: 2,
              id: 'm2',
              tool: 'box',
              rect: { x: 1813, y: 40, w: 148, h: 40 },
              geometry: { kind: 'rect', x: 1813, y: 40, w: 148, h: 40 },
              element: null,
            },
          ],
        },
        {
          index: 1,
          id: 'b',
          attachment_id: null,
          raw: null,
          width: 2880,
          height: 1800,
          display_scale: 2,
          captured_at: '2026-10-29T18:12:04Z',
          marks: [
            {
              n: 1,
              id: 'm1',
              tool: 'box',
              rect: { x: 100, y: 40, w: 148, h: 40 },
              geometry: { kind: 'rect', x: 100, y: 40, w: 148, h: 40 },
              element: null,
            },
          ],
        },
      ],
      clips: [
        {
          id: 'clip-a',
          attachment_id: 'attachment-a',
          duration_ms: 14200,
          has_mic_audio: true,
          mark_timestamps_ms: { '2': 9400 },
        },
        {
          id: 'clip-b',
          attachment_id: 'attachment-b',
          duration_ms: 3000,
          has_mic_audio: false,
          mark_timestamps_ms: { '1': 1200 },
        },
      ],
      context: {
        workspace: 'right-dock',
        agent: 'main',
        app_url: 'intent://local/workspace/right-dock',
      },
    });
  });

  it('keeps full stroke and arrow geometry, bounded, in metadata and a compact agent-readable copy', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a');
    evidence = mark(
      evidence,
      {
        ...box('pen', 'a'),
        tool: 'pen',
        geometry: {
          kind: 'path',
          points: Array.from({ length: 200 }, (_, i) => ({ x: i + 0.4, y: 2 * i })),
        },
      },
      {
        ...box('arrow', 'a'),
        tool: 'arrow',
        geometry: { kind: 'arrow', from: { x: 10.2, y: 20.7 }, to: { x: 300, y: 40 } },
        element: { role: 'button', name: 'Get started', path: null, source: null },
      },
    );
    const context = { workspaceId: 'w', agentId: 'a', appUrl: 'intent://local/workspace/w' };
    const [penMark, arrowMark] = buildDockEvidenceMetadata(evidence, context).images[0].marks;
    if (penMark.geometry.kind !== 'path') throw new Error('expected a path');
    expect(penMark.geometry.points.length).toBeLessThanOrEqual(DOCK_WIRE_PEN_POINTS.metadata);
    expect(penMark.geometry.points[0]).toEqual([0, 0]);
    expect(penMark.geometry.points.at(-1)).toEqual([199, 398]);
    expect(arrowMark.geometry).toEqual({ kind: 'arrow', tail: [10, 21], head: [300, 40] });
    const text = buildDockEvidenceContext(evidence, context);
    expect(text.startsWith(DOCK_EVIDENCE_CONTEXT_HEADER)).toBe(true);
    const body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    expect(body).toMatchObject({ type: 'dock_screen_evidence', version: 1 });
    // One compact line inside the fence, as the presentation parser expects.
    expect(text.split('\n')).toHaveLength(4);
    expect(body.images[0].marks.map((row: { n: number }) => row.n)).toEqual([1, 2]);
    expect(body.images[0].marks[0].geometry.points.length).toBeLessThanOrEqual(
      DOCK_WIRE_PEN_POINTS.context,
    );
    expect(body.images[0].marks[1].element.name).toBe('Get started');
    // No user text and no chip tokens are duplicated into the agent-readable copy.
    expect(text).not.toContain('[[mark:1]]');
  });

  it('round-trips draft evidence with cross-image numbering and ignores invalid rows', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(evidence, box('m1', 'b'), box('m2', 'a'), box('m3', 'b', 400));
    const persisted = toDockDraftEvidence(evidence);
    const restored = fromDockDraftEvidence('pair', [
      ...Object.entries(persisted).reverse(),
      ['junk', { kind: 'image', image: { id: 'x' } }],
      ['also-junk', null],
    ]);
    expect(restored.images.map((row) => [row.id, row.contextItemId])).toEqual([
      ['b', 'item-b'],
      ['a', 'item-a'],
    ]);
    expect(restored.marks.map((row) => row.id)).toEqual(['m1', 'm2', 'm3']);
    expect(restored.insertions).toEqual([]);
    expect(restored.annotation).toBeNull();
  });

  it('acknowledges insertions idempotently and keeps the content fingerprint session-independent', () => {
    let evidence = mark(capture(emptyDockEvidence('pair'), 'a'), box('m1', 'a'));
    const fingerprint = dockEvidenceFingerprint(evidence);
    evidence = enqueueDockInsertion(evidence, {
      id: 'i1',
      parts: [{ kind: 'mark', markId: 'm1' }],
    });
    evidence = enqueueDockInsertion(evidence, { id: 'i1', parts: [{ kind: 'text', text: 'dup' }] });
    expect(evidence.insertions).toHaveLength(1);
    evidence = patchDockEvidence(evidence, {
      annotation: { id: 's', mode: 'live', imageId: 'a' },
      capture: { pending: true, error: null, accepted: 0 },
    });
    evidence = ackDockInsertion(evidence, 'i1');
    const acked = ackDockInsertion(evidence, 'i1');
    expect(acked).toBe(evidence);
    expect(evidence.insertions).toEqual([]);
    expect(dockEvidenceFingerprint(evidence)).toBe(fingerprint);
    expect(dockEvidenceFingerprint(mark(evidence, box('m2', 'a')))).not.toBe(fingerprint);
  });

  it('accepts only bounded workspace-relative attachment paths for clip playback', () => {
    expect(isDockAttachmentPath('.intent/attachments/clip.webm')).toBe(true);
    for (const path of [
      '/tmp/clip.webm',
      '../clip.webm',
      'a/./b',
      'C:/clip.webm',
      'a\\b',
      '',
      'x'.repeat(2000),
    ])
      expect(isDockAttachmentPath(path)).toBe(false);
  });

  it('removes the mark of a deleted middle chip, renumbers later marks and restores it on undo', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(evidence, box('m1', 'a'), box('m2', 'b'), box('m3', 'a', 300));
    const numbers = (value: DockComposerEvidence) =>
      buildDockEvidenceMetadata(value, { workspaceId: 'w', agentId: 'g', appUrl: '' }).images.map(
        (row) => row.marks.map((m) => [m.id, m.n]),
      );
    const deleted = applyDockReferenceEdit(evidence, { removed: ['m2'], restored: [] });
    expect(screenReferences(deleted, labels).map((ref) => [ref.id, ref.number])).toEqual([
      ['m1', 1],
      ['m3', 2],
    ]);
    expect(numbers(deleted)).toEqual([
      [
        ['m1', 1],
        ['m3', 2],
      ],
      [],
    ]);
    // A later chip naming the deleted mark is not accepted while it is gone.
    expect(validDockWireTokens('[[mark:3]]', deleted)).toBe(false);
    const undone = applyDockReferenceEdit(deleted, { removed: [], restored: ['m2'] });
    expect(numbers(undone)).toEqual(numbers(evidence));
    expect(undone.retiredMarkIds ?? []).not.toContain('m2');
  });

  it('restores several chips removed by one edit to their old numbers, never onto a removed image', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(
      evidence,
      box('m1', 'a'),
      box('m2', 'b'),
      box('m3', 'a', 300),
      box('m4', 'b', 300),
    );
    const ids = (value: DockComposerEvidence) => value.marks.map((row) => row.id);
    const deleted = applyDockReferenceEdit(evidence, { removed: ['m2', 'm3'], restored: [] });
    expect(ids(deleted)).toEqual(['m1', 'm4']);
    expect(ids(applyDockReferenceEdit(deleted, { removed: [], restored: ['m2', 'm3'] }))).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    // A pasted copy of a live chip, or a chip whose image was removed, changes nothing.
    expect(applyDockReferenceEdit(evidence, { removed: [], restored: ['m1'] })).toBe(evidence);
    const imageGone = removeDockImage(deleted, 'b');
    expect(ids(applyDockReferenceEdit(imageGone, { removed: [], restored: ['m2', 'm3'] }))).toEqual(
      ['m1', 'm3'],
    );
  });

  it('lets the first live mark reuse the newest unmarked capture only when the screen is unchanged', () => {
    const near = '0'.repeat(63) + 'f'; // 4 bits from the all-zero hash
    const far = 'ffff' + '0'.repeat(60); // 16 bits away
    const hashed = (id: string, hash?: string) => ({ ...image(id), ...(hash ? { hash } : {}) });
    const shot = (hash?: string, width = 2880) => ({ width, height: 1800, hash });
    let evidence = applyDockCapture(
      emptyDockEvidence('pair'),
      hashed('a', '0'.repeat(64)),
    ).evidence;
    expect(reusableDockImage(evidence, shot(near))?.id).toBe('a');
    expect(reusableDockImage(evidence, shot(far))).toBeNull();
    expect(reusableDockImage(evidence, shot(undefined))).toBeNull();
    expect(reusableDockImage(evidence, shot(near, 1440))).toBeNull();
    // Only the newest image counts, and never once it carries a mark.
    evidence = mark(evidence, box('m1', 'a'));
    expect(reusableDockImage(evidence, shot(near))).toBeNull();
    evidence = applyDockCapture(evidence, hashed('b')).evidence;
    expect(reusableDockImage(evidence, shot(near))).toBeNull();
  });

  it('numbers recording chips by recording, holds speech until they exist, and drops them with their recording', () => {
    const clip = (id: string, status: 'recording' | 'ready' | 'failed') => ({
      id,
      status,
      startedAt: 0,
      durationMs: 1000,
      hasMicAudio: true,
    });
    let evidence = setDockClip(emptyDockEvidence('pair'), 'c1', clip('c1', 'failed'));
    evidence = setDockClip(evidence, 'c2', clip('c2', 'ready'));
    evidence = setDockClip(evidence, 'c3', clip('c3', 'recording'));
    const label = (n: number, end: boolean) => `Recording ${n}${end ? ' ends' : ''}`;
    // A failed recording is never sent, so it takes no number.
    expect(
      screenReferences(evidence, labels, label).map(({ id, number, kind, label }) => [
        id,
        number,
        kind,
        label,
      ]),
    ).toEqual([
      ['clip-start:c2', 1, 'clip-start', 'Recording 1'],
      ['clip-end:c2', 1, 'clip-end', 'Recording 1 ends'],
      ['clip-start:c3', 2, 'clip-start', 'Recording 2'],
      ['clip-end:c3', 2, 'clip-end', 'Recording 2 ends'],
    ]);
    expect(validDockWireTokens('a [[clip:2]] b [[clip:2:end]]', evidence)).toBe(true);
    expect(validDockWireTokens('[[clip:3]]', evidence)).toBe(false);
    // Speech naming a recording's start is ready; naming an unknown one waits.
    evidence = enqueueDockInsertion(evidence, {
      id: 'speech',
      parts: [
        { kind: 'text', text: 'here ' },
        { kind: 'mark', markId: dockClipReferenceId('c3', false) },
      ],
    });
    expect(readyDockInsertions(evidence).map((row) => row.id)).toEqual(['speech']);
    // Removing the recording takes its chip out of queued speech; the words stay.
    evidence = setDockClip(evidence, 'c3', null);
    expect(evidence.insertions[0].parts).toEqual([{ kind: 'text', text: 'here ' }]);
    expect(screenReferences(evidence, labels, label).map(({ id }) => id)).toEqual([
      'clip-start:c2',
      'clip-end:c2',
    ]);
  });

  it('undoes and redoes the live session marks with their numbers, parking the image of a last mark', () => {
    // Image "a" was attached earlier (mark m0); the open session draws on image "b".
    let evidence = capture(emptyDockEvidence('pair'), 'a', 'b');
    evidence = mark(evidence, box('m0', 'a'), box('m1', 'b'), box('m2', 'b', 300));
    evidence = patchDockEvidence(evidence, {
      annotation: { id: 's1', mode: 'live', imageId: 'b' },
    });
    const ids = (value: DockComposerEvidence) => value.marks.map((row) => row.id);
    const parked = {
      image: evidence.images[1],
      item: { id: 'item-b', label: 'shot.png', imageData: 'AAAA', imageMimeType: 'image/png' },
    };
    expect(undoableDockMark(evidence)?.id).toBe('m2');
    evidence = undoDockAnnotationMark(evidence);
    expect(ids(evidence)).toEqual(['m0', 'm1']);
    expect(redoableDockMark(evidence)).toBe(true);
    // The only mark left on the session image: it goes with its image, parked for redo.
    evidence = undoDockAnnotationMark(evidence, parked);
    expect(ids(evidence)).toEqual(['m0']);
    expect(evidence.images.map((row) => row.id)).toEqual(['a']);
    expect(evidence.annotation?.imageId).toBeNull();
    expect(parkedDockSessionImage(evidence)?.image.id).toBe('b');
    // Marks on an attached image are never undone by the session.
    expect(undoableDockMark(evidence)).toBeNull();
    // Redo brings the image back as the session image, then each mark at its old number.
    evidence = redoDockAnnotationMark(evidence);
    expect(evidence.images.map((row) => row.id)).toEqual(['a', 'b']);
    expect(evidence.annotation?.imageId).toBe('b');
    evidence = redoDockAnnotationMark(evidence);
    expect(screenReferences(evidence, labels).map(({ id, number }) => [id, number])).toEqual([
      ['m0', 1],
      ['m1', 2],
      ['m2', 3],
    ]);
    expect(redoableDockMark(evidence)).toBe(false);
  });

  it('refuses a redo whose image no longer fits, and never removes the image of a mark-up session', () => {
    let evidence = capture(emptyDockEvidence('pair'), 'a');
    evidence = mark(evidence, box('m1', 'a'));
    evidence = patchDockEvidence(evidence, {
      annotation: { id: 's1', mode: 'live', imageId: 'a' },
    });
    const parked = {
      image: evidence.images[0],
      item: { id: 'item-a', label: 'shot.png', imageData: 'AAAA', imageMimeType: 'image/png' },
    };
    evidence = undoDockAnnotationMark(evidence, parked);
    // Meanwhile four marked screenshots fill the message.
    for (const id of ['w', 'x', 'y', 'z'])
      evidence = mark(capture(evidence, id), box(`m-${id}`, id));
    expect(redoDockAnnotationMark(evidence)).toBe(evidence);
    // Mark-up on a still image: undoing its last mark keeps the image.
    let still = mark(capture(emptyDockEvidence('pair'), 'c'), box('m9', 'c'));
    still = patchDockEvidence(still, { annotation: { id: 's2', mode: 'still', imageId: 'c' } });
    still = undoDockAnnotationMark(still, { ...parked, image: still.images[0] });
    expect(still.images.map((row) => row.id)).toEqual(['c']);
    expect(still.marks).toEqual([]);
  });
});
