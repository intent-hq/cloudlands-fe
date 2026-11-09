import { createPendingEntry } from '$store/renderer/slices/pending-submissions/pending-submissions-model';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { queuePresentationMessages } from '$lib/components/chat/queued-message-presentation';
import { projectPendingSubmissions } from '$store/renderer/slices/pending-submissions/pending-submissions-projection';
import {
  buildDockEvidenceContext,
  buildDockEvidenceMetadata,
  emptyDockEvidence,
} from '$shared/dock-evidence';
import {
  queuedCapturePresentation,
  queuedCaptureGroup,
} from '$lib/components/chat/queued-capture-presentation';
import { describe, expect, it } from 'vitest';
import {
  consumeEditedCapturePrefix,
  consumeEditedCaptureEnvelope,
  dockCaptureDisplayCandidates,
  editedCaptureCards,
} from './dock-evidence-display';
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

describe('queued capture display boundary', () => {
  it('consumes trusted screen then edited outputs, retaining user prose and queue bytes', () => {
    const content = `${DOCK_EVIDENCE_CONTEXT_HEADER}\n\`\`\`json\n${JSON.stringify({ type: 'dock_screen_evidence' })}\n\`\`\`\n\n${prefix}\n\n${prose}`;
    const group = {
      content,
      messageMetadata: metadata,
      imageBlocks: [blocks[1]],
      fileBlocks: [blocks[0]],
    };
    const before = JSON.stringify(group);
    expect(queuedCapturePresentation(group)).toEqual({
      text: prose,
      captureSummary: ['recording'],
    });
    expect(JSON.stringify(group)).toBe(before);
  });
  it('keeps untrusted and unmatched-resource JSON byte-identical', () => {
    expect(queuedCapturePresentation({ content: prefix }).text).toBe(prefix);
    expect(queuedCapturePresentation({ content: prefix, messageMetadata: metadata }).text).toBe(
      prefix,
    );
    expect(
      queuedCapturePresentation({
        content: `user prose\n\n${prefix}`,
        messageMetadata: metadata,
        imageBlocks: blocks,
      }).text,
    ).toBe(`user prose\n\n${prefix}`);
  });
  it('uses each delivery group own metadata and resources', () => {
    const trusted = {
      content: prefix,
      messageMetadata: metadata,
      imageBlocks: [blocks[1]],
      fileBlocks: [blocks[0]],
    };
    expect(queuedCapturePresentation(trusted).captureSummary).toEqual(['recording']);
    expect(
      queuedCapturePresentation({
        content: prefix,
        imageBlocks: trusted.imageBlocks,
        fileBlocks: trusted.fileBlocks,
      }).captureSummary,
    ).toEqual([]);
  });
});

describe('recording-only queued producer envelope', () => {
  it('uses the real images-empty producer through queue projection, without legacy clips', () => {
    const evidence = emptyDockEvidence('generated');
    const context = { workspaceId: 'w', agentId: 'a', appUrl: 'intent://local/workspace/w' };
    const meta = { ...buildDockEvidenceMetadata(evidence, context), edited_captures: [row] };
    const content = `${buildDockEvidenceContext(evidence, context)}\n\n${prefix}\n\nSynthetic user prose`;
    const message = {
      id: 'q',
      content,
      queuedAt: '',
      position: 0,
      messageMetadata: meta,
      imageBlocks: [blocks[1]],
      fileBlocks: [blocks[0]],
    } as never;
    const projected = queuePresentationMessages(
      projectPendingSubmissions(undefined, [message]).queue,
    )[0];
    expect(queuedCapturePresentation(projected)).toEqual({
      text: 'Synthetic user prose',
      captureSummary: ['recording'],
    });
  });
  it('retains exact confirmed provenance when the optional projection metadata field is absent', () => {
    const confirmed = {
      id: 'q',
      queuedAt: '',
      position: 0,
      content: prefix,
      messageMetadata: metadata,
    };
    const row = {
      key: 'q',
      confirmed,
      content: prefix,
      imageBlocks: [blocks[1]],
      fileBlocks: [blocks[0]],
      contextItems: [],
      contributions: [],
      blocksMutations: false,
    } as never;
    expect(queuedCapturePresentation(queuePresentationMessages([row])[0]).captureSummary).toEqual([
      'recording',
    ]);
    const changed = { ...(row as object), content: `other user JSON\n${prefix}` } as never;
    expect(queuePresentationMessages([changed])[0].messageMetadata).toBeUndefined();
  });
  it('uses resource-array kind for otherwise valid references without a redundant type field', () => {
    const group = {
      content: prefix,
      messageMetadata: metadata,
      imageBlocks: [{ attachmentId: 'frame-1', mimeType: 'image/png' }],
      fileBlocks: [{ attachmentId: 'video-1', mimeType: 'video/mp4' }],
    };
    expect(queuedCapturePresentation(group)).toEqual({ text: '', captureSummary: ['recording'] });
    expect(queuedCapturePresentation({ ...group, messageMetadata: undefined }).text).toBe(prefix);
    expect(
      queuedCapturePresentation({
        ...group,
        fileBlocks: [{ type: 'image', attachmentId: 'video-1', mimeType: 'video/mp4' }],
      }).text,
    ).toBe(prefix);
  });
});

describe('six-mark recording confirmation and delivery-group pipeline', () => {
  const kinds = ['box', 'box', 'draw', 'draw', 'draw', 'arrow'];
  const geometries = [
    { kind: 'rect', x: 1, y: 2, w: 30, h: 40 },
    { kind: 'rect', x: 40, y: 2, w: 30, h: 40 },
    ...Array.from({ length: 3 }, () => ({
      kind: 'path',
      points: [
        { x: 1, y: 1 },
        { x: 20, y: 20 },
      ],
    })),
    { kind: 'arrow', from: { x: 1, y: 1 }, to: { x: 40, y: 40 } },
  ];
  const edited = {
    ...row,
    id: 'recording-six',
    voice: 'off',
    marks: kinds.map((kind, i) => ({
      ...row.marks[0],
      id: `m${i}`,
      n: i + 1,
      kind,
      geometry: geometries[i],
    })),
    frames: kinds.map((_, i) => ({ mark_id: `m${i}`, attachment_id: `frame${i}` })),
    kept_ms: [{ startMs: 0, endMs: 20950 }],
  };
  const context = {
    workspaceId: 'synthetic-workspace',
    agentId: 'synthetic-agent',
    appUrl: 'intent://local/workspace/synthetic-workspace',
  };
  const evidence = emptyDockEvidence('synthetic');
  const meta = { ...buildDockEvidenceMetadata(evidence, context), edited_captures: [edited] };
  const content = `${buildDockEvidenceContext(evidence, context)}\n\n[Edited capture outputs]\n${JSON.stringify([edited])}\n\nSynthetic user prose`;
  const confirmed = {
    id: 'six',
    content,
    queuedAt: '',
    position: 0,
    messageMetadata: meta,
    imageBlocks: kinds.map((_, i) => ({
      type: 'image' as const,
      attachmentId: `frame${i}`,
      mimeType: 'image/png',
    })),
    fileBlocks: [
      {
        type: 'file' as const,
        attachmentId: 'video-1',
        fileName: 'generated.mp4',
        mimeType: 'video/mp4',
      },
    ],
  };
  it('recovers provenance lost by a partial confirmation seed from the identical confirmed row', () => {
    const entry = createPendingEntry(
      {
        workspaceId: 'w',
        agentId: 'a',
        authority: 'auth',
        principalId: 'p',
        participation: 'part',
        owner: 'owner',
      },
      1,
    );
    const { messageMetadata: _, ...seed } = confirmed;
    entry.seeds = createCollection('id', [seed]);
    const rows = projectPendingSubmissions(entry, [confirmed]).queue;
    expect(rows[0].messageMetadata).toBeUndefined();
    expect(rows[0].confirmed?.messageMetadata).toEqual(meta);
    const message = queuePresentationMessages(rows)[0];
    expect(queuedCapturePresentation(message)).toEqual({
      text: 'Synthetic user prose',
      captureSummary: ['recording'],
    });
  });
  it('normalizes a single identical delivery unit without borrowing metadata for unrelated groups', () => {
    const { messageMetadata: _, ...unit } = confirmed;
    const single = { ...confirmed, deliveryGroups: [unit] };
    const group = queuedCaptureGroup(single, unit);
    expect(queuedCapturePresentation(group)).toEqual({
      text: 'Synthetic user prose',
      captureSummary: ['recording'],
    });
    expect(group.messageMetadata).toEqual(meta);
    const grouped = {
      ...confirmed,
      deliveryGroups: [unit, { content: 'Unrelated synthetic message' }],
    };
    expect(queuedCapturePresentation(queuedCaptureGroup(grouped, unit)).text).toBe(content);
    const own = { ...unit, messageMetadata: meta };
    expect(
      queuedCapturePresentation(
        queuedCaptureGroup({ ...grouped, deliveryGroups: [own, { content: 'Unrelated' }] }, own),
      ).captureSummary,
    ).toEqual(['recording']);
    expect(confirmed.content).toBe(content);
  });
});

describe('visible edited envelope independent of preview availability', () => {
  it('hides a known exact envelope without reference resources, preserving strict edit recognition', () => {
    const text = `[Edited capture outputs]\n${JSON.stringify(metadata.edited_captures)}\n\nUser prompt`;
    expect(consumeEditedCaptureEnvelope(text, metadata)?.remaining).toBe('User prompt');
    expect(consumeEditedCapturePrefix(text, metadata, [])).toBeNull();
    expect(consumeEditedCaptureEnvelope(text, undefined)).toBeNull();
    expect(
      consumeEditedCaptureEnvelope(text, {
        ...metadata,
        edited_captures: [{ ...row, unknown: true }],
      }),
    ).toBeNull();
    expect(consumeEditedCaptureEnvelope('User prose\n\n' + text, metadata)).toBeNull();
    const repeated = text + '\n\n' + text;
    expect(consumeEditedCaptureEnvelope(repeated, metadata)?.remaining).toBe(
      'User prompt\n\n' + text,
    );
  });
});

describe('batched capture display provenance', () => {
  it('keeps ordered candidates separate and never guesses missing provenance', () => {
    const other = { ...metadata, edited_captures: [{ ...row, id: 'other' }] };
    expect(
      dockCaptureDisplayCandidates({ mergedMessageMetadata: [null, metadata, other] }),
    ).toEqual([metadata, other]);
    expect(dockCaptureDisplayCandidates(undefined)).toEqual([]);
    expect(
      dockCaptureDisplayCandidates({
        mergedMessageMetadata: [{ mergedMessageMetadata: [metadata] }],
      }),
    ).toEqual([]);
    expect(
      dockCaptureDisplayCandidates({ mergedMessageMetadata: Array(33).fill(metadata) }),
    ).toEqual([]);
    expect(dockCaptureDisplayCandidates(metadata)).toEqual([metadata]);
  });
});
