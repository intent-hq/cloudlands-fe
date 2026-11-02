/** @vitest-environment jsdom */
import { render as renderDisplay, screen as view } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: unknown[]) => void) => {
        run([]);
        return () => {};
      },
    }),
    { select: () => [] },
  ),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentMessageById: Object.assign(
    () => ({
      subscribe: (run: (value: undefined) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
}));

import ChatMessage from '../ChatMessage.svelte';
import { DOCK_EVIDENCE_CONTEXT_HEADER } from '$shared/dock-evidence';

// The producer's current compact body: two images, two recordings (clips array).
const sentBody = {
  type: 'dock_screen_evidence',
  version: 1,
  images: [
    {
      image: 1,
      attachment_id: 'shot-1',
      size: [1440, 900],
      scale: 2,
      marks: [{ n: 1, tool: 'box', geometry: { kind: 'rect', x: 10, y: 10, w: 40, h: 20 } }],
    },
    {
      image: 2,
      attachment_id: 'shot-2',
      size: [1440, 900],
      scale: 2,
      marks: [
        {
          n: 2,
          tool: 'pen',
          geometry: {
            kind: 'path',
            points: [
              [1, 1],
              [9, 9],
            ],
          },
        },
      ],
    },
  ],
  clips: [
    {
      clip: 1,
      attachment_id: 'rec-1',
      duration_ms: 4000,
      has_mic_audio: true,
      mark_timestamps_ms: {},
    },
    {
      clip: 2,
      attachment_id: 'rec-2',
      duration_ms: 3000,
      has_mic_audio: true,
      mark_timestamps_ms: {},
    },
  ],
};
const prefix = (body: unknown) =>
  `${DOCK_EVIDENCE_CONTEXT_HEADER}\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;
const metadata = {
  type: 'dock_screen_evidence',
  version: 1,
  images: [
    { index: 0, marks: [{ n: 1, tool: 'box', element: null }] },
    { index: 1, marks: [{ n: 2, tool: 'pen', element: { role: 'button', name: 'Save' } }] },
  ],
  clips: [{ attachment_id: 'rec-1' }, { attachment_id: 'rec-2' }],
};
const words = 'these [[mark:1]] lines and [[mark:2]] [[clip:1]] as I dragged [[clip:1:end]] done';

function message(text: string, meta: Record<string, unknown> | undefined): AgentMessage {
  return {
    id: 'sent-1',
    role: 'user',
    timestamp: new Date('2026-10-30T18:00:00Z'),
    ...(meta ? { metadata: meta as never } : {}),
    contentBlocks: [
      { type: 'text', text },
      { type: 'image', attachmentId: 'shot-1', mimeType: 'image/png' },
      { type: 'image', attachmentId: 'shot-2', mimeType: 'image/png' },
      {
        type: 'file',
        attachmentId: 'rec-1',
        fileName: 'clip-e6206ea4.mp4',
        mimeType: 'video/mp4',
        size: 10,
      },
      {
        type: 'file',
        attachmentId: 'rec-2',
        fileName: 'clip-b4bb5577.mp4',
        mimeType: 'video/mp4',
        size: 10,
      },
    ],
  };
}

describe('a sent dock message with screen evidence in the transcript', () => {
  it('shows only the words, with the composer chips, and recordings by number', () => {
    renderDisplay(ChatMessage, {
      props: { message: message(`${prefix(sentBody)}\n\n${words}`, metadata) },
    });
    const surface = view.getByTestId('user-message-surface');
    expect(surface.textContent).not.toContain('Screen evidence');
    expect(surface.textContent).not.toContain('dock_screen_evidence');
    expect(surface.textContent).not.toContain('[[');
    expect(view.getByRole('img', { name: 'Reference 1: Box' }).textContent).toBe('1');
    expect(view.getByRole('img', { name: 'Reference 2: Save' }).textContent).toBe('2');
    expect(view.getByRole('img', { name: 'Recording 1' })).toBeTruthy();
    expect(view.getByRole('img', { name: 'Recording 1 ends' })).toBeTruthy();
    const files = view.getAllByTestId('chat-message-file-chip').map((chip) => chip.textContent);
    expect(files.join(' ')).toContain('Recording 1');
    expect(files.join(' ')).toContain('Recording 2');
    expect(files.join(' ')).not.toContain('clip-');
  });

  it('trusts the metadata for a newer evidence body, but text alone needs a valid body', () => {
    const newer = { type: 'dock_screen_evidence', version: 2, anything: [1, 2, 3] };
    renderDisplay(ChatMessage, {
      props: { message: message(`${prefix(newer)}\n\nhello [[mark:1]]`, metadata) },
    });
    expect(view.getByTestId('user-message-surface').textContent).not.toContain('Screen evidence');
  });

  it('never hides user-written json, and leaves brackets alone without evidence', () => {
    const own = 'my config:\n```json\n{"type":"dock_screen_evidence"}\n```\nsee [[mark:1]]';
    renderDisplay(ChatMessage, { props: { message: message(own, undefined) } });
    const surface = view.getByTestId('user-message-surface');
    expect(surface.textContent).toContain('dock_screen_evidence');
    expect(surface.textContent).toContain('[[mark:1]]');
    expect(view.queryByRole('img', { name: /^Reference/ })).toBeNull();
  });
});
