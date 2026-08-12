import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { ChatTranscriptReconciler } from '$lib/client/live/live-chat-client';

// Mock Redux store and selectors
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: Object.assign(
    () => ({
      subscribe: (run: (value: string | null) => void) => {
        run(null);
        return () => {};
      },
    }),
    { select: () => null },
  ),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    () => ({
      subscribe: (run: (value: any[]) => void) => {
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
      subscribe: (run: (value: any) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import ChatMessage from '../ChatMessage.svelte';

describe('ChatMessage image lightbox', () => {
  const mockImageData =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const mockImageMimeType = 'image/png';

  function createMessageWithImage(): AgentMessage {
    return {
      id: 'msg-1',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'Here is an image:' },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  function createMessageWithMultipleImages(): AgentMessage {
    return {
      id: 'msg-2',
      role: 'user',
      contentBlocks: [
        { type: 'text', text: 'Here are two images:' },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  function createAssistantMessageWithImage(): AgentMessage {
    return {
      id: 'msg-agent-image',
      role: 'assistant',
      contentBlocks: [
        { type: 'text', text: 'Here is the generated image.' },
        { type: 'image', data: mockImageData, mimeType: mockImageMimeType },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  function createAssistantMessageWithToolImage(): AgentMessage {
    return {
      id: 'msg-agent-tool-image',
      role: 'assistant',
      contentBlocks: [
        { type: 'tool_use', id: 'tool-image', name: 'screenshot', input: {} },
        {
          type: 'tool_result',
          tool_use_id: 'tool-image',
          output: [{ type: 'image', data: mockImageData, mimeType: mockImageMimeType }],
        },
      ],
      timestamp: new Date('2024-01-01T12:00:00Z'),
    };
  }

  it('renders an assistant image block inline and opens it full size', async () => {
    render(ChatMessage, { props: { message: createAssistantMessageWithImage() } });

    const image = screen.getByRole('img', { name: 'Image from agent' });
    expect(image.getAttribute('src')).toBe(`data:${mockImageMimeType};base64,${mockImageData}`);

    await fireEvent.click(screen.getByRole('button', { name: 'View image from agent full size' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });
  });

  it('renders an image block delivered by a live chat delta', () => {
    const reconciler = new ChatTranscriptReconciler();
    reconciler.applySnapshot(0, {
      agentId: 'agent-image',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });
    expect(
      reconciler.applyDelta(1, {
        added: [
          {
            messageId: 'msg-live-image',
            role: 'assistant',
            block: {
              type: 'image',
              id: 'msg-live-image:0',
              data: mockImageData,
              mimeType: mockImageMimeType,
            },
          },
        ],
        updated: [],
        removedIds: [],
      }),
    ).toBe('applied');

    const message = reconciler.transcript().messages[0];
    expect(message.contentBlocks?.[0]).toMatchObject({
      type: 'image',
      data: mockImageData,
      mimeType: mockImageMimeType,
    });
    render(ChatMessage, { props: { message } });

    expect(screen.getByRole('img', { name: 'Image from agent' }).getAttribute('src')).toBe(
      `data:${mockImageMimeType};base64,${mockImageData}`,
    );
  });

  it('renders protocol-shaped image content returned by an agent tool', () => {
    render(ChatMessage, { props: { message: createAssistantMessageWithToolImage() } });

    const image = screen.getByRole('img', { name: 'Attached image 1' });
    expect(image.getAttribute('src')).toBe(`data:${mockImageMimeType};base64,${mockImageData}`);
  });

  it('opens lightbox when image thumbnail is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    // Find the image button
    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    expect(imageButton).toBeTruthy();

    // Click the image
    await fireEvent.click(imageButton);

    // Check if lightbox dialog appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('hides attachment thumbnails while the user message is sticky', async () => {
    const message = createMessageWithImage();
    const { rerender } = render(ChatMessage, { props: { message, isSticky: false } });
    const thumbnailName = /view attached image 1 of 1 full size/i;

    expect(screen.getByRole('button', { name: thumbnailName })).toBeTruthy();

    await rerender({ message, isSticky: true });

    expect(screen.queryByRole('button', { name: thumbnailName })).toBeNull();
    expect(screen.getByText('Here is an image:')).toBeTruthy();
  });

  it('opens lightbox with Enter key', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });

    // Press Enter key
    await fireEvent.keyDown(imageButton, { key: 'Enter' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('opens lightbox with Space key', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });

    // Press Space key
    await fireEvent.keyDown(imageButton, { key: ' ' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('closes lightbox when Escape is pressed', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Press Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when close button is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click close button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when backdrop is clicked', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click the backdrop (dialog element itself)
    const dialog = screen.getByRole('dialog', { name: /image preview/i });
    await fireEvent.click(dialog);

    // Lightbox should close and focus should return to image button
    await waitFor(() => {
      const dialogAfter = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialogAfter).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('returns focus to image button when closed via Escape', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('returns focus to image button when closed via X button', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via X button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButton);
    });
  });

  it('handles multiple images in a single message', async () => {
    const message = createMessageWithMultipleImages();
    render(ChatMessage, { props: { message } });

    // Should have two image buttons
    const imageButtons = screen.getAllByRole('button', {
      name: /view attached image \d of \d full size/i,
    });
    expect(imageButtons).toHaveLength(2);

    // Click the first image
    await fireEvent.click(imageButtons[0]);

    // Lightbox should open
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close it
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
    });

    // Click the second image
    await fireEvent.click(imageButtons[1]);

    // Lightbox should open again
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Focus should return to second button when closed
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(imageButtons[1]);
    });
  });

  it('renders zoom controls in the lightbox', async () => {
    const message = createMessageWithImage();
    render(ChatMessage, { props: { message } });

    const imageButton = screen.getByRole('button', {
      name: /view attached image 1 of 1 full size/i,
    });
    await fireEvent.click(imageButton);

    // Zoom controls should render inside the lightbox
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: /zoom controls/i })).toBeTruthy();
    });
    expect(screen.getByRole('slider', { name: /zoom level/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeTruthy();
  });
});
