/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import type { FileBlock, ImageBlock } from '$lib/client/app-client';

const { errorNotice } = vi.hoisted(() => ({ errorNotice: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: errorNotice } }));
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
import { LiveAgentsClient } from '$lib/client/live/live-agents-client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';

const header =
  '[Screen evidence: screenshots lead the attached images in this order; [[mark:n]] in the message refers to mark n; [[clip:n]] and [[clip:n:end]] mark where recording n started and stopped while the user was speaking]';
const wireBody = {
  type: 'dock_screen_evidence',
  version: 1,
  images: [
    {
      image: 1,
      size: [640, 480],
      scale: 1,
      marks: [
        {
          n: 1,
          tool: 'box',
          geometry: { kind: 'rect', x: 20, y: 20, w: 40, h: 40 },
        },
      ],
    },
  ],
  clip: {
    attachment_id: 'clip-1',
    duration_ms: 2000,
    has_mic_audio: false,
    mark_timestamps_ms: { '1': 1500 },
  },
};
const evidence = (body: unknown = wireBody) =>
  `${header}\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;
const image: ImageBlock = { type: 'image', attachmentId: 'image-1', mimeType: 'image/png' };
const clip: FileBlock = {
  type: 'file',
  attachmentId: 'clip-1',
  fileName: 'screen.webm',
  mimeType: 'video/webm',
  size: 200,
};

describe('screen evidence confirmation through the real edit client (closed transport)', () => {
  let backend: MockBackendHandle;
  beforeEach(() => {
    errorNotice.mockClear();
    backend = installMockBackend();
    backend.onRequest('agent.editAndRegenerate', () => ({ success: true }));
  });
  afterEach(resetMockBackend);

  async function begin(prefix = evidence(), prompt = 'Fix [[mark:1]].') {
    const message: AgentMessage = {
      id: 'message-1',
      role: 'user',
      timestamp: new Date('2026-10-29T12:00:00Z'),
      contentBlocks: [{ type: 'text', text: `${prefix}\n\n${prompt}` }, image, clip],
    };
    const client = new LiveAgentsClient();
    render(ChatMessage, {
      props: {
        message,
        onEditSubmit: (content, model, blocks) => {
          // ChatPanel forwards these arguments to its edit owner unchanged. Exercise
          // the actual RPC client here; no real bridge or daemon can be reached.
          void client.editAndRegenerate({
            agentId: 'agent-1',
            workspaceId: 'workspace-1',
            messageId: message.id,
            content,
            model,
            ...blocks,
          });
        },
      },
    });
    // Display (prefix hidden, tokens as chips) is covered by ChatMessage-evidence-display.
    await fireEvent.dblClick(screen.getByTestId('user-message-surface'));
    await waitFor(() => expect(screen.getByTestId('mock-rich-input')).toBeTruthy());
  }
  async function confirm() {
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Edit & regenerate' }));
  }
  const edits = () =>
    backend.requests.filter((request) => request.method === 'agent.editAndRegenerate');

  it.each(['Fix [[mark:1]].', 'Keep [[mark:1]] but change the shadow.', ''])(
    'preserves exact prefix and media for edited text %j',
    async (text) => {
      await begin(evidence(), text === '' ? '' : 'Fix [[mark:1]].');
      await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
        target: { value: text },
      });
      await confirm();
      await waitFor(() => expect(edits()).toHaveLength(1));
      expect(edits()[0].params).toEqual({
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        messageId: 'message-1',
        content: `${evidence()}\n\n${text}`,
        imageBlocks: [image],
        fileBlocks: [clip],
      });
      expect(errorNotice).not.toHaveBeenCalled();
    },
  );

  it('honors explicit removal of the evidence context without renumbering the text or dropping media', async () => {
    await begin();
    await fireEvent.click(screen.getByTestId('mock-context-edit-screen-evidence-0'));
    await confirm();
    await waitFor(() => expect(edits()).toHaveLength(1));
    expect(edits()[0].params).toMatchObject({
      content: 'Fix [[mark:1]].',
      imageBlocks: [image],
      fileBlocks: [clip],
    });
  });

  it.each(['image-attachment-image-1', 'attachment-clip-1'])(
    'rejects retained evidence when referenced media %s is removed',
    async (id) => {
      await begin();
      await fireEvent.click(screen.getByTestId(`mock-context-${id}`));
      await confirm();
      expect(edits()).toHaveLength(0);
      expect(errorNotice).toHaveBeenCalledOnce();
      expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
        'Fix [[mark:1]].',
      );
      // Removing the evidence context explicitly resolves the invalid association.
      await fireEvent.click(screen.getByTestId('mock-context-edit-screen-evidence-0'));
      await confirm();
      await waitFor(() => expect(edits()).toHaveLength(1));
      expect(edits()[0].params).toMatchObject({ content: 'Fix [[mark:1]].' });
    },
  );

  it.each([evidence({ ...wireBody, version: 2 }), `${header}\n\`\`\`json\n{invalid}\n\`\`\``])(
    'does not consume or prepend malformed/unknown context',
    async (prefix) => {
      await begin(prefix);
      await confirm();
      await waitFor(() => expect(edits()).toHaveLength(1));
      expect(edits()[0].params).toMatchObject({
        content: `${prefix}\n\nFix [[mark:1]].`,
        imageBlocks: [image],
        fileBlocks: [clip],
      });
    },
  );
});
