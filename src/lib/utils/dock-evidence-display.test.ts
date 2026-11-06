import { describe, expect, it } from 'vitest';
import { consumeEditedCapturePrefix, editedCaptureCards } from './dock-evidence-display';
import { parseStoredMessage, restoreDockEvidenceForEdit } from './parseStoredMessage';
import { DOCK_EVIDENCE_CONTEXT_HEADER } from '$shared/dock-evidence';
import type { ContextItem } from '$lib/components/chat/input/context-api';

// Stored producer fixture: edited recordings intentionally have NO legacy clips row.
const row = {
  id: 'recording-1',
  kind: 'recording',
  video: 'highlights',
  voice: 'audio',
  transcript: null,
  marks: [
    {
      n: 1,
      id: 'mark-1',
      at_ms: 1200,
      kind: 'box',
      label: 'Box',
      note: '',
      context: { selector: null, text: null, url: null },
      geometry: { kind: 'rect', x: 10, y: 10, w: 40, h: 40 },
    },
  ],
  video_attachment_id: 'video-1',
  frames: [{ mark_id: 'mark-1', attachment_id: 'frame-1' }],
  kept_ms: [{ startMs: 200, endMs: 3200 }],
};
const metadata = { type: 'dock_screen_evidence', version: 1, images: [], edited_captures: [row] };
const blocks = [
  { type: 'file', attachmentId: 'video-1', mimeType: 'video/mp4' },
  { type: 'image', attachmentId: 'frame-1', mimeType: 'image/png' },
];
const prefix = `[Edited capture outputs]\n${JSON.stringify([row])}`;
const prose = 'Please fix this.\n\nKeep my JSON: {"x":1}';
const screen = `${DOCK_EVIDENCE_CONTEXT_HEADER}\n\`\`\`json\n${JSON.stringify({ type: 'dock_screen_evidence', version: 1, images: [] })}\n\`\`\``;

describe('persisted edited capture presentation', () => {
  it('recognizes the actual recording envelope without clips and with null transcript', () => {
    expect(editedCaptureCards(metadata, blocks)).toEqual([{ ...row, primaryId: 'video-1' }]);
    expect(consumeEditedCapturePrefix(`${prefix}\n\n${prose}`, metadata, blocks)?.remaining).toBe(
      prose,
    );
  });
  it('retains user JSON without matching producer metadata or at a non-prefix boundary', () => {
    expect(consumeEditedCapturePrefix(prefix, undefined, blocks)).toBeNull();
    expect(consumeEditedCapturePrefix(`${prose}\n\n${prefix}`, metadata, blocks)).toBeNull();
    expect(
      consumeEditedCapturePrefix(
        prefix,
        { ...metadata, edited_captures: [{ ...row, voice: 'off' }] },
        blocks,
      ),
    ).toBeNull();
  });
  it('fails closed on malformed/unknown producer shapes and absent or wrong resources', () => {
    expect(
      consumeEditedCapturePrefix('[Edited capture outputs]\n{bad}', metadata, blocks),
    ).toBeNull();
    for (const edited of [
      { ...row, unknown: true },
      { ...row, frames: [{ mark_id: 'missing', attachment_id: 'frame-1' }] },
    ]) {
      const meta = { ...metadata, edited_captures: [edited] };
      expect(
        consumeEditedCapturePrefix(
          `[Edited capture outputs]\n${JSON.stringify([edited])}`,
          meta,
          blocks,
        ),
      ).toBeNull();
    }
    expect(consumeEditedCapturePrefix(prefix, metadata, blocks.slice(1))).toBeNull();
    expect(
      consumeEditedCapturePrefix(prefix, metadata, [
        { ...blocks[0], mimeType: 'text/plain' },
        blocks[1],
      ]),
    ).toBeNull();
  });
  it('uses metadata image identity to join screenshots, never recording frame order', () => {
    const image = {
      id: 'shot',
      kind: 'screenshot',
      video: 'full',
      voice: 'off',
      transcript: null,
      marks: [],
    };
    const meta = {
      ...metadata,
      images: [{ id: 'shot', attachment_id: 'shot-file', index: 0 }],
      edited_captures: [image],
    };
    expect(
      editedCaptureCards(meta, [
        ...blocks,
        { type: 'image', attachmentId: 'shot-file', mimeType: 'image/png' },
      ])[0]?.primaryId,
    ).toBe('shot-file');
    expect(editedCaptureCards(meta, blocks)).toEqual([]);
  });
  it('preserves exact generated prefixes and attachment identities during edit/regenerate', () => {
    const text = `${screen}\n\n${prefix}\n\n${prose}`;
    const parsed = parseStoredMessage(text, { trustedEvidence: true, metadata, blocks });
    expect(parsed.userMessage).toBe(prose);
    const files: ContextItem[] = [
      {
        id: 'video',
        type: 'file',
        label: 'Recording',
        attachmentId: 'video-1',
        attachmentMimeType: 'video/mp4',
      },
      {
        id: 'frame',
        type: 'file',
        label: 'Frame',
        attachmentId: 'frame-1',
        imageMimeType: 'image/png',
      },
    ];
    const original = [...parsed.contextItems, ...files];
    expect(restoreDockEvidenceForEdit(original, original, 'Edited prose')).toBe(
      `${screen}\n\n${prefix}\n\nEdited prose`,
    );
    expect(
      restoreDockEvidenceForEdit(
        original,
        original.filter((item) => item.id !== 'frame'),
        'Edited prose',
      ),
    ).toBeNull();
  });
});
